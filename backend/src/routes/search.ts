import express from 'express';
import type { Request, Response } from 'express';
import type { ComparisonFilter, CompoundFilter } from 'openai/resources/shared';
import { requireAuth } from '../middleware/auth';
import { config } from '../config';
import { openai } from '../openaiClient';
import { isKnownDocumentType } from '../templates';
import { getDb } from '../db';

const router = express.Router();

interface SearchRequestBody {
  query: string;
  document_type?: string;
  provider_name?: string;
  clinic_or_facility?: string;
  date_from?: string;
  date_to?: string;
   keyword?: string;
  include_inactive?: boolean;
}

function buildFilters(body: SearchRequestBody): ComparisonFilter | CompoundFilter | null {
  const filters: ComparisonFilter[] = [];

  if (!body.include_inactive) {
    filters.push({
      key: 'is_active',
      type: 'eq',
      value: true,
    });
  }

  if (body.document_type && isKnownDocumentType(body.document_type)) {
    filters.push({
      key: 'document_type',
      type: 'eq',
      value: body.document_type,
    });
  }

  if (body.provider_name) {
    filters.push({
      key: 'provider_name',
      type: 'eq',
      value: body.provider_name,
    });
  }

  if (body.clinic_or_facility) {
    filters.push({
      key: 'clinic_or_facility',
      type: 'eq',
      value: body.clinic_or_facility,
    });
  }

  if (body.date_from) {
    filters.push({
      key: 'date',
      type: 'gte',
      value: body.date_from,
    });
  }

  if (body.date_to) {
    filters.push({
      key: 'date',
      type: 'lte',
      value: body.date_to,
    });
  }

  if (filters.length === 0) {
    return null;
  }

  if (filters.length === 1) {
    return filters[0];
  }

  const compound: CompoundFilter = {
    type: 'and',
    filters,
  };

  return compound;
}

async function runVectorSearchForDb(
  query: string,
  params: {
    document_type?: string;
    provider_name?: string;
    clinic_or_facility?: string;
    date_from?: string;
    date_to?: string;
  },
): Promise<{ fileIds: string[]; scoresByFileId: Record<string, number> }> {
  if (!config.vectorStoreId) {
    return { fileIds: [], scoresByFileId: {} };
  }

  const body: SearchRequestBody = {
    query,
    document_type: params.document_type,
    provider_name: params.provider_name,
    clinic_or_facility: params.clinic_or_facility,
    date_from: params.date_from,
    date_to: params.date_to,
    // DB search does not filter on is_active, so include inactive files here too.
    include_inactive: true,
  };

  const filters = buildFilters(body);

  const response = await openai.responses.create({
    model: 'gpt-4.1-mini',
    instructions:
      'You are a retrieval assistant for a single patient\'s medical/legal record. ' +
      'Use the file_search tool to retrieve documents relevant to the user query. ' +
      'You do not need to write an answer; we only care about which files you retrieve.',
    input: [
      {
        role: 'user',
        type: 'message',
        content: [
          {
            type: 'input_text',
            text: query,
          },
        ],
      },
    ],
    tools: [
      {
        type: 'file_search',
        vector_store_ids: [config.vectorStoreId],
        max_num_results: 50,
        filters: filters ?? null,
      },
    ],
    include: ['file_search_call.results'],
  });

  const fileSearchCall: any = (response as any).output?.find(
    (item: any) => item.type === 'file_search_call',
  );

  const results = (fileSearchCall?.results ?? []) as any[];

  const fileIds: string[] = [];
  const scoresByFileId: Record<string, number> = {};

  for (const r of results) {
    const fileId = typeof r.file_id === 'string' ? (r.file_id as string) : '';
    if (!fileId) continue;
    if (scoresByFileId[fileId] !== undefined) continue;

    fileIds.push(fileId);
    const score =
      typeof r.score === 'number'
        ? (r.score as number)
        : 0;
    scoresByFileId[fileId] = score;
  }

  return { fileIds, scoresByFileId };
}

// GET /api/search/options
// Return distinct provider_name, clinic_or_facility, and keywords values to populate filters.
router.get('/options', requireAuth, async (_req: Request, res: Response) => {
  try {
    const db = await getDb();

    const [providerRows] = (await db.query(
      `
        SELECT DISTINCT provider_name
        FROM documents
        WHERE provider_name IS NOT NULL AND provider_name <> ''
        ORDER BY provider_name ASC
      `,
    )) as any[];

    const [clinicRows] = (await db.query(
      `
        SELECT DISTINCT clinic_or_facility
        FROM documents
        WHERE clinic_or_facility IS NOT NULL AND clinic_or_facility <> ''
        ORDER BY clinic_or_facility ASC
      `,
    )) as any[];

    const [keywordRows] = (await db.query(
      `
        SELECT metadata_json
        FROM documents
        WHERE JSON_TYPE(metadata_json) = 'OBJECT'
      `,
    )) as any[];

    const providers = Array.isArray(providerRows)
      ? (providerRows as any[]).map((row) => row.provider_name as string)
      : [];
    const clinics = Array.isArray(clinicRows)
      ? (clinicRows as any[]).map(
          (row) => row.clinic_or_facility as string,
        )
      : [];

    const keywordSet = new Set<string>();
    if (Array.isArray(keywordRows)) {
      for (const row of keywordRows as any[]) {
        let meta: any = row.metadata_json;
        if (typeof meta === 'string') {
          try {
            meta = JSON.parse(meta);
          } catch {
            meta = null;
          }
        }

        if (!meta || typeof meta !== 'object') {
          continue;
        }

        const kws = (meta as any).keywords;
        if (Array.isArray(kws)) {
          for (const kw of kws) {
            if (typeof kw !== 'string') continue;
            const trimmed = kw.trim();
            if (!trimmed) continue;
            keywordSet.add(trimmed);
          }
        }
      }
    }

    const keywords = Array.from(keywordSet).sort((a, b) =>
      a.localeCompare(b),
    );

    res.json({ providers, clinics, keywords });
  } catch (error) {
    console.error('Error in GET /api/search/options:', error);
    res.status(500).json({ error: 'Failed to load search options' });
  }
});

// GET /api/search/db
// Simple DB-backed search over the documents table using basic filters.
// Query params: document_type?, provider_name?, clinic_or_facility?, date_from?, date_to?, keyword?, query?
router.get('/db', requireAuth, async (req: Request, res: Response) => {
  try {
    const {
      document_type,
      provider_name,
      clinic_or_facility,
      date_from,
      date_to,
      keyword,
      query,
    } = req.query as {
      document_type?: string;
      provider_name?: string;
      clinic_or_facility?: string;
      date_from?: string;
      date_to?: string;
      keyword?: string;
      query?: string;
    };

    const searchQuery = (query || '').trim();

    const where: string[] = [];
    const params: any[] = [];

    if (document_type && isKnownDocumentType(document_type)) {
      where.push('document_type = ?');
      params.push(document_type);
    }

    if (provider_name && provider_name.trim() !== '') {
      where.push('provider_name = ?');
      params.push(provider_name.trim());
    }

    if (clinic_or_facility && clinic_or_facility.trim() !== '') {
      where.push('clinic_or_facility = ?');
      params.push(clinic_or_facility.trim());
    }

    if (date_from && date_from.trim() !== '') {
      where.push('date >= ?');
      params.push(date_from.trim());
    }

    if (date_to && date_to.trim() !== '') {
      where.push('date <= ?');
      params.push(date_to.trim());
    }

    if (keyword && keyword.trim() !== '') {
      where.push(
        "JSON_CONTAINS(metadata_json, JSON_QUOTE(?), '$.keywords')",
      );
      params.push(keyword.trim());
    }

    // If a natural-language query is provided, use vector search to
    // identify relevant files and intersect that with the DB filters.
    let scoresByFileId: Record<string, number> = {};
    if (searchQuery) {
      if (!config.vectorStoreId) {
        console.warn(
          'Vector search query provided but ARGUS_VECTOR_STORE_ID is not configured; falling back to DB-only filters.',
        );
      } else {
        const { fileIds, scoresByFileId: scores } = await runVectorSearchForDb(
          searchQuery,
          {
            document_type,
            provider_name,
            clinic_or_facility,
            date_from,
            date_to,
          },
        );

        // If nothing matched the vector search, short-circuit with empty results.
        if (fileIds.length === 0) {
          res.json({ items: [] });
          return;
        }

        scoresByFileId = scores;

        const placeholders = fileIds.map(() => '?').join(', ');
        where.push(`openai_file_id IN (${placeholders})`);
        params.push(...fileIds);
      }
    }

    const db = await getDb();
    const sql = `
      SELECT
        vector_store_file_id,
        openai_file_id,
        filename,
        document_type,
        date,
        provider_name,
        clinic_or_facility
      FROM documents
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY date DESC, created_at DESC
    `;

    const [rows] = (await db.query(sql, params)) as any[];
    let items = (Array.isArray(rows) ? rows : []).map((row) => {
      const dateValue = row.date as Date | string | null;
      const dateStr =
        !dateValue
          ? ''
          : typeof dateValue === 'string'
          ? dateValue
          : (dateValue as Date).toISOString().slice(0, 10);

      const fileId = row.openai_file_id as string;
      const score =
        searchQuery && Object.prototype.hasOwnProperty.call(scoresByFileId, fileId)
          ? (scoresByFileId[fileId] as number)
          : null;

      return {
        id: row.vector_store_file_id as string,
        fileId,
        filename: row.filename as string,
        documentType: row.document_type as string,
        date: dateStr,
        providerName: (row.provider_name as string | null) ?? '',
        clinicOrFacility: (row.clinic_or_facility as string | null) ?? '',
        score,
      };
    });

    // When vector search is used, re-sort results by relevance score
    // (descending), falling back to date ordering when scores are equal.
    if (searchQuery && Object.keys(scoresByFileId).length > 0) {
      items = items.sort((a, b) => {
        const sa = typeof a.score === 'number' ? a.score : 0;
        const sb = typeof b.score === 'number' ? b.score : 0;
        if (sa !== sb) {
          return sb - sa;
        }

        const da = a.date || '';
        const dbDate = b.date || '';
        if (da === dbDate) return 0;
        return da < dbDate ? 1 : -1;
      });
    }

    res.json({ items });
  } catch (error) {
    console.error('Error in GET /api/search/db:', error);
    res.status(500).json({ error: 'DB search failed' });
  }
});

// POST /api/search
// Body: { query: string, document_type?, provider_name?, clinic_or_facility?, date_from?, date_to? }
// Returns: { answer: string, citations: [...] }
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!config.vectorStoreId) {
      res.status(500).json({ error: 'ARGUS_VECTOR_STORE_ID not configured' });
      return;
    }

    const body = req.body as SearchRequestBody;
    const query = (body.query || '').trim();

    if (!query) {
      res.status(400).json({ error: 'query is required' });
      return;
    }

    const filters = buildFilters(body);

    const response = await openai.responses.create({
      model: 'gpt-4.1',
      instructions:
        'You are a retrieval assistant for a single patient\'s medical/legal record. ' +
        'Use the file_search tool to answer questions using the most relevant snippets. ' +
        'Prefer concise answers (2-4 sentences) and, when appropriate, mention provider, date, and document type.',
      input: [
        {
          role: 'user',
          type: 'message',
          content: [
            {
              type: 'input_text',
              text: `User query:\n${query}\n\nIf you cannot find relevant information in the documents, say so explicitly.`,
            },
          ],
        },
      ],
      tools: [
        {
          type: 'file_search',
          vector_store_ids: [config.vectorStoreId],
          max_num_results: 8,
          filters: filters ?? null,
        },
      ],
      include: ['file_search_call.results'],
      text: {
        verbosity: 'medium',
      },
    });

    const answerText: string =
      (response as any).output_text ??
      ((response as any).output?.find((item: any) => item.type === 'message')?.content?.[0]?.text ??
        '');

    const fileSearchCall: any = (response as any).output?.find(
      (item: any) => item.type === 'file_search_call',
    );

    const citations =
      fileSearchCall?.results?.map((r: any) => ({
        fileId: r.file_id as string,
        filename: r.filename as string,
        score: r.score as number,
        snippet: r.text as string,
        attributes: r.attributes ?? null,
      })) ?? [];

    res.json({
      query,
      filters: body,
      answer: answerText,
      citations,
    });
  } catch (error) {
    console.error('Error in POST /api/search:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

export default router;

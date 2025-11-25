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

// GET /api/search/options
// Return distinct provider_name and clinic_or_facility values to populate filters.
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

    const providers = Array.isArray(providerRows)
      ? (providerRows as any[]).map((row) => row.provider_name as string)
      : [];
    const clinics = Array.isArray(clinicRows)
      ? (clinicRows as any[]).map(
          (row) => row.clinic_or_facility as string,
        )
      : [];

    res.json({ providers, clinics });
  } catch (error) {
    console.error('Error in GET /api/search/options:', error);
    res.status(500).json({ error: 'Failed to load search options' });
  }
});

// GET /api/search/db
// Simple DB-backed search over the documents table using basic filters.
// Query params: document_type?, provider_name?, clinic_or_facility?, date_from?, date_to?
router.get('/db', requireAuth, async (req: Request, res: Response) => {
  try {
    const {
      document_type,
      provider_name,
      clinic_or_facility,
      date_from,
      date_to,
    } = req.query as {
      document_type?: string;
      provider_name?: string;
      clinic_or_facility?: string;
      date_from?: string;
      date_to?: string;
    };

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
    const items = (Array.isArray(rows) ? rows : []).map((row) => {
      const dateValue = row.date as Date | string | null;
      const dateStr =
        !dateValue
          ? ''
          : typeof dateValue === 'string'
          ? dateValue
          : (dateValue as Date).toISOString().slice(0, 10);

      return {
        id: row.vector_store_file_id as string,
        fileId: row.openai_file_id as string,
        filename: row.filename as string,
        documentType: row.document_type as string,
        date: dateStr,
        providerName: (row.provider_name as string | null) ?? '',
        clinicOrFacility: (row.clinic_or_facility as string | null) ?? '',
      };
    });

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

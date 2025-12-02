import express from 'express';
import type { Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { isKnownDocumentType } from '../templates';
import { getDb } from '../db';

const router = express.Router();
type TextSearchRow = {
  terms: string[];
};

// GET /api/search/options
// Return distinct provider_name, clinic_or_facility, and taxonomy values to populate filters.
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

    const [taxonomyCategoryRows] = (await db.query(
      `
        SELECT id, label
        FROM taxonomy_categories
        ORDER BY label ASC
      `,
    )) as any[];

    const [taxonomyKeywordRows] = (await db.query(
      `
        SELECT k.id, k.category_id, k.label
        FROM taxonomy_keywords k
        WHERE
          k.status IN ('approved','review')
          AND EXISTS (
            SELECT 1
            FROM document_terms dt
            WHERE dt.keyword_id = k.id
          )
        ORDER BY k.label ASC
      `,
    )) as any[];

    const [taxonomySubkeywordRows] = (await db.query(
      `
        SELECT s.id, s.keyword_id, s.label
        FROM taxonomy_subkeywords s
        WHERE
          s.status IN ('approved','review')
          AND EXISTS (
            SELECT 1
            FROM document_terms dt
            WHERE dt.subkeyword_id = s.id
          )
        ORDER BY s.label ASC
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

    const taxonomyCategories = Array.isArray(taxonomyCategoryRows)
      ? (taxonomyCategoryRows as any[]).map((row) => ({
          id: row.id as string,
          label: row.label as string,
        }))
      : [];

    const taxonomyKeywords = Array.isArray(taxonomyKeywordRows)
      ? (taxonomyKeywordRows as any[])
          .map((row) => ({
            id: row.id as string,
            categoryId: row.category_id as string,
            label: row.label as string,
          }))
          // Hide internal "any_mention" keywords from the facet dropdown; the
          // "Any mention" behavior is driven by category-only filters instead.
          .filter((kw) => !kw.id.endsWith('.any_mention'))
          // For Mental Health, hide legacy granular medication/presentation keywords
          // that are being normalized into canonical ids.
          .filter((kw) => {
            if (kw.categoryId !== 'mental_health') return true;
            const legacyIds = new Set([
              'mental_health.antidepressant_medication',
              'mental_health.antidepressant_medication_use',
              'mental_health.emotionally_labile',
              'mental_health.pressured_speech',
              'mental_health.combative_or_hostile',
              'mental_health.emotionally_distressed',
              'mental_health.non_compliant',
            ]);
            return !legacyIds.has(kw.id);
          })
      : [];

    const taxonomySubkeywords = Array.isArray(taxonomySubkeywordRows)
      ? (taxonomySubkeywordRows as any[]).map((row) => ({
          id: row.id as string,
          keywordId: row.keyword_id as string,
          label: row.label as string,
        }))
      : [];

    res.json({
      providers,
      clinics,
      taxonomyCategories,
      taxonomyKeywords,
      taxonomySubkeywords,
    });
  } catch (error) {
    console.error('Error in GET /api/search/options:', error);
    res.status(500).json({ error: 'Failed to load search options' });
  }
});

// GET /api/search/db
// Simple DB-backed search over the documents table using basic filters.
// Query params:
//   document_type?, provider_name?, clinic_or_facility?, date_from?, date_to?,
//   taxonomy_category_id?, taxonomy_keyword_id?, taxonomy_subkeyword_id?
router.get('/db', requireAuth, async (req: Request, res: Response) => {
  try {
    const {
      document_type,
      provider_name,
      clinic_or_facility,
      date_from,
      date_to,
      taxonomy_category_id,
      taxonomy_keyword_id,
      taxonomy_subkeyword_id,
    } = req.query as {
      document_type?: string;
      provider_name?: string;
      clinic_or_facility?: string;
      date_from?: string;
      date_to?: string;
      taxonomy_category_id?: string;
      taxonomy_keyword_id?: string;
      taxonomy_subkeyword_id?: string;
    };

    const taxonomyCategoryId = (taxonomy_category_id || '').trim();
    const taxonomyKeywordId = (taxonomy_keyword_id || '').trim();
    const taxonomySubkeywordId = (taxonomy_subkeyword_id || '').trim();

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

    let join = '';
    if (taxonomyCategoryId || taxonomySubkeywordId || taxonomyKeywordId) {
      join = 'JOIN document_terms dt ON dt.document_id = d.id';
      if (taxonomySubkeywordId) {
        where.push('dt.subkeyword_id = ?');
        params.push(taxonomySubkeywordId);
      } else if (taxonomyKeywordId) {
        where.push('dt.keyword_id = ?');
        params.push(taxonomyKeywordId);
      }

      if (taxonomyCategoryId) {
        join += ' JOIN taxonomy_keywords tk ON tk.id = dt.keyword_id';
        where.push('tk.category_id = ?');
        params.push(taxonomyCategoryId);
      }
    }

    const db = await getDb();
    const sql = `
      SELECT DISTINCT
        d.vector_store_file_id,
        d.openai_file_id,
        d.filename,
        d.document_type,
        d.date,
        d.provider_name,
        d.clinic_or_facility
      FROM documents d
      ${join}
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY d.date DESC, d.created_at DESC
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

// POST /api/search/db
// JSON body:
// {
//   document_type?: string;
//   provider_name?: string;
//   clinic_or_facility?: string;
//   date_from?: string;
//   date_to?: string;
//   taxonomy_category_id?: string;
//   taxonomy_keyword_id?: string;
//   taxonomy_subkeyword_id?: string;
//   text?: { rows?: { terms?: string[] }[] };
// }
router.post('/db', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      document_type?: string;
      provider_name?: string;
      clinic_or_facility?: string;
      date_from?: string;
      date_to?: string;
      taxonomy_category_id?: string;
      taxonomy_keyword_id?: string;
      taxonomy_subkeyword_id?: string;
      text?: { rows?: TextSearchRow[] };
    };

    const taxonomyCategoryId = (body.taxonomy_category_id || '').trim();
    const taxonomyKeywordId = (body.taxonomy_keyword_id || '').trim();
    const taxonomySubkeywordId = (body.taxonomy_subkeyword_id || '').trim();

    const where: string[] = [];
    const params: any[] = [];

    if (body.document_type && isKnownDocumentType(body.document_type)) {
      where.push('d.document_type = ?');
      params.push(body.document_type);
    }

    if (body.provider_name && body.provider_name.trim() !== '') {
      where.push('d.provider_name = ?');
      params.push(body.provider_name.trim());
    }

    if (body.clinic_or_facility && body.clinic_or_facility.trim() !== '') {
      where.push('d.clinic_or_facility = ?');
      params.push(body.clinic_or_facility.trim());
    }

    if (body.date_from && body.date_from.trim() !== '') {
      where.push('d.date >= ?');
      params.push(body.date_from.trim());
    }

    if (body.date_to && body.date_to.trim() !== '') {
      where.push('d.date <= ?');
      params.push(body.date_to.trim());
    }

    let join = '';
    if (taxonomyCategoryId || taxonomySubkeywordId || taxonomyKeywordId) {
      join = 'JOIN document_terms dt ON dt.document_id = d.id';
      if (taxonomySubkeywordId) {
        where.push('dt.subkeyword_id = ?');
        params.push(taxonomySubkeywordId);
      } else if (taxonomyKeywordId) {
        where.push('dt.keyword_id = ?');
        params.push(taxonomyKeywordId);
      }

      if (taxonomyCategoryId) {
        join += ' JOIN taxonomy_keywords tk ON tk.id = dt.keyword_id';
        where.push('tk.category_id = ?');
        params.push(taxonomyCategoryId);
      }
    }

    // Text search: rows are AND; terms within a row are OR.
    const textRows = body.text?.rows ?? [];
    const normalizedRows: string[][] = [];

    for (const row of textRows) {
      if (!row || !Array.isArray(row.terms)) continue;
      const terms = row.terms
        .map((t) => (typeof t === 'string' ? t.trim() : ''))
        .filter((t) => t.length > 0);
      if (terms.length > 0) {
        normalizedRows.push(terms);
      }
    }

    if (normalizedRows.length > 0) {
      for (const rowTerms of normalizedRows) {
        const orParts: string[] = [];
        for (const term of rowTerms) {
          orParts.push('LOWER(d.markdown) LIKE ?');
          params.push(`%${term.toLowerCase()}%`);
        }
        if (orParts.length > 0) {
          where.push(`(${orParts.join(' OR ')})`);
        }
      }
    }

    const db = await getDb();
    const sql = `
      SELECT DISTINCT
        d.vector_store_file_id,
        d.openai_file_id,
        d.filename,
        d.document_type,
        d.date,
        d.provider_name,
        d.clinic_or_facility
      FROM documents d
      ${join}
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY d.date DESC, d.created_at DESC
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
    console.error('Error in POST /api/search/db:', error);
    res.status(500).json({ error: 'DB search failed' });
  }
});

export default router;

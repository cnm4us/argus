import express from 'express';
import type { Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { getDb } from '../db';
import { loadModuleTemplate } from '../templates';
import { openai } from '../openaiClient';
import { logOpenAI } from '../logger';
import { updateDocumentProjectionsForVectorStoreFile } from '../metadataProjections';
import { runTaxonomyExtractionForDocument } from './documents';

type ModuleName =
  | 'provider'
  | 'patient'
  | 'reason_for_encounter'
  | 'vitals'
  | 'smoking'
  | 'sexual_health'
  | 'mental_health'
  | 'referral'
  | 'results'
  | 'communication';

const KNOWN_MODULES: { name: ModuleName; label: string }[] = [
  { name: 'provider', label: 'Provider' },
  { name: 'patient', label: 'Patient' },
  { name: 'reason_for_encounter', label: 'Reason for Encounter' },
  { name: 'vitals', label: 'Vitals' },
  { name: 'smoking', label: 'Smoking' },
  { name: 'sexual_health', label: 'Sexual Health / STI Risk' },
  { name: 'mental_health', label: 'Mental Health' },
  { name: 'referral', label: 'Referrals' },
  { name: 'results', label: 'Results (Labs/Imaging)' },
  { name: 'communication', label: 'Communication' },
];

const router = express.Router();

// GET /api/admin/modules/status
// Summarize how many documents have each module populated.
router.get('/modules/status', requireAuth, async (_req: Request, res: Response) => {
  try {
    const db = await getDb();

    const [countRows] = (await db.query(
      'SELECT COUNT(*) AS total, SUM(CASE WHEN markdown IS NOT NULL THEN 1 ELSE 0 END) AS with_markdown FROM documents',
    )) as any[];

    const totalDocuments =
      Array.isArray(countRows) && countRows.length > 0
        ? Number(countRows[0].total ?? 0)
        : 0;
    const documentsWithMarkdown =
      Array.isArray(countRows) && countRows.length > 0
        ? Number(countRows[0].with_markdown ?? 0)
        : 0;

    const modulesStatus = [];

    for (const m of KNOWN_MODULES) {
      const [rows] = (await db.query(
        `
          SELECT
            SUM(
              CASE
                WHEN JSON_EXTRACT(metadata_json, CONCAT('$.modules."', ?, '"')) IS NOT NULL
                THEN 1 ELSE 0
              END
            ) AS with_module
          FROM documents
        `,
        [m.name],
      )) as any[];

      const withModule =
        Array.isArray(rows) && rows.length > 0
          ? Number(rows[0].with_module ?? 0)
          : 0;

      modulesStatus.push({
        name: m.name,
        label: m.label,
        totalDocuments,
        documentsWithMarkdown,
        documentsWithModule: withModule,
        documentsMissingModule: Math.max(
          documentsWithMarkdown - withModule,
          0,
        ),
      });
    }

    res.json({ modules: modulesStatus });
  } catch (error) {
    console.error('Error in GET /api/admin/modules/status:', error);
    res
      .status(500)
      .json({ error: 'Failed to load module status for admin dashboard' });
  }
});

async function runSingleModuleFromMarkdown(
  moduleName: ModuleName,
  markdown: string,
  fileName: string,
): Promise<any | null> {
  try {
    const template = await loadModuleTemplate(moduleName);

    logOpenAI('admin:moduleExtract:markdown:start', {
      module: moduleName,
      fileName,
    });

    const response = await openai.responses.create({
      model: 'gpt-4.1',
      instructions: template,
      input: [
        {
          role: 'user',
          type: 'message',
          content: [
            {
              type: 'input_text',
              text:
                'Extract this module according to the instructions from the following document (in Markdown) and output strict JSON only.\n\n' +
                markdown,
            },
          ],
        },
      ],
      text: {
        format: { type: 'json_object' },
      },
    });

    const rawText =
      ((response as any).output?.[0]?.content?.[0]?.text as
        string | undefined) ??
      ((response as any).output_text as string | undefined);

    if (!rawText) {
      logOpenAI('admin:moduleExtract:markdown:error', {
        module: moduleName,
        fileName,
        error: { message: 'No text output from module extraction model' },
      });
      return null;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(rawText);
    } catch (err) {
      logOpenAI('admin:moduleExtract:markdown:error', {
        module: moduleName,
        fileName,
        error: {
          message: 'Failed to parse module extraction JSON',
          rawText: rawText.slice(0, 500),
        },
      });
      return null;
    }

    logOpenAI('admin:moduleExtract:markdown:success', {
      module: moduleName,
      fileName,
    });

    return parsed;
  } catch (error) {
    logOpenAI('admin:moduleExtract:markdown:error', {
      module: moduleName,
      fileName,
      status: (error as any)?.status,
      error:
        error instanceof Error
          ? { message: error.message, stack: error.stack }
          : error,
    });
    return null;
  }
}

// POST /api/admin/modules/rebuild
// Body: { module: ModuleName, scope: "missing" | "all", limit?: number }
router.post('/modules/rebuild', requireAuth, async (req: Request, res: Response) => {
  try {
    const { module, scope, limit } = req.body as {
      module?: string;
      scope?: string;
      limit?: number;
    };

    if (!module || !KNOWN_MODULES.find((m) => m.name === module)) {
      res.status(400).json({ error: 'Invalid or missing module name' });
      return;
    }

    const scopeValue = scope === 'all' ? 'all' : 'missing';
    const batchLimit =
      typeof limit === 'number' && Number.isFinite(limit) && limit > 0
        ? Math.min(limit, 250)
        : 100;

    const db = await getDb();

    const whereCondition =
      scopeValue === 'missing'
        ? "markdown IS NOT NULL AND JSON_EXTRACT(metadata_json, CONCAT('$.modules.\"', ?, '\"')) IS NULL"
        : 'markdown IS NOT NULL';

    const params: any[] =
      scopeValue === 'missing' ? [module, batchLimit] : [batchLimit];

    const sql = `
      SELECT
        id,
        vector_store_file_id,
        filename,
        markdown,
        metadata_json
      FROM documents
      WHERE ${whereCondition}
      ORDER BY created_at ASC
      LIMIT ?
    `;

    const [rows] = (await db.query(sql, params)) as any[];
    const docs = Array.isArray(rows) ? (rows as any[]) : [];

    let processed = 0;
    let skipped = 0;

    for (const row of docs) {
      const documentId = row.id as number;
      const vectorStoreFileId = row.vector_store_file_id as string;
      const fileName = (row.filename as string) ?? 'document.pdf';
      const markdown = ((row.markdown as string | null) ?? '').trim();

      if (!markdown) {
        skipped += 1;
        continue;
      }

      let metadata = row.metadata_json;
      if (typeof metadata === 'string') {
        try {
          metadata = JSON.parse(metadata);
        } catch {
          metadata = {};
        }
      }
      if (!metadata || typeof metadata !== 'object') {
        metadata = {};
      }

      const output = await runSingleModuleFromMarkdown(
        module as ModuleName,
        markdown,
        fileName,
      );

      if (!output) {
        skipped += 1;
        continue;
      }

      const metadataObj: any = metadata;
      metadataObj.modules = metadataObj.modules || {};
      metadataObj.modules[module as ModuleName] = output;

      await db.query(
        `
          UPDATE documents
          SET
            metadata_json = ?,
            needs_metadata = 0
          WHERE id = ?
        `,
        [JSON.stringify(metadataObj), documentId],
      );

      await updateDocumentProjectionsForVectorStoreFile(
        vectorStoreFileId,
        metadataObj,
      );

      processed += 1;
    }

    res.json({
      module,
      scope: scopeValue,
      requestedLimit: batchLimit,
      processed,
      skipped,
    });
  } catch (error) {
    console.error('Error in POST /api/admin/modules/rebuild:', error);
    res.status(500).json({ error: 'Failed to rebuild module across documents' });
  }
});

// POST /api/admin/taxonomy/rebuild
// Body: { categoryId?: string, limit?: number }
// When categoryId is provided, only taxonomy terms under that category are cleared and rebuilt.
// When categoryId is omitted/null, all projection-backed categories (vitals, smoking, mental_health, sexual_history) are rebuilt.
router.post(
  '/taxonomy/rebuild',
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const { categoryId, limit } = req.body as {
        categoryId?: string | null;
        limit?: number;
      };

      const projectionCategories = [
        'vitals',
        'smoking',
        'mental_health',
        'sexual_history',
      ];

      const categoriesToRebuild: string[] = [];
      if (typeof categoryId === 'string' && categoryId.trim() !== '') {
        categoriesToRebuild.push(categoryId.trim());
      } else {
        categoriesToRebuild.push(...projectionCategories);
      }

      const db = await getDb();

      // Clear document_terms entries for the selected categories.
      for (const cat of categoriesToRebuild) {
        await db.query(
          `
            DELETE dt
            FROM document_terms dt
            LEFT JOIN taxonomy_keywords tk ON tk.id = dt.keyword_id
            LEFT JOIN taxonomy_subkeywords ts ON ts.id = dt.subkeyword_id
            LEFT JOIN taxonomy_keywords tk2 ON tk2.id = ts.keyword_id
            WHERE tk.category_id = ? OR tk2.category_id = ?
          `,
          [cat, cat],
        );
      }

      const batchLimit =
        typeof limit === 'number' && Number.isFinite(limit) && limit > 0
          ? Math.min(limit, 500)
          : null;

      const [rows] = (await db.query(
        `
          SELECT vector_store_file_id
          FROM documents
          WHERE markdown IS NOT NULL
            AND metadata_json IS NOT NULL
          ORDER BY created_at ASC
          ${batchLimit ? 'LIMIT ?' : ''}
        `,
        batchLimit ? [batchLimit] : [],
      )) as any[];

      const docs = Array.isArray(rows) ? (rows as any[]) : [];

      let processed = 0;

      for (const row of docs) {
        const vectorStoreFileId = row.vector_store_file_id as string;
        await updateDocumentProjectionsForVectorStoreFile(
          vectorStoreFileId,
          null,
        );
        processed += 1;
      }

      res.json({
        categoryId: categoriesToRebuild.length === 1 ? categoriesToRebuild[0] : null,
        categoriesRebuilt: categoriesToRebuild,
        processed,
      });
    } catch (error) {
      console.error('Error in POST /api/admin/taxonomy/rebuild:', error);
      res
        .status(500)
        .json({ error: 'Failed to rebuild taxonomy terms across documents' });
    }
  },
);

// POST /api/admin/taxonomy/extract
// Body: { categoryId: string, limit?: number }
// Re-run LLM taxonomy extraction for a single category across existing documents.
router.post(
  '/taxonomy/extract',
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const { categoryId, limit } = req.body as {
        categoryId?: string;
        limit?: number;
      };

      if (!categoryId || !categoryId.trim()) {
        res
          .status(400)
          .json({ error: 'categoryId is required for taxonomy extraction' });
        return;
      }

      const db = await getDb();

      // Clear existing terms and evidence for this category across all documents.
      await db.query(
        `
          DELETE dt
          FROM document_terms dt
          LEFT JOIN taxonomy_keywords tk ON tk.id = dt.keyword_id
          LEFT JOIN taxonomy_subkeywords ts ON ts.id = dt.subkeyword_id
          LEFT JOIN taxonomy_keywords tk2 ON tk2.id = ts.keyword_id
          WHERE tk.category_id = ? OR tk2.category_id = ?
        `,
        [categoryId, categoryId],
      );

      await db.query(
        `
          DELETE e
          FROM document_term_evidence e
          LEFT JOIN taxonomy_keywords tk ON tk.id = e.keyword_id
          LEFT JOIN taxonomy_subkeywords ts ON ts.id = e.subkeyword_id
          LEFT JOIN taxonomy_keywords tk2 ON tk2.id = ts.keyword_id
          WHERE tk.category_id = ? OR tk2.category_id = ?
        `,
        [categoryId, categoryId],
      );

      const batchLimit =
        typeof limit === 'number' && Number.isFinite(limit) && limit > 0
          ? Math.min(limit, 250)
          : null;

      const [rows] = (await db.query(
        `
          SELECT id, filename, markdown
          FROM documents
          WHERE markdown IS NOT NULL
          ORDER BY created_at ASC
          ${batchLimit ? 'LIMIT ?' : ''}
        `,
        batchLimit ? [batchLimit] : [],
      )) as any[];

      const docs = Array.isArray(rows) ? (rows as any[]) : [];

      let processed = 0;
      let skipped = 0;

      for (const row of docs) {
        const documentId = row.id as number;
        const fileName = (row.filename as string) ?? 'document.pdf';
        const markdown = ((row.markdown as string | null) ?? '').trim();

        if (!markdown) {
          skipped += 1;
          continue;
        }

        await runTaxonomyExtractionForDocument(
          documentId,
          markdown,
          fileName,
          categoryId,
        );
        processed += 1;
      }

      res.json({
        categoryId,
        processed,
        skipped,
      });
    } catch (error) {
      console.error('Error in POST /api/admin/taxonomy/extract:', error);
      res
        .status(500)
        .json({ error: 'Failed to re-run LLM taxonomy extraction' });
    }
  },
);

export default router;

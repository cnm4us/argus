import express from 'express';
import multer from 'multer';
import type { Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { toFile } from 'openai';
import { requireAuth } from '../middleware/auth';
import { config } from '../config';
import { openai } from '../openaiClient';
import {
  DOCUMENT_TYPES,
  type DocumentType,
  type DocumentMetadata,
} from '../documentTypes';
import { loadTemplateForDocumentType } from '../templates';
import { getDb } from '../db';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB
  },
});

const localFileDir = path.join(__dirname, '..', 'file_store');

function isValidDocumentType(value: string): value is DocumentType {
  return (DOCUMENT_TYPES as readonly string[]).includes(value);
}

async function extractMetadata(
  documentType: DocumentType,
  fileId: string,
  fileName: string,
): Promise<DocumentMetadata | null> {
  try {
    const template = await loadTemplateForDocumentType(documentType);

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
              text: 'Use the provided instructions and this document to produce the requested JSON metadata.',
            },
            {
              type: 'input_file',
              file_id: fileId,
            },
          ],
        },
      ],
      text: {
        format: { type: 'json_object' },
      },
    });

    const rawText =
      ((response as any).output?.[0]?.content?.[0]?.text as string | undefined) ??
      ((response as any).output_text as string | undefined);

    if (!rawText) {
      console.warn('Metadata extraction: no text output from model');
      return null;
    }

    const parsed = JSON.parse(rawText) as DocumentMetadata;

    // Ensure some fields are filled from known context if missing.
    if (!parsed.document_type) {
      parsed.document_type = documentType;
    }
    if (!parsed.file_id) {
      parsed.file_id = fileId;
    }
    if (!parsed.file_name) {
      parsed.file_name = fileName;
    }

    return parsed;
  } catch (error) {
    console.error('Metadata extraction failed:', error);
    return null;
  }
}

// POST /api/documents
// - Accepts a single PDF file and a document_type field.
// - Uploads the file to OpenAI Files.
// - Adds it to the configured vector store with minimal metadata.
router.post(
  '/',
  requireAuth,
  upload.single('file'),
  async (req: Request, res: Response) => {
    try {
      if (!config.vectorStoreId) {
        res.status(500).json({ error: 'ARGUS_VECTOR_STORE_ID not configured' });
        return;
      }

      if (!req.file) {
        res.status(400).json({ error: 'Missing file field "file"' });
        return;
      }

      const asyncFlag = String((req.query as any).async ?? '').toLowerCase();
      const asyncMode = asyncFlag === '1' || asyncFlag === 'true';

      const { originalname, buffer } = req.file;
      const { document_type } = req.body as { document_type?: string };

      if (!document_type || !isValidDocumentType(document_type)) {
        res.status(400).json({
          error: 'Invalid or missing document_type',
          allowed: DOCUMENT_TYPES,
        });
        return;
      }

      // 1) Upload raw file to OpenAI Files
      const file = await openai.files.create({
        file: await toFile(buffer, originalname),
        purpose: 'assistants',
      });

      const attributes: { [key: string]: string | number | boolean } = {
        document_type,
        file_name: originalname,
        file_id: file.id,
        is_active: true,
      };

      // Best-effort save of a local PDF copy for browser viewing.
      try {
        await fs.mkdir(localFileDir, { recursive: true });
        const localPath = path.join(localFileDir, `${file.id}.pdf`);
        await fs.writeFile(localPath, buffer);
        attributes.has_local_copy = true;
      } catch (err) {
        console.warn('Failed to save local PDF copy', err);
      }

      let metadata: DocumentMetadata | null = null;

      if (!asyncMode) {
        // 2) Extract structured metadata using the templates and file.
        metadata = await extractMetadata(
          document_type,
          file.id,
          originalname,
        );

        if (metadata) {
          if (metadata.date) attributes.date = metadata.date;
          if (metadata.provider_name) {
            attributes.provider_name = metadata.provider_name;
          }
          if (metadata.clinic_or_facility) {
            attributes.clinic_or_facility = metadata.clinic_or_facility;
          }
        }
      }

      // 3) Attach to vector store with attributes (including underlying file_id)
      const vectorStoreFile = await openai.vectorStores.files.create(
        config.vectorStoreId,
        {
          file_id: file.id,
          attributes,
        },
      );

      // 4) Persist metadata snapshot into MariaDB.
      try {
        const db = await getDb();
        const dateValue =
          metadata && metadata.date ? metadata.date.slice(0, 10) : null;

        await db.query(
          `
          INSERT INTO documents (
            vector_store_file_id,
            openai_file_id,
            filename,
            document_type,
            date,
            provider_name,
            clinic_or_facility,
            is_active,
            metadata_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
          [
            vectorStoreFile.id,
            file.id,
            originalname,
            document_type,
            dateValue,
            metadata ? metadata.provider_name : null,
            metadata ? metadata.clinic_or_facility : null,
            1,
            JSON.stringify(metadata ?? {}),
          ],
        );
      } catch (err) {
        console.error('Failed to persist document metadata to DB:', err);
      }

      res.status(201).json({
        fileId: file.id,
        vectorStoreFileId: vectorStoreFile.id,
        documentType: document_type,
        filename: originalname,
        ingestionStatus: vectorStoreFile.status,
        metadata,
        async: asyncMode,
      });
    } catch (error) {
      console.error('Error in POST /api/documents:', error);
      res.status(500).json({ error: 'Failed to upload and ingest document' });
    }
  },
);

// GET /api/documents
// List vector store files with basic attributes.
router.get('/', requireAuth, async (_req: Request, res: Response) => {
  try {
    if (!config.vectorStoreId) {
      res.status(500).json({ error: 'ARGUS_VECTOR_STORE_ID not configured' });
      return;
    }

    const page = await openai.vectorStores.files.list(config.vectorStoreId, {
      order: 'desc',
    });

    const items = page.data.map((file) => ({
      id: file.id,
      vectorStoreId: file.vector_store_id,
      status: file.status,
      usageBytes: file.usage_bytes,
      attributes: file.attributes ?? null,
    }));

    res.json({ items });
  } catch (error) {
    console.error('Error in GET /api/documents:', error);
    res.status(500).json({ error: 'Failed to list documents' });
  }
});

// DELETE /api/documents/:id
// Remove a file from the vector store (and delete the underlying File when possible).
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!config.vectorStoreId) {
      res.status(500).json({ error: 'ARGUS_VECTOR_STORE_ID not configured' });
      return;
    }

    const { id } = req.params;

    // Retrieve to discover attributes (including original file_id when available).
    const file = await openai.vectorStores.files.retrieve(id, {
      vector_store_id: config.vectorStoreId,
    });

    const attributes = file.attributes ?? {};
    const underlyingFileId =
      typeof attributes.file_id === 'string' ? (attributes.file_id as string) : undefined;

    // Detach from vector store.
    const deleted = await openai.vectorStores.files.delete(id, {
      vector_store_id: config.vectorStoreId,
    });

    // Best-effort delete of the underlying file; for older entries this may be missing.
    let fileDeleteResult: unknown = null;
    if (underlyingFileId) {
      try {
        fileDeleteResult = await openai.files.delete(underlyingFileId);
      } catch (err) {
        console.warn('Failed to delete underlying file', underlyingFileId, err);
      }
    }

    // Best-effort delete of DB row.
    try {
      const db = await getDb();
      await db.query('DELETE FROM documents WHERE vector_store_file_id = ?', [
        id,
      ]);
    } catch (err) {
      console.error('Failed to delete document row from DB:', err);
    }

    res.json({
      ok: true,
      vectorStoreFileDeleted: deleted,
      underlyingFileDeleted: fileDeleteResult,
    });
  } catch (error) {
    console.error('Error in DELETE /api/documents/:id:', error);
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

// POST /api/documents/:id/soft-delete
// Mark a document as inactive so it is excluded from search but retained in the store.
router.post('/:id/soft-delete', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!config.vectorStoreId) {
      res.status(500).json({ error: 'ARGUS_VECTOR_STORE_ID not configured' });
      return;
    }

    const { id } = req.params;

    const file = await openai.vectorStores.files.retrieve(id, {
      vector_store_id: config.vectorStoreId,
    });

    const attributes = file.attributes ?? {};
    const updated = await openai.vectorStores.files.update(id, {
      vector_store_id: config.vectorStoreId,
      attributes: {
        ...attributes,
        is_active: false,
      },
    });

    try {
      const db = await getDb();
      await db.query(
        'UPDATE documents SET is_active = 0 WHERE vector_store_file_id = ?',
        [id],
      );
    } catch (err) {
      console.error('Failed to update document is_active in DB:', err);
    }

    res.json({
      ok: true,
      file: updated,
    });
  } catch (error) {
    console.error('Error in POST /api/documents/:id/soft-delete:', error);
    res.status(500).json({ error: 'Failed to soft-delete document' });
  }
});

// GET /api/documents/:id
// Retrieve a single vector store file's metadata.
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!config.vectorStoreId) {
      res.status(500).json({ error: 'ARGUS_VECTOR_STORE_ID not configured' });
      return;
    }

    const { id } = req.params;

    const file = await openai.vectorStores.files.retrieve(id, {
      vector_store_id: config.vectorStoreId,
    });

    res.json({
      id: file.id,
      status: file.status,
      usageBytes: file.usage_bytes,
      vectorStoreId: file.vector_store_id,
      attributes: file.attributes ?? null,
      lastError: file.last_error,
    });
  } catch (error) {
    console.error('Error in GET /api/documents/:id:', error);
    res.status(500).json({ error: 'Failed to retrieve document' });
  }
});

// GET /api/documents/:id/metadata
// Run metadata extraction on demand for a given vector store file.
router.get('/:id/metadata', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!config.vectorStoreId) {
      res.status(500).json({ error: 'ARGUS_VECTOR_STORE_ID not configured' });
      return;
    }

    const { id } = req.params;

    // Fast path: if we already have metadata in the DB, return it without
    // re-calling OpenAI.
    try {
      const db = await getDb();
      const [rows] = (await db.query(
        'SELECT metadata_json FROM documents WHERE vector_store_file_id = ? LIMIT 1',
        [id],
      )) as any[];

      if (Array.isArray(rows) && rows.length > 0) {
        const row = rows[0] as any;
        let raw = row.metadata_json;

        // In MariaDB, JSON columns may come back as strings; parse if needed.
        if (typeof raw === 'string') {
          try {
            raw = JSON.parse(raw);
          } catch {
            // If parsing fails, treat as missing and fall through to OpenAI.
            raw = null;
          }
        }

        if (raw && typeof raw === 'object' && Object.keys(raw).length > 0) {
          res.json({ metadata: raw });
          return;
        }
      }
    } catch (err) {
      console.error('Failed to read metadata from DB, falling back to OpenAI:', err);
    }

    const file = await openai.vectorStores.files.retrieve(id, {
      vector_store_id: config.vectorStoreId,
    });

    const attributes = (file.attributes ?? {}) as {
      [key: string]: string | number | boolean;
    };

    const documentTypeRaw = attributes.document_type;
    const fileIdRaw = attributes.file_id;
    const fileNameRaw = attributes.file_name;

    if (typeof documentTypeRaw !== 'string' || !isValidDocumentType(documentTypeRaw)) {
      res.status(400).json({ error: 'Missing or invalid document_type on vector store file' });
      return;
    }
    if (typeof fileIdRaw !== 'string') {
      res.status(400).json({ error: 'Missing file_id attribute on vector store file' });
      return;
    }

    const metadata = await extractMetadata(
      documentTypeRaw,
      fileIdRaw,
      typeof fileNameRaw === 'string' ? fileNameRaw : 'document.pdf',
    );

    if (!metadata) {
      res.status(500).json({ error: 'Metadata extraction failed' });
      return;
    }

    // Update searchable attributes based on latest metadata.
    const updatedAttributes: { [key: string]: string | number | boolean } = {
      ...attributes,
    };

    if (metadata.date) updatedAttributes.date = metadata.date;
    if (metadata.provider_name) updatedAttributes.provider_name = metadata.provider_name;
    if (metadata.clinic_or_facility) {
      updatedAttributes.clinic_or_facility = metadata.clinic_or_facility;
    }

    await openai.vectorStores.files.update(id, {
      vector_store_id: config.vectorStoreId,
      attributes: updatedAttributes,
    });

    // Persist or update metadata snapshot in DB.
    try {
      const db = await getDb();
      const dateValue = metadata.date ? metadata.date.slice(0, 10) : null;

      await db.query(
        `
        INSERT INTO documents (
          vector_store_file_id,
          openai_file_id,
          filename,
          document_type,
          date,
          provider_name,
          clinic_or_facility,
          is_active,
          metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          filename = VALUES(filename),
          document_type = VALUES(document_type),
          date = VALUES(date),
          provider_name = VALUES(provider_name),
          clinic_or_facility = VALUES(clinic_or_facility),
          is_active = VALUES(is_active),
          metadata_json = VALUES(metadata_json)
      `,
        [
          id,
          fileIdRaw,
          typeof fileNameRaw === 'string' ? fileNameRaw : 'document.pdf',
          documentTypeRaw,
          dateValue,
          metadata.provider_name,
          metadata.clinic_or_facility,
          1,
          JSON.stringify(metadata),
        ],
      );
    } catch (err) {
      console.error('Failed to upsert document metadata in DB:', err);
    }

    res.json({ metadata });
  } catch (error) {
    console.error('Error in GET /api/documents/:id/metadata:', error);
    res.status(500).json({ error: 'Failed to extract metadata' });
  }
});

export default router;

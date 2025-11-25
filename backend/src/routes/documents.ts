import express from 'express';
import multer from 'multer';
import type { Request, Response } from 'express';
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
import { uploadPdfToS3, deleteObjectFromS3 } from '../s3Client';
import { logOpenAI } from '../logger';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB
  },
});

function isValidDocumentType(value: string): value is DocumentType {
  return (DOCUMENT_TYPES as readonly string[]).includes(value);
}

async function extractMetadata(
  documentType: DocumentType,
  fileId: string,
  fileName: string,
): Promise<DocumentMetadata | null> {
  const maxAttempts = 3;
  const baseDelayMs = 4000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      logOpenAI('extractMetadata:start', {
        documentType,
        fileId,
        fileName,
        attempt,
      });

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

      logOpenAI('extractMetadata:success', {
        documentType,
        fileId,
        fileName,
        attempt,
      });

      return parsed;
    } catch (error) {
      const status = (error as any)?.status;
      const message =
        error instanceof Error ? error.message : String(error ?? '');

      logOpenAI('extractMetadata:error', {
        attempt,
        status,
        error:
          error instanceof Error
            ? { message: error.message, stack: error.stack }
            : error,
      });

      // Simple retry for OpenAI rate limits (429).
      if (status === 429 && attempt < maxAttempts) {
        const delay = baseDelayMs * attempt;
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      console.error('Metadata extraction failed:', error);
      return null;
    }
  }

  return null;
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
      let s3Key: string | null = null;

      // Best-effort upload of a PDF copy to S3 for browser viewing.
      try {
        s3Key = await uploadPdfToS3(file.id, buffer, originalname);
        attributes.s3_key = s3Key;
      } catch (err) {
        console.warn('Failed to upload PDF to S3', err);
      }

      let metadata: DocumentMetadata | null = null;

      if (!asyncMode) {
        // 2) Extract structured metadata using the templates and file (synchronous path).
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
          attributes.has_metadata = true;
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
            s3_key,
            filename,
            document_type,
            date,
            provider_name,
            clinic_or_facility,
            is_active,
            metadata_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
          [
            vectorStoreFile.id,
            file.id,
            s3Key,
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

      // For async uploads, kick off background metadata extraction so the caller
      // does not have to visit the metadata page to populate it.
      if (asyncMode) {
        (async () => {
          try {
            logOpenAI('backgroundMetadata:start', {
              documentType: document_type,
              fileId: file.id,
              vectorStoreFileId: vectorStoreFile.id,
            });

            const bgMetadata = await extractMetadata(
              document_type,
              file.id,
              originalname,
            );

            if (!bgMetadata) {
              logOpenAI('backgroundMetadata:skip', {
                reason: 'extractMetadata returned null',
                documentType: document_type,
                fileId: file.id,
                vectorStoreFileId: vectorStoreFile.id,
              });
              return;
            }

            const updatedAttributes: {
              [key: string]: string | number | boolean;
            } = {
              ...attributes,
            };

            if (bgMetadata.date) {
              updatedAttributes.date = bgMetadata.date;
            }
            if (bgMetadata.provider_name) {
              updatedAttributes.provider_name = bgMetadata.provider_name;
            }
            if (bgMetadata.clinic_or_facility) {
              updatedAttributes.clinic_or_facility =
                bgMetadata.clinic_or_facility;
            }
            updatedAttributes.has_metadata = true;

            if (config.vectorStoreId) {
              try {
                await openai.vectorStores.files.update(vectorStoreFile.id, {
                  vector_store_id: config.vectorStoreId,
                  attributes: updatedAttributes,
                });
              } catch (err) {
                logOpenAI('backgroundMetadata:attributes_error', {
                  error:
                    err instanceof Error
                      ? { message: err.message, stack: err.stack }
                      : err,
                  vectorStoreFileId: vectorStoreFile.id,
                });
              }
            }

            try {
              const db = await getDb();
              const dateValue = bgMetadata.date
                ? bgMetadata.date.slice(0, 10)
                : null;

              await db.query(
                `
                UPDATE documents
                SET
                  date = ?,
                  provider_name = ?,
                  clinic_or_facility = ?,
                  metadata_json = ?
                WHERE vector_store_file_id = ?
              `,
                [
                  dateValue,
                  bgMetadata.provider_name ?? null,
                  bgMetadata.clinic_or_facility ?? null,
                  JSON.stringify(bgMetadata),
                  vectorStoreFile.id,
                ],
              );
            } catch (err) {
              console.error(
                'Failed to persist background metadata to DB:',
                err,
              );
              logOpenAI('backgroundMetadata:db_error', {
                error:
                  err instanceof Error
                    ? { message: err.message, stack: err.stack }
                    : err,
                vectorStoreFileId: vectorStoreFile.id,
              });
            }

            logOpenAI('backgroundMetadata:success', {
              documentType: document_type,
              fileId: file.id,
              vectorStoreFileId: vectorStoreFile.id,
            });
          } catch (err) {
            console.error('Background metadata extraction failed:', err);
            logOpenAI('backgroundMetadata:error', {
              error:
                err instanceof Error
                  ? { message: err.message, stack: err.stack }
                  : err,
            });
          }
        })();
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

// GET /api/documents/db
// List documents from the local MariaDB snapshot (fast path for the UI).
router.get('/db', requireAuth, async (_req: Request, res: Response) => {
  try {
    const db = await getDb();
    const [rows] = (await db.query(
      `
        SELECT
          vector_store_file_id,
          openai_file_id,
          filename,
          document_type,
          date,
          provider_name,
          clinic_or_facility,
          is_active,
          metadata_json,
          s3_key
        FROM documents
        ORDER BY created_at DESC
      `,
    )) as any[];

    if (!Array.isArray(rows)) {
      res.json({ items: [] });
      return;
    }

    const items = (rows as any[]).map((row) => {
      const vectorStoreFileId = row.vector_store_file_id as string;
      const openaiFileId = row.openai_file_id as string;
      const filename = row.filename as string;
      const documentType = row.document_type as string;
      const dateValue = row.date as Date | string | null;
      const providerName = (row.provider_name as string | null) ?? '';
      const clinicOrFacility = (row.clinic_or_facility as string | null) ?? '';
      const isActiveRaw = row.is_active as number | boolean | null;
      const s3Key = (row.s3_key as string | null) ?? undefined;

      let metadataRaw = row.metadata_json;
      if (typeof metadataRaw === 'string') {
        try {
          metadataRaw = JSON.parse(metadataRaw);
        } catch {
          metadataRaw = null;
        }
      }

      const hasMetadata =
        metadataRaw && typeof metadataRaw === 'object'
          ? Object.keys(metadataRaw).length > 0
          : false;

      const attributes: { [key: string]: string | number | boolean } = {
        file_id: openaiFileId,
        file_name: filename,
        document_type: documentType,
        is_active: isActiveRaw === 1 || isActiveRaw === true,
      };

      if (dateValue) {
        const iso =
          typeof dateValue === 'string'
            ? dateValue
            : (dateValue as Date).toISOString().slice(0, 10);
        attributes.date = iso;
      }

      if (providerName) {
        attributes.provider_name = providerName;
      }

      if (clinicOrFacility) {
        attributes.clinic_or_facility = clinicOrFacility;
      }

      if (s3Key) {
        attributes.s3_key = s3Key;
      }

      if (hasMetadata) {
        attributes.has_metadata = true;
      }

      return {
        id: vectorStoreFileId,
        vectorStoreId: config.vectorStoreId ?? null,
        status: hasMetadata ? 'completed' : 'in_progress',
        usageBytes: 0,
        attributes,
      };
    });

    res.json({ items });
  } catch (error) {
    console.error('Error in GET /api/documents/db:', error);
    res.status(500).json({ error: 'Failed to list documents from DB' });
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
      typeof attributes.file_id === 'string'
        ? (attributes.file_id as string)
        : undefined;
    const s3Key =
      typeof (attributes as any).s3_key === 'string'
        ? ((attributes as any).s3_key as string)
        : undefined;

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

    // Best-effort delete of the S3 object, if present.
    let s3DeleteAttempted = false;
    if (s3Key) {
      s3DeleteAttempted = true;
      await deleteObjectFromS3(s3Key);
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
      s3DeleteAttempted,
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

async function getMetadataFromDb(
  vectorStoreFileId: string,
): Promise<DocumentMetadata | null> {
  try {
    const db = await getDb();
    const [rows] = (await db.query(
      'SELECT metadata_json FROM documents WHERE vector_store_file_id = ? LIMIT 1',
      [vectorStoreFileId],
    )) as any[];

    if (Array.isArray(rows) && rows.length > 0) {
      const row = rows[0] as any;
      let raw = row.metadata_json;

      // In MariaDB, JSON columns may come back as strings; parse if needed.
      if (typeof raw === 'string') {
        try {
          raw = JSON.parse(raw);
        } catch {
          raw = null;
        }
      }

      if (raw && typeof raw === 'object' && Object.keys(raw).length > 0) {
        return raw as DocumentMetadata;
      }
    }
  } catch (err) {
    console.error('Failed to read metadata from DB:', err);
  }

  return null;
}

// GET /api/documents/:id/metadata/db
// Return metadata only from the local DB snapshot, without calling OpenAI.
router.get(
  '/:id/metadata/db',
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const metadata = await getMetadataFromDb(id);
      if (!metadata) {
        res.status(404).json({ error: 'No metadata stored for this document' });
        return;
      }

      res.json({ metadata });
    } catch (error) {
      console.error('Error in GET /api/documents/:id/metadata/db:', error);
      res.status(500).json({ error: 'Failed to read metadata from DB' });
    }
  },
);

// GET /api/documents/:id/metadata
// Run metadata extraction on demand for a given vector store file and persist it.
router.get('/:id/metadata', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!config.vectorStoreId) {
      res.status(500).json({ error: 'ARGUS_VECTOR_STORE_ID not configured' });
      return;
    }

    const { id } = req.params;

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
    updatedAttributes.has_metadata = true;

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
          s3_key,
          filename,
          document_type,
          date,
          provider_name,
          clinic_or_facility,
          is_active,
          metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          filename = VALUES(filename),
          document_type = VALUES(document_type),
          date = VALUES(date),
          provider_name = VALUES(provider_name),
          clinic_or_facility = VALUES(clinic_or_facility),
          is_active = VALUES(is_active),
          metadata_json = VALUES(metadata_json),
          s3_key = VALUES(s3_key)
      `,
        [
          id,
          fileIdRaw,
          attributes.s3_key ?? null,
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

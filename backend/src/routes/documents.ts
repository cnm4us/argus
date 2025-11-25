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
import { loadTemplateForDocumentType, loadClassificationTemplate } from '../templates';
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
  const maxAttempts =
    config.metadataRetryMaxAttempts > 0 ? config.metadataRetryMaxAttempts : 3;
  const baseDelaySeconds =
    config.metadataRetryBaseDelaySeconds > 0
      ? config.metadataRetryBaseDelaySeconds
      : 4;
  const baseDelayMs = baseDelaySeconds * 1000;

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

interface ClassificationResult {
  predictedType: DocumentType | 'unclassified' | null;
  confidence: number | null;
  rawLabel?: string;
}

async function classifyDocument(
  fileId: string,
  fileName: string,
): Promise<ClassificationResult | null> {
  try {
    logOpenAI('classify:start', {
      fileId,
      fileName,
    });

    const template = await loadClassificationTemplate();

    const response = await openai.responses.create({
      model: 'gpt-4.1-mini',
      instructions: template,
      input: [
        {
          role: 'user',
          type: 'message',
          content: [
            {
              type: 'input_text',
              text:
                'Classify this document according to the provided schema and respond only with JSON that matches the specified JSON output format.',
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
      logOpenAI('classify:error', {
        fileId,
        fileName,
        error: { message: 'No text output from classification model' },
      });
      return null;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(rawText);
    } catch (err) {
      logOpenAI('classify:error', {
        fileId,
        fileName,
        error: {
          message: 'Failed to parse classification JSON',
          rawText: rawText.slice(0, 500),
        },
      });
      return null;
    }

    const predictedTypeRaw = typeof parsed.predicted_type === 'string' ? parsed.predicted_type : '';
    const confidenceRaw = parsed.confidence;
    const rawLabel =
      typeof parsed.raw_label === 'string' ? parsed.raw_label : undefined;

    let confidence: number | null = null;
    if (typeof confidenceRaw === 'number') {
      confidence = confidenceRaw;
    } else if (typeof confidenceRaw === 'string') {
      const num = Number(confidenceRaw);
      confidence = Number.isFinite(num) ? num : null;
    }

    let predictedType: DocumentType | 'unclassified' | null = null;
    if (predictedTypeRaw === 'unclassified') {
      predictedType = 'unclassified';
    } else if (isValidDocumentType(predictedTypeRaw)) {
      predictedType = predictedTypeRaw;
    } else {
      predictedType = null;
    }

    logOpenAI('classify:success', {
      fileId,
      fileName,
      predictedType,
      confidence,
      rawLabel,
    });

    return {
      predictedType,
      confidence,
      rawLabel,
    };
  } catch (error) {
    logOpenAI('classify:error', {
      fileId,
      fileName,
      error:
        error instanceof Error
          ? { message: error.message, stack: error.stack }
          : error,
    });
    return null;
  }
}

async function waitForVectorStoreFileReady(
  vectorStoreFileId: string,
  maxAttempts = 5,
  delayMs = 1000,
): Promise<boolean> {
  if (!config.vectorStoreId) {
    return false;
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const file = await openai.vectorStores.files.retrieve(vectorStoreFileId, {
        vector_store_id: config.vectorStoreId,
      });

      if (file.status === 'completed') {
        return true;
      }

      if (file.status === 'failed' || file.status === 'cancelled') {
        logOpenAI('vectorStoreFile:not_ready', {
          vectorStoreFileId,
          status: file.status,
        });
        return false;
      }
    } catch (error) {
      logOpenAI('vectorStoreFile:poll_error', {
        vectorStoreFileId,
        error:
          error instanceof Error
            ? { message: error.message, stack: error.stack }
            : error,
      });
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  logOpenAI('vectorStoreFile:not_ready_timeout', {
    vectorStoreFileId,
    attempts: maxAttempts,
  });

  return false;
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

      let effectiveDocumentType: DocumentType;
      if (!document_type || document_type.trim() === '') {
        effectiveDocumentType = 'unclassified';
      } else if (!isValidDocumentType(document_type)) {
        res.status(400).json({
          error: 'Invalid document_type',
          allowed: DOCUMENT_TYPES,
        });
        return;
      } else {
        effectiveDocumentType = document_type as DocumentType;
      }

      // 1) Upload raw file to OpenAI Files
      const file = await openai.files.create({
        file: await toFile(buffer, originalname),
        purpose: 'assistants',
      });

      const attributes: { [key: string]: string | number | boolean } = {
        document_type: effectiveDocumentType,
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
        metadata = await extractMetadata(effectiveDocumentType, file.id, originalname);

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
            needs_metadata,
            metadata_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
          [
            vectorStoreFile.id,
            file.id,
            s3Key,
            originalname,
            effectiveDocumentType,
            dateValue,
            metadata ? metadata.provider_name : null,
            metadata ? metadata.clinic_or_facility : null,
            1,
            metadata ? 0 : 1,
            JSON.stringify(metadata ?? {}),
          ],
        );
      } catch (err) {
        console.error('Failed to persist document metadata to DB:', err);
      }

      // For async uploads, kick off background classification / metadata work.
      if (asyncMode) {
        (async () => {
          try {
            // If a specific document type was provided, skip classification and
            // run background metadata extraction as before.
            if (effectiveDocumentType !== 'unclassified') {
              logOpenAI('backgroundMetadata:start', {
                documentType: effectiveDocumentType,
                fileId: file.id,
                vectorStoreFileId: vectorStoreFile.id,
              });

              const bgMetadata = await extractMetadata(
                effectiveDocumentType,
                file.id,
                originalname,
              );

              if (!bgMetadata) {
                logOpenAI('backgroundMetadata:skip', {
                  reason: 'extractMetadata returned null',
                  documentType: effectiveDocumentType,
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
                  const ready = await waitForVectorStoreFileReady(
                    vectorStoreFile.id,
                  );
                  if (ready) {
                    await openai.vectorStores.files.update(vectorStoreFile.id, {
                      vector_store_id: config.vectorStoreId,
                      attributes: updatedAttributes,
                    });
                  } else {
                    logOpenAI('backgroundMetadata:vs_not_ready', {
                      vectorStoreFileId: vectorStoreFile.id,
                    });
                  }
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
                    metadata_json = ?,
                    needs_metadata = 0
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
                documentType: effectiveDocumentType,
                fileId: file.id,
                vectorStoreFileId: vectorStoreFile.id,
              });

              return;
            }

            // For unclassified uploads, run classification only (no automatic metadata).
            logOpenAI('classify:background:start', {
              fileId: file.id,
              vectorStoreFileId: vectorStoreFile.id,
            });

            const classification = await classifyDocument(
              file.id,
              originalname,
            );
            if (!classification) {
              logOpenAI('classify:background:skip', {
                reason: 'classification returned null',
                fileId: file.id,
                vectorStoreFileId: vectorStoreFile.id,
              });
              return;
            }

            const { predictedType, confidence } = classification;
            const threshold = config.classifyConfidenceThreshold || 0.85;

            if (
              !predictedType ||
              predictedType === 'unclassified' ||
              confidence === null ||
              confidence < threshold
            ) {
              logOpenAI('classify:background:low_confidence', {
                predictedType,
                confidence,
                threshold,
                fileId: file.id,
                vectorStoreFileId: vectorStoreFile.id,
              });
              return;
            }

            const updatedAttributes: {
              [key: string]: string | number | boolean;
            } = {
              ...attributes,
              document_type: predictedType,
            };

            if (config.vectorStoreId) {
              try {
                const ready = await waitForVectorStoreFileReady(
                  vectorStoreFile.id,
                );
                if (ready) {
                  await openai.vectorStores.files.update(vectorStoreFile.id, {
                    vector_store_id: config.vectorStoreId,
                    attributes: updatedAttributes,
                  });
                } else {
                  logOpenAI('classify:background:vs_not_ready', {
                    vectorStoreFileId: vectorStoreFile.id,
                  });
                }
              } catch (err) {
                logOpenAI('classify:background:attributes_error', {
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
              await db.query(
                `
                UPDATE documents
                SET document_type = ?
                WHERE vector_store_file_id = ?
              `,
                [predictedType, vectorStoreFile.id],
              );
            } catch (err) {
              console.error('Failed to update classified document_type in DB:', err);
              logOpenAI('classify:background:db_error', {
                error:
                  err instanceof Error
                    ? { message: err.message, stack: err.stack }
                    : err,
                vectorStoreFileId: vectorStoreFile.id,
              });
            }

            logOpenAI('classify:background:success', {
              predictedType,
              confidence,
              fileId: file.id,
              vectorStoreFileId: vectorStoreFile.id,
            });

            // Optionally run automatic metadata extraction after successful classification.
            if (!config.autoMetadataAfterClassify) {
              return;
            }

            const classifiedType = predictedType as DocumentType;

            logOpenAI('backgroundMetadata:after_classify:enter', {
              documentType: classifiedType,
              fileId: file.id,
              vectorStoreFileId: vectorStoreFile.id,
            });

            logOpenAI('backgroundMetadata:after_classify:start', {
              documentType: classifiedType,
              fileId: file.id,
              vectorStoreFileId: vectorStoreFile.id,
            });

            logOpenAI('backgroundMetadata:after_classify:before_extract', {
              documentType: classifiedType,
              fileId: file.id,
              vectorStoreFileId: vectorStoreFile.id,
            });

            const autoMetadata = await extractMetadata(
              classifiedType,
              file.id,
              originalname,
            );

            if (!autoMetadata) {
              logOpenAI('backgroundMetadata:after_classify:skip', {
                reason: 'extractMetadata returned null',
                documentType: classifiedType,
                fileId: file.id,
                vectorStoreFileId: vectorStoreFile.id,
              });
              return;
            }

            logOpenAI('backgroundMetadata:after_classify:after_extract', {
              documentType: classifiedType,
              fileId: file.id,
              vectorStoreFileId: vectorStoreFile.id,
            });

            const metadataAttributes: {
              [key: string]: string | number | boolean;
            } = {
              ...updatedAttributes,
            };

            if (autoMetadata.date) {
              metadataAttributes.date = autoMetadata.date;
            }
            if (autoMetadata.provider_name) {
              metadataAttributes.provider_name = autoMetadata.provider_name;
            }
            if (autoMetadata.clinic_or_facility) {
              metadataAttributes.clinic_or_facility =
                autoMetadata.clinic_or_facility;
            }
            metadataAttributes.has_metadata = true;

            if (config.vectorStoreId) {
              try {
                const ready = await waitForVectorStoreFileReady(
                  vectorStoreFile.id,
                );
                if (ready) {
                  await openai.vectorStores.files.update(vectorStoreFile.id, {
                    vector_store_id: config.vectorStoreId,
                    attributes: metadataAttributes,
                  });
                } else {
                  logOpenAI('backgroundMetadata:after_classify:vs_not_ready', {
                    vectorStoreFileId: vectorStoreFile.id,
                  });
                }
              } catch (err) {
                logOpenAI('backgroundMetadata:after_classify:attributes_error', {
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
              const dateValue = autoMetadata.date
                ? autoMetadata.date.slice(0, 10)
                : null;

              await db.query(
                `
                UPDATE documents
                SET
                  date = ?,
                  provider_name = ?,
                  clinic_or_facility = ?,
                  metadata_json = ?,
                  needs_metadata = 0
                WHERE vector_store_file_id = ?
              `,
                [
                  dateValue,
                  autoMetadata.provider_name ?? null,
                  autoMetadata.clinic_or_facility ?? null,
                  JSON.stringify(autoMetadata),
                  vectorStoreFile.id,
                ],
              );
            } catch (err) {
              console.error(
                'Failed to persist auto metadata after classify to DB:',
                err,
              );
              logOpenAI('backgroundMetadata:after_classify:db_error', {
                error:
                  err instanceof Error
                    ? { message: err.message, stack: err.stack }
                    : err,
                vectorStoreFileId: vectorStoreFile.id,
              });
            }

            logOpenAI('backgroundMetadata:after_classify:success', {
              documentType: classifiedType,
              fileId: file.id,
              vectorStoreFileId: vectorStoreFile.id,
            });
          } catch (err) {
            console.error('Background classification/metadata failed:', err);
            logOpenAI('classify:background:error', {
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
          needs_metadata,
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
      const needsMetadataRaw = row.needs_metadata as number | boolean | null;
      const s3Key = (row.s3_key as string | null) ?? undefined;

      let metadataRaw = row.metadata_json;
      if (typeof metadataRaw === 'string') {
        try {
          metadataRaw = JSON.parse(metadataRaw);
        } catch {
          metadataRaw = null;
        }
      }

      const hasMetadataObject =
        metadataRaw && typeof metadataRaw === 'object'
          ? Object.keys(metadataRaw).length > 0
          : false;

      const needsMetadata =
        needsMetadataRaw === 1 || needsMetadataRaw === true;

      const hasMetadata = hasMetadataObject && !needsMetadata;

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

      attributes.needs_metadata = needsMetadata;

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

// POST /api/documents/:id/type
// Update the document_type classification and mark metadata as needing refresh.
router.post('/:id/type', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!config.vectorStoreId) {
      res.status(500).json({ error: 'ARGUS_VECTOR_STORE_ID not configured' });
      return;
    }

    const { id } = req.params;
    const { document_type } = req.body as { document_type?: string };

    if (!document_type || !isValidDocumentType(document_type)) {
      res.status(400).json({
        error: 'Invalid or missing document_type',
        allowed: DOCUMENT_TYPES,
      });
      return;
    }

    const file = await openai.vectorStores.files.retrieve(id, {
      vector_store_id: config.vectorStoreId,
    });

    const attributes = (file.attributes ?? {}) as {
      [key: string]: string | number | boolean;
    };

    const previousType =
      typeof attributes.document_type === 'string'
        ? (attributes.document_type as string)
        : null;
    const underlyingFileId =
      typeof attributes.file_id === 'string'
        ? (attributes.file_id as string)
        : null;

    const updatedAttributes: { [key: string]: string | number | boolean } = {
      ...attributes,
      document_type,
    };

    // Clear has_metadata flag so UI shows it as needing regeneration.
    if (updatedAttributes.has_metadata) {
      delete updatedAttributes.has_metadata;
    }

    const updatedFile = await openai.vectorStores.files.update(id, {
      vector_store_id: config.vectorStoreId,
      attributes: updatedAttributes,
    });

    try {
      const db = await getDb();
      await db.query(
        `
          UPDATE documents
          SET document_type = ?, needs_metadata = 1
          WHERE vector_store_file_id = ?
        `,
        [document_type, id],
      );
    } catch (err) {
      console.error('Failed to update document_type in DB:', err);
    }

    logOpenAI('documentType:update', {
      vectorStoreFileId: id,
      fileId: underlyingFileId ?? undefined,
      from: previousType,
      to: document_type,
    });

    res.json({
      ok: true,
      documentType: document_type,
      attributes: updatedFile.attributes ?? null,
    });
  } catch (error) {
    console.error('Error in POST /api/documents/:id/type:', error);
    res.status(500).json({ error: 'Failed to update document_type' });
  }
});

// GET /api/documents/:id/logs
// Return OpenAI-related log events for a single document (debug only).
router.get('/:id/logs', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!config.debugRequests) {
      res.status(404).json({ error: 'Debug logging is disabled' });
      return;
    }

    const { id } = req.params;

    // Look up the DB row to get the OpenAI file ID.
    let openaiFileId: string | null = null;
    try {
      const db = await getDb();
      const [rows] = (await db.query(
        'SELECT openai_file_id FROM documents WHERE vector_store_file_id = ? LIMIT 1',
        [id],
      )) as any[];

      if (Array.isArray(rows) && rows.length > 0) {
        const row = rows[0] as any;
        if (row.openai_file_id && typeof row.openai_file_id === 'string') {
          openaiFileId = row.openai_file_id;
        }
      }
    } catch (err) {
      console.error('Failed to look up openai_file_id for logs:', err);
    }

    const fs = await import('fs');
    const path = await import('path');

    // Logs are written relative to the backend root (../logs from src).
    const logsDir = path.join(__dirname, '..', '..', 'logs');
    const openaiLogPath = path.join(logsDir, 'openai.log');

    if (!fs.existsSync(openaiLogPath)) {
      res.json({ items: [] });
      return;
    }

    const raw = fs.readFileSync(openaiLogPath, 'utf8');
    const lines = raw.split('\n').filter((line) => line.trim().length > 0);

    const events: any[] = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        const entryVsId = entry.vectorStoreFileId as string | undefined;
        const entryFileId = entry.fileId as string | undefined;

        if (
          (entryVsId && entryVsId === id) ||
          (openaiFileId && entryFileId && entryFileId === openaiFileId)
        ) {
          events.push(entry);
        }
      } catch {
        // Ignore malformed lines.
      }
    }

    events.sort((a, b) => {
      const ta = typeof a.ts === 'string' ? a.ts : '';
      const tb = typeof b.ts === 'string' ? b.ts : '';
      if (ta === tb) return 0;
      return ta < tb ? -1 : 1;
    });

    res.json({ items: events });
  } catch (error) {
    console.error('Error in GET /api/documents/:id/logs:', error);
    res.status(500).json({ error: 'Failed to read logs for document' });
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
          needs_metadata,
          metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          filename = VALUES(filename),
          document_type = VALUES(document_type),
          date = VALUES(date),
          provider_name = VALUES(provider_name),
          clinic_or_facility = VALUES(clinic_or_facility),
          is_active = VALUES(is_active),
          needs_metadata = VALUES(needs_metadata),
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
          0,
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

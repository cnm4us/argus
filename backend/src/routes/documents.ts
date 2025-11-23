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

      // 2) Extract structured metadata using the templates and file.
      const metadata = await extractMetadata(
        document_type,
        file.id,
        originalname,
      );

      const attributes: { [key: string]: string | number | boolean } = {
        document_type,
        file_name: originalname,
        file_id: file.id,
      };

      if (metadata) {
        if (metadata.date) attributes.date = metadata.date;
        if (metadata.provider_name) attributes.provider_name = metadata.provider_name;
        if (metadata.clinic_or_facility) {
          attributes.clinic_or_facility = metadata.clinic_or_facility;
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

      res.status(201).json({
        fileId: file.id,
        vectorStoreFileId: vectorStoreFile.id,
        documentType: document_type,
        filename: originalname,
        ingestionStatus: vectorStoreFile.status,
        metadata,
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

export default router;

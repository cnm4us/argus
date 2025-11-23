import express from 'express';
import type { Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { isKnownDocumentType, loadTemplateForDocumentType } from '../templates';

const router = express.Router();

// GET /api/templates/:document_type
// Returns the combined template text (universal + doc-type specific)
// so we can inspect and iterate on prompts.
router.get('/:document_type', requireAuth, async (req: Request, res: Response) => {
  const { document_type } = req.params;

  if (!document_type || !isKnownDocumentType(document_type)) {
    res.status(400).json({
      error: 'Invalid document_type',
      param: document_type,
    });
    return;
  }

  try {
    const template = await loadTemplateForDocumentType(document_type);
    res.type('text/plain').send(template);
  } catch (error) {
    console.error('Error loading template for', document_type, error);
    res.status(500).json({ error: 'Failed to load template' });
  }
});

export default router;


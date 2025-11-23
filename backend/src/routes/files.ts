import express from 'express';
import type { Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { openai } from '../openaiClient';

const router = express.Router();

// GET /api/files/:id
// Stream the underlying file (e.g., PDF) from OpenAI Files.
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const file = await openai.files.retrieve(id);
    const content = await openai.files.content(id);

    res.setHeader(
      'Content-Type',
      'application/pdf',
    );
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${file.filename || 'document.pdf'}"`,
    );

    const arrayBuffer = await content.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (error) {
    console.error('Error in GET /api/files/:id:', error);
    res.status(500).json({ error: 'Failed to fetch file content' });
  }
});

export default router;


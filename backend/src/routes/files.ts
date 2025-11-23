import express from 'express';
import type { Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { requireAuth } from '../middleware/auth';

const router = express.Router();

const localFileDir = path.join(__dirname, '..', 'file_store');

// GET /api/files/:id
// Stream the underlying file (e.g., PDF) from the local file store.
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const localPath = path.join(localFileDir, `${id}.pdf`);

    try {
      const buf = await fs.readFile(localPath);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${id}.pdf"`,
      );
      res.send(buf);
      return;
    } catch (err: any) {
      if (err && err.code === 'ENOENT') {
        res.status(404).json({ error: 'Local file not found' });
        return;
      }
      throw err;
    }
  } catch (error) {
    console.error('Error in GET /api/files/:id:', error);
    res.status(500).json({ error: 'Failed to fetch file content' });
  }
});

export default router;

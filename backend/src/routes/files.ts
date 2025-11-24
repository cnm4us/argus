import express from 'express';
import type { Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { getPdfStreamFromS3 } from '../s3Client';

const router = express.Router();

// GET /api/files/:id
// Stream the underlying file (e.g., PDF) from S3.
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    try {
      const { stream, filename } = await getPdfStreamFromS3(id);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${filename}"`,
      );
      stream.pipe(res);
      return;
    } catch (err: any) {
      if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NoSuchKey') {
        res.status(404).json({ error: 'File not found in S3' });
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

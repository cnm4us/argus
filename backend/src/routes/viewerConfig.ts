import express from 'express';
import type { Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { config } from '../config';

const router = express.Router();

router.get('/highlights', requireAuth, (_req: Request, res: Response) => {
  const colors = [
    config.highlightColor1,
    config.highlightColor2,
    config.highlightColor3,
  ].filter((c) => typeof c === 'string' && c.trim().length > 0);

  res.json({
    colors,
    opacity: config.highlightOpacity,
  });
});

export default router;


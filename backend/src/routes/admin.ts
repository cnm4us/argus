import express from 'express';
import { requireAuth } from '../middleware/auth';
import { openai } from '../openaiClient';
import { config } from '../config';

const router = express.Router();

router.post('/vector-store/init', requireAuth, async (_req, res) => {
  if (config.vectorStoreId) {
    res.status(400).json({
      error: 'ARGUS_VECTOR_STORE_ID is already set. Clear it in .env if you want to create a new store.',
      vectorStoreId: config.vectorStoreId,
    });
    return;
  }

  if (!config.openaiApiKey) {
    res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
    return;
  }

  try {
    const store = await openai.vectorStores.create({
      name: 'argus-med-legal-store',
    });

    console.log('Created vector store:', store.id);

    res.json({
      ok: true,
      vectorStoreId: store.id,
      note: 'Add this ID to ARGUS_VECTOR_STORE_ID in your .env and restart the server.',
    });
  } catch (error) {
    console.error('Failed to create vector store:', error);
    res.status(500).json({ error: 'Failed to create vector store' });
  }
});

export default router;

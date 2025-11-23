import express from 'express';
import cors from 'cors';
import { config } from './config';
import { requireAuth } from './middleware/auth';
import { openai } from './openaiClient';

const app = express();

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    hasOpenAIApiKey: Boolean(config.openaiApiKey),
  });
});

// Example protected route for testing auth.
app.get('/api/ping', requireAuth, (_req, res) => {
  res.json({ ok: true });
});

// Simple OpenAI health check (calls a lightweight API).
app.get('/api/openai/health', requireAuth, async (_req, res) => {
  if (!config.openaiApiKey) {
    res.status(500).json({ ok: false, error: 'OPENAI_API_KEY not configured' });
    return;
  }

  try {
    // Cheap call just to verify the key works.
    const models = await openai.models.list();
    res.json({
      ok: true,
      modelCount: models.data.length,
    });
  } catch (error) {
    console.error('OpenAI health check failed:', error);
    res.status(500).json({ ok: false, error: 'OpenAI request failed' });
  }
});

app.listen(config.port, () => {
  console.log(`Argus backend listening on port ${config.port}`);
});

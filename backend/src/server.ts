import express from 'express';
import cors from 'cors';
import { config } from './config';
import { requireAuth } from './middleware/auth';
import { openai } from './openaiClient';
import adminRouter from './routes/admin';
import documentsRouter from './routes/documents';
import templatesRouter from './routes/templates';
import searchRouter from './routes/search';

const app = express();

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    hasOpenAIApiKey: Boolean(config.openaiApiKey),
    hasVectorStoreId: Boolean(config.vectorStoreId),
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

// Admin routes (e.g., vector store init).
app.use('/api/admin', adminRouter);

// Document upload and (later) metadata routes.
app.use('/api/documents', documentsRouter);

// Template inspection routes.
app.use('/api/templates', templatesRouter);

// Search routes.
app.use('/api/search', searchRouter);

app.listen(config.port, () => {
  console.log(`Argus backend listening on port ${config.port}`);
});

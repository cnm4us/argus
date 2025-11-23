import express from 'express';
import cors from 'cors';
import { config } from './config';
import { requireAuth } from './middleware/auth';

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

app.listen(config.port, () => {
  console.log(`Argus backend listening on port ${config.port}`);
});


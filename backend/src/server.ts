import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { config } from './config';
import { requireAuth } from './middleware/auth';
import { openai } from './openaiClient';
import adminRouter from './routes/admin';
import documentsRouter from './routes/documents';
import templatesRouter from './routes/templates';
import searchRouter from './routes/search';
import filesRouter from './routes/files';
import authRouter from './routes/auth';
import { initDb } from './db';
import { SESSION_COOKIE_NAME, verifySessionToken } from './session';

const app = express();

app.use(cors());
app.use(cookieParser());
app.use(express.json());

// Require a valid session cookie for all non-API pages except the login page
// and static assets. APIs continue to use bearer token or session via
// requireAuth.
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    next();
    return;
  }

  const isLoginPage = req.path === '/login.html';
  const isRoot = req.path === '/';
  const isStaticAsset =
    /\.(css|js|png|jpg|jpeg|svg|ico|map)$/.test(req.path);

  if (isLoginPage || isStaticAsset) {
    next();
    return;
  }

  const token = (req as any).cookies?.[SESSION_COOKIE_NAME] as
    | string
    | undefined;

  if (token && verifySessionToken(token)) {
    next();
    return;
  }

  // For root path, redirect straight to login.
  if (isRoot) {
    res.redirect('/login.html');
    return;
  }

  // Any other non-API URL without a valid session goes to login.
  res.redirect('/login.html');
});

// Serve simple static assets (e.g., upload and list pages) from /public.
app.use(
  express.static(path.join(__dirname, '..', 'public'), {
    index: false,
  }),
);

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    hasOpenAIApiKey: Boolean(config.openaiApiKey),
    hasVectorStoreId: Boolean(config.vectorStoreId),
    debugRequests: config.debugRequests,
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

// File streaming routes.
app.use('/api/files', filesRouter);

// Auth routes.
app.use('/api/auth', authRouter);

// Initialize database (ensures tables exist).
initDb().catch((err) => {
  console.error('Failed to initialize database:', err);
});

app.listen(config.port, () => {
  console.log(`Argus backend listening on port ${config.port}`);
});

# Argus Document Intelligence

Personal RAG system for searching and analyzing a private collection of medical and legal PDFs using OpenAI's managed vector stores.

## Project layout

- `backend/` – Node.js + TypeScript API server (Express).
- `frontend/` – (planned) React UI for upload, search, and document browsing.

## Getting started (backend)

From the repo root:

```bash
cd backend
npm install
npm run dev
```

Then visit or `curl`:

```bash
curl http://localhost:4000/health
```

You should see:

```json
{"status":"ok"}
```


# Handoff_05 – Argus Document Intelligence

## Thread context

- Fifth agent thread for the Argus project.
- Started by reading `docs/agents/README.md` and `Handoff_04.md`.
- Focus of this thread: complete the migration of metadata/modules/taxonomy processing to use markdown-only inputs, starting with the async/background document ingest path (plan item #1).

## High-level system state (snapshot)

- Backend: Node.js + TypeScript + Express in `backend/`.
- Frontend: Simple HTML UI in `backend/public/` with search page driven by taxonomy facets (category → keyword → subkeyword) and non-vector DB search.
- Storage:
  - MariaDB `argus` schema with `documents`, projection tables, and taxonomy tables.
  - OpenAI Files API still used for PDF → markdown extraction; vector store is no longer used for search.
  - S3 bucket continues to hold original PDFs.
- Metadata pipeline:
  - Markdown for each document stored in `documents.markdown`.
  - Synchronous ingest path already uses markdown-based helpers for classification, module selection, extraction, projections, and taxonomy.

## Next-step suggestions for this thread

- Implement plan item #1: update the async/background ingest path in `backend/src/routes/documents.ts` to use the markdown-based helpers (no file-based metadata/module calls).
- After that, update `GET /api/documents/:id/metadata` to be markdown-first and independent of file-based helpers, then remove any unused file-based helper functions.
- Keep changes small and testable; ensure the app remains runnable after each change.


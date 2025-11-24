# Handoff_02 – Argus Document Intelligence

## Thread context

- Second agent thread for the Argus project.
- Started by reading `docs/agents/README.md` and `Handoff_01.md` as instructed.
- This file will be updated throughout this thread as work progresses.

## High-level system state (snapshot)

- Backend: Node.js + TypeScript + Express app in `backend/`.
- Auth: password-based login (`APP_PASSWORD`) with `argus_session` cookie, protecting UI pages and APIs.
- Storage:
  - OpenAI vector store for document chunks (ID from `ARGUS_VECTOR_STORE_ID`).
  - MariaDB `argus` schema with `documents` table for metadata snapshots.
  - S3 bucket (e.g. `bacs-argus-docs`) for PDF storage keyed by OpenAI file ID.

## Key endpoints / flows (brief)

- Auth: `/api/auth/login`, `/api/auth/logout`, `/api/auth/session`, `/health`.
- Documents:
  - Upload: `POST /api/documents?async=1` (preferred) and sync `POST /api/documents`.
  - Listing/details: `GET /api/documents`, `GET /api/documents/:id`.
  - Metadata: `GET /api/documents/:id/metadata`, `GET /api/documents/:id/metadata/db`.
  - Deletion: `POST /api/documents/:id/soft-delete`, `DELETE /api/documents/:id`.
- Search: `POST /api/search` using OpenAI `file_search` on the configured vector store.
- File delivery: `GET /api/files/:fileId` streaming PDFs from S3.

## Known issues / open questions

- This thread has just started; specific issues and questions will be recorded here as they are discovered.

## Next-step suggestions (living list)

- Coordinate with the human developer on their immediate priorities before implementing changes.
- Maintain small, testable increments; keep the app in a working state between steps.
- Continue to follow the commit message template from `docs/agents/README.md` when preparing commits.


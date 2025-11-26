# Handoff_03 – Argus Document Intelligence

## Thread context

- Third agent thread for the Argus project.
- Started by reading `docs/agents/README.md` and `Handoff_02.md` as instructed.
- This file will be updated throughout this thread as work progresses.

## High-level system state (snapshot)

- Backend: Node.js + TypeScript + Express app in `backend/`.
- Auth: password-based login (`APP_PASSWORD`) with `argus_session` cookie, protecting UI pages and APIs.
- Storage:
  - OpenAI vector store for document chunks (ID from `ARGUS_VECTOR_STORE_ID`).
  - MariaDB `argus` schema with `documents` table for metadata snapshots.
  - S3 bucket (e.g. `bacs-argus-docs`) for PDF storage keyed by OpenAI file ID.

## Key endpoints / flows (carryover)

- Auth and health: `/api/auth/login`, `/api/auth/logout`, `/api/auth/session`, `/health`.
- Documents:
  - Upload: `POST /api/documents?async=1` (preferred) and sync `POST /api/documents`.
  - Listing/details: `GET /api/documents`, `GET /api/documents/:id`.
  - Metadata:
    - `GET /api/documents/:id/metadata` – on-demand extraction using the current `document_type`, overwrites metadata.
    - `GET /api/documents/:id/metadata/db` – DB-only read, no OpenAI call.
  - Classification / type update:
    - `POST /api/documents/:id/type` – change `document_type` (manual override), mark `needs_metadata = 1`.
  - Logs:
    - `GET /api/documents/:id/logs` – returns JSON log events for that file (when `DEBUG_REQUESTS=1`).
  - Deletion: `POST /api/documents/:id/soft-delete`, `DELETE /api/documents/:id`.
- Search:
  - `POST /api/search` – semantic search via OpenAI `file_search` with attribute filters.
  - `GET /api/search/db` – DB-backed structured search (document_type, provider, clinic/facility, date range).
  - `GET /api/search/options` – distinct provider/clinic names for populating search filters.
- File delivery: `GET /api/files/:fileId` streaming PDFs from S3.

## Known issues / open questions (inherited)

- Vector-store attributes are best-effort and can be temporarily out of sync with DB when ingestion is not ready.
- Classification is single-label, driven by `classify.md`, with auto-assignment for high-confidence results and manual review for low-confidence ones.
- Metadata extraction and classification quality depend on current prompts; some templates/edge cases may need refinement.

## Next-step suggestions (living list)

- Coordinate with the human developer on immediate priorities before implementing changes.
- Maintain small, testable increments that keep the app working at each step.
- Follow the commit message template from `docs/agents/README.md` when preparing commits.
- For future threads, consider:
  - **Classification tuning** – refine prompts and thresholds based on real mis-classification examples.
  - **Metadata robustness** – use logs and `needs_metadata` to identify systemic extraction failures.
  - **UI improvements** – expose confidence, highlight `unclassified` / `needs_metadata=1` docs, and streamline review flows.


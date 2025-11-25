# Handoff_02 – Argus Document Intelligence

## Thread context

- Second agent thread for the Argus project.
- Started by reading `docs/agents/README.md` and `Handoff_01.md` as instructed.
- This file has been updated throughout this thread as work progressed.

## High-level system state (snapshot)

- Backend: Node.js + TypeScript + Express app in `backend/`.
- Auth: password-based login (`APP_PASSWORD`) with `argus_session` cookie, protecting UI pages and APIs.
- Storage:
  - OpenAI vector store for document chunks (ID from `ARGUS_VECTOR_STORE_ID`).
  - MariaDB `argus` schema with `documents` table for metadata snapshots.
  - S3 bucket (e.g. `bacs-argus-docs`) for PDF storage keyed by OpenAI file ID.

### New/important behaviors from this thread

- Documents table now includes:
  - `needs_metadata` flag to indicate when metadata should be (re)generated.
  - `document_type` can be updated and metadata fully regenerated safely.
- Vector-store file attributes (for filtering) are treated as best-effort:
  - The DB is the primary source of truth for document type, date, provider, etc.

## Key endpoints / flows (brief)

- Auth: `/api/auth/login`, `/api/auth/logout`, `/api/auth/session`, `/health`.
- Documents:
  - Upload: `POST /api/documents?async=1` (preferred) and sync `POST /api/documents`.
  - Listing/details: `GET /api/documents`, `GET /api/documents/:id`.
  - Metadata:
    - `GET /api/documents/:id/metadata` – on-demand extraction using the current `document_type`, overwrites metadata.
    - `GET /api/documents/:id/metadata/db` – DB-only read, no OpenAI call.
  - Classification / type update:
    - `POST /api/documents/:id/type` – change `document_type` (manual override), mark `needs_metadata = 1`.
  - Logs:
    - `GET /api/documents/:id/logs` – returns JSON log events for that file (only when `DEBUG_REQUESTS=1`).
  - Deletion: `POST /api/documents/:id/soft-delete`, `DELETE /api/documents/:id`.
- Search:
  - `POST /api/search` – semantic search via OpenAI `file_search` with attribute filters.
  - `GET /api/search/db` – DB-backed structured search (document_type, provider, clinic/facility, date range).
  - `GET /api/search/options` – distinct provider/clinic names for populating search filters.
- File delivery: `GET /api/files/:fileId` streaming PDFs from S3.

### Frontend pages (as of this thread)

- `upload.html`
  - Drag-and-drop multi-file upload.
  - Optional `document_type` select:
    - If set, all dropped files use that type.
    - If left blank, files upload as `unclassified`.
  - Async uploads (`?async=1`) only; background processes handle classification/metadata.
- `documents.html`
  - Now uses `GET /api/documents/db` (DB-backed).
  - Columns sortable (Status, File Name, Document Type, Date, Provider).
  - Status shows:
    - `completed` when metadata exists and `needs_metadata = 0`.
    - `processing` otherwise.
    - A small `needs metadata` badge when `needs_metadata = 1`.
- `document-metadata.html`
  - Shows metadata from DB and allows:
    - Re-loading DB metadata.
    - “Generate metadata” (full re-extraction) using current `document_type`.
    - Editing `document_type` via a dropdown and “Update type” button, which sets `needs_metadata = 1`.
  - When `DEBUG_REQUESTS=1`, shows “View debug logs”:
    - Calls `/api/documents/:id/logs` and renders the structured events.
- `search.html`
  - DB-backed search page.
  - Filters: `document_type`, `provider_name`, `clinic_or_facility`, `date_from`, `date_to`.
  - Provider and clinic filters are populated from DB via `/api/search/options`.

### Logging and debug

- Structured JSON logs in `backend/logs/openai.log` when `DEBUG_REQUESTS=1`:
  - `extractMetadata:*` – metadata extraction attempts (with retry info).
  - `backgroundMetadata:*` – background extraction and DB/attribute updates.
  - `classify:*` – classification requests, outputs, and background classification phases.
  - `vectorStoreFile:*` – polling / readiness checks for vector-store files.
- `logOpenAI`:
  - Writes JSON per line: `{ ts, event, ...details }`.
  - When `DEBUG_REQUESTS=0`, only `*:error` events are recorded to keep logs light.

## Known issues / open questions

- Some vector-store attribute updates can be skipped when ingestion is not ready:
  - This is logged as `*vs_not_ready`.
  - DB remains the source of truth; attributes are best-effort.
- Classification is currently:
  - Single-label, using `gpt-4.1-mini` and `classify.md`.
  - High-confidence predictions auto-set `document_type`.
  - Low-confidence or ambiguous cases keep `unclassified` and `needs_metadata = 1` for manual review.
- Classification and metadata extraction rely on current prompts:
  - There may be mis-classifications for edge cases or templates that need refining.

## Next-step suggestions (living list)

- Coordinate with the human developer on their immediate priorities before implementing changes.
- Maintain small, testable increments; keep the app in a working state between steps.
- Continue to follow the commit message template from `docs/agents/README.md` when preparing commits.
- Consider next steps for future threads:
  - **Classification tuning**:
    - Collect examples of mis-classifications and refine `classify.md` (possibly with few-shot examples).
    - Adjust `CLASSIFY_CONFIDENCE_THRESHOLD` and observe impact.
  - **Metadata coverage**:
    - Use `needs_metadata` and the new logs to audit which docs are failing to get metadata and why (rate limits, prompt issues, etc.).
  - **UI improvements**:
    - Show classification confidence in the Documents or metadata UI for debugging/trust.
    - Add a simple filter or view for `unclassified` / `needs_metadata=1` docs to streamline review.
  - **Backfill tools** (when ready):
    - A controlled admin endpoint/script to re-run metadata generation for selected sets of documents (e.g., all `needs_metadata=1` with a given type), with rate limiting respected.

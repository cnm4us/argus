# Handoff_01 – Argus Document Intelligence

## Thread context

- This is the first agent thread for the Argus project.
- docs/agents/README.md defines the agent handoff process; this file is the initial handoff snapshot.

## High-level system state

- **Backend**: Node.js + TypeScript + Express app in `backend/`.
- **Auth**:
  - Single-user password via `APP_PASSWORD` in `.env`.
  - Browser session via `argus_session` cookie (created at `/api/auth/login`).
  - All non-API pages require a valid session; unauthenticated requests are redirected to `/login.html`.
  - APIs are protected by `requireAuth` (either bearer password or session cookie).
- **Storage**:
  - **OpenAI vector store**: single store ID from `ARGUS_VECTOR_STORE_ID` in `.env`.
  - **MariaDB**: `documents` table in `argus` schema, holds metadata snapshots.
  - **S3**: bucket `bacs-argus-docs` in `us-west-1`, used for PDF storage (`ARGUS_S3_BUCKET`, `ARGUS_S3_PREFIX`).

## Key backend routes (as of this thread)

- **Health & auth**
  - `GET /health` – basic status + flags for OpenAI key and vector store ID.
  - `POST /api/auth/login` – body `{ password }`, sets `argus_session` cookie.
  - `POST /api/auth/logout` – clears cookie.
  - `GET /api/auth/session` – returns `{ authenticated: true }` or `401`.

- **Admin / vector store**
  - `POST /api/admin/vector-store/init` – creates a vector store, returns its ID (used once, then set in `.env`).

- **Documents API**
  - `POST /api/documents?async=1` (recommended upload path):
    - Accepts `multipart/form-data` with `file` (PDF) and `document_type`.
    - Uploads file to OpenAI Files (`purpose: assistants`).
    - Uploads the PDF bytes to S3 (`bacs-argus-docs`) under `<ARGUS_S3_PREFIX><fileId>.pdf`.
    - Creates a vector-store file with attributes:
      - `document_type`, `file_name`, `file_id`, `is_active: true`, and `s3_key`.
    - Inserts a stub row into `documents` with empty `metadata_json` (to be filled later).
    - Returns `fileId`, `vectorStoreFileId`, `ingestionStatus`, `async: true`.
  - `POST /api/documents` (sync mode):
    - Same as above, but also immediately calls OpenAI `responses.create` with the combined template to extract full `DocumentMetadata`.
    - Populates `date`, `provider_name`, `clinic_or_facility` attributes and `metadata_json` in DB.
  - `GET /api/documents` – lists vector-store files with basic attributes (status, IDs, subset of metadata).
  - `GET /api/documents/:id` – retrieves vector-store file details.
  - `POST /api/documents/:id/soft-delete` – sets `is_active = false` in attributes and DB; excludes from `/api/search` by default.
  - `DELETE /api/documents/:id` – removes file from vector store, deletes underlying OpenAI File, and deletes the DB row.

- **Metadata extraction & caching**
  - `GET /api/documents/:id/metadata/db`:
    - Fast path; returns `{ metadata }` from `documents.metadata_json` if present and non-empty.
  - `GET /api/documents/:id/metadata`:
    - Always calls OpenAI Responses with the document file and templates to generate `DocumentMetadata`.
    - Updates vector-store attributes (`date`, `provider_name`, `clinic_or_facility`).
    - Upserts into `documents` with full `metadata_json` and `s3_key`.
    - Returns `{ metadata }`.
  - `DocumentMetadata` shape is defined in `backend/src/documentTypes.ts` and driven by `backend/openai/templates/universal.md` and doc-type templates under `backend/openai/templates/doctypes/`.

- **Search**
  - `POST /api/search`:
    - Body: `{ query, document_type?, provider_name?, clinic_or_facility?, date_from?, date_to?, include_inactive? }`.
    - Uses `openai.responses.create` with `file_search` tool against the configured vector store.
    - Builds `ComparisonFilter` / `CompoundFilter` from provided filters; adds `is_active = true` unless `include_inactive` is true.
    - Returns `{ query, filters, answer, citations[] }` where `citations` includes snippet text and attributes (including metadata subset).

- **File delivery**
  - `GET /api/files/:fileId`:
    - Streams the PDF from S3 using `fileId` → S3 key `<prefix><fileId>.pdf`.
    - Uses `Content-Type: application/pdf` and `Content-Disposition: inline; filename="<original_filename>"` where possible.

## Frontend pages

- `login.html`
  - Simple login form (APP_PASSWORD) that calls `/api/auth/login`.
  - Shows login status; navbar for navigation (Login / Documents / Search).

- `documents.html`
  - Requires a valid session; otherwise browser is redirected to `/login.html`.
  - Shows table of documents:
    - Status pill, File Name (links to `/api/files/:fileId`), Document Type (links to metadata page), Date, Provider, Actions.
  - “Upload” button → navigates to `upload.html`.
  - “Delete” button → calls `DELETE /api/documents/:id`.

- `upload.html`
  - Requires session.
  - Async upload form: `document_type` + file → `POST /api/documents?async=1`.
  - Displays the JSON response for debugging.

- `document-metadata.html`
  - Requires session.
  - Reads `?id=<vectorStoreFileId>` from query string.
  - On load:
    - Calls `GET /api/documents/:id/metadata/db` to show stored metadata if available (fast path).
  - Buttons:
    - “Load metadata” → DB-only path.
    - “Generate metadata” → calls full OpenAI extraction, then shows updated metadata.

## Important conventions / behaviors

- **Dates**:
  - `metadata.date` is instructed to be ISO `"YYYY-MM-DD"`.
  - If only year+month are known, templates approximate as `"YYYY-MM-01"`.
  - `date_from` / `date_to` filters in `/api/search` operate on the `date` attribute string.

- **Vector-store attributes** (per file, max ~16 keys):
  - Currently used: `document_type`, `file_name`, `file_id`, `date`, `provider_name`, `clinic_or_facility`, `is_active`, `s3_key`.
  - These are the only fields filterable via `file_search` at this time.
  - Full `DocumentMetadata` lives in MariaDB as JSON and is used for display and future logic.

- **Async vs sync uploads**:
  - `?async=1`: no metadata extraction at upload; DB row exists but `metadata_json` is `{}`.
  - Running `GET /api/documents/:id/metadata` later fills in `metadata_json` and updates attributes.

- **Legacy/local files**:
  - Older uploads before S3 integration may not have `s3_key` and will 404 via `/api/files/:id`; re-uploading via the current flow is the simplest fix.

## Next-step suggestions for the next agent

These are suggestions for future threads; coordinate with the human developer as they prefer to plan in small, testable steps.

1. **Search UI (`search.html`)**
   - Add a simple page with:
     - Query input.
     - Optional filters for document_type, provider, date range.
     - Display of `answer` and `citations` (snippets with metadata).
   - Wire it to `POST /api/search` using the existing session cookie.

2. **Richer filtering / metadata promotion**
   - Decide on a few more attributes to promote into vector-store attributes for filtering:
     - e.g. `encounter_mode`, `primary_diagnosis_code`, `has_imaging`, `has_risk_flags`.
   - Update upload + metadata update flows to write those into `attributes` (staying within the ~16 key limit).

3. **Document listing powered by DB (optional)**
   - Long term, we may want `/api/documents` to read from the `documents` table instead of the vector store for listing, to:
     - Include more fields (e.g. `is_active`, `date`, `provider_name`) in a single query.
     - Perform more complex filters (e.g. multiple statuses) without hitting OpenAI.
   - For now, the current vector-store based listing is acceptable.

4. **Backfill for existing docs**
   - If there are many async uploads with empty `metadata_json`, consider a small admin script/endpoint that:
     - Lists docs from DB where `metadata_json = '{}'`.
     - Iterates and calls `GET /api/documents/:id/metadata` to fill them in gradually.

5. **Error-handling / observability**
   - Consider adding minimal logging around:
     - S3 failures (currently logged at `warn`).
     - Metadata extraction failures and timeouts.
   - Optionally, track simple metrics (counts of uploads, metadata extractions) if useful.

## Process notes for future agents

- Always start by reading:
  - `docs/agents/README.md`
  - The latest `docs/agents/Handoff_nn.md` (this file for now).
- Maintain the pattern of small, testable steps, leaving the app in a working state between changes.
- Follow the commit message template described in `docs/agents/README.md` when suggesting or preparing commit messages.

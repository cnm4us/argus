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

You should see something like:

```json
{"status":"ok","hasOpenAIApiKey":true,"hasVectorStoreId":false}
```

## Vector store and document API

All API routes expect a bearer token in the `Authorization` header:

```http
Authorization: Bearer <APP_PASSWORD>
```

### 1. Initialize the vector store (one‑time)

Create the OpenAI vector store and get its ID:

```bash
curl -X POST http://localhost:4000/api/admin/vector-store/init \
  -H "Authorization: Bearer $APP_PASSWORD"
```

Copy the returned `vectorStoreId` into `backend/.env` as `ARGUS_VECTOR_STORE_ID`, then restart the server.

### 2. Upload and ingest a document

Upload a single PDF, set its `document_type`, extract metadata, and attach it to the vector store:

```bash
curl -X POST http://localhost:4000/api/documents \
  -H "Authorization: Bearer $APP_PASSWORD" \
  -F "file=@/path/to/file.pdf" \
  -F "document_type=telehealth_visit"
```

Response includes:

- `fileId` – OpenAI File ID.
- `vectorStoreFileId` – vector store file ID.
- `ingestionStatus` – indexing status.
- `metadata` – full extracted `DocumentMetadata` JSON.
- A snapshot of this metadata is also persisted into the MariaDB `documents` table.

By default, new documents are marked with `is_active: true` in their attributes and will participate in search.

### 3. List documents in the vector store

```bash
curl http://localhost:4000/api/documents \
  -H "Authorization: Bearer $APP_PASSWORD"
```

Returns an array of vector store files with:

- `id` – vector store file ID.
- `status` – `in_progress`, `completed`, etc.
- `attributes` – metadata subset (`document_type`, `date`, `provider_name`, `clinic_or_facility`, `file_id`, `file_name`, `is_active`).

### 4. Get document details

```bash
curl http://localhost:4000/api/documents/<vectorStoreFileId> \
  -H "Authorization: Bearer $APP_PASSWORD"
```

Returns a single vector store file with status, usage, attributes, and any last error.

### 5. Soft‑delete a document (exclude from search)

Mark a document as inactive but keep it in the vector store:

```bash
curl -X POST http://localhost:4000/api/documents/<vectorStoreFileId>/soft-delete \
  -H "Authorization: Bearer $APP_PASSWORD"
```

This sets `attributes.is_active = false`. By default, `/api/search` will ignore inactive documents unless `include_inactive` is explicitly set.

### 6. Hard delete a document

Detach the file from the vector store and delete the underlying OpenAI File:

```bash
curl -X DELETE http://localhost:4000/api/documents/<vectorStoreFileId> \
  -H "Authorization: Bearer $APP_PASSWORD"
```

Once hard‑deleted, the document is no longer searchable and the raw file is removed from the Files API.

### 7. Search (hybrid: attributes + semantic)

Search across vector store files using optional filters and a free‑text query:

```bash
curl -X POST http://localhost:4000/api/search \
  -H "Authorization: Bearer $APP_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "summarize the patient'\''s main issues and current plan",
    "document_type": "telehealth_visit",
    "provider_name": "Zosima lnton",
    "clinic_or_facility": "Family Health Services",
    "date_from": "2024-01-01",
    "date_to": "2024-12-31"
  }'
```

Request body fields:

- `query` (required) – natural language question or search phrase.
- `document_type` (optional) – filters by document type attribute.
- `provider_name`, `clinic_or_facility` (optional) – exact‑match filters.
- `date_from`, `date_to` (optional) – filter by `date` attribute (`YYYY-MM-DD`).
- `include_inactive` (optional, boolean) – when `true`, include soft‑deleted documents.

Response:

- `answer` – concise LLM answer grounded in the documents.
- `citations[]` – snippet‑level results with:
  - `fileId`, `filename`, `score`,
  - `snippet` (text),
  - `attributes` (metadata subset).

## Simple upload UI

For quick manual testing, the backend serves a minimal HTML upload form:

- URL (through nginx): `https://argus.bawebtech.com/upload.html`
- URL (direct to backend): `http://localhost:4000/upload.html`

The form:

- Lets you choose a `document_type` and a PDF file,
- Calls `POST /api/documents?async=1`,
- Displays the JSON response (IDs and status) inline.

## Developer CLI helpers

From the repo root, there are simple helper scripts in `scripts/` to avoid retyping passwords and curl commands.

### 1. Set `APP_PASSWORD` in your shell

Loads `APP_PASSWORD` from `backend/.env` into the current shell:

```bash
source scripts/set_password
```

After this, `$APP_PASSWORD` is available to your `curl` commands and the `scripts/openai` helper.

### 2. `scripts/openai` (direct OpenAI helper)

The `scripts/openai` script talks **directly to OpenAI** (vector stores + files), bypassing the Argus backend. It is intended for debugging the actual asset state in OpenAI and comparing it with what the app reports.

It assumes:

- `OPENAI_API_KEY` and `ARGUS_VECTOR_STORE_ID` / `VECTOR_STORE_ID` are set in the environment, **or**
- It will read them from `backend/.env` if present.

Usage:

```bash
# List raw vector store files directly from OpenAI
scripts/openai list documents

# Inspect a single vector store file
scripts/openai get details <vectorStoreFileId>

# Soft delete (update attributes.is_active=false on the OpenAI vector store file)
scripts/openai soft-delete <vectorStoreFileId>

# Hard delete (detach from vector store and delete the underlying OpenAI File)
scripts/openai hard-delete <vectorStoreFileId>

# Attach a local PDF to the vector store without going through the app
scripts/openai upload <document_type> <path-from-repo-root>
```

This helper is useful when you want to verify OpenAI’s ground truth (e.g., file status, attributes, deletion) independently of Argus’s database or S3 state.

## Metadata, modules, and taxonomies

Argus processes each document into several layers:

- **Universal metadata (`documents.metadata_json`)**
  - Includes core fields like `date`, `provider_name`, `clinic_or_facility`, `document_type`, and a narrative summary.
  - Backed by Markdown stored in `documents.markdown`, extracted once from the PDF using the OpenAI Files + Responses APIs.

- **Modules (`metadata_json.modules`)**
  - Fine-grained extractors run over the Markdown for:
    - `provider`, `patient`, `reason_for_encounter`
    - `vitals`, `smoking`, `sexual_health`, `mental_health`
    - `referral`, `results`, `communication`
  - Their outputs are projected into dedicated tables:
    - `document_vitals`, `document_smoking`, `document_mental_health`
    - `document_referrals`, `document_results`
    - `document_appointments`, `document_communications`

- **Taxonomies (categories, keywords, subkeywords)**
  - Stored in:
    - `taxonomy_categories`
    - `taxonomy_keywords`
    - `taxonomy_subkeywords`
    - Links in `document_terms` (+ evidence in `document_term_evidence`)
  - Two sources of taxonomy terms:
    1. **Projection‑backed categories** (deterministic, rule‑based):
       - `vitals`, `smoking`, `mental_health`, `sexual_history`
       - `respiratory`, `appointments`, `results`, `referrals`, `communication`
       - Derived from the `document_*` projection tables and universal metadata via `updateTaxonomyFromProjections`.
    2. **LLM‑driven taxonomy**:
       - A taxonomy extraction model runs over Markdown per category, returning keyword/subkeyword IDs and optional evidence snippets.
       - Used for richer, more free‑form taxonomy beyond what simple rules can express (e.g., finer Appointments/Communication concepts).

The Search UI (`/search.html`) is backed by the local DB:

- Filters on `document_type`, `date`, `provider_name`, `clinic_or_facility`.
- Taxonomy filters: Category → Keyword → Subkeyword (using `document_terms`).
- Optional text search on `documents.markdown` with:
  - **Rows = AND**, **boxes in a row = OR** (CNF).
  - Results show both taxonomy evidence and text‑search snippets in the Details view.

## Admin tools: when and what to run

There are two main admin pages:

- `/admin-modules.html` – module coverage and re‑runs.
- `/admin-taxonomy.html` – taxonomy maintenance.

### Admin – Modules (`/admin-modules.html`)

Shows a table of modules with:

- `Module` – internal name (e.g., `vitals`, `smoking`, `results`).
- `Label` – human‑friendly label.
- `Total docs`, `With markdown`, `With module`, `Missing module`.
- Actions:
  - **Run on missing**
    - Re‑runs a single module only for documents that:
      - Have `documents.markdown`, and
      - Do not currently have that module under `metadata_json.modules`.
    - Updates `metadata_json.modules[module]`, marks `needs_metadata = 0`, and refreshes projections + taxonomy for that document.
    - Use this when:
      - You add a new module, or
      - Some documents were ingested before a module was introduced.
  - **Run on all**
    - Re‑runs the module for all documents with Markdown (up to a batch limit per click).
    - Overwrites the module’s output in `metadata_json.modules[module]`, then refreshes projections + taxonomy.
    - Use this when:
      - You significantly change a module prompt/schema and want the new behavior applied consistently across the corpus.

### Admin – Taxonomies (`/admin-taxonomy.html`)

Shows one row per taxonomy category:

- Columns:
  - **Taxonomy** – label + category ID (e.g., `Appointments (appointments)`).
  - **Rebuild** – enabled for projection‑backed categories only:
    - `vitals`, `smoking`, `mental_health`, `sexual_history`
    - `respiratory`, `appointments`, `results`, `referrals`, `communication`
  - **Re‑run LLM** – available for all categories.

Actions:

- **Rebuild** (projection‑backed only)
  - Clears `document_terms` and rule‑based evidence for the selected category.
  - Recomputes terms by:
    - Re‑running `updateTaxonomyFromProjections` for all documents with both `markdown` and `metadata_json`.
  - Does **not** call the LLM.
  - Use this when:
    - You change or tighten the rule logic in `metadataProjections.ts` (e.g., Smoking, Respiratory, Appointments, Results, Referrals, Communication).
    - You want deterministic, inexpensive re‑tagging.

- **Re‑run LLM**
  - Clears `document_terms` and evidence for the selected category.
  - Re‑runs the LLM taxonomy extractor for that category over all documents with Markdown.
  - Writes:
    - New keyword/subkeyword links for that category.
    - Any `keyword_evidence` / `subkeyword_evidence` snippets returned by the model.
  - Use this when:
    - You update the taxonomy extraction prompt/schema.
    - You add new keywords/subkeywords or synonyms for a category.
    - You want fresh snippet‑level evidence for LLM‑driven categories (e.g., Appointments, Communication, or fine‑grained subdomains).

### Practical guidance

- After changing **module prompts or schemas**:
  - Use **Admin Modules → Run on missing** for the affected module first.
  - If you want consistent behavior across all docs, follow with **Run on all**.
- After tuning **projection‑based taxonomy logic**:
  - Use **Admin Taxonomy → Rebuild** for the affected categories.
  - This is cheap and does not incur additional LLM calls.
- After tuning **taxonomy LLM prompts or synonyms**:
  - Use **Admin Taxonomy → Re‑run LLM** for the affected categories.
  - Expect one model call per document per category; use in modest batches during iteration.

### Per‑document iteration (single file)

When tightening or refining the taxonomy of a module for a specific document, use this loop:

1. Update the module’s extraction template in code and restart the backend so the new template is loaded.
2. Go to `Admin → Documents` (`/admin-documents.html`), locate your test file, and click **Modules...** for that row. On the per‑document Modules page:
   - Click **Re‑run** for the specific module you are tuning (e.g., `vitals`, `smoking`, `mental_health`).
   - This re‑runs that module’s OpenAI extraction for this document only, updates `metadata_json.modules[module]`, and recomputes projections + projection‑backed taxonomy for that document.
3. From `Admin → Documents`, click **Taxonomies...** for the same file. On the per‑document Taxonomy page:
   - Choose the relevant taxonomy category (typically matching the module’s domain, e.g., `smoking`, `vitals`, `respiratory`, etc.).
   - Click **Rebuild (this doc)** to clear and recompute projection‑backed taxonomy for that category using the updated projections (no extra LLM calls).
4. If you are also iterating on the **taxonomy LLM behavior itself** (the taxonomy extraction prompt/schema):
   - On the same page, click **Re‑run LLM (this doc)** for the category.
   - This clears existing terms and evidence for that document + category and re‑runs `runTaxonomyExtractionForDocument` for this document only.
5. Inspect the updated terms and evidence for the document, adjust templates or taxonomy prompts as needed, and repeat steps 1–4 until the single‑file behavior looks correct. Once satisfied, use the global Admin Modules / Admin Taxonomy tools to roll changes out to the broader corpus.

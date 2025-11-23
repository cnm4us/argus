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

- Prompts for the Argus password (`APP_PASSWORD`),
- Lets you choose a `document_type` and a PDF file,
- Calls `POST /api/documents`,
- Displays the JSON response (including extracted metadata) inline.


# Implementation Plan: PDF.js Viewer + Page-Level Comments

## 1. Overview
Goal: Enhance `viewer.html` so that it renders PDFs via PDF.js instead of a raw `<iframe>`, and introduce page-level comments that can be viewed and created within the viewer. This work builds on the existing viewer shell (`/viewer.html?doc=<vectorStoreFileId>`) and pre-signed URL endpoint, without changing the `/search.html` contract.

In scope:
- Integrating PDF.js into `viewer.html` to render the document pages.
- Basic viewer UI (page navigation, loading/error states) driven by PDF.js.
- A new `document_comments` table and minimal comment APIs to support page-level comments.
- A comments sidebar in `viewer.html` that lists comments and allows adding new comments tied to a specific page.

Out of scope:
- Rich text selection or text-anchored comments (e.g., highlighting exact phrases).
- Complex per-annotation positioning (we’ll treat comments as page-level, not precise coordinates).
- Full React conversion of the viewer; this plan uses the existing HTML/JS shell, with room to migrate later.

## 2. Step-by-Step Plan

1. Integrate PDF.js into `viewer.html` and render the first page  
Status: Completed  
Testing: Add PDF.js (e.g., via `pdfjs-dist` served by the backend or a CDN) and update `viewer.html` so that, after fetching the pre-signed `{ url }` from `/api/documents/:id/presigned-url`, it loads the PDF via `pdfjsLib.getDocument(url)` and renders the first page into a `<canvas>` element. Replace the existing `<iframe>` usage with this canvas-based rendering, keeping the same loading/error messaging. Manually verify that opening `/viewer.html?doc=<id>` shows the first page of the PDF at a readable scale and that error cases still show clear messages.  
Checkpoint: Wait for developer approval before proceeding.

2. Add basic page navigation (next/previous) in the PDF.js viewer  
Status: Completed  
Testing: Extend the viewer UI with simple controls (e.g., “Prev page”, “Next page”, and a `Page X / Y` indicator). Use PDF.js APIs to track the current page index and re-render the canvas when the user navigates. Ensure navigation is clamped to `[1, numPages]`. Manually test on multi-page PDFs to confirm that navigation works, rendering is stable, and the loading state and error handling remain correct.  
Checkpoint: Wait for developer approval before proceeding.

3. Add `document_comments` table and minimal comment APIs  
Status: Completed  
Testing: In the backend, create a `document_comments` table with columns such as `id`, `document_id` (FK to `documents.id`), `page_number` (INT), `comment_text` (TEXT), `author` (optional VARCHAR), `created_at`, and `updated_at`. Then implement `GET /api/documents/:id/comments` and `POST /api/documents/:id/comments` (both protected by `requireAuth`). These routes should map `vector_store_file_id` to the internal `documents.id` once per request, then operate on `document_comments`. Test with `curl`: verify that POST creates comments, GET returns them grouped by document, and invalid ids yield clear 4xx errors.  
Checkpoint: Wait for developer approval before proceeding.

4. Wire the viewer to load and display page-level comments  
Status: Completed  
Testing: Update `viewer.html` to call `GET /api/documents/:id/comments` during initialization (after resolving the `doc` parameter and looking up any necessary metadata) and render the results in a right-hand sidebar, grouped or labeled by page number. When the user navigates pages, highlight comments for the current page (e.g., filter the list or visually emphasize matching entries). Manually verify that comments appear correctly for different pages and that the viewer remains responsive.  
Checkpoint: Wait for developer approval before proceeding.

5. Enable adding new comments tied to the current page  
Status: Completed  
Testing: Add an “Add comment” UI in the comments sidebar that posts new comments with the current page number via `POST /api/documents/:id/comments`. On success, append the new comment to the local list without a full reload. Ensure the viewer prevents empty comments and surfaces backend validation errors (if any). Manually add comments on several pages of a test document and confirm they persist (via a fresh reload of `/viewer.html?doc=<id>`) and are displayed under the correct page.  
Checkpoint: Wait for developer approval before proceeding.

## 3. Progress Tracking Notes

- Step 1 — Status: Completed — `viewer.html` now loads PDF.js from a CDN, replaces the `<iframe>` with a `<canvas>`, and uses `pdfjsLib.getDocument({ url })` to render the first page of the PDF into the canvas after fetching the pre-signed URL, while preserving existing loading/error messaging.  
- Step 2 — Status: Completed — The viewer now includes Prev/Next buttons and a `Page X / Y` indicator, tracks `pdfDoc`, `currentPage`, and `totalPages`, and re-renders the canvas with PDF.js when the user navigates pages (with simple locking to avoid overlapping renders).  
- Step 3 — Status: Completed — Added a `document_comments` table in `backend/src/db.ts` and implemented `GET /api/documents/:id/comments` and `POST /api/documents/:id/comments` in `backend/src/routes/documents.ts`, mapping `vector_store_file_id` to `documents.id` and supporting basic page-numbered comments with optional authors.  
- Step 4 — Status: Completed — `viewer.html` now fetches comments via `GET /api/documents/:id/comments`, stores them in memory, and renders a right-hand Comments sidebar that shows comments for the current page (or a clear “No comments…” message), updating automatically when the user navigates pages.  
- Step 5 — Status: Completed — The viewer sidebar now includes an “Add comment” area with a textarea, optional initials field, and `Add comment` button that posts to `POST /api/documents/:id/comments` with the current page number; new comments are appended client-side and rendered immediately under the correct page.  

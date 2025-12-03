# Implementation Plan: React/PDF.js Viewer Shell for Documents

## 1. Overview
Goal: Introduce a dedicated viewer route that opens a document in a React (or minimal JS) viewer shell using a backend-issued pre-signed PDF URL, and wire the existing Viewer column on `/search.html` to this viewer instead of going directly to the PDF. This sets up a clean, stable entry point where PDF.js and shared comments can be layered in later without changing the search page or backend contracts again.

In scope:
- A JSON endpoint that returns a pre-signed URL for a given document id (rather than redirecting).
- A simple viewer page (initially static HTML + JS, with room to evolve to React) that:
  - Parses a document id from the URL.
  - Calls the JSON endpoint to fetch a pre-signed PDF URL.
  - Embeds the PDF (initially via `<iframe>` or `<embed>`, later via PDF.js).
- Updating the Viewer column on `/search.html` to open the viewer route instead of the redirect route.

Out of scope:
- Implementing full React app structure (routing, bundling) beyond what is required to host a single viewer page.
- Implementing PDF.js-based rendering or comment overlays (those will be handled in a follow-up plan).
- Changing how documents are ingested into S3 or how `s3_key` is populated.

## 2. Step-by-Step Plan

1. Add JSON pre-signed URL endpoint for a document  
Status: Completed  
Testing: In `backend/src/routes/documents.ts`, add a new `GET /api/documents/:id/presigned-url` endpoint (protected by `requireAuth`) that mirrors the lookup logic from `/api/documents/:id/view`: it validates `:id` as `vector_store_file_id`, looks up the row in `documents`, checks `s3_key`, and calls `getPresignedUrlForS3Key`. Instead of redirecting, it should return JSON `{ url: string }`. Verify with `curl` that valid ids return `{ url: "https://..." }` and invalid/missing `s3_key` cases return clear 4xx/5xx errors.  
Checkpoint: Wait for developer approval before proceeding.

2. Create a minimal viewer HTML shell that embeds a PDF from a URL  
Status: Completed  
Testing: Add a static `backend/public/viewer.html` that accepts a `doc` query parameter. In an inline `<script>`, parse `doc` from `window.location.search`, call the new `GET /api/documents/:id/presigned-url` endpoint, and once a `url` is returned, render the PDF using a simple `<iframe src="url">` or `<embed>` tag sized to fill most of the viewport. Add basic loading and error messaging (e.g., “Loading PDF…” / “Unable to load PDF”). Manually test by visiting `/viewer.html?doc=<vectorStoreFileId>` in the browser and confirm the PDF loads via the pre-signed URL.  
Checkpoint: Wait for developer approval before proceeding.

3. Wire the Viewer column on `/search.html` to the new viewer shell  
Status: Completed  
Testing: Update the Viewer column link in `backend/public/search.html` so it points to `/viewer.html?doc=<id>` instead of `/api/documents/<id>/view` (keeping `target="_blank"`). Ensure that existing fallback behavior for documents without `s3_key` (currently using `/api/files/<fileId>`) is preserved, either by: (a) retaining a direct fallback link in those cases, or (b) teaching the viewer shell to call `/api/files/:fileId` when the pre-signed endpoint reports “No PDF” but a file still exists. Manually run searches, click Viewer for several documents, and confirm the viewer tab opens, calls the JSON endpoint, and displays the PDF.  
Checkpoint: Wait for developer approval before proceeding.

4. Adjust CORS and headers as needed for embedding and future PDF.js integration  
Status: Completed  
Testing: Confirm that the pre-signed URL and S3 bucket CORS rules allow embedding in an `<iframe>`/`<embed>` from the Argus origin (no blocked mixed-content or cross-origin issues). Validate by opening `/viewer.html?doc=<id>` via the Viewer column in the Search UI and confirming the PDF renders in the iframe without browser console CORS errors. No additional CORS changes were required in the current environment.  
Checkpoint: Wait for developer approval before proceeding.

## 3. Progress Tracking Notes

- Step 1 — Status: Completed — Added `GET /api/documents/:id/presigned-url` in `backend/src/routes/documents.ts`, mirroring `/api/documents/:id/view` lookup logic but returning `{ url }` JSON instead of redirecting, with appropriate 4xx/5xx responses for missing documents or `s3_key`.  
- Step 2 — Status: Completed — Added `backend/public/viewer.html`, which reads `?doc=<vectorStoreFileId>` from the query string, calls `/api/documents/:id/presigned-url`, and, on success, embeds the returned PDF URL in a full-height `<iframe>` with basic loading and error messaging.  
- Step 3 — Status: Completed — Updated the Viewer column in `/search.html` so that when `hasPdf` is true it now opens `/viewer.html?doc=<id>` in a new tab (which in turn uses the JSON pre-signed URL endpoint), and when `hasPdf` is false it continues to fall back to `/api/files/<fileId>` to maintain compatibility with older documents.  
- Step 4 — Status: Completed — Verified that PDFs loaded via `/api/documents/:id/presigned-url` can be embedded in the `/viewer.html` iframe from the Argus origin without CORS issues, so no further header or bucket configuration changes are needed for the current setup.  

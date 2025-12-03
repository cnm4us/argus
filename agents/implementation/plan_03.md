# Implementation Plan: Viewer Column with Pre-signed PDF URLs

## 1. Overview
Goal: Add a “Viewer” column to the `/search.html` results table that opens the original PDF in a new browser tab via a backend-generated S3 pre-signed URL, using the existing document records (including `s3_key`) as the source of truth. This sets the foundation for a future React/PDF.js viewer with shared comments, but for now focuses only on direct PDF viewing.

In scope:
- New backend endpoint(s) to generate and expose short-lived pre-signed S3 URLs for PDFs associated with `documents` rows.
- Wiring the Viewer column in `/search.html` to open PDFs in a new tab (via a redirect or a simple link) using the new backend endpoint.
- Basic error handling for missing `s3_key` or S3 access failures.

Out of scope:
- React/PDF.js viewer and overlay comments UI (to be handled in a later plan).
- Any changes to ingestion, S3 upload, or how `s3_key` is populated.
- Fine-grained authorization beyond the existing `requireAuth` protection.

## 2. Step-by-Step Plan

1. Add S3 pre-signed URL helper and configuration in the backend  
Status: Completed  
Testing: Introduce a small helper in `backend/src` (e.g., `s3SignedUrl.ts` or inside an existing config/util file) that uses the AWS SDK to generate `getObject` pre-signed URLs for a given `(bucket, key, expiresSeconds)`. Wire it to read S3 configuration from existing environment variables (or add clear env var expectations if not yet present). Write a small one-off script or temporary route in dev to call the helper with a known `s3_key` and manually verify the returned URL successfully downloads the expected PDF, and that the URL expires after the configured TTL.  
Checkpoint: Wait for developer approval before proceeding.

2. Implement authenticated backend route to serve a pre-signed PDF URL for a document  
Status: Completed  
Testing: Add a new route in the backend (e.g., `GET /api/documents/:id/view` or `/api/documents/:id/presigned-url`) that: (a) validates the `id` (vector_store_file_id or internal `documents.id`, based on the existing search result shape), (b) looks up the corresponding `documents` row, (c) confirms `s3_key` is present, and (d) generates a short-lived pre-signed URL for the PDF. For the MVP, this route should issue a `302` redirect to the S3 pre-signed URL; optionally, it can return JSON `{ url }` if we need that later. Use `curl -v` and the browser to hit the endpoint for a test document, confirm it redirects to S3, the PDF opens, and error cases (unknown id, missing `s3_key`, S3 failures) return reasonable 4xx/5xx responses.  
Checkpoint: Wait for developer approval before proceeding.

3. Add a Viewer column to `/search.html` and wire it to the view route  
Status: Completed  
Testing: Update `backend/public/search.html` to insert a “Viewer” header between “Details” and “Provider”, and add a corresponding cell in `renderResults` that renders a link or button (e.g., “View PDF”) pointing to the new backend route (e.g., `/api/documents/<id>/view`) with `target="_blank"`. Ensure that the `id` used matches the backend route’s expectation (most likely `item.id` / `vector_store_file_id`). Manually run a few searches, click the Viewer link for multiple documents, and confirm that each opens the correct PDF in a new tab, with no regressions to existing Details links or filters.  
Checkpoint: Wait for developer approval before proceeding.

4. Polish UX and error handling for missing PDFs  
Status: Completed  
Testing: Ensure the Viewer cell behaves sensibly when a document has no `s3_key` or when pre-signed URL generation fails (e.g., fall back to the existing `/api/files/:id` streaming route) so users always have a working “View PDF” link when a file exists, while still allowing the `/api/documents/:id/view` pre-signed redirect to be used when `s3_key` is present. Manually verify behavior for at least one document with a stored `s3_key` and others without, confirming that Viewer links resolve correctly and that existing search and details flows still work as before.  
Checkpoint: Wait for developer approval before proceeding.

## 3. Progress Tracking Notes

- Step 1 — Status: Completed — Added `getPresignedUrlForS3Key` helper in `backend/src/s3Client.ts` using `@aws-sdk/s3-request-presigner` to generate short-lived `getObject` URLs for a given `s3_key`, wired to existing S3 config/env.  
- Step 2 — Status: Completed — Added `GET /api/documents/:id/view` (protected by `requireAuth`) in `backend/src/routes/documents.ts` that looks up `documents` by `vector_store_file_id`, verifies `s3_key` is present, uses `getPresignedUrlForS3Key` to create a short-lived URL, and redirects the client to the PDF.  
- Step 3 — Status: Completed — Added a “Viewer” column between Details and Provider on `/search.html` and wired each row to `/api/documents/<id>/view` (opening in a new tab) using the existing `item.id` / `vector_store_file_id` from the search results.  
- Step 4 — Status: Completed — The search DB query (`POST /api/search/db`) now selects `d.s3_key` and returns a boolean `hasPdf` flag per item, and `/search.html` uses this to prefer `/api/documents/<id>/view` (pre-signed URL) when `hasPdf` is true while falling back to `/api/files/<fileId>` when it is not, ensuring Viewer links remain usable even for documents without an explicit `s3_key` recorded.  

# Handoff_06 – Argus Document Intelligence

## Thread context

- Sixth agent thread for the Argus project.
- Picked up after Handoff_05 with markdown-first ingestion, modules, projections, and taxonomy already in place.
- Immediate focus: polish and bug fixes around the new Admin tools (Modules, Taxonomies, Documents) and search UI.

## High-level system state (snapshot)

- Backend: Node.js + TypeScript + Express in `backend/`.
- Frontend: Simple HTML pages in `backend/public/` for Search and Admin tools.
- Search:
  - DB-backed search over `documents.markdown` with metadata filters, taxonomy filters, and CNF-style text search.
  - Vector search is disabled in the UI; Files API is still used only for PDF → markdown extraction.
- Admin:
  - **Admin Modules**: global module coverage and rebuild controls.
  - **Admin Taxonomies**: per-category rebuild (projection-based) and LLM re-run.
  - **Admin Documents**: per-document view with links to module and taxonomy re-run pages.
- Taxonomy:
  - Projection-backed categories for vitals, smoking, mental_health, respiratory, appointments, results, referrals, communications.
  - LLM-backed categories including sexual_history, with evidence snippets stored per term.

## Key endpoints / flows

- `/api/search/db` (POST): combined metadata, taxonomy, and text filters for search.
- `/api/search/options` (GET): options for document types, providers, facilities, taxonomy categories/keywords/subkeywords.
- `/api/documents/db` (GET): DB-backed document listing used by Admin Documents.
- `/api/documents/:id/metadata/db` (GET): DB metadata for a single document.
- `/api/documents/:id/taxonomy` + `/api/documents/:id/text-evidence`: data for taxonomy Details and text snippet evidence.
- `/api/admin/modules/*`: global and per-document module rebuild endpoints.
- `/api/admin/taxonomy/*`: global and per-document taxonomy rebuild / LLM re-run endpoints.

## Known issues / open questions

- Admin Documents page currently shows an empty table for the File Name, Document Type, Date, and Provider columns even though the table structure and buttons are wired correctly. Likely a mismatch between the JSON shape from `/api/documents/db` and the field names used in `admin-documents.html`.
- Need to verify that the new respiratory taxonomy behaves as expected and that evidence strings are understandable for the user.
- As the corpus grows toward ~2,000 documents, performance of text search and admin pages should continue to be monitored; current implementation is straightforward SQL `LIKE` over `documents.markdown`.

## Next-step suggestions

- Inspect `backend/src/routes/documents.ts` for `GET /api/documents/db` and confirm the JSON shape (field names and nesting) returned to the Admin Documents page.
- Update `backend/public/admin-documents.html` (or the endpoint) so the table correctly renders File Name, Document Type, Date, and Provider using the returned fields.
- After fixing the Admin Documents table, manually verify per-document module and taxonomy pages for a few documents to ensure IDs and links remain correct.
- If time allows, add brief inline comments or README notes describing how Admin Documents ties into the modules/taxonomy pipeline for future debugging.


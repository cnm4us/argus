# Implementation Plan: Persisted Saved Text Searches

## 1. Overview
Goal: Add a “Save Search” feature for the text search section of `/search.html` that persists named text-only queries in the backend so they are shared across machines (single logical user), allows applying a saved search to repopulate text rows and re-run the query, and supports deleting saved searches; other filters (Documents, Encounters, Dates) remain transient and are not captured in saved searches.

In scope:
- New database storage for saved text searches.
- Backend API endpoints to create, list, and delete saved text searches.
- `/search.html` UI changes: “Save search” flow (with name dialog), saved-search dropdown in the upper-right of the text search container, and a way to delete saved searches.
- Behavior where applying a saved search repopulates text rows, clears other filters, and immediately re-runs the search.

Out of scope:
- Per-user or multi-tenant saved searches; assume a single shared logical user.
- Editing or renaming existing saved searches (other than delete + recreate).
- Capturing or restoring Documents/Encounters/Dates filters as part of a saved search.

## 2. Step-by-Step Plan

1. Add database table for saved text searches  
Status: Completed  
Testing: Update `initDb` in `backend/src/db.ts` to create a `saved_text_searches` table (if not present) with columns such as `id` (AUTO_INCREMENT primary key), `name` (unique, VARCHAR), `query_json` (JSON storing `{ rows: [{ terms: string[] }, ...] }`), `created_at`, and `updated_at`. Start the backend (or run the DB init path) against a dev database, confirm no migration errors, and verify via `SHOW TABLES LIKE 'saved_text_searches';` and `DESCRIBE saved_text_searches;` that the schema exists and matches expectations.  
Checkpoint: Wait for developer approval before proceeding.

2. Implement backend APIs to list and delete saved text searches  
Status: Completed  
Testing: In `backend/src/routes/search.ts` (or a small companion router), add authenticated endpoints `GET /api/search/saved` (returns an array of `{ id, name, query: { rows } }` sorted by name or creation time) and `DELETE /api/search/saved/:id` (removes a saved search by id). Use `saved_text_searches` as the source of truth. Exercise the endpoints with `curl` or similar to confirm: listing works when there are zero or more rows, deleting a non-existent id is handled gracefully (e.g., 204 or 404), and deleting an existing saved search removes it from subsequent `GET` responses.  
Checkpoint: Wait for developer approval before proceeding.

3. Implement backend API to create saved text searches with validation  
Status: Completed  
Testing: Add `POST /api/search/saved` that accepts `{ name: string, text: { rows: { terms: string[] }[] } }`. Validate on the server that `name` is non-empty after trimming and that there is at least one row with at least one non-empty term. Normalize and store the query structure into `query_json`. Enforce unique names (e.g., a `UNIQUE KEY` on `name`) and surface a 400/409 error when a duplicate name is submitted so the UI can tell the user to delete or choose a different name. Use `curl` to send valid and invalid payloads and confirm: valid requests create rows in `saved_text_searches`, invalid payloads return clear JSON error messages, and duplicates are rejected as designed.  
Checkpoint: Wait for developer approval before proceeding.

4. Wire `/search.html` to load and apply saved searches  
Status: Completed  
Testing: In `backend/public/search.html`, add a “Saved searches” `<select>` in the upper-right of the text search container (with a neutral placeholder option). On page initialization, fetch `GET /api/search/saved` and populate this dropdown with `{ id, name }`. On selection of a saved search (excluding the placeholder), fetch or reuse the stored `rows` definition, clear any existing text rows, rebuild them using the existing `createTextRow` helper (or a new shared function) so that rows = AND, terms = OR, and reset Documents/Encounters/Dates filters back to their default “Any”/blank states. Then call `runSearch()` so the document table refreshes to match the saved text query. Test by seeding a few saved searches via the API or DB, reloading `/search.html`, selecting them, and confirming that: the text row UI matches the stored rows, other filters are cleared, and the results match what you’d get if you manually typed the same text query and clicked Search.  
Checkpoint: Wait for developer approval before proceeding.

5. Add “Save search” UI and dialog flow on the search page  
Status: Completed  
Testing: Add a “Save search” button near the text search section (e.g., near the text search title or controls). When clicked, gather the current text-row structure from the DOM via a shared helper (so logic stays in sync with `runSearch`), and if there are no non-empty terms, show a simple inline message and skip the dialog. Otherwise, open a lightweight modal/dialog prompting for a search name with `[Save]` and `[Exit]` buttons. On `[Save]`, POST to `/api/search/saved`; on success, close the dialog, refresh the saved-search dropdown, and optionally select the new entry; on duplicate-name or validation errors, display a clear message in the dialog without closing it. Verify in the browser that saving works end-to-end, empty-name and empty-query cases are blocked with user feedback, and duplicate-name errors behave as intended while not breaking the rest of the page.  
Checkpoint: Wait for developer approval before proceeding.

6. Add delete controls for saved searches and finalize UX behavior  
Status: Completed  
Testing: Next to the saved-search dropdown, add a small “Delete” control (e.g., a button) that is enabled only when a real saved search is selected. On click, ask for confirmation (e.g., `window.confirm('Delete saved search "<name>"?')`); if confirmed, call `DELETE /api/search/saved/:id`, then refresh the dropdown and clear the selection. Deleting a saved search should not forcibly reset the current text rows or results, but subsequent page loads or dropdown openings should no longer show the deleted entry. Perform a final pass in the UI to confirm: applying a saved search clears non-text filters and re-runs the search; users can still adjust Documents/Encounters/Dates afterward; selecting a saved search while other filters are active discards those filters as intended; saving, applying, and deleting work together without JavaScript errors or regressions to the base search behavior.  
Checkpoint: Wait for developer approval before proceeding.

## 3. Progress Tracking Notes

- Step 1 — Status: Completed — `saved_text_searches` table created in `backend/src/db.ts` and wired into `initDb` so it is created idempotently on startup.  
- Step 2 — Status: Completed — `GET /api/search/saved` and `DELETE /api/search/saved/:id` implemented in `backend/src/routes/search.ts` to list and delete saved text searches.  
- Step 3 — Status: Completed — `POST /api/search/saved` implemented with validation for non-empty name and at least one non-empty term, storing normalized `{ rows: [{ terms }] }` JSON and returning appropriate errors on duplicates or invalid input.  
- Step 4 — Status: Completed — `/search.html` now loads saved searches into a “Saved” dropdown in the Text Search section, and selecting a saved search clears non-text filters, repopulates text rows, and immediately re-runs the search.  
- Step 5 — Status: Completed — Added a “Save” button in the Text Search header plus a modal dialog that prompts for a name and posts to `/api/search/saved`, with inline validation for empty names, empty queries, and duplicate-name/server errors.  
- Step 6 — Status: Completed — Added a “Delete” button next to the saved-search dropdown that is enabled only when a saved search is selected, confirms with the user, calls `DELETE /api/search/saved/:id`, and refreshes the dropdown without altering the current text rows or results.

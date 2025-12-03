# Implementation Plan: Text-Anchored Highlights + Rich Comment Metadata

## 1. Overview
Goal: Evolve the current PDF.js viewer from page-level comments to text-anchored comments, so users can highlight specific text in a document and attach comments (with custom fields) directly to that selection. This plan assumes the existing viewer shell (`/viewer.html?doc=<vectorStoreFileId>`), PDF.js integration, page navigation, and page-level comments are already working (as implemented in `plan_05`).

In scope:
- Introduce a robust “highlight selection → add comment” workflow in the viewer.
- Persist highlight anchors in the database in a way that survives re-rendering and minor layout differences.
- Render stored highlights back into the viewer and keep comments and highlights in sync.
- Extend the comment model and UI to support custom metadata fields (e.g., category, severity, status, tags, initials).

Out of scope:
- Full migration to the official PDF.js `web/viewer.html` UI (iframe-based) — this plan assumes we continue from the custom viewer, but we may borrow patterns from the official text layer.
- Complex range reconciliation across major PDF changes (e.g., if the underlying PDF is replaced with a structurally different copy).
- Multi-user identity and permissions beyond the existing shared login (we still treat “author” as a free-form field, not as a real auth identity).

## 2. Design Decisions (to confirm early in the next thread)

Before executing, the next agent should confirm:

1. **Highlight granularity**
   - Preferred option: text selection at character/range level (e.g., a selected phrase within a line).
   - Keep comments anchored to:
     - `document_id`
     - `page_number`
     - text range information (see below).

2. **Anchor representation in the DB**
   - Proposed fields (in a new table or by extending `document_comments`):
     - `page_number` (INT)
     - `selected_text` (TEXT) — the quoted text.
     - `context_before` / `context_after` (TEXT, optional) — short snippets around the selection to improve matching.
     - `start_offset` / `end_offset` (INT, optional) — character offsets within the page’s text, if practical.
     - `rects_json` (JSON, optional) — list of bounding boxes for the highlight (if we compute them).
   - For a first pass, storing `selected_text` + `page_number` + `rects_json` is likely enough; offsets and context can be added if needed.

3. **Custom comment fields**
   - Decide upfront which extra fields to support, e.g.:
     - `category` (e.g., “clinical risk”, “documentation”, “legal note”)
     - `severity` (e.g., low/medium/high)
     - `status` (e.g., open/resolved)
   - These can be columns on the same comment/highlight table and simple selects in the UI.

4. **UX ergonomics**
   - Likely workflow:
     1. User selects text on the page.
     2. A small “Comment on selection” button/toolbar appears near the selection or in the sidebar.
     3. Clicking it opens/uses the sidebar form prefilled with the selection preview.
   - Highlights display:
     - Yellow overlay on selected text.
     - Clicking highlight focuses the corresponding comment in the sidebar.

## 3. Step-by-Step Plan

1. Add a text layer over the PDF canvas for selectable text  
Status: Pending  
Testing: Implement a PDF.js text layer for each rendered page (either by using the official `TextLayerBuilder` from the PDF.js viewer or by replicating its approach). For each page render, fetch `page.getTextContent()` and create an absolutely positioned `<div>` overlay that contains `<span>` elements for the text runs aligned with the canvas. Validate that users can select text (copy/paste) and that the overlay aligns well with the underlying rendered text at common zoom levels.  
Checkpoint: Wait for developer approval before proceeding.

2. Capture text selections and map them to page + text range  
Status: Pending  
Testing: Add event handlers (e.g., `mouseup` / `selectionchange`) that detect when the user has a non-empty selection within the text layer. Determine the current page (from PDF.js) and capture:
  - `page_number`
  - `selected_text` (string)
  - Optional: bounding rectangles for the selection (via `Range.getClientRects()`), normalized to page coordinates.  
Provide a visual cue (e.g., a small inline toolbar or a subtle highlight) that a selection is ready to be commented on. Confirm via console logs that selection events correctly capture page number and text for various PDFs.  
Checkpoint: Wait for developer approval before proceeding.

3. Extend the comment data model to store highlight anchors and custom fields  
Status: Pending  
Testing: Either extend `document_comments` or create a new `document_highlight_comments` table with fields like:
  - `id`, `document_id`, `page_number`, `comment_text`, `author`
  - `selected_text`, `context_before`, `context_after`
  - `rects_json` (JSON array of `{ x, y, width, height }` in normalized coordinates)
  - Custom metadata fields (e.g., `category`, `severity`, `status`) as agreed in Section 2.3.  
Update `GET /api/documents/:id/comments` and `POST /api/documents/:id/comments` (or add parallel routes) to accept/return these fields. Use `curl` to verify that the API can create and retrieve highlight-anchored comments and that JSON serialization works as expected.  
Checkpoint: Wait for developer approval before proceeding.

4. Update the viewer UI to create comments from selections and show highlight metadata  
Status: Pending  
Testing: Modify `viewer.html` so that when a text selection is present and the user chooses “Add comment”:
  - The sidebar form is populated with:
    - The `selected_text` preview.
    - The current `page_number`.
  - On submit, the viewer posts all highlight data (including custom fields) to the updated comments API.  
Extend the comments list UI so that each comment shows whether it is highlight-based (e.g., using a quote preview) and displays any custom fields (category, severity, etc.). Manually test by creating several highlight-based comments on different pages and verifying persistence and retrieval.  
Checkpoint: Wait for developer approval before proceeding.

5. Render stored highlights back onto the PDF pages  
Status: Pending  
Testing: For each page render, after drawing the canvas and text layer, iterate through comments for that page that include highlight anchor data. For each, draw an overlay highlight (e.g., a semi-transparent yellow `<div>` or `<span>` positioned using `rects_json` or re-derived offsets). Ensure highlights reposition correctly when re-rendering pages (e.g., after navigation or resize) and that they do not interfere with text selection or clicks. Confirm that clicking a highlight focuses the sidebar on the corresponding comment (and optionally scrolls it into view) and that clicking a comment scrolls the document to the highlight.  
Checkpoint: Wait for developer approval before proceeding.

6. Polish UX and edge cases for mixed page-level and text-anchored comments  
Status: Pending  
Testing: Decide how to handle existing page-level comments alongside new highlight-based comments (e.g., show both, with a clear badge/icon). Ensure the sidebar groups or labels comments clearly and that creating a highlight-based comment on a page without text (e.g., an image-only page) fails gracefully with a helpful message. Perform a manual QA pass across a few PDFs with varying layouts (simple text, multi-column, scanned image PDFs) to confirm that selection + comment workflows feel stable and do not degrade the base viewer experience.  
Checkpoint: Wait for developer approval before proceeding.

## 4. Progress Tracking Notes

- Step 1 — Status: Pending.  
- Step 2 — Status: Pending.  
- Step 3 — Status: Pending.  
- Step 4 — Status: Pending.  
- Step 5 — Status: Pending.  
- Step 6 — Status: Pending.  


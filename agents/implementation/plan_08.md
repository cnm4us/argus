# Implementation Plan: Advanced Highlight Editing + Comment Context

## 1. Overview
Goal: Evolve the viewer’s text-anchored highlight UX so users can (a) see highlight color immediately while selecting, (b) choose a highlight color from a palette, (c) select an existing comment as “context” and edit its metadata and highlight islands, and (d) optionally assemble a comment from multiple discontiguous highlight regions (e.g., via SHIFT-based selection).

In scope:
- Add a live highlight preview for the current selection using the active palette color, before a comment is saved.
- Introduce a clear “active comment” context in the sidebar and visually differentiate the selected comment and its highlights.
- Support an edit mode where an existing comment’s metadata (category, severity, status, color) and highlight islands can be modified.
- Extend highlight editing so users can add new islands to an existing comment or remove specific islands using an eraser, persisted via the API.
- Optionally support multi-region selection (e.g., SHIFT + drag) to build a single comment from multiple non-adjacent text regions.

Out of scope:
- Freehand drawing / arbitrary polygon tools (marker-style freeform highlights).
- Complex versioning or history of comment edits.
- Per-user permissions beyond “owner/admin can edit/delete”.

## 2. Step-by-Step Plan

1. Add live highlight preview for current selections  
Status: Completed  
Testing: Update `viewer.html` so that when a selection is captured (before clicking “Add comment”), the rects in `currentSelection` are rendered immediately on top of the page using the active palette color (visually distinct as a preview). Ensure the preview disappears or converts to a persisted highlight when the comment is saved or cancelled, and that single-line and multi-line previews remain aligned with the text as pages are re-rendered.  
Checkpoint: Wait for developer approval before proceeding.

2. Introduce active comment context and visual selection  
Status: Completed  
Testing: Add an “active comment” concept in the viewer: clicking a comment in the sidebar sets `activeCommentId`, visually highlights that comment row, and optionally emphasizes its highlights (e.g., stronger outline). Verify that only one comment is active at a time, that clicking elsewhere clears or changes the active comment, and that existing scroll-to-highlight behavior still works.  
Checkpoint: Wait for developer approval before proceeding.

3. Implement comment edit mode and metadata updates  
Status: Completed  
Testing: When an active comment is selected, the viewer now loads its metadata into the comments form: text, category, severity, status, and color are reflected in the textarea, selects, and palette (with the “Update comment” label on the primary button). The backend `PATCH /api/documents/:id/comments/:commentId` handler in `backend/src/routes/documents.ts` was extended to accept partial updates for `rects` (as before) and metadata fields `category`, `severity`, `status`, and `color` (validated where appropriate), only updating columns that are present in the request body. On the frontend, the submit handler in `viewer.html` now distinguishes between create vs. edit: when `editingCommentId` is set, it sends a `PATCH` with the metadata fields and updates the in-memory `allComments` entry on success; when not editing, it continues to `POST` a new comment. Manual checks confirm that changing category/severity/status/color in edit mode persists correctly and that comments without some fields still render sensibly.  
Checkpoint: Wait for developer approval before proceeding.

4. Extend highlight editing for existing comments (add/remove islands)  
Status: Pending  
Testing: In edit mode for an active comment, reuse the existing rects+color machinery so that:  
- New selections, when a comment is active, append their rects to that comment instead of creating a new comment (then call `PATCH` with the merged `rects` list).  
- The eraser behavior removes specific islands from the active comment’s `rects` and persists the updated list via `PATCH`.  
Ensure that removing all islands for a comment leaves it as a page-level comment (no highlight) or prompts for deletion, and that the UI and API stay in sync after each edit.  
Checkpoint: Wait for developer approval before proceeding.

5. Add multi-region selection (SHIFT + drag) and interaction polish  
Status: Pending  
Testing: When in selection or edit mode, allow users to hold SHIFT to accumulate multiple rect batches into `currentSelection` (for new comments) or into the active comment’s `rects` (for existing comments), then persist them together on save/update. Add small UX refinements: e.g., consistent cursor changes for preview vs edit vs eraser, ESC to clear preview selection, and a clear visual distinction between preview highlights and saved highlights. Perform manual QA on single-line, multi-line, and non-adjacent selections, including edge cases where selections are partially overlapping or near page boundaries.  
Checkpoint: Wait for developer approval before proceeding.

## 3. Progress Tracking Notes

- Step 1 — Status: Completed.  
- Step 2 — Status: Completed.  
- Step 3 — Status: Completed.  
- Step 4 — Status: Pending.  
- Step 5 — Status: Pending.  

# Implementation Plan: Comment Threads (One-Level Replies) for Text-Anchored Highlights

## 1. Overview
Goal: Extend the existing text-anchored comment system so each highlight can have a small, linear thread of follow-up remarks (one level of replies) while keeping the UI simple and preserving the current highlight behavior. This plan assumes `plan_06` is complete: comments are already text-anchored, have metadata (category/severity/status), and render highlights in the viewer.

In scope:
- Allow multiple users to add replies to a single root comment (one level deep).
- Persist replies in the database, tied to a root comment and its highlight.
- Expose replies via the existing comments API in a way that is easy for the viewer to consume.
- Update the viewer UI so each root comment displays its replies as a grouped block, and clicking any reply still focuses the same highlight.

Out of scope:
- Nested replies beyond one level (no replies-to-replies).
- Per-reply highlight anchors (replies share the root comment’s anchor).
- Real user identity or permissions (replies still use free-form initials/author).
- Cross-document or cross-page threading.

## 2. Step-by-Step Plan

1. Design the data model for one-level replies  
Status: Pending  
Testing: Decide whether replies live in the existing `document_comments` table (via a `parent_comment_id` column) or a new `document_comment_replies` table. Document the chosen schema, including fields like `id`, `comment_id` or `parent_comment_id`, `reply_text`, `author`, and timestamps, and ensure that only root comments (with highlight anchors) can have replies. Verify the design supports efficient querying of all comments + replies for a document without breaking existing data.  
Checkpoint: Wait for developer approval before proceeding.

2. Implement DB schema changes and migrations for replies  
Status: Pending  
Testing: Add the chosen schema to `backend/src/db.ts`, including `CREATE TABLE` or `ALTER TABLE` statements and any backfill logic needed for existing installs. Run `npm run build` and connect to a dev DB to confirm the new columns/table exist (via `SHOW COLUMNS` / `DESCRIBE` / `SELECT`), and that existing comments remain intact.  
Checkpoint: Wait for developer approval before proceeding.

3. Extend the comments API to return grouped threads (root + replies)  
Status: Pending  
Testing: Update `GET /api/documents/:id/comments` so it returns each root comment with a `replies` array containing its replies, ordered by creation time (oldest first). Ensure root comments still include all existing fields (highlight anchors + metadata). Use `curl` or a REST client to confirm that documents with and without replies serialize correctly, and that clients that ignore `replies` still see the same root comment fields as before.  
Checkpoint: Wait for developer approval before proceeding.

4. Add an API to create replies for a specific root comment  
Status: Pending  
Testing: Introduce a way to post replies, either by extending `POST /api/documents/:id/comments` with a `parentCommentId` field (restricted to roots) or adding a dedicated endpoint (e.g., `POST /api/comments/:id/replies`). Validate that replies cannot be created for non-existent or non-root comments, and that replies do not require highlight fields (`rects`, `selectedText`). Use `curl` to create replies, then fetch via `GET /api/documents/:id/comments` to confirm they appear under the correct root.  
Checkpoint: Wait for developer approval before proceeding.

5. Update the viewer UI to render threaded comments and capture replies  
Status: Pending  
Testing: Modify `viewer.html` so that the comments sidebar groups each root comment and its replies as a single visual block: the root comment appears as now (selection preview + metadata + text), and replies render underneath with a lighter, indented style. Add a “Reply” affordance (button/link) on each root comment that opens a small reply textarea (and initials input) scoped to that comment, wired to the new reply API. Confirm that posting a reply updates the in-memory `allComments`/threads list without reloading the page, that replies appear after a refresh, and that reply creation still works when no highlight is present (page-level root comments).  
Checkpoint: Wait for developer approval before proceeding.

6. Keep highlight behavior consistent for replies and polish UX  
Status: Pending  
Testing: Ensure that clicking either the root comment or any of its replies scrolls the viewer to the same highlight and applies an “active” style to the entire thread (root + replies) and its highlight(s). Verify that threads without highlight anchors (pure page-level comments) still behave sensibly (e.g., no highlight but still scroll the page if a sensible default exists). Perform a manual QA pass on documents with mixed page-level and text-anchored comments, long threads, and no replies to confirm the UI remains readable and that the new reply features do not regress core comment functionality.  
Checkpoint: Wait for developer approval before proceeding.

## 3. Progress Tracking Notes

- Step 1 — Status: Pending.  
- Step 2 — Status: Pending.  
- Step 3 — Status: Pending.  
- Step 4 — Status: Pending.  
- Step 5 — Status: Pending.  
- Step 6 — Status: Pending.  


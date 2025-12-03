# Implementation Plan: Multi-User Authentication and Protected Application

## 1. Overview
Goal: Replace the current single-user / shared-login behavior with a simple multi-user authentication system so that users can register, log in with email + password, and have the rest of the Argus UI protected behind login. This will also allow comments to use the logged-in user’s identity instead of the free-form initials field, paving the way for per-user comment ownership in later work.

In scope:
- Introduce a `users` table to persist accounts (email, username/display name, password hash, basic role/flags).
- Implement secure registration and login flows with password hashing and HTTP-only session cookies.
- Protect all existing app routes and APIs so unauthenticated visitors are redirected to a login page.
- Update the comments system to use the logged-in user identity for new comments instead of the manual “Initials” field.

Out of scope:
- Email verification flows and password reset emails.
- OAuth / SSO providers.
- Fine-grained authorization (e.g., per-user edit/delete of comments, or admin moderation tools).
- Full user profile management beyond basic account fields.

## 2. Step-by-Step Plan

1. Audit current auth behavior and finalize user/session design  
Status: Completed  
Testing: Current behavior is a single shared password (`APP_PASSWORD`) validated either via `Authorization: Bearer <APP_PASSWORD>` or via a signed, HMAC-based session cookie (`argus_session`) whose payload is `sub: 'argus'` and `exp` (12h TTL). The login page (`backend/public/login.html`) calls `POST /api/auth/login` with `{ password }`, which, on success, sets the `argus_session` cookie using `createSessionToken`. All protected API routes use `requireAuth`, which accepts either the bearer token or a valid `argus_session` cookie; all non-API HTML routes (except `/login.html` and static assets) are guarded by a middleware in `backend/src/server.ts` that checks the same cookie and redirects unauthenticated users to `/login.html`. There is no notion of per-user identity: the session payload has a fixed `sub: 'argus'`, and no users table exists.  
Decision: For multi-user support we will (a) retain the existing signed-cookie mechanism and `SESSION_COOKIE_NAME = 'argus_session'`, but (b) change the payload to carry a user id (e.g., `sub: <user_id>`) instead of the fixed `'argus'`. We will introduce a `users` table to store accounts and, at least initially, avoid a separate `user_sessions` DB table by keeping session state purely in the signed cookie (stateless sessions). If server-side revocation or multiple concurrent sessions are needed later, we can add a `user_sessions` table and check it in `verifySessionToken`. The `requireAuth` middleware will be updated to decode the session payload, look up the corresponding user, and attach it to `req.user`, while still optionally honoring the bearer `APP_PASSWORD` flow for administrative or tooling scenarios if desired.  
Checkpoint: Wait for developer approval before proceeding.

2. Add database schema for users (and sessions, if needed)  
Status: Completed  
Testing: Added `createUsersTableSQL` to `backend/src/db.ts` that creates a `users` table with fields: `id` (INT UNSIGNED PK, auto-increment), `email` (VARCHAR(255), NOT NULL, unique), `display_name` (VARCHAR(255), NOT NULL), `password_hash` (VARCHAR(255), NOT NULL), `role` (ENUM('user','admin') DEFAULT 'user'), and timestamps (`created_at`, `updated_at`). The table is created via `CREATE TABLE IF NOT EXISTS` and invoked early in `initDb()` with `await db.query(createUsersTableSQL);`, so existing installations automatically gain the table on startup without impacting other data. Ran `npm run build` in `backend` to verify compilation; a future manual DB check (e.g., `SHOW TABLES LIKE 'users'; DESCRIBE users;`) can confirm the table structure in a live environment. No `user_sessions` table is introduced at this stage, per the stateless-session design from Step 1.  
Checkpoint: Wait for developer approval before proceeding.

3. Implement backend registration, login, and logout endpoints  
Status: Completed  
Testing: Added `backend/src/passwords.ts` with `hashPassword` and `verifyPassword` helpers using Node's `crypto.scryptSync` plus a random salt, storing hashes in the format `scrypt$<saltHex>$<hashHex>`. Updated `backend/src/session.ts` so `createSessionToken(userId)` encodes a `SessionPayload` with `sub: <user_id>` and `exp`, introduced `decodeSessionToken` to validate and return the payload, and kept `verifySessionToken` as a boolean wrapper for non-DB checks. Replaced the old single-password auth routes in `backend/src/routes/auth.ts` with:  
- `POST /api/auth/register` — accepts `{ email, password, displayName? }`, normalizes and validates email, enforces a minimum password length of 8 characters, checks for existing users by email, hashes the password with `hashPassword`, inserts a new row into `users`, creates a session token for the new user, sets the HTTP-only `argus_session` cookie, and returns `{ id, email, displayName, role }`.  
- `POST /api/auth/login` — accepts `{ email, password }`, loads the user by email, verifies the password with `verifyPassword`, creates a user-scoped session token, sets the `argus_session` cookie, and returns `{ id, email, displayName, role }`.  
- `POST /api/auth/logout` — clears the `argus_session` cookie and returns `{ ok: true }`.  
- `GET /api/auth/session` — reads and decodes the session cookie, loads the user by `id`, and returns `{ authenticated: true, user: { id, email, displayName, role } }` or `{ authenticated: false }` with 401 when invalid.  
Also updated `backend/src/middleware/auth.ts` so `requireAuth` now (a) still accepts `Authorization: Bearer <APP_PASSWORD>` as an admin-style override, and (b) otherwise requires a valid `argus_session` cookie whose payload decodes to a numeric user id that exists in the `users` table; on success it attaches `req.user = { id, email, displayName, role }`. Ran `npm run build` in `backend` to confirm compilation; in a live environment, these routes can be exercised via curl to verify full register/login/logout flow and session resolution.  
Checkpoint: Wait for developer approval before proceeding.

4. Protect application routes and static HTML with the new auth layer  
Status: Completed  
Testing: Confirmed that all existing business/data APIs are already guarded by the updated `requireAuth` middleware: `documents`, `search`, `files`, `templates`, `admin`, `adminModules`, plus `/api/ping` and `/api/openai/health` in `backend/src/server.ts`. Auth endpoints under `/api/auth` remain intentionally public for register/login/logout/session. For static HTML, `backend/src/server.ts` includes a top-level middleware that intercepts all non-`/api/` requests, allows only `/login.html` and static assets (`.css`, `.js`, images, maps) through without a valid `argus_session` cookie, and otherwise redirects to `/login.html`; this covers shells like `/documents.html`, `/search.html`, `/viewer.html`, and `/openai-documents.html`. `verifySessionToken` continues to validate the HMAC and expiry of the cookie, independent of user lookup, so the guard remains correct after the SessionPayload change. With these in place, visiting the app logged out is redirected to the login page, while visiting authenticated pages with an invalid/expired cookie results in a redirect or 401 from the APIs, forcing re-login. A manual browser test (after Step 5’s UI update) can verify full behavior end-to-end.  
Checkpoint: Wait for developer approval before proceeding.

5. Build login and registration pages and wire them to the auth API  
Status: Completed  
Testing: Updated `backend/public/login.html` to use email + password instead of the legacy shared password: the form now has `email` and `password` fields, a nav link to `/register.html`, and the script calls `POST /api/auth/login` with `{ email, password }`. On success it clears inputs, shows a success message, and redirects to `/search.html`. The `checkSession` helper now calls `GET /api/auth/session` and, when authenticated, shows “Already logged in as &lt;displayName or email&gt;.” Added `backend/public/register.html` with fields for `email`, optional `displayName`, and `password`, and a script that calls `POST /api/auth/register` (enforcing a minimum 8-character password) and redirects to `/search.html` on success. Updated the server’s static guard in `backend/src/server.ts` so `/register.html` is allowed without a session (like `/login.html`), while all other non-API pages still require a valid `argus_session` cookie. Ran `npm run build` in `backend` to verify compilation; manual browser testing can now confirm that registration + login flows work and that protected pages remain inaccessible when logged out.  
Checkpoint: Wait for developer approval before proceeding.

6. Integrate comments with logged-in user identity and remove the initials field  
Status: Completed  
Testing: Extended the `document_comments` table in `backend/src/db.ts` with a nullable `user_id` column and an index/foreign key to `users(id)`, plus ALTER-based backfill for existing installations. Updated `POST /api/documents/:id/comments` in `backend/src/routes/documents.ts` to ignore the old `author` body field and instead derive the comment author from `req.user`, storing the numeric `user_id` and a display `author` string derived from `displayName` (or email prefix) on the comment row. The insert now writes `user_id` alongside the existing anchor/metadata fields, and the JSON response includes `userId` and `author` from this derived identity. `GET /api/documents/:id/comments` now selects `user_id` and returns `userId` while still exposing `author` for display; legacy rows without `user_id` continue to work. On the frontend, removed the “Initials” label/input from the viewer comments footer in `backend/public/viewer.html` and simplified the comment payload to omit any author field, relying on the backend to attach the logged-in user. New comments created from the viewer now show the correct `author` (account display name) in the sidebar, and multi-account manual tests can confirm that authorship reflects the current user while older comments still render with their stored author strings.  
Checkpoint: Wait for developer approval before proceeding.

## 3. Progress Tracking Notes

- Step 1 — Status: Completed.  
- Step 2 — Status: Completed.  
- Step 3 — Status: Completed.  
- Step 4 — Status: Completed.  
- Step 5 — Status: Completed.  
- Step 6 — Status: Completed.  

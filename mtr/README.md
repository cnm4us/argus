# Manual Test Runs (`mtr/`)

This folder holds simple, repeatable manual test runs for the Argus pipeline and storage. Each test is captured in a `test_nn.txt` file so both human and AI can review the same snapshot.

## Naming convention

- Files are named `test_nn.txt` where `nn` is a zero‑padded counter:
  - `test_01.txt`, `test_02.txt`, `test_03.txt`, etc.
- For a new test:
  - Look at existing files in `mtr/`.
  - Choose the next number and create `test_nn.txt`.

## Typical prep for a fresh test

These steps are optional but useful when you want a clean run:

1. **Delete old test file(s)** from `mtr/` if you want to avoid confusion.
2. **Truncate DB tables** (from MySQL/MariaDB client) if you want a clean DB:
   - `TRUNCATE TABLE documents;`
   - `TRUNCATE TABLE document_vitals;`
   - `TRUNCATE TABLE document_smoking;`
   - `TRUNCATE TABLE document_referrals;`
   - `TRUNCATE TABLE document_mental_health;`
3. **Clear OpenAI vector store files** (optional):
   - Use `scripts/openai list documents` to list IDs.
   - Use `scripts/openai hard-delete <vectorStoreFileId>` on any you want to remove.

## Simple test procedure

1. **Upload one or more PDFs** via the app or `scripts/openai upload` (or both).

2. **S3 objects**
   - Run:
     - `scripts/s3 list objects`

3. **OpenAI vector store documents**
   - Run:
     - `scripts/openai list documents`

4. **Local DB snapshots**
   - From a MySQL/MariaDB client (adjust host/user/db as needed):
     - `SELECT * FROM documents;`
     - `SELECT * FROM document_vitals;`
     - `SELECT * FROM document_smoking;`
     - `SELECT * FROM document_referrals;`
     - `SELECT * FROM document_mental_health;`

   Capture results in a way you can paste into a text file (e.g., terminal copy‑paste).

5. **Write the test file**
   - Create a new file `mtr/test_nn.txt` with:
     - A short header (e.g., `TEST 03` and what you did: which PDFs, sync/async, etc.).
     - The raw outputs of:
       - `scripts/s3 list objects`
       - `scripts/openai list documents`
       - The `SELECT *` results for:
         - `documents`
         - `document_vitals`
         - `document_smoking`
         - `document_referrals`
         - `document_mental_health`

   Example structure:

   ```text
   TEST 03
   - short description of this run

   S3 OBJECTS
   <paste scripts/s3 list objects output>

   OPENAI DOCUMENTS
   <paste scripts/openai list documents output>

   TABLE: documents
   <paste SELECT * FROM documents;>

   TABLE: document_vitals
   <paste SELECT * FROM document_vitals;>

   ...
   ```

## How this will be used

- When you ask the AI to “review `mtr/test_nn.txt`”, it will:
  - Read the file.
  - Confirm that the pipeline behaved as expected.
  - Point out mismatches (e.g., missing modules, projection issues, or S3/OpenAI/DB inconsistencies).


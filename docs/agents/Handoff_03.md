# Handoff_03 – Argus Document Intelligence

## Thread context

- Third agent thread for the Argus project.
- Started by reading `docs/agents/README.md` and `Handoff_02.md` as instructed.
- This thread implemented the first full multi-pass (classification → module selection → per-module extraction) pipeline and DB projections to support legal/clinical search.

## High-level system state (snapshot)

- Backend: Node.js + TypeScript + Express app in `backend/`.
- Auth: password-based login (`APP_PASSWORD`) with `argus_session` cookie, protecting UI pages and APIs.
- Storage:
  - OpenAI vector store for document chunks (ID from `ARGUS_VECTOR_STORE_ID`).
  - MariaDB `argus` schema with `documents` table for metadata snapshots.
  - S3 bucket (e.g. `bacs-argus-docs`) for PDF storage keyed by OpenAI file ID.

### Metadata / prompts

- Universal metadata:
  - Still uses `backend/openai/templates/universal.md` + `doctypes/*.md` to produce a single `DocumentMetadata` JSON object with narrative fields, diagnoses, flat vitals, meds, procedures, communication, etc.
- New high-level classification (Pass 1):
  - Prompt in `backend/openai/templates/high_level_classify.md` (based on `reference/classifications.txt`).
  - Returns `{ "type": "clinical_encounter" | "communication" | "result" | "referral" | "administrative" | "external_record", "confidence": number }`.
  - Stored in `documents.metadata_json.high_level_classification`.
- Module selection (Pass 2):
  - Prompt in `backend/openai/templates/module_selection.md` (based on `reference/module_selection.txt`).
  - Returns `{ "modules": ["provider","patient","reason_for_encounter","vitals","smoking","sexual_health","mental_health","referral","results","communication"] }`.
  - Stored in `documents.metadata_json.modules_selected`.
- Per-module extraction (Pass 3+):
  - Module prompts live in `reference/modules/*.txt`:
    - `provider`, `patient`, `reason_for_encounter`
    - `vitals`, `smoking`, `sexual_health`, `mental_health`
    - `referral`, `results`, `communication`
  - Outputs are stored under `documents.metadata_json.modules.<module_name>`, each with its own `module` + `confidence` + structured payload.

### DB projections (search-oriented tables)

- `documents`:
  - “Header row” per PDF: `vector_store_file_id`, `openai_file_id`, `s3_key`, `filename`, `document_type`, `date`, `provider_name`, `clinic_or_facility`, `is_active`, `needs_metadata`, and full `metadata_json`.
  - `metadata_json` now includes:
    - `high_level_classification`
    - `modules_selected`
    - `modules` (per-module outputs).
- Projection tables in MariaDB (`initDb()` in `backend/src/db.ts`):
  - `document_vitals`
    - One row per document.
    - Driven primarily by `modules.vitals.vitals` (structured BP, HR, RR, Temp, SpO2, BMI, `oxygen_device`, etc.), with universal `vitals` as fallback.
  - `document_smoking`
    - One row per document.
    - Prefers `modules.smoking.smoking` (patient/provider history, cessation counseling), falls back to universal keywords if module is missing.
  - `document_mental_health`
    - One row per document.
    - Prefers `modules.mental_health.mental_health` (affect, behavior, symptoms, diagnoses), falls back to universal metadata.
  - `document_referrals`
    - **Multi-row** per document (critical for standard-of-care questions).
    - Structured row from `modules.referral.referral.referral_request` + `referral_denial`.
    - Additional rows derived from universal `metadata.referrals[]`, each mapped to a normalized specialty (`dermatology`, `endocrinology`, `gastroenterology`, etc.) when the string matches a known specialty name.
    - COPD/emphysema flags (`reason_mentions_copd`, `reason_mentions_emphysema_or_obstructive_lung`) computed from `referral_reason_text` plus `conditions_discussed`.
  - `document_results`
    - One row per document.
    - Driven by `modules.results.results`:
      - `result_type` (`lab`/`imaging`), lab/imaging category + subtype, `lab_abnormal_flags` (join of flags), `lab_summary_text`, `impression_text`, `findings_text`, `reason_for_test`.
  - `document_appointments`
    - Schema present for future use:
      - `appointment_date`, `status` (`scheduled`, `completed`, `no_show`, `canceled`, `rescheduled`, `unknown`), `source`, `related_specialty`, `reason_text`.
    - Not yet populated; reserved for an appointments / missed-visits module or admin workflow.
  - `document_communications`
    - One row per document.
    - Prefers `modules.communication.communication`, falls back to universal `communication`.
    - Columns:
      - `initiated_by` (enum: `patient`, `provider`, `clinic`, `pharmacy`, `insurance`, `attorney`, `other`, `unknown`, `not_documented`).
      - `message_direction` (enum: `inbound`, `outbound`, `bidirectional`, `unknown`, `not_documented`).
      - `reason_text`, `advice_given_text`, `patient_response_text`.

## Key endpoints / flows

- Auth and health: `/api/auth/login`, `/api/auth/logout`, `/api/auth/session`, `/health`.
- Documents:
  - Upload: `POST /api/documents?async=1` (preferred) and sync `POST /api/documents`.
  - Listing/details:
    - `GET /api/documents` – list vector-store files via OpenAI.
    - `GET /api/documents/db` – list documents from local DB snapshot (includes `metadata_json`).
    - `GET /api/documents/:id` – get a single vector-store file’s metadata.
  - Metadata:
    - `GET /api/documents/:id/metadata` – on-demand extraction via OpenAI (universal + modules), persists `metadata_json` + projections.
    - `GET /api/documents/:id/metadata/db` – DB-only read, no OpenAI call.
  - Classification / type update:
    - `POST /api/documents/:id/type` – change `document_type` (manual override), mark `needs_metadata = 1`.
  - Logs:
    - `GET /api/documents/:id/logs` – returns JSON log events for that file (when `DEBUG_REQUESTS=1`).
  - Deletion:
    - `POST /api/documents/:id/soft-delete` – mark inactive.
    - `DELETE /api/documents/:id` – remove from vector store and best-effort cleanup of file/S3/DB.
- Search:
  - `POST /api/search` – semantic search via OpenAI `file_search` with attribute filters.
  - `GET /api/search/db` – DB-backed structured search (document_type, provider, clinic/facility, date range).
  - `GET /api/search/options` – distinct provider/clinic names for populating search filters.
- File delivery:
  - `GET /api/files/:fileId` – stream PDFs from S3.

### OpenAI / metadata flows

- Upload (`POST /api/documents`):
  - Always:
    - Upload file to OpenAI Files.
    - Upload PDF to S3.
    - Attach file to vector store with basic attributes (document_type, file_name, file_id, s3_key, etc.).
  - Sync mode (`async=0`):
    - In-request:
      - `extractMetadata` (universal + doctype).
      - `classifyHighLevelDocument` → `high_level_classification`.
      - `selectModulesForFile` → `modules_selected`.
      - `runSelectedModulesForFile` → `modules`.
      - Update vector-store attributes and persist `metadata_json` + projections.
  - Async mode (`async=1`, preferred):
    - Immediately inserts a `documents` row with minimal info and `needs_metadata = 1`.
    - Background worker (wrapped in concurrency limiter) later runs:
      - If `document_type` provided:
        - `extractMetadata` → high-level classify → module selection → modules → projections.
      - If `document_type = unclassified` and `AUTO_METADATA_AFTER_CLASSIFY=1`:
        - `classifyDocument` (detailed type) → `extractMetadata` with predicted type → high-level classify → module selection → modules → projections.
    - Vector-store attributes are updated with date, provider, clinic, and `has_metadata`.

### Concurrency and rate limiting

- Config:
  - `METADATA_RETRY_MAX_ATTEMPTS`, `METADATA_RETRY_BASE_DELAY_SECONDS` – retries for universal `extractMetadata` on 429.
  - `CLASSIFY_CONFIDENCE_THRESHOLD` – threshold for trusting auto-classification.
  - `AUTO_METADATA_AFTER_CLASSIFY` – toggles automatic metadata extraction after classification.
  - `METADATA_MAX_CONCURRENCY` – **new**; limits concurrent metadata jobs (default ~2).
- Concurrency limiter:
  - Implemented in `routes/documents.ts` as `runWithMetadataConcurrency`.
  - Applies to:
    - Async background classification/metadata for uploads.
    - On-demand `GET /api/documents/:id/metadata`.
  - Uses a simple in-process queue and `activeMetadataJobs` counter.
- Rate-limit visibility:
  - On any OpenAI 429, we:
    - Log structured JSON to `backend/logs/openai.log` (event `*:error` with `status: 429`).
    - Print a short message to stderr indicating which call hit the limit and for which file (e.g., `extractMetadata`, `classifyDocument`, `moduleSelection`, `moduleExtract`).

### CLI utilities and manual testing

- `scripts/openai`:
  - `scripts/openai upload <document_type> <path-from-repo-root>`
  - `scripts/openai list documents`
  - `scripts/openai get details <vectorStoreFileId>`
  - `scripts/openai soft-delete <vectorStoreFileId>`
  - `scripts/openai hard-delete <vectorStoreFileId>`
- `scripts/s3`:
  - `scripts/s3 list objects [prefix]` – uses AWS CLI to list S3 objects; reads bucket/prefix from `backend/.env`.
- Manual test runs in `mtr/`:
  - `mtr/README.md` describes how to:
    - Clear DB/vector store if desired.
    - Upload docs.
    - Capture:
      - `scripts/s3 list objects`
      - `scripts/openai list documents`
      - `SELECT *` from:
        - `documents`
        - `document_vitals`
        - `document_smoking`
        - `document_referrals`
        - `document_results`
        - `document_mental_health`
        - `document_communications`
    - Save each run as `mtr/test_nn.txt` for AI/human review.

## Known issues / open questions

- Vector-store attributes remain best-effort and can be temporarily out of sync with DB when ingestion is not ready or when updates fail.
- Classification is still single-label for `document_type`, driven by `classify.md`, with thresholds for auto-assignment vs manual review.
- Universal metadata still extracts some structured fields (vitals, results, communication, etc.) that are now also covered by modules:
  - Projections treat modules as canonical when present and fall back to universal metadata otherwise.
  - In the future, universal prompts could be slimmed down to focus on narrative/summary while modules own structure.
- `document_appointments` is defined but not yet populated; we still need an appointments/missed-visit module or a separate workflow to ingest scheduling/no-show information.
- Token / rate-limit behavior will need to be monitored as more documents are ingested; concurrency + backoff are in place but may need tuning.

## Next-step suggestions (living list)

- Coordinate with the human developer on immediate priorities before implementing changes.
- Maintain small, testable increments that keep the app working at each step.
- Follow the commit message template from `docs/agents/README.md` when preparing commits.
- For future threads, consider:
  - **Classification tuning**
    - Refine prompts and thresholds based on real mis-classification examples, especially around `medication_refill` vs `communication` vs `clinical_encounter`.
  - **Metadata robustness**
    - Use `openai.log`, `needs_metadata`, and the projection tables to identify systemic extraction failures or edge cases (e.g., unusual referral formats, multi-result documents).
  - **Referrals / standard of care**
    - Build UI and queries on top of `document_referrals` to:
      - Show all referrals (by specialty and date) for the patient.
      - Correlate referrals with appointments and results (once appointments module is live).
  - **Results / communication**
    - Surface `document_results` and `document_communications` in the UI:
      - “Which results existed?” vs “Which results were communicated?”
      - Focus on pap smear, imaging, and key labs relevant to the malpractice case.
  - **Appointments / missed visits**
    - Design an `appointments` module and/or admin capture flow for:
      - Scheduled, completed, no-show, canceled, rescheduled visits.
    - Populate `document_appointments` to support missed-appointment timelines.
  - **Search UI**
    - Add faceted filters over the `document_*` tables:
      - Vitals (e.g., SpO2 < 90).
      - Smoking counseling.
      - Mental health flags.
      - Referrals by specialty.
      - Results presence/abnormality.
      - Communication initiation/direction.
  - **Prompt evolution**
    - Continue tuning module prompts (especially `results`, `referral`, `communication`, and future `appointments`) as real-world documents surface more edge cases.


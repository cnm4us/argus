# Handoff_04 – Argus Document Intelligence

## Thread context

- Fourth agent thread for the Argus project.
- Started by reading `docs/agents/README.md` and `Handoff_03.md` as instructed.
- Awaiting current human priorities for this thread (features, fixes, or experiments).

## High-level system state (snapshot)

- Backend: Node.js + TypeScript + Express app in `backend/`.
- Auth: password-based login (`APP_PASSWORD`) with `argus_session` cookie.
- Storage:
  - OpenAI vector store for document chunks (`ARGUS_VECTOR_STORE_ID`).
  - MariaDB `argus` schema with `documents` + projection tables (`document_vitals`, `document_smoking`, `document_mental_health`, `document_referrals`, `document_results`, `document_appointments`, `document_communications`).
  - S3 bucket for PDFs keyed by OpenAI file ID.
- Metadata pipeline:
  - High-level classification (`high_level_classification`).
  - Module selection (`modules_selected`).
  - Per-module extraction into `modules.*` (vitals, smoking, mental_health, referral, results, communication, etc.).
  - Projections hydrate the `document_*` tables from module outputs, falling back to universal metadata when modules are missing.

## Key endpoints / flows

- Auth: `/api/auth/login`, `/api/auth/logout`, `/api/auth/session`.
- Documents:
  - Upload and ingest PDFs (OpenAI file + vector store + S3 + DB row).
  - Classification + module-based metadata extraction feeding `documents.metadata_json` and projection tables.
- CLI helpers:
  - `scripts/openai` – upload/list/get/delete documents in the vector store.
  - `scripts/s3` – inspect S3 objects corresponding to uploaded PDFs.

## Known issues / open questions

- `document_appointments` exists but is not populated; appointments/missed-visit module is still future work.
- Prompt and threshold tuning for classification and modules is ongoing and should be refined using real misclassification / extraction failures.
- Token and rate-limit behavior will need monitoring as ingestion volume grows; concurrency and backoff are in place but may need tuning.

## Next-step suggestions

- Confirm with the human developer what this thread should prioritize (e.g., UI over projections, new modules, classification tuning, or ingestion robustness).
- Continue making small, testable changes that keep the app deployable at each step.
- Update this `Handoff_04.md` throughout the thread with:
  - What was implemented.
  - Any architectural or schema changes.
  - New known issues or edge cases discovered.
  - Concrete, small next actions for the next threadself.


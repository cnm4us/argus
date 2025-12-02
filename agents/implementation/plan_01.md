# Implementation Plan: Normalize Mental Health Taxonomy

## 1. Overview
Goal: Normalize the Mental Health taxonomy so that medication-related concepts are merged under a single “Medication for mental health” keyword, and behavior/presentation concepts are merged under a single “Mental health presentation” keyword, while preserving existing data and keeping search + details views accurate.

In scope:
- Mental Health taxonomy keyword definitions (DB seeding and in-DB rows).
- Migration of existing `document_terms` and `document_term_evidence` entries for Mental Health to the new canonical keyword IDs.
- Updates to projection-backed taxonomy logic for Mental Health so behaviors map to the new “presentation” keyword.
- Optional adjustments to the LLM taxonomy extraction prompt behavior for Mental Health to favor the new canonical keywords.

Out of scope:
- Changes to other taxonomy categories (vitals, smoking, respiratory, etc.).
- Major redesign of the taxonomy UI or search page beyond what’s needed to show the new Mental Health keywords.
- Changes to the underlying mental health module schema, aside from small prompt nudges if needed.

## 2. Step-by-Step Plan

1. Inspect current Mental Health taxonomy and data usage  
Status: Completed  
Testing: Manually inspect `taxonomy_categories`, `taxonomy_keywords` for `mental_health.*`, and a small sample of `document_terms` / `document_term_evidence` rows in the DB to confirm which keyword IDs are currently in use for meds vs. behaviors. Verify how these appear in `/search.html` and `taxonomy-details.html` when filtering by Mental Health.  
Checkpoint: Wait for developer approval before proceeding.

2. Define canonical Mental Health keywords (schema/seeding layer)  
Status: Completed  
Testing: Update the seeding logic in `backend/src/db.ts` so it defines (at minimum) `mental_health.any_mention`, a canonical `mental_health.medication_for_mental_health`, and a canonical `mental_health.presentation`, with appropriate labels and synonyms. Run migrations/seed logic in a safe environment (or via a targeted SQL script) to ensure the new keyword rows exist without breaking existing constraints.  
Checkpoint: Wait for developer approval before proceeding.

3. Mark legacy granular keywords as deprecated and hide them from search options  
Status: Completed  
Testing: For the legacy “meds” keywords (`mental_health.antidepressant_medication`, `mental_health.antidepressant_medication_use`, older `mental_health.medication_for_mental_health` variants) and granular behavior keywords (`mental_health.emotionally_labile`, `mental_health.pressured_speech`, `mental_health.combative_or_hostile`, `mental_health.emotionally_distressed`, `mental_health.non_compliant`), mark them as deprecated (e.g., via a `status` field) or add a flag so they are excluded from `/api/search/options`. Confirm via `/api/search/options` that Mental Health shows only the desired canonical keywords (“Any mental health mention”, “Medication for mental health”, “Mental health presentation”, plus “Mental health status inquiry” if kept).  
Checkpoint: Wait for developer approval before proceeding.

4. Migrate existing meds-related document terms to the canonical medication keyword  
Status: Completed  
Testing: Write and run a one-time SQL migration that updates `document_terms.keyword_id` and `document_term_evidence.keyword_id` from the legacy med-related IDs (`mental_health.antidepressant_medication`, `mental_health.antidepressant_medication_use`, any legacy `mental_health.medication_for_mental_health` variants) to the canonical `mental_health.medication_for_mental_health`. After migration, run a deduplication pass if necessary to ensure each (document, keyword) pair appears only once in `document_terms`, and spot-check a few documents in `taxonomy-details.html` to confirm meds entries now display under the unified label.  
Checkpoint: Wait for developer approval before proceeding.

5. Migrate existing behavior-related document terms to the canonical presentation keyword  
Status: Completed  
Testing: Write and run a one-time SQL migration that updates `document_terms.keyword_id` and `document_term_evidence.keyword_id` from behavior-related IDs (`mental_health.emotionally_labile`, `mental_health.pressured_speech`, `mental_health.combative_or_hostile`, `mental_health.emotionally_distressed`, `mental_health.non_compliant`) to the canonical `mental_health.presentation`. As with meds, deduplicate any resulting duplicates, and spot-check a few documents in `taxonomy-details.html` to confirm behavioral snippets now appear under “Mental health presentation”.  
Checkpoint: Wait for developer approval before proceeding.

6. Align projection-backed Mental Health rules with the new presentation keyword  
Status: Completed  
Testing: Update the Mental Health section of `updateTaxonomyFromProjections` in `backend/src/metadataProjections.ts` so it no longer emits multiple granular behavior keywords, but instead emits only `mental_health.presentation` whenever any of the relevant flags (e.g., `affect_labile`, `pressured_speech`, `behavior_emotionally_distressed`, `behavior_non_compliant`, `behavior_guarded_or_hostile`) are true. Ensure it still emits `mental_health.any_mention`, `mental_health.anxiety`, `mental_health.depression`, and `mental_health.substance_use_disorder` as before. Run the unit or integration tests (if present), then use Admin → Taxonomy → Mental Health → Rebuild (projection-backed) to recompute terms for a test subset or full corpus, and verify that behavior-related cases show as “Mental health presentation” with clear rule evidence.  
Checkpoint: Wait for developer approval before proceeding.

7. Adjust LLM taxonomy extraction behavior for Mental Health to prefer canonical keywords  
Status: Completed  
Testing: In `runTaxonomyExtractionForDocument` (`backend/src/routes/documents.ts`), add Mental Health–specific guidance to the prompt so the LLM (a) maps medication mentions to `mental_health.medication_for_mental_health`, (b) maps behavioral/affect descriptions (emotionally labile, pressured speech, combative/hostile, etc.) to `mental_health.presentation`, and (c) avoids inventing new `mental_health.*` keywords for drugs or behaviors that clearly fit one of these canonical buckets. Test by manually re-running LLM taxonomy for a small sample of documents via Admin → Document Taxonomy for category = Mental Health, inspect the returned keywords/evidence, and confirm they are using the canonical IDs.  
Checkpoint: Wait for developer approval before proceeding.

8. Clean up deprecated keywords and finalize UI behavior  
Status: Completed  
Testing: Once migrations and projection/LLM changes are verified, optionally remove deprecated Mental Health keyword rows from `taxonomy_keywords` (or leave them with `status='deprecated'` if you prefer preserving history). Confirm that `/api/search/options` and the Search UI only surface the canonical Mental Health keywords, and that `taxonomy-details.html` correctly displays “Medication for mental health” and “Mental health presentation” (plus any other intentionally retained keywords) with appropriate snippets or rule evidence.  
Checkpoint: Wait for developer approval before proceeding.

## 3. Progress Tracking Notes

- All steps in this plan are now `Status: Completed` and have been implemented and validated in the current codebase and database state.

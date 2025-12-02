-- Migration: Normalize Mental Health taxonomy keywords
-- Goal:
--   - Merge medication-related Mental Health keywords into
--       mental_health.medication_for_mental_health
--   - Merge behavior/presentation-related Mental Health keywords into
--       mental_health.presentation
--
-- This script is idempotent and assumes:
--   - taxonomy_keywords already contains canonical rows for
--       mental_health.medication_for_mental_health
--       mental_health.presentation
--   - document_terms has a UNIQUE KEY on (document_id, keyword_id, subkeyword_id)
--
-- Run in a transaction if your environment supports it.

-- 1) Canonical medication keyword: mental_health.medication_for_mental_health
--    Legacy medication-related keyword ids to merge:
--      - mental_health.antidepressant_medication
--      - mental_health.antidepressant_medication_use

-- 1a) Ensure there is a canonical document_terms row for each document
--     that currently has any of the legacy medication keywords.
INSERT IGNORE INTO document_terms (document_id, keyword_id, subkeyword_id)
SELECT DISTINCT dt.document_id,
       'mental_health.medication_for_mental_health' AS keyword_id,
       NULL AS subkeyword_id
FROM document_terms dt
WHERE dt.keyword_id IN (
  'mental_health.antidepressant_medication',
  'mental_health.antidepressant_medication_use'
);

-- 1b) Point all medication-related evidence at the canonical keyword id.
UPDATE document_term_evidence e
SET e.keyword_id = 'mental_health.medication_for_mental_health'
WHERE e.keyword_id IN (
  'mental_health.antidepressant_medication',
  'mental_health.antidepressant_medication_use'
);

-- 1c) Remove legacy medication keyword rows from document_terms.
DELETE FROM document_terms
WHERE keyword_id IN (
  'mental_health.antidepressant_medication',
  'mental_health.antidepressant_medication_use'
);

-- 2) Canonical presentation keyword: mental_health.presentation
--    Legacy behavior/presentation keyword ids to merge:
--      - mental_health.emotionally_labile
--      - mental_health.pressured_speech
--      - mental_health.combative_or_hostile
--      - mental_health.emotionally_distressed
--      - mental_health.non_compliant

-- 2a) Ensure there is a canonical document_terms row for each document
--     that currently has any of the legacy presentation keywords.
INSERT IGNORE INTO document_terms (document_id, keyword_id, subkeyword_id)
SELECT DISTINCT dt.document_id,
       'mental_health.presentation' AS keyword_id,
       NULL AS subkeyword_id
FROM document_terms dt
WHERE dt.keyword_id IN (
  'mental_health.emotionally_labile',
  'mental_health.pressured_speech',
  'mental_health.combative_or_hostile',
  'mental_health.emotionally_distressed',
  'mental_health.non_compliant'
);

-- 2b) Point all presentation-related evidence at the canonical keyword id.
UPDATE document_term_evidence e
SET e.keyword_id = 'mental_health.presentation'
WHERE e.keyword_id IN (
  'mental_health.emotionally_labile',
  'mental_health.pressured_speech',
  'mental_health.combative_or_hostile',
  'mental_health.emotionally_distressed',
  'mental_health.non_compliant'
);

-- 2c) Remove legacy presentation keyword rows from document_terms.
DELETE FROM document_terms
WHERE keyword_id IN (
  'mental_health.emotionally_labile',
  'mental_health.pressured_speech',
  'mental_health.combative_or_hostile',
  'mental_health.emotionally_distressed',
  'mental_health.non_compliant'
);


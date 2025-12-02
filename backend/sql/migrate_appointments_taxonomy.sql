-- Migration: Normalize Appointments taxonomy keywords into keyword + subkeyword
-- Goal:
--   - Treat over-specified Appointments keyword ids like
--       appointments.diagnostic_imaging_appointment.chest_x_ray_imaging
--     as subkeywords under their parent keyword
--       appointments.diagnostic_imaging_appointment
--   - Preserve existing document_terms and evidence while cleaning up the
--     Keyword facet so the Keyword dropdown stays focused and specific
--     variations move into the Subkeyword dropdown.
--
-- This script is idempotent and assumes:
--   - taxonomy_keywords already contains canonical parent Appointment keywords
--     such as appointments.diagnostic_imaging_appointment,
--     appointments.follow_up_appointment, appointments.referral_appointment, etc.
--   - document_terms has a UNIQUE KEY on (document_id, keyword_id, subkeyword_id).
--
-- Pattern:
--   - We treat any Appointments keyword id with at least two dots as:
--       id = 'appointments.<parent>.<child>'
--     and derive:
--       parent keyword id = SUBSTRING_INDEX(id, '.', 2)
--
-- Steps:
--   1) Create taxonomy_subkeywords rows for these over-specified Appointments
--      keywords, using their current id as the subkeyword id and the derived
--      parent id as keyword_id.
--   2) Update document_terms to point keyword_id to the parent and subkeyword_id
--      to the migrated subkeyword id.
--   3) Update document_term_evidence similarly so snippet evidence is attached
--      to both the parent keyword and the new subkeyword id.
--   4) Delete the over-specified keyword rows from taxonomy_keywords now that
--      references have been migrated.

-- 1) Create subkeywords for over-specified Appointments keyword ids.
INSERT IGNORE INTO taxonomy_subkeywords (id, keyword_id, label, synonyms_json, description, status)
SELECT
  k.id AS id,
  SUBSTRING_INDEX(k.id, '.', 2) AS keyword_id,
  k.label,
  k.synonyms_json,
  k.description,
  k.status
FROM taxonomy_keywords k
JOIN taxonomy_keywords parent
  ON parent.id = SUBSTRING_INDEX(k.id, '.', 2)
WHERE k.category_id = 'appointments'
  -- Require at least two dots in the id, e.g. appointments.parent.child
  AND LOCATE('.', k.id, LOCATE('.', k.id) + 1) > 0;

-- 2) Update document_terms so these ids become subkeywords under their parent.
UPDATE document_terms dt
JOIN taxonomy_keywords k
  ON dt.keyword_id = k.id
JOIN taxonomy_keywords parent
  ON parent.id = SUBSTRING_INDEX(k.id, '.', 2)
SET
  dt.subkeyword_id = k.id,
  dt.keyword_id = parent.id
WHERE k.category_id = 'appointments'
  AND LOCATE('.', k.id, LOCATE('.', k.id) + 1) > 0
  AND dt.subkeyword_id IS NULL;

-- 3) Update document_term_evidence in the same way so evidence follows.
UPDATE document_term_evidence e
JOIN taxonomy_keywords k
  ON e.keyword_id = k.id
JOIN taxonomy_keywords parent
  ON parent.id = SUBSTRING_INDEX(k.id, '.', 2)
SET
  e.subkeyword_id = k.id,
  e.keyword_id = parent.id
WHERE k.category_id = 'appointments'
  AND LOCATE('.', k.id, LOCATE('.', k.id) + 1) > 0
  AND e.subkeyword_id IS NULL;

-- 4) Remove the over-specified Appointments keyword rows now that they have
--    been migrated into taxonomy_subkeywords.
DELETE k
FROM taxonomy_keywords k
JOIN taxonomy_keywords parent
  ON parent.id = SUBSTRING_INDEX(k.id, '.', 2)
WHERE k.category_id = 'appointments'
  AND LOCATE('.', k.id, LOCATE('.', k.id) + 1) > 0;


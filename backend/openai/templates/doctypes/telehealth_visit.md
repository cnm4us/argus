# Document Type: telehealth_visit

This document is a **telehealth visit** (e.g., video or phone encounter).

Guidance:

- Pay special attention to:
  - Encounter mode (telehealth).
  - Reason for visit / chief complaint.
  - Symptom description over time.
  - Assessment and plan, especially safety netting instructions (when to go to ER, when to call back).
  - Any communication metadata (who initiated, how the visit was scheduled, any follow-up messages).
- If the document contains vitals, note whether they are patient-reported or from prior in-person visits.
- Telehealth visits may reference prior in-person encounters; keep the summary focused on this specific encounter.

Constraints:

- `document_type` MUST be `"telehealth_visit"` in the JSON.
- If the document clearly states this is a telephone-only encounter (not video), you may reflect that in `encounter_mode` as `"telehealth_phone"`; otherwise `"telehealth"` is sufficient.


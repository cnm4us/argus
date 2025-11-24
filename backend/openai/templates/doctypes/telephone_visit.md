# Document Type: telephone_visit

This document is a **telephone visit** (audio-only encounter, no video).

Guidance:

- Treat this as a full clinical visit conducted by telephone.
- Pay special attention to:
  - Encounter mode (telephone / phone).
  - Reason for visit / chief complaint.
  - Symptom description over time.
  - Assessment and plan, especially safety-netting instructions (when to go to ER, when to call back).
  - Any communication details (who initiated, how the call was scheduled, any follow-up messages).
- If the document contains vitals, note whether they are patient-reported or copied from prior in-person visits.
- Telephone visits may reference prior or upcoming in-person or telehealth encounters; keep the summary focused on this specific encounter.

Constraints:

- `document_type` MUST be `"telephone_visit"` in the JSON.
- Reflect the encounter as a phone-based encounter in `encounter_mode`, typically `"phone"` (unless the document clearly uses a different mode that is more appropriate).


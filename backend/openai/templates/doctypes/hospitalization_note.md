# Document Type: hospitalization_note

This document describes an **inpatient hospitalization** (admission, progress, or discharge-style narrative).

Guidance:

- Focus on:
  - Reason for admission and major diagnoses.
  - Hospital course, significant events, and key interventions.
  - Current status at the time of the note.
  - Planned next steps and follow-up.
- Use the diagnoses, procedures, and risk flags sections to capture hospital-level risk and complexity.

Constraints:

- `document_type` MUST be `"hospitalization_note"` in the JSON.
- In `encounter_type`, a value like `"hospitalization"` is appropriate; `encounter_mode` is usually `"in_person"`.


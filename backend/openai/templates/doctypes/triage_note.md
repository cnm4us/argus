# Document Type: triage_note

This document is a **triage note** (often nurse- or staff-authored) assessing urgency and next steps.

Guidance:

- Focus on:
  - Presenting symptoms and initial assessment.
  - Risk factors or red flags considered.
  - Triage decision (home care, clinic appointment, urgent care, emergency department).
  - Specific instructions given to the patient.
- Use risk flags and communication fields to capture safety-netting and urgency.

Constraints:

- `document_type` MUST be `"triage_note"` in the JSON.
- Use `encounter_mode` to reflect how triage occurred (e.g. `"phone"`, `"portal_message"`, `"in_person"`).


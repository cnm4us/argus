# Document Type: lab_result

This document is a **laboratory result** summary or report.

Guidance:

- Focus on:
  - Key lab values and their interpretations (high, low, normal).
  - Any diagnoses or clinical impressions discussed in relation to the labs.
  - Follow-up plans, medication changes, or further testing ordered.
- Use the diagnoses and conditions sections to capture clinically meaningful conclusions, not every numeric detail.

Constraints:

- `document_type` MUST be `"lab_result"` in the JSON.
- Use `encounter_mode` based on the document context (e.g. `"portal_message"`, `"in_person"`, `"telehealth"`), or leave empty if unclear.


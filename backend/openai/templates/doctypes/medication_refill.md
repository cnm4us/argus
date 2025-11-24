# Document Type: medication_refill

This document is primarily about a **medication refill request or approval**.

Guidance:

- Focus on:
  - Which medications are being refilled or adjusted.
  - The clinical context or justification (if present).
  - Any changes to dosing, frequency, or instructions.
  - Safety concerns, monitoring plans, or follow-up related to medications.
- Capture relevant diagnoses or conditions associated with the medications where possible.

Constraints:

- `document_type` MUST be `"medication_refill"` in the JSON.
- Use `encounter_mode` based on the document (e.g. `"portal_message"`, `"phone"`, `"in_person"`, `"telehealth"`), or leave empty if unclear.


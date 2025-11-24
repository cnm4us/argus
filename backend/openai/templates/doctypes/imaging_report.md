# Document Type: imaging_report

This document is an **imaging report** (e.g., X-ray, CT, MRI, ultrasound).

Guidance:

- Focus on:
  - Imaging modality and body part.
  - Key findings and impression.
  - Any incidental findings or recommendations for follow-up imaging.
- Map the narrative into the imaging section of the universal template while also filling diagnoses and risk flags if relevant.

Constraints:

- `document_type` MUST be `"imaging_report"` in the JSON.
- `imaging.modality` and `imaging.body_part` should be populated when possible; use `""` if unclear.


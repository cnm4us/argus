# Document Type: unclassified

This document has not been assigned a specific encounter type yet.

Guidance:

- Treat this as a generic clinical or administrative document.
- Focus on extracting the universal metadata fields (date, provider, clinic, summary, diagnoses, risk flags, etc.).
- Do not attempt to force a specific encounter type; keep `encounter_type` and `encounter_mode` as general as possible based on the text.

Constraints:

- `document_type` SHOULD be `"unclassified"` in the JSON if no clear type can be determined.
- All other fields should still be populated as best as possible from the available content.


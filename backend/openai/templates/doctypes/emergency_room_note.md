# Document Type: emergency_room_note

This document is an **emergency department note**.

Guidance:

- Focus on:
  - Presenting complaint and acuity.
  - Key exam findings, vital signs, and diagnostics (labs, imaging).
  - ED course, treatments given, and response.
  - Disposition (discharge, admit, transfer) and follow-up instructions.
- Pay special attention to risk flags, especially urgent recommendations and safety-netting.

Constraints:

- `document_type` MUST be `"emergency_room_note"` in the JSON.
- In `encounter_type`, a value like `"emergency_department"` is appropriate, and `encounter_mode` is typically `"in_person"`.


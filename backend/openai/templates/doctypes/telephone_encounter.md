# Document Type: telephone_encounter

This document is a **telephone encounter** focused on clinical communication by phone (often brief triage or follow-up).

Guidance:

- Treat this as a focused clinical communication conducted over the telephone.
- Pay attention to:
  - Reason for the call (symptoms, questions, follow-up).
  - Key clinical details gathered during the call.
  - Any assessment, advice, or plan communicated.
  - Safety-net instructions (when to call back, when to seek urgent care).
- Use the universal template fields to capture encounter context, diagnoses, risk flags, and key entities.

Constraints:

- `document_type` MUST be `"telephone_encounter"` in the JSON.
- Reflect the encounter as a phone-based interaction in `encounter_mode`, typically `"phone"` or a clearly appropriate alternative.


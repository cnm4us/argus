# Document Type: office_visit

This document is an **in-person office visit** (clinic or outpatient encounter).

Guidance:

- Treat this as a standard face-to-face clinical encounter.
- Pay special attention to:
  - Encounter mode (in-person / clinic).
  - Chief complaint and history of present illness.
  - Physical exam findings and objective data (vitals, labs, imaging summaries).
  - Assessment and plan, including safety-netting (when to go to ER, when to return).
  - Any follow-up instructions, referrals, or diagnostic workup ordered.
- If imaging or procedures are referenced, summarize them in the appropriate sections.

Constraints:

- `document_type` MUST be `"office_visit"` in the JSON.
- Reflect the encounter as an in-person visit in `encounter_mode`, typically `"in_person"`, unless the document clearly indicates a different mode.


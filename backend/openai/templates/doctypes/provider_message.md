# Document Type: provider_message

This document is a **message authored by a provider or clinic staff** (e.g., portal reply, outreach call note).

Guidance:

- Focus on:
  - Advice, instructions, or decisions communicated to the patient.
  - Any changes to medications, follow-up plans, or referrals mentioned in the message.
  - Safety-net recommendations (when to seek urgent care).
- Use the communication section to capture that the message originates from the provider/clinic and is directed to the patient.

Constraints:

- `document_type` MUST be `"provider_message"` in the JSON.
- In `communication.initiated_by`, prefer `"provider"` or `"clinic"`, and in `communication.message_direction`, prefer `"outbound"`.


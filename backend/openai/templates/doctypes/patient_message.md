# Document Type: patient_message

This document is a **message authored by the patient** (e.g., portal message, email-like text).

Guidance:

- Focus on:
  - Patient’s reported symptoms, concerns, and questions.
  - Timeline and severity when mentioned.
  - Any self-treatment or home monitoring described.
- Use the communication section to capture who initiated the message (the patient) and the direction (`"inbound"` to the clinic).

Constraints:

- `document_type` MUST be `"patient_message"` in the JSON.
- In `communication.initiated_by`, prefer `"patient"`, and in `communication.message_direction`, prefer `"inbound"`.


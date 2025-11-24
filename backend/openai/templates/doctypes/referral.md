# Document Type: referral

This document is a **referral** to another provider or service.

Guidance:

- Focus on:
  - Reason for referral and key clinical questions for the consultant.
  - Relevant diagnoses, history, and prior testing that justify the referral.
  - Any urgency or time frame requested.
- Capture the referring provider and the target specialty or service where possible.

Constraints:

- `document_type` MUST be `"referral"` in the JSON.
- Use `referrals` to represent the target service(s) (e.g. `"dermatology"`, `"cardiology"`).


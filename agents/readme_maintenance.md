# Developer README Maintenance Guide
This document describes how AI agents should update the project's root
developer-facing README.md file. These updates communicate implementation
changes to human developers. The README.md is not for internal agent notes.

---

# 1. When to Update README.md

You must consider updating /README.md only after **confirmed implementation
changes**, specifically:

- A feature has been added, modified, or removed.
- An API route's behavior, parameters, or output changed.
- A new endpoint was introduced.
- Build/start instructions changed.
- Environment variables changed.
- A new module, script, or admin tool was added.
- Database schema or projections changed in a way developers must know.
- Search behavior, filters, or query shapes changed.
- A new CLI helper or workflow was introduced.
- Infrastructure or deployment steps changed.

README.md should reflect the **actual current system**, not planned or
speculative ideas.

You must NOT update README.md for:
- planning, discussion, or ideation
- changes that only affect agent workflows
- unimplemented designs
- refactoring that does not affect developer workflows
- metadata that developers do not need to interact with

---

# 2. Trigger: After a Commit

After completing a commit, and after updating your handoff file, you must:

1. Reread this document (`agents/readme_maintenance.md`).
2. Evaluate whether the implemented change affects any information in /README.md.
3. If an update is required, edit README.md to document:
   - What changed
   - How it now works
   - Any new steps needed by developers
4. Keep updates concise and factual.
5. Do not rewrite unrelated sections.

README.md should be kept accurate, not rewritten wholesale.

---

# 3. How to Write README.md Updates

Updates must be:

- concise
- clear
- in developer-facing tone
- free of speculation
- focused on operational steps

Prefer:
- bullet points
- short paragraphs
- command examples
- updated curl/API examples
- updated environment variable explanations
- updated admin tool behavior

Avoid:
- formality
- verbosity
- internal reasoning
- statements about the agent’s process

---

# 4. Structure Preservation Rules

When modifying README.md:

- Preserve the existing layout unless a structural change is necessary.
- Add new subsections only when the system gains new operational
  functionality.
- Do not delete sections unless the functionality has been retired.
- Follow the same heading hierarchy used in the current README.md.
- Add new examples using the project's conventions (bash, curl, JSON).

---

# 5. Examples of Valid README.md Updates

Valid updates include:

- Adding documentation for a new API route.
- Updating an existing curl example to show new parameters.
- Updating database column descriptions after schema changes.
- Adding instructions for a new admin tool.
- Updating search documentation to include new filters.
- Updating project layout when a new directory is added.

Invalid updates include:

- Adding AI-internal processes or notes.
- Adding experimental endpoints not yet implemented.
- Rewriting large portions for stylistic reasons.
- Adding commentary or high-level planning.

---

# 6. Coordination With Handoff Notes

README.md updates complement, but do not duplicate, handoff notes.

- README.md = documentation for *human developers*
- Handoff files = continuity for *future AI agents*

After updating README.md, you may also:
- record a brief summary in your current handoff file noting the update
  ("README.md updated to reflect new /api/search filters").

Keep the two systems separate, but coordinated.

---

# End of Guide

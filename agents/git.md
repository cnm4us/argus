# Git Commit Instructions

Within this project:
- You may always use read-only Git history commands (`git log`, `git show`,
  `git diff`, `git blame`) to review previous commits for context.
- You may only perform `git commit` (or otherwise modify Git history) when the
  user explicitly requests a commit or Git history change, as described in
  `agents/README.md`.

AI agents do not have access to the interactive CLI editor, so all commits
must be created using `git commit -m` with multiple `-m` blocks to emulate
the multi-section commit template.

The following template defines the required structure. Types, scopes, and
keywords are suggestions; the agent may vary them as appropriate.

-- BEGIN TEMPLATE --
Subject: <type>(<scope>): <short, imperative summary>
# Types: feat | fix | docs | style | refactor | test | chore | perf | build | ci | revert
# Scopes: api | db | cli | ui | video | feed | player | auth | billing | hcpcs | pubmed | config | deps

Description:
<explain the implementation, reasoning, and context>

Keywords: #tag1 #tag2 #tag3
-- END TEMPLATE --

## Rules for Constructing Commit Messages

When creating a commit:

1. Stage only the specific files that were created or modified.
   Never use `git add .` unless the user explicitly requests it.

2. Construct the commit message using:
   - A single `git commit` command  
   - One `-m` block per template section (no unlabeled first-line subject)  
   Example (where `<subject>` starts with `<type>(<scope>):`):
   git commit -m "Subject:\n<subject>" \
               -m "Description:\n<details>" \
               -m "Keywords:\n#tag1 #tag2"

3. The commit message MUST follow the template structure:
   - First block: a `Subject:` header whose content is a single line starting with `<type>(<scope>): <summary>`
   - Then labeled blocks for `Description:` and `Keywords:`
   - Do not add an extra unlabeled subject line before the `Subject:` header
   - Keywords must begin with `#` and be space-separated

4. The agent must NOT attempt to open an editor or rely on prompts from the CLI.

## Trigger: After a Commit

Immediately after performing a commit, follow this post-commit checklist:

1. Handoff notes (and plan status)
   - Reread `agents/handoff_process.md`.
   - Update your current handoff file in `agents/handoff/` with:
     - A brief summary of what was committed
     - Why the change was made
     - Any follow-up tasks required
   - If there is an active implementation plan in `agents/implementation/plan_nn.md`,
     update the relevant step's status to reflect the completed work.

2. Developer documentation
   - Then follow the "Trigger: Update Developer Documentation (README.md)" section
     below to evaluate whether `/README.md` or other developer-facing docs require
     updates.

Only implemented, confirmed changes should be recorded in handoff files,
implementation plans, and developer documentation. Planning, discussion, or
speculative ideas must NOT be added.

## Trigger: Update Developer Documentation (README.md)

After completing a commit, and after updating your handoff notes, you must:

1. Reread `agents/readme_maintenance.md`.
2. Determine whether the latest implementation requires an update to the
   project's root `/README.md` or any developer-facing documentation.
3. If an update is needed, modify the appropriate documentation using
   clear, concise developer-friendly language.
4. Only update developer documentation for implemented changes—never for
   planned or speculative work.

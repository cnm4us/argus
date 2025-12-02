# Handoff Process Guide  
This document describes how AI agents should create, update, and maintain
handoff files (`Handoff_nn.md`) to preserve project coherence across threads.
Handoff files are written for AI agents, not for the human developer.

---

# 1. Purpose of Handoff Notes  
Handoff notes are a private workspace for the agent.  
They should:

- Capture only the information needed for the next threadself.
- Omit user-facing explanations.
- Preserve decisions, outcomes, and reasoning that would otherwise be lost at the end of a thread.
- Provide continuity without overwhelming future agents with excess detail.

---

# 2. When to Update Handoff Files  
You should update your current handoff file only during specific events:

## Update Trigger A: After Creating the File (start of thread)
Record:
- Thread purpose or focus.
- Relevant system state.
- Known issues carried over from previous threads.

## Update Trigger B: After Meaningful Implementation Progress
Add notes only when **real changes have been made to the project**, such as:
- Code added, modified, or refactored.
- Database schema updates.
- Architectural decisions that have been implemented.

## Update Trigger C: After Each Commit  
After executing a git commit, follow the post-commit checklist in `agents/git.md`
(see "Trigger: After a Commit").

When you update the handoff file as part of that checklist, ensure you:
- Append a brief summary of what changed and why.
- Include commit type, scope, and any relevant keywords.

Do **not** update the handoff file during:
- Ideation  
- Planning  
- Architectural brainstorming  
- High-level discussion  
- User clarifications  
- Testing steps before the final confirmed implementation  

---

# 3. Structure of Handoff Notes  
Each handoff file should contain:

## 3.1 Thread Summary  
- What this thread is doing.  
- Why it matters.  
- What was inherited from the previous handoff.

## 3.2 Implementation Notes  
Updates added only after actual changes or commits:
- What was modified.  
- Why it was modified.  
- Any follow-up tasks needed.  

## 3.3 Open Questions / Deferred Tasks  
List items that were raised in this thread but not resolved.

## 3.4 Suggestions for Next Threadself  
Concrete next steps, brief and actionable.

---

# 4. Writing Style  
Handoff notes should be:

- Concise  
- Bullet-oriented  
- Non-narrative  
- Machine-readable  
- Focused on continuity  

Avoid long paragraphs. Prioritize clarity over completeness.

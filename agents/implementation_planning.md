# IMPLEMENTATION PLANNING GUIDE
This document explains how AI agents must create, update, and maintain
implementation plans. Implementation plans define the sequence of steps
required to implement a feature or change safely, in small increments, and
with developer approval at each stage.

This guide applies whenever the agent is in **Implementation Plan Mode**.

---

## PURPOSE OF IMPLEMENTATION PLAN

Implementation plans:
- Break complex work into small, testable steps.
- Ensure each step leaves the system in a runnable state.
- Prevent the agent from coding prematurely.
- Allow the developer to review and approve each stage before execution.
- Provide a durable reference file that can be followed across many user
  requests or even multiple threads.

Plans are stored in:
`agents/implementation/plan_nn.md`

Only one plan is active at a time.

---

## WHEN TO CREATE OR UPDATE A PLAN
**Trigger:**  
- The user requests creation of a new implementation plan, **or**
- A previous implementation plan exists but requires modification due to:
  - developer feedback  
  - architectural changes  
  - discovered dependencies  
  - changes in requirements  

Do **not** create or modify plans during:
- Exploratory discussion
- High-level architectural exploration
- Ideation or brainstorming
- Partial or ambiguous requirements

If uncertain, ask the developer to confirm that you should begin drafting
a plan.

---

## STRUCTURE OF AN IMPLEMENTATION PLAN

Each plan must contain:

### 1. Overview  
- One short paragraph summarizing the goal.
- A clear statement of what is *in scope* and *out of scope*.

---

### 2. Step-by-Step Plan  
A numbered list of steps, where each step:
- Is small and atomic.
- Leaves the system running.
- Includes a testing instruction.
- Ends with a checkpoint: “Wait for developer approval before proceeding.”

### 3. Tracking Progress Through the Plan

Implementation plans must record progress so the agent (and future agents)
know exactly which step is next.

Each step can have one of three statuses:

- `Status: Pending` (default)
- `Status: In Progress`
- `Status: Completed`

Use statuses consistently:
- `Status: Pending` — step is defined but work has not started.
- `Status: In Progress` — step is actively being executed.
  - At any given time, **at most one** step should be marked `Status: In Progress`.
- `Status: Completed` — step has been implemented and its testing instruction has passed.

When updating progress:
- Before starting work on a step, set its status to `Status: In Progress`.
- After completing implementation and tests, change the status to `Status: Completed`.
- Only move on to the next step after the current step is `Status: Completed`.

---

### 4. Example Implementation Plan File

Plans live in `agents/implementation/plan_nn.md`.  
Below is a minimal example structure:

```markdown
# Implementation Plan: Improve Search Filters

## 1. Overview
Goal: Allow users to filter search results by specialty and date without breaking existing queries.

In scope:
- Backend search query changes to support new filters.
- API parameter handling and validation.
- Minimal UI wiring needed to pass new parameters.

Out of scope:
- Major UI redesign of the search page.
- Changes to authentication or permissions.

## 2. Step-by-Step Plan

1. Add backend support for new filters  
   Status: Pending  
   Testing: Run existing search tests and add a focused test for specialty/date filters.  
   Checkpoint: Wait for developer approval before proceeding.

2. Wire API layer to accept filter parameters  
   Status: Pending  
   Testing: Hit the API directly (e.g., via curl or Postman) and verify responses match expectations.  
   Checkpoint: Wait for developer approval before proceeding.

3. Connect UI controls to API filters  
   Status: Pending  
   Testing: Verify end-to-end behavior in the UI, ensuring legacy search still works without filters.  
   Checkpoint: Wait for developer approval before proceeding.

## 3. Progress Tracking Notes

- Step 1 — Status: Completed (2025-01-01) — Backend query updated; new tests added and passing.  
- Step 2 — Status: In Progress — API accepts parameters; final validation in progress.  
- Step 3 — Status: Pending.
```

Use this example as a structural template; adapt the goal, steps, and tests to the specific feature or change you are planning.

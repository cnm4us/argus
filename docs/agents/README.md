# THIS DOCUMENTS PURPOSE
This documents is written by AI agents, for AI agents. It describes the project in broad strokes, and defines some processes that AI agents should follow to maintain cohesion between threads. 

It should be constantly updated 
- As the project evolves
- As the project progresses

## HANDOFF DOCUMENTS
In `docs/agents/` you will find `Handoff_nn.md` documents. 
These documents are written by AI, and optimized for maximum project cohesion when a new thread must be started. AI agents should write these documents for their next threadself. 

### Handoff numbering

- For the very first thread, the agent should use `docs/agents/Handoff_01.md`.
- For each new thread after that, the agent should:
  - Find the highest existing `Handoff_nn.md`
  - Read it carefully
  - Create `Handoff_(nn+1).md` as its own handoff file.

After reading this `docs/agents/README.md` document, the AI agent should locate the most recent `Handoff_nn.md` document and read the notes its last threadself left for it. 

Then the AI agent should immediately begin the next handoff document
`docs/agents/Handoff_nn(+1).md`. The AI agent should add notes to that new document throughout the duration of this thread. 

### Recommended handoff structure

Each `Handoff_nn.md` should, at minimum, contain:

- **Thread context** – what this thread is/was doing.
- **High-level system state** – current architecture, major services, and any important configuration.
- **Key endpoints / flows** – APIs and UI pages that matter right now.
- **Known issues / open questions** – anything that needs follow-up.
- **Next-step suggestions** – concrete, small next actions for the next threadself.

The `/README.md` document is the project readme document meant to provide project developers with useful explanations and commands regarding the project and is completely separate and not to be confused with `docs/agents/README.md`.

## PROJECT GOALS
Build an app that uses OpenAI to extract information from medical documentation in preparation for litigation regarding medical malpractice. 

## PROJECT ARCHITECTURE
- Node.js installation on AWS EC2 instance.
- MariaDB instance on EC2
- OpenAI API key

## AI / DEVELOPER COLLABORATION
- The developer prefers to discuss and plan with the AI before attempting to implement. 
- The developer prefers that more detailed implementation plans be broken down into distinct testable sections, leaving the site in a workable state during testing, and only moving on to the next stage after testing has been approved. 

## GIT COMMIT
I've created a GIT COMMIT template which looks as follows below
Types, Scopes, and Keywords are suggestions, and the AI agent may vary these as necesary for the commit
Keywords should be entered as space separated, and beginning with # signs
Example: #ui #db #layout

-- BEGIN TEMPLATE --
# <type>(<scope>): <short, imperative summary>
# Types: feat | fix | docs | style | refactor | test | chore | perf | build | ci | revert
# Scopes: api | db | cli | ui | video | feed | player | auth | billing | hcpcs | pubmed | config | deps
# Keywords: hooks, context, state, props, layout, routing, performance, accessibility, animation, testing, deployment, error-handling

Subject:

Description:

Keywords:

# Please enter the commit message for your changes. Lines starting
# with '#' will be ignored, and an empty message aborts the commit.
#
# On branch main
# Your branch is up to date with 'origin/main'.
-- END TEMPLATE -- 

### How agents should use this template

- The interactive `git commit` editor is not available to agents, so agents MUST construct commit messages non‑interactively using `git commit -m ...`.
- When the developer asks the agent to "make a commit":
  - The agent should run `git add` for the specific files it has changed (never `git add .` unless explicitly requested).
  - The agent should then run a single `git commit -m "..."` command with multiple `-m` blocks to emulate the template.
- The commit message MUST follow this structure so custom reporting tools can parse it:
  1. **Subject line (first line)**: `<type>(<scope>): <short, imperative summary>`
  2. **Body sections with explicit labels**:
     - A `Subject:` section that repeats the subject line, e.g.  
       `Subject:`  
       `feat(search): add text CNF filters`
     - A `Description:` section with one or more short paragraphs or bullets explaining context and approach.
     - A `Keywords:` section with space‑separated `#tags` (e.g. `#ui #db #search`).
- Example non‑interactive pattern the agent should use:

```bash
git commit -m "feat(search): add text CNF filters" -m "Subject:
feat(search): add text CNF filters

Description:
- Add POST /api/search/db to support combined metadata, taxonomy, and CNF-style text filters on documents.markdown.
- Extend the search UI with text search rows (rows = AND, boxes = OR) and wire it to the new endpoint.

Keywords:
#search #ui #text" 
```

- It is acceptable (and expected) that the agent reconstructs the template like this instead of opening the editor; the important part is that the **Subject**, **Description**, and **Keywords** labels are present and consistently formatted.

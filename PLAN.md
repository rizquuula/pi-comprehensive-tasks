# Plan: pi-comprehensive-tasks

### 1. Goal
A tree of tasks in `TODO.md`, seeded from a plan's slices and cycles, kept honest by the agent as it works, and collapsed as branches finish.

**1a. Success criteria (testable).**
A plan with 2 slices and 5 cycles seeds a 2-level tree of 2 parents and 5 children, each child filed under the slice that owns its files · verified by `tests/seed.test.ts` case `tree mirrors the plan`.
A branch whose children are all done renders as one dimmed line `[x] Slice A · 3/3` instead of four · verified by `tests/render.test.ts` case `a finished branch collapses`.

### 2. Non-goals
No dependency on `pi-comprehensive-planning`. This package works standalone.
No re-reading of `PLAN.md` after seeding. The plan is intent, not state.
No drag-and-drop, no re-parenting, no assignees, no time tracking.
No new task store. `TODO.md` is the store, matching the project's own convention.

### 3. Context and assumptions
`pi-comprehensive-planning@0.2.1` is published and renders §8 as a read-only widget with id `plan-todos` (`extensions/index.ts:25`).
It exports `planTodos`, `readPlan`, `parseSections`, `resolvePlanPath`, and `PLAN_FILENAME` from `extensions/plan-file.ts`.
Its §8 table is `| # | Red | Green | Refactor | Done when |`; its §9 table is `| Slice | Owns these files | Runs after | Deliverable |`.
§9 is currently unused by any code, so the slice names and file ownership are free for this package to consume.
pi has no built-in todo list; the global `AGENTS.md` says to use `TODO.md` as a checkbox list.
There is no cross-package import mechanism, so the file is the only contract available. **(assumption)**
npm name `pi-comprehensive-tasks` is free (checked 2026-09-18).

### 4. Unknowns and questions
- **4a. Blocking**: none. Confirmed with the user: `task_list` is a tool, completed branches collapse, and tasks form a tree.
- **4b. Non-blocking**: a cycle belongs to a slice when the slice owns a file the cycle names. That match is heuristic. Cycle 4 pins the behaviour; the fallback is visible rather than silent. Confirm the fallback name (`Unassigned`) later.
- **4b. Non-blocking**: whether a collapsed branch should still be expandable on demand, or is display-only until a child reopens.

### 5. Approach and alternatives
Own `TODO.md` outright and treat it as the interface. `PLAN.md` holds intent and is read exactly once, at seed time; `TODO.md` holds live state and is the only thing rewritten during work. Nesting is two spaces per level, so the file stays valid Markdown that renders as a real nested checklist on GitHub.

Seeding builds the tree from both plan tables: each §9 slice becomes a parent, each §8 cycle becomes a child of the slice that owns a file the cycle names. A cycle that matches no slice lands under an `Unassigned` parent instead of being dropped — a silent loss would be worse than a visible mis-filing. Every item is tagged with its origin (`<!-- plan:§8#3 -->`), which makes seeding idempotent and lets a task be traced back to its cycle.

Three decisions worth your attention:

1. **No import from the planning package.** Parsing the two tables is about fifty lines. Duplicating it buys independent versioning and lets this package work with no plan at all. The cost is that a change to either table shape must be mirrored here — §10, with tests pinning both shapes.
2. **Two widgets stay.** Planning's shows intent (`PLAN.md · 7 cycles`); this one shows state (`TODO.md · 3/7 done`). Different headers, different questions. Either can be disabled with `pi config`.
3. **Collapsing is pure logic, not a UI concern.** `render.ts` turns a tree plus a set of collapsed ids into an array of strings, so the collapse rule is unit-tested rather than eyeballed.

Alternatives considered:
- **Flat list with a slice prefix** (`A › parse items`) — no nesting, but it loses the collapse feature and reads worse past ten items.
- **Import `planTodos` from the planning package** — no duplication, but a hard version coupling between two independently published packages.
- **Replace planning's widget** by writing to its widget id — one list, but it is string-coupling to another package's internals.

### 6. Files to change (directory tree)

```
pi-comprehensive-tasks/
  package.json                       [NEW]   pi manifest: extensions + skills, pi-package keyword
  README.md                          [NEW]   install, the plan→tasks story, the TODO.md format
  LICENSE                            [NEW]   MIT
  .gitignore                         [NEW]   node_modules, package-lock.json
  extensions/
    index.ts                         [NEW]   /tasks command, 3 tools, widget, session_start
    task-file.ts                     [NEW]   parse the tree, toggle, add, write back in place
    seed.ts                          [NEW]   §9 parents + §8 children, tagged, idempotent
    render.ts                        [NEW]   tree + collapsed ids -> widget lines, pure
  skills/
    comprehensive-tasks/
      SKILL.md                       [NEW]   when to add a task, when to mark one done
  tests/
    task-file.test.ts                [NEW]   parse, toggle, add, round-trip, no duplicate
    seed.test.ts                     [NEW]   tree shape, file matching, Unassigned, idempotent
    render.test.ts                   [NEW]   indentation, dimming, collapse rule
```

### 7. Flow diagram (ASCII)

```
  PLAN.md  (intent, written once by the planning package)
    |
    | 1. /tasks seed    §9 slice -> parent, §8 cycle -> child, tagged §8#N
    v
  +------------------+  2. task_list      +---------------------+
  |    TODO.md    *  |<-------------------|   agent or user     |
  |   (live state)   |------------------->|                     |
  |   nested tree    |  3. task_add /     +---------------------+
  +------------------+     task_complete           |
        |                                          | 5. refresh
        | 4. rewrite in place, checkbox + indent    v
        v                                  +----------------------+
  +------------------+                     | TODO.md · 3/7 done * |
  |  task-file.ts *  |---> render.ts * --->|   [x] Slice A · 3/3  |
  +------------------+     collapse rule   +----------------------+

  * = new or changed by this plan
```

### 8. Step-by-step breakdown (test-first)

| # | Red: write the failing test | Green: make it pass | Refactor | Done when |
|---|---|---|---|---|
| 1 | `task-file.test.ts` — nested items, depth from indent, tabs normalised | `extensions/task-file.ts` | — | the parse cases pass |
| 2 | `task-file.test.ts` — toggle a child, re-serialise, re-parse | `extensions/task-file.ts` | one item regex, shared by parse and write | the round-trip keeps indentation and tag |
| 3 | `task-file.test.ts` — add a child under a parent, and re-adding the same plan ref is a no-op | `extensions/task-file.ts` | — | both add cases pass |
| 4 | `seed.test.ts` — 2 slices and 5 cycles become 2 parents and 5 children, matched by file | `extensions/seed.ts` | — | the tree-shape case passes |
| 5 | `seed.test.ts` — a cycle matching no slice lands under `Unassigned` | `extensions/seed.ts` | share the tag helper with task-file | the fallback case passes |
| 6 | `seed.test.ts` — seeding twice changes nothing | `extensions/seed.ts` | — | the idempotency case passes |
| 7 | `render.test.ts` — tree to lines, indented, done items dimmed | `extensions/render.ts` | — | the render cases pass |
| 8 | `render.test.ts` — a branch with every child done collapses to `[x] Slice A · 3/3` | `extensions/render.ts` | — | the collapse case passes |
| 9 | `[NO-TEST]` wiring only — register the command and the 3 tools | `extensions/index.ts` | extract the widget refresh into a function | `pi -e . --no-skills` lists all 3 tools and `/tasks` |
| 10 | `[NO-TEST]` prose and packaging — the skill, README, npm manifest | `skills/comprehensive-tasks/SKILL.md`, `README.md`, `package.json` | — | `npm pack --dry-run` ships 9 files and no `tests/` |

### 9. Work sequencing

| Slice | Owns these files | Runs after | Deliverable |
|---|---|---|---|
| A: the file format | `extensions/task-file.ts`, `tests/task-file.test.ts` | — | cycles 1–3 green |
| B: seeding the tree | `extensions/seed.ts`, `tests/seed.test.ts` | A | cycles 4–6 green |
| C: rendering | `extensions/render.ts`, `tests/render.test.ts` | A | cycles 7–8 green |
| D: wiring | `extensions/index.ts` | B, C | cycle 9 verified by inspection |
| E: packaging | `package.json`, `README.md`, `LICENSE`, `.gitignore`, `skills/comprehensive-tasks/SKILL.md` | D | cycle 10, then publish |

B and C both run after A and do not touch each other's files, so they are parallel-safe on paper. They still run in order: one writer.

### 10. Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| The §8 or §9 table shape changes, silently breaking seeding | Medium | Both shapes are pinned by `seed.test.ts`; parse failure writes nothing and reports the count it added |
| The cycle-to-slice match mis-files a cycle | Medium | Unmatched cycles go to a visible `Unassigned` parent; the seed reports how many it filed where |
| Indentation drift breaks the tree on a hand-edited `TODO.md` | Medium | Depth comes from indent, tabs normalise to two spaces, and unparseable lines pass through untouched |
| Rewriting `TODO.md` clobbers prose the user added around the list | Low | Only checkbox lines are rewritten; everything else passes through, covered by cycle 2 |
| A collapsed branch hides work that reopened | Low | Collapse is computed from the tree on every render, never stored; one reopened child expands the branch again |

### 11. Validation plan

- **11a. Unit tests**: `tests/task-file.test.ts` (parse, toggle round-trip, add, no duplicate), `tests/seed.test.ts` (tree shape, `Unassigned` fallback, idempotent re-run), `tests/render.test.ts` (indentation, dimming, collapse).
- **11b. Mocked integration tests**: SKIPPED — the package reads and writes two local files and calls no external dependency.
- **11c. Visual verification**: the widget's indentation, the dimming of done items, and a collapsed branch, checked by eye in an interactive pi session against a seeded `TODO.md`. Terminal capture, no browser.
- **11d. Metrics and logs**: SKIPPED — no log lines and no metrics are added by this change.

### 12. Rollout and reversibility
Publish `0.1.0` to npm as a new package; nothing existing changes.
Rollback is `pi uninstall npm:pi-comprehensive-tasks`, which leaves `TODO.md` on disk untouched.
No migration: the package creates `TODO.md` only when it is absent, and never rewrites a file it cannot parse.

### 13. Out-of-scope follow-ups
Let planning offer to seed tasks itself, so the user runs one command instead of two.
A `--from-plan <path>` flag for `/tasks seed` when the plan is not at the default path.
Let a user expand a collapsed branch on demand, if the display-only version proves annoying.
Report the exact-name filter anomaly in the pi package manager upstream (found while building the planning package).

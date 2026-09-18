---
name: comprehensive-tasks
description: Keep TODO.md honest while implementing a plan. Use when working through a plan's cycles, when a task turns out to be bigger or different than the plan said, when new work appears mid-flight, or when deciding whether a task is really done. Covers when to add a task rather than hold it in your head, when to complete one, when to reopen one, and how to file a task under the right slice.
---

# Comprehensive Tasks

`TODO.md` is the live state of the work. `PLAN.md` is the intent.
The plan is written once and reviewed. The task list changes as reality does.

## The shape

```markdown
# Tasks

- [ ] Slice A: the file format <!-- plan:§9#A -->
  - [ ] parse the tree <!-- plan:§8#1 -->
  - [x] toggle a child <!-- plan:§8#2 -->
- [ ] Unassigned
  - [ ] wiring only <!-- plan:§8#9 -->
```

Two spaces of indent per level. The `<!-- plan:… -->` comment records where the task came
from, so a task can be traced back to its cycle. Keep the tag when you edit a line.

## Workflow

1. **Read the list before you start.** `task_list` gives the numbers and refs.
2. **Work one task at a time**, in order. The list is ordered for a reason.
3. **Complete a task the moment its done-criterion holds** — not when the code looks
   right, but when the test in its Red column passes. `task_complete §8#3`.
4. **Reopen it if you were wrong.** `task_complete` with `done: false`. A stale tick is
   worse than an unticked box.
5. **Add work you discover**, rather than holding it in your head. File it under the
   slice it belongs to, or at the top level if it belongs to none.
6. **Finish with a truthful list.** Every box ticked means every criterion in §1a holds.

## Adding a task

Use `task_add` when:

- The plan did not cover something you had to do. Add it and keep going.
- A cycle turned out to be two behaviours. Add the second rather than quietly widening
  the first.
- You found a follow-up worth keeping. If it is genuinely out of scope, put it in the
  plan's §13 instead — the list is for work you are actually doing.

Do not add a task for something you are about to do in the same breath. The list is a
commitment, not a log.

## Filing

A task belongs under the slice that owns the files it touches. If nothing owns them, it
belongs under `Unassigned` — that parent exists on purpose, and a visible mis-filing is
better than a silent one.

## Do / Don't

| Do | Don't |
|---|---|
| Tick a task when its test passes | Tick it because the code is written |
| Reopen a task you closed too early | Leave a wrong tick in place |
| Add the work you discovered, with a short line | Keep three undone things in your head |
| File a task under its slice | Dump everything at the top level |
| Keep the `<!-- plan:… -->` tag when editing | Strip the tag and lose the trail |
| Leave prose outside the list alone | Rewrite the whole file to change one box |

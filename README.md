# pi-comprehensive-tasks

A task tree in `TODO.md` for the [pi coding agent](https://pi.dev), seeded from a
[pi-comprehensive-planning](https://github.com/rizquuula/pi-comprehensive-planning) plan.

```bash
pi install npm:pi-comprehensive-tasks
```

The plan is intent, written once and reviewed. The task list is live state, rewritten as
the work actually goes. Keeping those two in one file is how plans rot, so this package
keeps them apart.

```markdown
# Tasks

- [ ] Slice A: the file format <!-- plan:§9#A -->
  - [x] parse the tree <!-- plan:§8#1 -->
  - [ ] toggle a child <!-- plan:§8#2 -->
- [ ] Unassigned
  - [ ] wiring only <!-- plan:§8#9 -->
```

## Where the file lives

The task list is **`.pi/TODO.md`**. pi's project config directory already holds the
settings, skills and extensions for a project, so the task list belongs there rather than
in your source tree.

The path is resolved in this order, so nothing is ever orphaned:

1. `--tasks-file <path>` on the command line, if you pass one.
2. `.pi/TODO.md`, if it exists.
3. `TODO.md` at the project root, if it exists. A project that has always kept it there
   keeps working — the extension will not quietly start a second, empty list.
4. Otherwise `.pi/TODO.md` is created.

```bash
pi --tasks-file TODO.md                 # force the project root
pi --tasks-file docs/tasks.md           # somewhere else entirely
```

`PLAN.md` stays at the project root. It is reviewed by people, so it is visible on purpose.

## Install

```bash
# from npm
pi install npm:pi-comprehensive-tasks

# from GitHub
pi install git:github.com/rizquuula/pi-comprehensive-tasks

# try it without installing anything
pi -e npm:pi-comprehensive-tasks
```

Add `-l` to install into the current project instead of globally. Requires pi v0.85 or
newer. Nothing to compile — pi loads the TypeScript directly.

## Seeding from a plan

```
/tasks seed
```

Reads `PLAN.md` and builds a two-level tree: each **§9 slice** becomes a parent, each
**§8 cycle** becomes a child of the slice that owns a file the cycle names.

```
- [ ] A: the file format          ← §9 slice
  - [ ] `task-file.test.ts` …     ← §8 cycle, filed here because slice A owns the file
- [ ] Unassigned
  - [ ] wiring only               ← §8 cycle whose files no slice claims
```

Seeding is **idempotent**. Each item is tagged with its origin, so running it twice adds
nothing the second time and never touches work you have already done.

Two things worth knowing:

- **File paths must be in backticks** in §8 and §9. That is what the plan template does,
  and it is how cycles are matched to slices. If they are missing, seeding says so rather
  than silently doing nothing.
- **The match is a heuristic.** A cycle is filed under the first slice that owns a file it
  names. Anything unmatched lands under `Unassigned`, which is visible on purpose.

No plan? The package works standalone. `/tasks add <text>` and the tools below do not
need a `PLAN.md` anywhere.

## The extension

**Three tools** the agent uses as it works:

| Tool | What it does |
|---|---|
| `task_list` | The numbered tree plus progress. Numbers are stable positions in that list. |
| `task_add` | Adds a task, optionally under a parent and tagged with a plan ref. Adding a ref twice is a no-op. |
| `task_complete` | Ticks a task, or reopens it with `done: false`. |

**`/tasks`** for you:

```
/tasks                  pick a task to toggle, repeatedly, until Esc
/tasks seed             build the tree from PLAN.md
/tasks add <text>       add a top-level task
/tasks done <ref|num>   tick one
/tasks undone <ref|num> reopen one
```

**A widget** under the editor: `TODO.md · 3/7 done`, with the tree beneath it. A branch
whose cycles are all finished collapses to one dimmed line carrying its count.

The glyph is always the task's own state, never a summary of its children. A slice whose
cycles are all done but which is itself unticked stays `[ ]` — that is the one thing left
to do, and reporting it as finished would be a lie.

## Working with pi-comprehensive-planning

They are independent packages. Neither imports the other, and each installs and versions
on its own.

| | |
|---|---|
| `PLAN.md` | Intent. Written once by `/plan-comprehensively`, checked by `plan_validate`. |
| `TODO.md` | State. Written continuously by this package. |

Planning shows a `PLAN.md · 7 cycles` widget; this one shows `TODO.md · 3/7 done`. They
answer different questions, so both stay. Disable either with `pi config` if the pair
feels noisy.

## Development

No build step. A clone runs as-is:

```bash
pi -e ./ --no-skills     # load this package in isolation
npm test                 # node --test, no dependencies installed
```

The tests cover the three modules with rules worth pinning down: `task-file` (parse,
toggle round-trip, add), `seed` (tree shape, `Unassigned` fallback, idempotency), and
`render` (indentation, dimming, the collapse rule).

## Security

The extension reads and writes two files in the working directory, registers three tools,
one command, and one widget, and handles one event. It runs no subprocesses, opens no
sockets, and makes no network calls. Read the source before installing it — it is about
600 lines.

## License

MIT

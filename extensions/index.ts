/**
 * pi-comprehensive-tasks — the extension half.
 *
 * TODO.md is the store. This wires three tools, a /tasks command, and a widget that
 * collapses branches as they finish. It reads PLAN.md exactly once, at seed time.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  addTask,
  createTaskFile,
  findTask,
  flatten,
  parseTaskFile,
  progress,
  serializeTaskFile,
  setDone,
  type TaskFile,
} from "./task-file.ts";
import { applySeed, seedFromPlan, seedWarning } from "./seed.ts";
import { renderWidget } from "./render.ts";

const TASKS_FILENAME = "TODO.md";
const PLAN_FILENAME = "PLAN.md";
const WIDGET_ID = "tasks";

function tasksPath(ctx: ExtensionContext): string {
  return join(ctx.cwd, TASKS_FILENAME);
}

/** Read TODO.md, or an empty in-memory file when it does not exist yet. */
function load(ctx: ExtensionContext): TaskFile {
  const path = tasksPath(ctx);
  if (!existsSync(path)) return createTaskFile(path);
  return parseTaskFile(path, readFileSync(path, "utf-8"));
}

function save(ctx: ExtensionContext, file: TaskFile): void {
  const text = serializeTaskFile(file);
  // Always end the file with a newline, even when the last line was just inserted.
  writeFileSync(tasksPath(ctx), text.endsWith("\n") ? text : `${text}\n`, "utf-8");
}

function refresh(ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;
  const file = load(ctx);
  const lines = renderWidget(file, {
    dim: (text) => ctx.ui.theme.fg("dim", text),
    accent: (text) => ctx.ui.theme.fg("accent", text),
    width: 72,
  });
  ctx.ui.setWidget(WIDGET_ID, lines.length > 0 ? lines : undefined, { placement: "belowEditor" });
}

/** The numbered tree, in the same pre-order `findTask` resolves numbers against. */
function numberedList(file: TaskFile): string {
  const all = flatten(file);
  if (all.length === 0) return `No tasks yet. Seed from a plan with /tasks seed, or add one.`;
  return all
    .map((task, index) => {
      const indent = "   ".repeat(task.depth);
      const ref = task.planRef ? `  (${task.planRef})` : "";
      return `${index + 1}. ${indent}${task.done ? "[x]" : "[ ]"} ${task.text}${ref}`;
    })
    .join("\n");
}

function summary(file: TaskFile): string {
  const { done, total } = progress(file);
  return total === 0 ? `${TASKS_FILENAME} · empty` : `${TASKS_FILENAME} · ${done}/${total} done`;
}

function readPlan(ctx: ExtensionContext): string | null {
  const path = join(ctx.cwd, PLAN_FILENAME);
  return existsSync(path) ? readFileSync(path, "utf-8") : null;
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    refresh(ctx);
  });

  // Keep the widget in step when the file is edited by hand or by another tool.
  pi.on("tool_result", async (event, ctx) => {
    const path = (event.input as { path?: string }).path;
    if (path && path.endsWith(TASKS_FILENAME)) refresh(ctx);
  });

  // ------------------------------------------------------------------ tools

  pi.registerTool({
    name: "task_list",
    label: "List Tasks",
    description: `List every task in ${TASKS_FILENAME} as a numbered tree, with progress. Numbers are stable positions in that list and can be passed to task_complete.`,
    promptSnippet: `List the task tree from ${TASKS_FILENAME}`,
    promptGuidelines: [
      "Use task_list to read the current task state instead of guessing from memory.",
      "Use task_list before task_complete when you need the number of a task.",
    ],
    parameters: Type.Object({}),

    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const file = load(ctx);
      return {
        content: [{ type: "text" as const, text: `${summary(file)}\n\n${numberedList(file)}` }],
        details: { done: progress(file).done, total: progress(file).total },
      };
    },
  });

  pi.registerTool({
    name: "task_add",
    label: "Add Task",
    description: `Add a task to ${TASKS_FILENAME}. Omit parent to add at the top level. Adding a planRef that is already present is a no-op, so this is safe to call twice.`,
    promptSnippet: `Add a task to ${TASKS_FILENAME}`,
    promptGuidelines: [
      "Use task_add when work appears that the plan did not cover, rather than keeping it in your head.",
      "Use task_add with a parent to file a task under the slice it belongs to.",
    ],
    parameters: Type.Object({
      text: Type.String({ description: "What the task is. One line." }),
      parent: Type.Optional(
        Type.String({ description: "Plan ref or number of the parent task, for example §9#A. Omit for top level." }),
      ),
      planRef: Type.Optional(
        Type.String({ description: "Plan origin to tag the task with, for example §8#5. Makes a repeat call a no-op." }),
      ),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const file = load(ctx);
      const result = addTask(file, {
        text: params.text,
        planRef: params.planRef ?? null,
        parentRef: params.parent ?? null,
      });

      if (!result.added) {
        return {
          content: [{ type: "text" as const, text: `Not added: ${result.reason}.` }],
          details: { added: false, reason: result.reason },
        };
      }

      save(ctx, file);
      refresh(ctx);
      return {
        content: [{ type: "text" as const, text: `Added. ${summary(file)}\n\n${numberedList(file)}` }],
        details: { added: true },
      };
    },
  });

  pi.registerTool({
    name: "task_complete",
    label: "Complete Task",
    description: `Mark a task in ${TASKS_FILENAME} done, or reopen it with done false. Identify it by plan ref (§8#3) or by its number from task_list.`,
    promptSnippet: `Mark a task done, or reopen it`,
    promptGuidelines: [
      "Use task_complete as soon as a cycle passes, so the task list reflects reality.",
      "Use task_complete with done false to reopen a task that turned out to be unfinished.",
    ],
    parameters: Type.Object({
      task: Type.String({ description: "Plan ref such as §8#3, or the number shown by task_list." }),
      done: Type.Optional(Type.Boolean({ description: "True to complete, false to reopen. Defaults to true." })),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const file = load(ctx);
      const done = params.done ?? true;

      // Resolve before mutating, so the reply can name the task it changed.
      const target = findTask(file, params.task);
      if (!target) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No task matches "${params.task}". Run task_list to see the refs and numbers.`,
            },
          ],
          details: { updated: false },
        };
      }

      setDone(file, params.task, done);
      save(ctx, file);
      refresh(ctx);
      return {
        content: [
          {
            type: "text" as const,
            text: `${done ? "Completed" : "Reopened"} "${target.text}". ${summary(file)}\n\n${numberedList(file)}`,
          },
        ],
        details: { updated: true, done, task: target.text },
      };
    },
  });

  // ------------------------------------------------------------------ /tasks

  async function togglePicker(ctx: ExtensionContext): Promise<void> {
    for (;;) {
      const file = load(ctx);
      const all = flatten(file);
      if (all.length === 0) {
        ctx.ui.notify("No tasks yet. Run /tasks seed, or /tasks add <text>.", "info");
        return;
      }

      const options = all.map(
        (task, index) => `${index + 1}. ${task.done ? "[x]" : "[ ]"} ${"  ".repeat(task.depth)}${task.text}`,
      );
      const choice = await ctx.ui.select(`${summary(file)} — pick one to toggle, Esc to close`, options);
      if (!choice) return;

      const number = /^(\d+)\./.exec(choice)?.[1];
      if (!number) return;
      setDone(file, number, !all[Number(number) - 1]!.done);
      save(ctx, file);
      refresh(ctx);
    }
  }

  pi.registerCommand("tasks", {
    description: "List, seed, add, or toggle tasks in TODO.md",
    handler: async (args, ctx) => {
      const input = (args ?? "").trim();
      const [verb, ...rest] = input.split(/\s+/);
      const remainder = rest.join(" ").trim();

      if (verb === "seed") {
        const plan = readPlan(ctx);
        if (!plan) {
          ctx.ui.notify(`No ${PLAN_FILENAME} in this directory. Run /plan-comprehensively first.`, "warning");
          return;
        }
        const warning = seedWarning(plan);
        if (warning) {
          ctx.ui.notify(warning, "warning");
          return;
        }
        const file = load(ctx);
        const result = applySeed(file, seedFromPlan(plan));
        save(ctx, file);
        refresh(ctx);
        ctx.ui.notify(
          result.added > 0
            ? `Seeded ${result.added} task(s) from ${PLAN_FILENAME}, skipped ${result.skipped}. ${summary(file)}`
            : `Nothing to seed: all ${result.skipped} task(s) were already there.`,
          "info",
        );
        return;
      }

      if (verb === "add") {
        if (!remainder) {
          ctx.ui.notify("Usage: /tasks add <text>", "error");
          return;
        }
        const file = load(ctx);
        const result = addTask(file, { text: remainder });
        if (!result.added) {
          ctx.ui.notify(`Not added: ${result.reason}.`, "error");
          return;
        }
        save(ctx, file);
        refresh(ctx);
        ctx.ui.notify(`Added. ${summary(file)}`, "info");
        return;
      }

      if (verb === "done" || verb === "undone") {
        if (!remainder) {
          ctx.ui.notify(`Usage: /tasks ${verb} <ref|number>`, "error");
          return;
        }
        const file = load(ctx);
        if (!setDone(file, remainder, verb === "done")) {
          ctx.ui.notify(`No task matches "${remainder}". Run /tasks to see the numbers.`, "error");
          return;
        }
        save(ctx, file);
        refresh(ctx);
        ctx.ui.notify(`${verb === "done" ? "Completed" : "Reopened"}. ${summary(file)}`, "info");
        return;
      }

      if (verb) {
        ctx.ui.notify("Usage: /tasks [seed | add <text> | done <ref> | undone <ref>]", "error");
        return;
      }

      if (!ctx.hasUI) {
        const file = load(ctx);
        ctx.ui.notify(`${summary(file)}\n${numberedList(file)}`, "info");
        return;
      }
      await togglePicker(ctx);
    },
  });
}

/**
 * Turning a task tree into widget lines.
 *
 * Pure on purpose: the collapse rule is the interesting part of the display, so it is
 * unit-tested rather than eyeballed. Colour arrives as injected functions, which keeps
 * this module free of any theme dependency.
 */

import { flatten, progress, type Task, type TaskFile } from "./task-file.ts";

export interface RenderOptions {
  dim?: (text: string) => string;
  accent?: (text: string) => string;
  /** Collapse a branch whose descendants are all done. On by default. */
  collapse?: boolean;
  /** Truncate each line to this width. Default 72. */
  width?: number;
}

const CHECKED = "[x]";
const OPEN = "[ ]";

/** Every descendant of a task, at all depths. */
function descendants(task: Task): Task[] {
  const out: Task[] = [];
  const walk = (tasks: Task[]) => {
    for (const child of tasks) {
      out.push(child);
      walk(child.children);
    }
  };
  walk(task.children);
  return out;
}

function truncate(text: string, width: number): string {
  if (text.length <= width) return text;
  return `${text.slice(0, Math.max(1, width - 1))}…`;
}

function label(task: Task): string {
  return `${task.done ? CHECKED : OPEN} ${task.text}`;
}

/**
 * One line per visible task, indented by depth. A branch whose descendants are all
 * done collapses to a single line carrying its own count.
 *
 * The glyph is always the task's own state, never a summary of its children: a slice
 * whose cycles are all finished but which is itself unticked stays `[ ]`, because that
 * is the one thing left to do.
 */
export function renderTasks(file: TaskFile, options: RenderOptions = {}): string[] {
  const { dim = (text) => text, collapse = true, width = 72 } = options;
  const lines: string[] = [];

  const walk = (tasks: Task[]) => {
    for (const task of tasks) {
      const indent = "  ".repeat(task.depth);
      const kids = descendants(task);
      const branchDone = kids.length > 0 && kids.every((child) => child.done);

      if (collapse && branchDone) {
        const done = kids.filter((child) => child.done).length;
        lines.push(dim(truncate(`${indent}${label(task)} · ${done}/${kids.length}`, width)));
        continue;
      }

      const line = `${indent}${label(task)}`;
      lines.push(truncate(task.done ? dim(line) : line, width));
      walk(task.children);
    }
  };

  walk(file.tasks);
  return lines;
}

/** `TODO.md · 3/7 done`, or `TODO.md · empty` when there is nothing to do. */
export function renderHeader(file: TaskFile, options: RenderOptions = {}): string {
  const { accent = (text) => text } = options;
  const { done, total } = progress(file);
  const name = file.path.split("/").pop() ?? "TODO.md";
  if (total === 0) return accent(`${name} · empty`);
  return accent(`${name} · ${done}/${total} done`);
}

/** The whole widget body: header first, then the tree. */
export function renderWidget(file: TaskFile, options: RenderOptions = {}): string[] {
  const body = renderTasks(file, options);
  if (body.length === 0) return [];
  return [renderHeader(file, options), ...body];
}

/** Re-exported so callers can size the widget without importing task-file twice. */
export { flatten, progress };

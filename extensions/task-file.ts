/**
 * Reading and writing TODO.md.
 *
 * The file is the interface: plain Markdown nested checkboxes, so it renders as a real
 * checklist on GitHub. Only checkbox lines are ever rewritten — prose the user added
 * around the list passes through untouched.
 *
 *   # Tasks
 *
 *   - [ ] Slice A: the file format <!-- plan:§9#A -->
 *     - [ ] parse the tree <!-- plan:§8#1 -->
 *     - [x] toggle a child <!-- plan:§8#2 -->
 */

import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";

export interface Task {
  text: string;
  done: boolean;
  /** Origin in the plan, for example `§8#1`. Null for tasks a human added. */
  planRef: string | null;
  /** Nesting level, 0 for a root. Two spaces of indent per level. */
  depth: number;
  /** Index into `TaskFile.lines`. */
  line: number;
  children: Task[];
}

export interface TaskFile {
  path: string;
  /** Raw lines. Mutations rewrite this, then re-parse. */
  lines: string[];
  tasks: Task[];
}

const ITEM_RE = /^([ \t]*)-[ \t]+\[([ xX])\][ \t]*(.*)$/;
const TAG_RE = /<!--\s*plan:([^\s>]+)\s*-->/;
const INDENT_PER_LEVEL = 2;

export const TASKS_FILENAME = "TODO.md";
/** pi's project config directory. New task lists go here, not in the project root. */
export const TASKS_DIR = ".pi";

/**
 * Where the task list lives.
 *
 * An explicit path wins. Otherwise a file that already exists wins, so a project that
 * has always kept `TODO.md` at its root keeps working instead of quietly starting a
 * second, empty list in `.pi/`. Only a project with neither gets the new default.
 */
export function resolveTasksPath(cwd: string, requested?: string | null): string {
  const asked = (requested ?? "").trim();
  if (asked !== "") return isAbsolute(asked) ? asked : join(cwd, asked);

  const inConfig = join(cwd, TASKS_DIR, TASKS_FILENAME);
  const atRoot = join(cwd, TASKS_FILENAME);
  if (existsSync(inConfig)) return inConfig;
  if (existsSync(atRoot)) return atRoot;
  return inConfig;
}

/** Tabs become two spaces so depth is measured from spaces alone. */
function expandTabs(line: string): string {
  return line.replace(/\t/g, " ".repeat(INDENT_PER_LEVEL));
}

function depthOf(expandedLine: string): number {
  const indent = /^[ \t]*/.exec(expandedLine)![0];
  return Math.floor(expandTabs(indent).length / INDENT_PER_LEVEL);
}

export function parseTaskFile(path: string, raw: string): TaskFile {
  const lines = raw.split(/\r?\n/);
  const tasks: Task[] = [];
  const stack: Task[] = [];

  lines.forEach((line, index) => {
    const match = ITEM_RE.exec(expandTabs(line));
    if (!match) return;

    const body = match[3] ?? "";
    const tag = TAG_RE.exec(body);
    const text = body.replace(TAG_RE, "").trim();
    const depth = depthOf(line);

    const task: Task = {
      text,
      done: (match[2] ?? " ").toLowerCase() === "x",
      planRef: tag ? tag[1]! : null,
      depth,
      line: index,
      children: [],
    };

    while (stack.length > 0 && stack[stack.length - 1]!.depth >= depth) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(task);
    else tasks.push(task);

    stack.push(task);
  });

  return { path, lines, tasks };
}

export function createTaskFile(path: string): TaskFile {
  return parseTaskFile(path, "# Tasks\n");
}

export function serializeTaskFile(file: TaskFile): string {
  return file.lines.join("\n");
}

/** Depth-first order, the order the widget and `task_list` both use. */
export function flatten(file: TaskFile): Task[] {
  const out: Task[] = [];
  const walk = (tasks: Task[]) => {
    for (const task of tasks) {
      out.push(task);
      walk(task.children);
    }
  };
  walk(file.tasks);
  return out;
}

/**
 * Find a task by plan ref (`§8#3`) or by its 1-based position in `flatten`.
 * Numbers shift as the file changes, so a ref is the durable way to name one.
 */
export function findTask(file: TaskFile, ref: string): Task | undefined {
  const wanted = ref.trim();
  if (wanted === "") return undefined;

  const byRef = flatten(file).find((task) => task.planRef === wanted);
  if (byRef) return byRef;

  if (/^\d+$/.test(wanted)) {
    const index = Number(wanted);
    const list = flatten(file);
    if (index >= 1 && index <= list.length) return list[index - 1];
  }
  return undefined;
}

/**
 * Rebuild the parsed tree after mutating `lines`.
 *
 * Every mutation must call this. A stale tree makes the next `findTask` miss a task that
 * was just added, which silently turns a full seed into a partial one.
 */
function reparse(file: TaskFile): void {
  file.tasks = parseTaskFile(file.path, file.lines.join("\n")).tasks;
}

export function setDone(file: TaskFile, ref: string, done: boolean): boolean {
  const task = findTask(file, ref);
  if (!task) return false;

  const line = file.lines[task.line] ?? "";
  const next = line.replace(/\[([ xX])\]/, done ? "[x]" : "[ ]");
  if (next === line) return true;

  file.lines[task.line] = next;
  reparse(file);
  return true;
}

export interface AddOptions {
  text: string;
  /** Plan origin to tag the new task with, for example `§8#1`. */
  planRef?: string | null;
  /** Plan ref of the parent. Omit to add at the top level. */
  parentRef?: string | null;
}

export interface AddResult {
  added: boolean;
  reason?: string;
  task?: Task;
}

/** Index of the last line belonging to this task or any of its descendants. */
function lastLineOf(task: Task): number {
  let last = task.line;
  for (const child of task.children) last = Math.max(last, lastLineOf(child));
  return last;
}

export function addTask(file: TaskFile, options: AddOptions): AddResult {
  const text = options.text.trim();
  if (text === "") return { added: false, reason: "empty text" };

  const ref = options.planRef?.trim() || null;
  if (ref && findTask(file, ref)) {
    return { added: false, reason: `already present: ${ref}` };
  }

  let depth = 0;
  let insertAt = file.lines.length;

  if (options.parentRef) {
    const parent = findTask(file, options.parentRef);
    if (!parent) return { added: false, reason: `no such parent: ${options.parentRef}` };
    depth = parent.depth + 1;
    insertAt = lastLineOf(parent) + 1;
  } else {
    // Append after the last task so prose below the list keeps its place.
    const all = flatten(file);
    if (all.length > 0) insertAt = Math.max(...all.map((task) => lastLineOf(task))) + 1;
  }

  const line = `${" ".repeat(depth * INDENT_PER_LEVEL)}- [ ] ${text}${ref ? ` <!-- plan:${ref} -->` : ""}`;
  file.lines.splice(insertAt, 0, line);
  reparse(file);
  return { added: true };
}

/** Done and total counts across every level. */
export function progress(file: TaskFile): { done: number; total: number } {
  const all = flatten(file);
  return { done: all.filter((task) => task.done).length, total: all.length };
}

/** Plan refs already present, used to keep seeding idempotent. */
export function presentRefs(file: TaskFile): Set<string> {
  return new Set(flatten(file).map((task) => task.planRef).filter((ref): ref is string => ref !== null));
}

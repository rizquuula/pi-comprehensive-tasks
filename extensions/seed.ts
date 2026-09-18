/**
 * Seeding TODO.md from a plan.
 *
 * Reads two tables out of PLAN.md and nowhere else:
 *   §9 Work sequencing  -> one parent per slice, with the files it owns
 *   §8 Step-by-step     -> one child per cycle, filed under the slice that owns its files
 *
 * A cycle whose files match no slice lands under an `Unassigned` parent. Filing it
 * wrongly is recoverable; dropping it silently is not.
 *
 * Nothing here imports the planning package. The two table shapes are duplicated on
 * purpose, so this package versions and installs independently.
 */

import { addTask, findTask, type TaskFile } from "./task-file.ts";

export interface SeedChild {
  ref: string;
  text: string;
}

export interface SeedParent {
  ref: string;
  text: string;
  children: SeedChild[];
}

export interface SliceRow {
  ref: string;
  text: string;
  files: string[];
}

export interface CycleRow {
  ref: string;
  text: string;
  files: string[];
}

export const UNASSIGNED_REF = "unassigned";

const FILE_LIKE =
  /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|cpp|cc|cxx|h|hpp|kt|kts|dart|java|rb|php|cs|swift|sql|json|ya?ml|toml|md|proto|sh|tf)$/i;

/** Split on `## N. Title` / `### N. Title` headings, keyed by the number. */
function sections(raw: string): Map<string, string> {
  const found = new Map<string, string>();
  let current: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (current !== null) found.set(current, buffer.join("\n").trim());
  };

  for (const line of raw.split(/\r?\n/)) {
    const heading = /^#{2,4}\s+(\d+)[.)]\s+/.exec(line);
    if (heading) {
      flush();
      current = heading[1]!;
      buffer = [];
      continue;
    }
    if (current !== null) buffer.push(line);
  }
  flush();
  return found;
}

function tableRows(body: string): string[][] {
  const rows: string[][] = [];
  let seenHeader = false;

  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) {
      if (seenHeader && rows.length > 0 && trimmed === "") seenHeader = false;
      continue;
    }
    const cells = trimmed
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());

    if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) continue;
    if (!seenHeader) {
      seenHeader = true;
      continue;
    }
    rows.push(cells);
  }
  return rows;
}

function backticked(text: string): string[] {
  return [...text.matchAll(/`([^`]+)`/g)]
    .map((match) => match[1]!.trim().replace(/^\.\//, ""))
    .filter((value) => value !== "" && FILE_LIKE.test(value));
}

function clean(text: string): string {
  return text.replace(/\s+/g, " ").replace(/<!--[\s\S]*?-->/g, "").trim();
}

/** `A: the file format` -> `A`. Falls back to the row's position. */
function sliceLabel(cell: string, index: number): string {
  const match = /^([A-Za-z][A-Za-z0-9]*)\s*[:：\-–—]/.exec(cell.trim());
  return match ? match[1]! : String(index + 1);
}

export function readPlanTables(planRaw: string): { slices: SliceRow[]; cycles: CycleRow[] } {
  const parts = sections(planRaw);

  const slices = tableRows(parts.get("9") ?? "").map((cells, index) => ({
    ref: `§9#${sliceLabel(cells[0] ?? "", index)}`,
    text: clean(cells[0] ?? ""),
    files: backticked(cells[1] ?? ""),
  }));

  const cycles = tableRows(parts.get("8") ?? "").map((cells) => ({
    ref: `§8#${(cells[0] ?? "").replace(/[^A-Za-z0-9]/g, "")}`,
    text: clean(cells[1] ?? ""),
    files: [...backticked(cells[1] ?? ""), ...backticked(cells[2] ?? "")],
  }));

  return { slices, cycles };
}

/**
 * Build the tree a plan implies. Slice order is preserved; `Unassigned` comes last
 * and only when something actually landed there.
 */
export function seedFromPlan(planRaw: string): SeedParent[] {
  const { slices, cycles } = readPlanTables(planRaw);

  const parents: SeedParent[] = slices.map((slice) => ({
    ref: slice.ref,
    text: slice.text,
    children: [],
  }));
  const unassigned: SeedParent = { ref: UNASSIGNED_REF, text: "Unassigned", children: [] };

  for (const cycle of cycles) {
    const owner = slices.find((slice) =>
      slice.files.some((owned) => cycle.files.includes(owned)),
    );
    const child: SeedChild = { ref: cycle.ref, text: cycle.text };
    if (!owner) {
      unassigned.children.push(child);
      continue;
    }
    parents.find((parent) => parent.ref === owner.ref)!.children.push(child);
  }

  if (unassigned.children.length > 0) parents.push(unassigned);
  return parents;
}

export interface SeedResult {
  added: number;
  skipped: number;
}

/**
 * Explain why a seed would do nothing, instead of silently doing nothing.
 * Returns null when the plan looks seedable.
 */
export function seedWarning(planRaw: string): string | null {
  const parts = sections(planRaw);

  if (!parts.has("8") || !parts.has("9")) {
    const missing = ["8", "9"].filter((key) => !parts.has(key));
    const label = missing.length === 2 ? "§8 and §9" : `§${missing[0]}`;
    return `PLAN.md has no ${label} section. Seeding reads §9 for slices and §8 for cycles.`;
  }

  const { slices, cycles } = readPlanTables(planRaw);
  if (cycles.length === 0) return "§8 has no table rows, so there are no cycles to seed.";
  if (slices.length === 0) return "§9 has no table rows, so there are no slices to group under.";

  if (cycles.every((cycle) => cycle.files.length === 0)) {
    return "§8 names no file paths. Wrap them in backticks, for example `src/cache.ts`, so cycles can be matched to slices.";
  }
  if (slices.every((slice) => slice.files.length === 0)) {
    return "§9 lists no file paths. Wrap them in backticks so cycles can be matched to slices.";
  }
  return null;
}

/** Merge a seed into an open task file. Idempotent: a ref already present is skipped. */
export function applySeed(file: TaskFile, parents: SeedParent[]): SeedResult {
  let added = 0;
  let skipped = 0;

  for (const parent of parents) {
    if (findTask(file, parent.ref)) {
      skipped += 1;
    } else {
      const result = addTask(file, { text: parent.text, planRef: parent.ref });
      if (result.added) added += 1;
      else skipped += 1;
    }

    for (const child of parent.children) {
      if (findTask(file, child.ref)) {
        skipped += 1;
        continue;
      }
      const result = addTask(file, { text: child.text, planRef: child.ref, parentRef: parent.ref });
      if (result.added) added += 1;
      else skipped += 1;
    }
  }

  return { added, skipped };
}

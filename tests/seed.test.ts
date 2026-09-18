import { test } from "node:test";
import assert from "node:assert/strict";
import { applySeed, readPlanTables, seedFromPlan, seedWarning, UNASSIGNED_REF } from "../extensions/seed.ts";
import { createTaskFile, flatten, findTask, parseTaskFile, serializeTaskFile } from "../extensions/task-file.ts";

const PLAN = [
  "# Plan: something",
  "",
  "### 1. Goal",
  "Do a thing.",
  "",
  "**1a. Success criteria (testable).**",
  "It works · verified by `a.test.ts`.",
  "",
  "### 8. Step-by-step breakdown (test-first)",
  "| # | Red: write the failing test | Green: make it pass | Refactor | Done when |",
  "|---|---|---|---|---|",
  "| 1 | `a.test.ts` — parses | `src/a.ts` | — | a.test.ts passes |",
  "| 2 | `a.test.ts` — round trip | `src/a.ts` | — | round trip passes |",
  "| 3 | `b.test.ts` — seeds | `src/b.ts` | — | seed passes |",
  "| 4 | [NO-TEST] wiring only | `src/wiring.ts` | — | the app starts |",
  "",
  "### 9. Work sequencing",
  "| Slice | Owns these files | Runs after | Deliverable |",
  "|---|---|---|---|",
  "| A: the format | `src/a.ts`, `tests/a.test.ts` | — | cycles 1-2 |",
  "| B: seeding | `src/b.ts`, `tests/b.test.ts` | A | cycle 3 |",
  "",
].join("\n");

test("reads both tables, with slice labels and cycle numbers as refs", () => {
  const { slices, cycles } = readPlanTables(PLAN);
  assert.deepEqual(slices.map((slice) => slice.ref), ["§9#A", "§9#B"]);
  assert.deepEqual(slices[0]!.files, ["src/a.ts", "tests/a.test.ts"]);
  assert.deepEqual(cycles.map((cycle) => cycle.ref), ["§8#1", "§8#2", "§8#3", "§8#4"]);
  assert.deepEqual(cycles[0]!.files, ["a.test.ts", "src/a.ts"]);
});

test("cycle text comes from the Red column, with whitespace collapsed", () => {
  const { cycles } = readPlanTables(PLAN);
  assert.equal(cycles[0]!.text, "`a.test.ts` — parses");
});

test("the tree mirrors the plan: slices as parents, cycles as children", () => {
  const parents = seedFromPlan(PLAN);
  assert.deepEqual(parents.map((parent) => parent.ref), ["§9#A", "§9#B", UNASSIGNED_REF]);
  assert.deepEqual(parents[0]!.children.map((child) => child.ref), ["§8#1", "§8#2"]);
  assert.deepEqual(parents[1]!.children.map((child) => child.ref), ["§8#3"]);
});

test("a cycle matching no slice lands under Unassigned, not nowhere", () => {
  const parents = seedFromPlan(PLAN);
  const unassigned = parents.at(-1)!;
  assert.equal(unassigned.ref, UNASSIGNED_REF);
  assert.deepEqual(unassigned.children.map((child) => child.ref), ["§8#4"]);
});

test("no Unassigned parent appears when every cycle is filed", () => {
  const plan = PLAN.replace("| 4 | [NO-TEST] wiring only | `src/wiring.ts` | — | the app starts |\n", "");
  const parents = seedFromPlan(plan);
  assert.equal(parents.some((parent) => parent.ref === UNASSIGNED_REF), false);
});

test("applies a seed into an empty file, tagged and nested", () => {
  const file = createTaskFile("TODO.md");
  const result = applySeed(file, seedFromPlan(PLAN));
  assert.deepEqual(result, { added: 7, skipped: 0 });

  const out = serializeTaskFile(file);
  assert.ok(out.includes("- [ ] A: the format <!-- plan:§9#A -->"));
  assert.ok(out.includes("  - [ ] `a.test.ts` — parses <!-- plan:§8#1 -->"));
  assert.ok(out.includes("- [ ] Unassigned <!-- plan:unassigned -->"));
});

test("the seeded tree nests cycles under their slice", () => {
  const file = createTaskFile("TODO.md");
  applySeed(file, seedFromPlan(PLAN));
  const parsed = parseTaskFile("TODO.md", serializeTaskFile(file));

  const sliceA = findTask(parsed, "§9#A")!;
  assert.equal(sliceA.children.length, 2);
  assert.equal(sliceA.children[0]!.depth, 1);
  assert.equal(flatten(parsed).length, 7);
});

test("seeding twice changes nothing", () => {
  const file = createTaskFile("TODO.md");
  applySeed(file, seedFromPlan(PLAN));
  const afterFirst = serializeTaskFile(file);

  const second = applySeed(file, seedFromPlan(PLAN));
  assert.equal(second.added, 0);
  assert.equal(second.skipped, 7);
  assert.equal(serializeTaskFile(file), afterFirst);
});

test("seeding preserves work already done in the file", () => {
  const file = createTaskFile("TODO.md");
  applySeed(file, seedFromPlan(PLAN));
  const parsed = parseTaskFile("TODO.md", serializeTaskFile(file));
  parsed.lines[parsed.lines.findIndex((line) => line.includes("§8#1"))!] = parsed.lines[
    parsed.lines.findIndex((line) => line.includes("§8#1"))
  ]!.replace("[ ]", "[x]");

  const before = serializeTaskFile(parsed);
  applySeed(parsed, seedFromPlan(PLAN));
  assert.equal(serializeTaskFile(parsed), before);
});

test("seedWarning explains a plan with no tables", () => {
  assert.match(seedWarning("# Plan\n\n### 1. Goal\nNothing.\n")!, /no §8 and §9 section/);
});

test("seedWarning explains backtick-less file lists", () => {
  const noTicks = PLAN.replace(/`/g, "");
  assert.match(seedWarning(noTicks)!, /backticks/);
});

test("seedWarning is null for a seedable plan", () => {
  assert.equal(seedWarning(PLAN), null);
});

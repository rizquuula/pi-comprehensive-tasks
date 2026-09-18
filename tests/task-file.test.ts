import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addTask,
  createTaskFile,
  findTask,
  flatten,
  parseTaskFile,
  presentRefs,
  progress,
  serializeTaskFile,
  setDone,
} from "../extensions/task-file.ts";

const SAMPLE = `# Tasks

Notes above the list stay put.

- [ ] Slice A: the file format <!-- plan:§9#A -->
  - [ ] parse the tree <!-- plan:§8#1 -->
  - [x] toggle a child <!-- plan:§8#2 -->
- [x] A one-off thing a human added
- [ ] Unassigned <!-- plan:unassigned -->
  - [ ] wiring only <!-- plan:§8#9 -->
`;

function parse(raw = SAMPLE) {
  return parseTaskFile("TODO.md", raw);
}

test("parses nesting into a tree, depth from indentation", () => {
  const file = parse();
  assert.equal(file.tasks.length, 3);
  assert.equal(file.tasks[0]!.text, "Slice A: the file format");
  assert.equal(file.tasks[0]!.depth, 0);
  assert.equal(file.tasks[0]!.children.length, 2);
  assert.equal(file.tasks[0]!.children[0]!.depth, 1);
  assert.equal(file.tasks[2]!.children[0]!.text, "wiring only");
});

test("parses done state, plan tags, and untagged tasks", () => {
  const file = parse();
  const child = file.tasks[0]!.children[1]!;
  assert.equal(child.done, true);
  assert.equal(child.planRef, "§8#2");
  assert.equal(file.tasks[1]!.planRef, null);
  assert.equal(file.tasks[1]!.done, true);
});

test("strips the tag from the displayed text", () => {
  const file = parse();
  assert.equal(file.tasks[0]!.text, "Slice A: the file format");
  assert.ok(!file.tasks[0]!.text.includes("plan:"));
});

test("normalises tabs to two spaces per level", () => {
  const file = parse("- [ ] root\n\t- [ ] child\n\t\t- [ ] grandchild\n");
  assert.equal(file.tasks[0]!.children[0]!.depth, 1);
  assert.equal(file.tasks[0]!.children[0]!.children[0]!.depth, 2);
});

test("flatten is depth-first", () => {
  const texts = flatten(parse()).map((task) => task.text);
  assert.deepEqual(texts, [
    "Slice A: the file format",
    "parse the tree",
    "toggle a child",
    "A one-off thing a human added",
    "Unassigned",
    "wiring only",
  ]);
});

test("findTask resolves a plan ref and a 1-based position", () => {
  const file = parse();
  assert.equal(findTask(file, "§8#2")?.text, "toggle a child");
  assert.equal(findTask(file, "2")?.text, "parse the tree");
  assert.equal(findTask(file, "99"), undefined);
  assert.equal(findTask(file, "nope"), undefined);
});

test("toggling one item leaves everything else byte-identical", () => {
  const file = parse();
  assert.equal(setDone(file, "§8#1", true), true);

  const out = serializeTaskFile(file);
  assert.ok(out.includes("- [x] parse the tree <!-- plan:§8#1 -->"));
  // The untouched lines keep their exact bytes, including the note above the list.
  assert.ok(out.includes("Notes above the list stay put."));
  assert.ok(out.includes("- [x] toggle a child <!-- plan:§8#2 -->"));
  assert.ok(out.includes("- [ ] Slice A: the file format <!-- plan:§9#A -->"));
  assert.equal(out.split("\n").length, SAMPLE.split("\n").length);
});

test("toggling back restores the original file exactly", () => {
  const file = parse();
  setDone(file, "§8#1", true);
  setDone(file, "§8#1", false);
  assert.equal(serializeTaskFile(file), SAMPLE);
});

test("toggling preserves indentation and any trailing prose", () => {
  const file = parse();
  setDone(file, "§8#9", true);
  const out = serializeTaskFile(file);
  assert.ok(out.includes("  - [x] wiring only <!-- plan:§8#9 -->"));
});

test("addTask appends a child under the given parent", () => {
  const file = parse();
  const result = addTask(file, { text: "a new child", planRef: "§8#3", parentRef: "§9#A" });

  assert.equal(result.added, true);
  const reparsed = parse(serializeTaskFile(file));
  const slice = findTask(reparsed, "§9#A")!;
  assert.equal(slice.children.length, 3);
  assert.equal(slice.children[2]!.text, "a new child");
  assert.equal(slice.children[2]!.depth, 1);
});

test("a new child lands after the parent's last descendant, not mid-branch", () => {
  const file = parse();
  addTask(file, { text: "grandchild", parentRef: "§8#1" });
  const reparsed = parse(serializeTaskFile(file));
  const parent = findTask(reparsed, "§8#1")!;
  assert.equal(parent.children.length, 1);
  // Still inside slice A, before the human's one-off line.
  const order = flatten(reparsed).map((task) => task.text);
  assert.deepEqual(order.slice(0, 5), [
    "Slice A: the file format",
    "parse the tree",
    "grandchild",
    "toggle a child",
    "A one-off thing a human added",
  ]);
});

test("adding the same plan ref twice is a no-op", () => {
  const file = parse();
  const first = addTask(file, { text: "parse the tree", planRef: "§8#1", parentRef: "§9#A" });
  assert.equal(first.added, false);
  assert.match(first.reason!, /already present/);
  assert.equal(flatten(file).length, 6);
});

test("addTask without a parentRef goes to the top level", () => {
  const file = parse();
  const result = addTask(file, { text: "loose task" });
  assert.equal(result.added, true);
  const reparsed = parse(serializeTaskFile(file));
  const added = flatten(reparsed).find((task) => task.text === "loose task")!;
  assert.equal(added.depth, 0);
  assert.equal(added.planRef, null);
});

test("an empty text is rejected", () => {
  const result = addTask(parse(), { text: "   " });
  assert.equal(result.added, false);
  assert.equal(result.reason, "empty text");
});

test("an unknown parent is reported, not silently created", () => {
  const result = addTask(parse(), { text: "x", parentRef: "§9#ZZ" });
  assert.equal(result.added, false);
  assert.match(result.reason!, /no such parent/);
});

test("a new file starts with a heading and takes its first task", () => {
  const file = createTaskFile("TODO.md");
  assert.equal(flatten(file).length, 0);
  addTask(file, { text: "first", planRef: "§8#1" });
  const reparsed = parse(serializeTaskFile(file));
  assert.equal(reparsed.tasks.length, 1);
  assert.equal(reparsed.tasks[0]!.text, "first");
});

test("progress and presentRefs read the whole tree", () => {
  const file = parse();
  assert.deepEqual(progress(file), { done: 2, total: 6 });
  assert.deepEqual([...presentRefs(file)].sort(), ["unassigned", "§8#1", "§8#2", "§8#9", "§9#A"]);
});

test("a file with no tasks parses to an empty tree and survives a round trip", () => {
  const raw = "# Notes\n\nJust prose, no checkboxes.\n";
  const file = parse(raw);
  assert.equal(file.tasks.length, 0);
  assert.equal(serializeTaskFile(file), raw);
});

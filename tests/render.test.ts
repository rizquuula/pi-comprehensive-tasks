import { test } from "node:test";
import assert from "node:assert/strict";
import { renderHeader, renderTasks, renderWidget } from "../extensions/render.ts";
import { parseTaskFile } from "../extensions/task-file.ts";

const TREE = [
  "# Tasks",
  "",
  "- [ ] Slice A: the format <!-- plan:§9#A -->",
  "  - [x] parse the tree <!-- plan:§8#1 -->",
  "  - [ ] toggle a child <!-- plan:§8#2 -->",
  "- [x] Slice B: seeding <!-- plan:§9#B -->",
  "  - [x] read the tables <!-- plan:§8#3 -->",
  "  - [x] file the cycles <!-- plan:§8#4 -->",
  "- [ ] A loose task",
  "",
].join("\n");

const FINISHED_BRANCH = [
  "# Tasks",
  "",
  "- [x] Slice B: seeding <!-- plan:§9#B -->",
  "  - [x] read the tables <!-- plan:§8#3 -->",
  "  - [x] file the cycles <!-- plan:§8#4 -->",
  "",
].join("\n");

const dim = (text: string) => `<d>${text}</d>`;
const accent = (text: string) => `<a>${text}</a>`;

function parse(raw: string) {
  return parseTaskFile("TODO.md", raw);
}

test("renders one line per task, indented by depth, tags stripped", () => {
  const lines = renderTasks(parse(TREE));
  assert.deepEqual(lines, [
    "[ ] Slice A: the format",
    "  [x] parse the tree",
    "  [ ] toggle a child",
    "[x] Slice B: seeding · 2/2",
    "[ ] A loose task",
  ]);
});

test("completed items are dimmed, open ones are not", () => {
  const lines = renderTasks(parse(TREE), { dim, collapse: false });
  assert.equal(lines[1], "<d>  [x] parse the tree</d>");
  assert.equal(lines[2], "  [ ] toggle a child");
});

test("a finished branch collapses to one dimmed line with its count", () => {
  const lines = renderTasks(parse(FINISHED_BRANCH), { dim });
  assert.deepEqual(lines, ["<d>[x] Slice B: seeding · 2/2</d>"]);
});

test("collapse counts descendants at every depth, not just direct children", () => {
  const deep = [
    "# Tasks",
    "",
    "- [x] Slice <!-- plan:§9#A -->",
    "  - [x] parent <!-- plan:§8#1 -->",
    "    - [x] grandchild <!-- plan:§8#2 -->",
    "",
  ].join("\n");
  assert.deepEqual(renderTasks(parse(deep), { dim }), ["<d>[x] Slice · 2/2</d>"]);
});

test("collapse can be turned off", () => {
  const lines = renderTasks(parse(FINISHED_BRANCH), { collapse: false });
  assert.equal(lines.length, 3);
});

test("the glyph is the task's own state, never a summary of its children", () => {
  // All the cycles are done but the slice itself was never ticked. That is the one
  // thing left to do, so it must not be reported as finished.
  const unticked = [
    "# Tasks",
    "",
    "- [ ] Slice B: seeding <!-- plan:§9#B -->",
    "  - [x] read the tables <!-- plan:§8#3 -->",
    "  - [x] file the cycles <!-- plan:§8#4 -->",
    "",
  ].join("\n");
  const lines = renderTasks(parse(unticked), { dim });
  assert.deepEqual(lines, ["<d>[ ] Slice B: seeding · 2/2</d>"]);
});

test("an open branch keeps every line", () => {
  const lines = renderTasks(parse(TREE), { collapse: true });
  assert.equal(lines.length, 5);
});

test("lines are truncated to the given width", () => {
  const long = [
    "# Tasks",
    "",
    "- [ ] A task with a very long description that will not fit in a narrow widget",
    "",
  ].join("\n");
  const lines = renderTasks(parse(long), { width: 30 });
  assert.equal(lines[0]!.length, 30);
  assert.ok(lines[0]!.endsWith("…"));
});

test("the header reports progress", () => {
  assert.equal(renderHeader(parse(TREE)), "TODO.md · 4/7 done");
  assert.equal(renderHeader(parse(TREE), { accent }), "<a>TODO.md · 4/7 done</a>");
});

test("an empty file gets an empty widget, not a lone header", () => {
  const empty = parse("# Tasks\n\n");
  assert.deepEqual(renderWidget(empty), []);
  assert.equal(renderHeader(empty), "TODO.md · empty");
});

test("the widget body is the header followed by the tree", () => {
  const lines = renderWidget(parse(TREE), { accent, dim });
  assert.equal(lines[0], "<a>TODO.md · 4/7 done</a>");
  assert.equal(lines.length, 6);
});

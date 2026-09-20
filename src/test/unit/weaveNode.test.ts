import * as assert from "assert";
import { buildFoldArgs, WeaveNode } from "../../tree/weaveNode";

suite("buildFoldArgs", () => {
  test("commit target moves above it, never plain fold", () => {
    const commitTarget: WeaveNode = {
      kind: "commit",
      commit: { hash: "target1", subject: "t", files: [] },
      branchNames: [],
      root: "/repo",
    };
    assert.deepStrictEqual(buildFoldArgs(["src1"], commitTarget), [
      "fold",
      "src1",
      "--above",
      "target1",
    ]);
    assert.deepStrictEqual(buildFoldArgs(["src1", "src2"], commitTarget), [
      "fold",
      "src1",
      "src2",
      "--above",
      "target1",
    ]);
    // Dropping a commit onto itself is a no-op, not a self-fold.
    assert.strictEqual(buildFoldArgs(["target1"], commitTarget), undefined);
  });

  test("branch target moves to the top of that branch by name", () => {
    const branchTarget: WeaveNode = {
      kind: "branch",
      section: {
        names: [{ name: "feat-a" }],
        commits: [],
        stackedOnNext: false,
      },
      root: "/repo",
    };
    assert.deepStrictEqual(buildFoldArgs(["src1"], branchTarget), [
      "fold",
      "src1",
      "feat-a",
    ]);
  });

  test("integration target moves above its topmost loose commit", () => {
    const integrationTarget: WeaveNode = {
      kind: "integration",
      commits: [{ hash: "loose1", subject: "l", files: [] }],
      root: "/repo",
    };
    assert.deepStrictEqual(buildFoldArgs(["src1"], integrationTarget), [
      "fold",
      "src1",
      "--above",
      "loose1",
    ]);
  });

  test("file/upstream/error targets are not droppable", () => {
    const fileTarget: WeaveNode = {
      kind: "file",
      commit: { hash: "c1", subject: "c", files: [] },
      file: { status: "M", path: "a.txt" },
      root: "/repo",
    };
    const upstreamTarget: WeaveNode = {
      kind: "upstream",
      info: { label: "origin/main", baseHash: "b1", baseSubject: "init", commitsAhead: 0 },
    };
    const errorTarget: WeaveNode = { kind: "error", message: "oops" };
    assert.strictEqual(buildFoldArgs(["src1"], fileTarget), undefined);
    assert.strictEqual(buildFoldArgs(["src1"], upstreamTarget), undefined);
    assert.strictEqual(buildFoldArgs(["src1"], errorTarget), undefined);
  });
});

import * as assert from "assert";
import { parseStatusGraph } from "../../loom/jsonStatusParser";
import { LoomError } from "../../loom/model";

// Trimmed from a real `git-loom --agent status -f` (0.25.0): local changes, a loose commit,
// a stack of two branches, and a co-located pair.
function sampleGraph(): Record<string, unknown> {
  return {
    schema: 1,
    integration_branch: "integration",
    cwd_prefix: "",
    local_changes: {
      id: "zz",
      files: [
        { id: "ss", path: "s/", index: "?", worktree: "?", state: "untracked" },
        { id: "xx", path: "x", index: " ", worktree: "M", state: "tracked" },
        { id: "cc", path: "c", index: "M", worktree: "M", state: "tracked" },
        { id: "uu", path: "u", index: "U", worktree: "U", state: "conflicted" },
      ],
    },
    branches: [
      {
        names: [{ id: "fc", name: "feat-c", remote: "different" }],
        stacked_on: "feat-b",
        stacked_on_hidden: false,
        commits: [
          {
            id: "pkz",
            hash: "7a067a9",
            oid: "7a067a9000000000000000000000000000000000",
            subject: "feat: c",
            change_id: "I1",
            files: [
              { id: "pkz:0", path: "c", index: "M", worktree: " " },
              { id: "pkz:1", path: "gone.txt", index: "D", worktree: " " },
            ],
          },
        ],
      },
      {
        names: [{ id: "fb", name: "feat-b", remote: "synced" }],
        stacked_on: null,
        stacked_on_hidden: false,
        commits: [
          {
            id: "lvk",
            hash: "17d369f",
            oid: "17d369f32fe64919635a7c491786046091ba94d7",
            subject: "feat: b",
            change_id: "I2",
            files: [{ id: "lvk:0", path: "b", index: "A", worktree: " " }],
          },
        ],
      },
      {
        names: [
          { id: "f2", name: "feat-a2", remote: null },
          { id: "fa", name: "feat-a", remote: "gone" },
        ],
        stacked_on: null,
        stacked_on_hidden: false,
        commits: [],
      },
    ],
    loose_commits: [
      {
        id: "ttu",
        hash: "98c328e",
        oid: "98c328e4d7dd89dc1aaa175166178650f39163e5",
        subject: "loose",
        change_id: null,
        files: [],
      },
    ],
    upstream: {
      label: "origin/main",
      base_hash: "d369b9b",
      base_oid: "d369b9bb31b135de39d933c8cdf07f91223619b5",
      base_subject: "init",
      base_date: "2026-09-28",
      commits_ahead: 2,
    },
    context_commits: [],
  };
}

suite("jsonStatusParser", () => {
  test("maps branches, commits and their files in loom's order", () => {
    const status = parseStatusGraph(sampleGraph());
    assert.deepStrictEqual(
      status.branches.map((b) => b.names.map((n) => n.name)),
      [["feat-c"], ["feat-b"], ["feat-a2", "feat-a"]],
    );
    assert.deepStrictEqual(status.branches[0].commits, [
      {
        hash: "7a067a9",
        subject: "feat: c",
        files: [
          { status: "M", path: "c" },
          { status: "D", path: "gone.txt" },
        ],
      },
    ]);
    assert.deepStrictEqual(status.branches[2].commits, []);
  });

  test("stacked_on becomes stackedOn, null becomes undefined", () => {
    const status = parseStatusGraph(sampleGraph());
    assert.strictEqual(status.branches[0].stackedOn, "feat-b");
    assert.strictEqual(status.branches[1].stackedOn, undefined);
  });

  test("remote states map to synced/ahead/gone, null to no remote", () => {
    const status = parseStatusGraph(sampleGraph());
    assert.strictEqual(status.branches[0].names[0].remote, "ahead");
    assert.strictEqual(status.branches[1].names[0].remote, "synced");
    assert.strictEqual(status.branches[2].names[0].remote, undefined);
    assert.strictEqual(status.branches[2].names[1].remote, "gone");
  });

  test("local changes keep porcelain XY, untracked as ??", () => {
    const status = parseStatusGraph(sampleGraph());
    assert.deepStrictEqual(status.localChanges, [
      { index: "?", worktree: "?", path: "s/" },
      { index: " ", worktree: "M", path: "x" },
      { index: "M", worktree: "M", path: "c" },
      { index: "U", worktree: "U", path: "u" },
    ]);
  });

  test("loose commits and upstream", () => {
    const status = parseStatusGraph(sampleGraph());
    assert.deepStrictEqual(status.looseCommits, [
      { hash: "98c328e", subject: "loose", files: [] },
    ]);
    assert.deepStrictEqual(status.upstream, {
      label: "origin/main",
      baseHash: "d369b9b",
      baseSubject: "init",
      commitsAhead: 2,
    });
  });

  test("a missing graph (git-loom < 0.25) is a LoomError", () => {
    assert.throws(() => parseStatusGraph(undefined), LoomError);
  });

  test("an unknown schema is a LoomError", () => {
    assert.throws(
      () => parseStatusGraph({ ...sampleGraph(), schema: 2 }),
      LoomError,
    );
  });
});

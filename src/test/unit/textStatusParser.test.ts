import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { parseStatusText } from "../../loom/textStatusParser";

function loadFixture(name: string): string {
  // __dirname is out/test/unit here; fixtures live at <repo root>/test/fixtures/status.
  return fs.readFileSync(path.join(__dirname, "../../../test/fixtures/status", name), "utf8");
}

suite("textStatusParser", () => {
  test("simple.txt: loose commit, 3 branches, upstream with 0 ahead, zz parsed", () => {
    const status = parseStatusText(loadFixture("simple.txt"));

    assert.strictEqual(status.looseCommits.length, 1);
    assert.strictEqual(status.looseCommits[0].hash, "08ce79a");
    assert.strictEqual(status.looseCommits[0].subject, "chore: loose commit on integration");
    assert.deepStrictEqual(status.looseCommits[0].files, [{ status: "A", path: "l.txt" }]);

    assert.strictEqual(status.branches.length, 3);
    assert.strictEqual(status.branches[0].names.length, 1);
    assert.strictEqual(status.branches[0].names[0].name, "feat-a-stack");
    assert.strictEqual(status.branches[0].commits.length, 1);
    assert.strictEqual(status.branches[0].commits[0].hash, "81ed772");

    assert.strictEqual(status.branches[1].names[0].name, "feat-c");
    assert.strictEqual(status.branches[2].names[0].name, "feat-a");
    assert.strictEqual(status.branches[2].commits.length, 2);
    assert.strictEqual(status.branches[2].commits[0].hash, "162a27a");
    assert.strictEqual(status.branches[2].commits[1].hash, "b00f4f5");
    assert.strictEqual(status.branches[2].commits[1].subject, "feat: add a (reworded)");

    assert.ok(status.upstream);
    assert.strictEqual(status.upstream?.label, "origin/main");
    assert.strictEqual(status.upstream?.baseHash, "e509757");
    assert.strictEqual(status.upstream?.baseSubject, "init");
    assert.strictEqual(status.upstream?.commitsAhead, 0);

    assert.deepStrictEqual(status.localChanges, [
      { index: " ", worktree: "M", path: "a.txt" },
      { index: "?", worktree: "?", path: "loose.txt" },
    ]);

    // zz files must not leak into commits: a.txt is only a working-tree change here.
    for (const branch of status.branches) {
      for (const commit of branch.commits) {
        assert.ok(
          commit.files.every((f) => f.path !== "a.txt" || commit.hash === "b00f4f5"),
          "a.txt from local changes must not leak into an unrelated commit",
        );
      }
    }
  });

  test("stacked-colocated.txt: stacked section + co-located branch names", () => {
    const status = parseStatusText(loadFixture("stacked-colocated.txt"));

    assert.strictEqual(status.branches.length, 4);

    const stack = status.branches.find((b) => b.names.some((n) => n.name === "feat-stack"));
    assert.ok(stack);
    assert.strictEqual(stack?.stackedOnNext, true);
    assert.strictEqual(stack?.commits.length, 1);
    assert.strictEqual(stack?.commits[0].hash, "cd80931");

    const colocated = status.branches.find((b) => b.names.some((n) => n.name === "feat-a-alias"));
    assert.ok(colocated);
    assert.deepStrictEqual(
      colocated?.names.map((n) => n.name),
      ["feat-a-alias", "feat-a"],
    );
    assert.strictEqual(colocated?.stackedOnNext, false);
    assert.strictEqual(colocated?.commits.length, 2);
    assert.strictEqual(colocated?.commits[0].hash, "162a27a");
    assert.strictEqual(colocated?.commits[1].hash, "b00f4f5");
    assert.deepStrictEqual(colocated?.commits[0].files, [{ status: "A", path: "b.txt" }]);
    assert.deepStrictEqual(colocated?.commits[1].files, [{ status: "A", path: "a.txt" }]);
  });

  test("upstream-ahead.txt: commitsAhead, base hash/subject", () => {
    const status = parseStatusText(loadFixture("upstream-ahead.txt"));

    assert.ok(status.upstream);
    assert.strictEqual(status.upstream?.commitsAhead, 1);
    assert.strictEqual(status.upstream?.baseHash, "e509757");
    assert.strictEqual(status.upstream?.baseSubject, "init");
    assert.strictEqual(status.upstream?.label, "origin/main");

    // Remote markers on branch names are parsed.
    const fc = status.branches.find((b) => b.names.some((n) => n.name === "feat-c"));
    assert.strictEqual(fc?.names[0].remote, "synced");
  });

  test("empty-branch.txt: a branch section with zero commits", () => {
    const status = parseStatusText(loadFixture("empty-branch.txt"));

    const empty = status.branches.find((b) => b.names.some((n) => n.name === "empty-one"));
    assert.ok(empty);
    assert.strictEqual(empty?.commits.length, 0);
    assert.strictEqual(empty?.stackedOnNext, false);
  });

  test("clean.txt: 'no changes' inside zz gives no local changes", () => {
    const status = parseStatusText(loadFixture("clean.txt"));

    assert.deepStrictEqual(status.localChanges, []);

    assert.strictEqual(status.looseCommits.length, 1);
    assert.strictEqual(status.branches.length, 4); // feat-a-stack, feat-c, feat-stack, [feat-a-alias,feat-a]
    assert.ok(status.upstream);
    assert.strictEqual(status.upstream?.commitsAhead, 1);
  });

  test("local-changes.txt: every staged/unstaged/untracked combination", () => {
    const status = parseStatusText(loadFixture("local-changes.txt"));

    assert.deepStrictEqual(status.localChanges, [
      { index: " ", worktree: "M", path: "a.txt" },
      { index: "M", worktree: " ", path: "b.txt" },
      { index: "M", worktree: "M", path: "c.txt" },
      { index: "D", worktree: " ", path: "d.txt" },
      { index: "A", worktree: " ", path: "dir with space/staged.txt" },
      { index: " ", worktree: "D", path: "e.txt" },
      { index: "A", worktree: " ", path: "new.txt" },
      // loom doesn't detect renames: a staged `git mv` shows as a delete plus an add
      { index: "D", worktree: " ", path: "r.txt" },
      { index: "A", worktree: " ", path: "renamed.txt" },
      { index: "?", worktree: "?", path: "dir with space/extra.txt" },
      { index: "?", worktree: "?", path: "sub/" },
      { index: "?", worktree: "?", path: "untracked.txt" },
    ]);

    // The rest of the weave still parses after a populated zz block.
    assert.strictEqual(status.looseCommits.length, 1);
    assert.strictEqual(status.looseCommits[0].hash, "4c1020c");
    assert.deepStrictEqual(status.looseCommits[0].files, [{ status: "A", path: "l.txt" }]);
    assert.strictEqual(status.branches.length, 1);
    assert.strictEqual(status.branches[0].names[0].name, "feat-a");
    assert.strictEqual(status.branches[0].commits[0].hash, "840d21c");
    assert.strictEqual(status.upstream?.baseHash, "515c3f5");
  });

  test("local-changes-only.txt: zz directly on top of upstream", () => {
    const status = parseStatusText(loadFixture("local-changes-only.txt"));

    // Same working tree as local-changes.txt, just without the loose commit and branch.
    assert.deepStrictEqual(
      status.localChanges,
      parseStatusText(loadFixture("local-changes.txt")).localChanges,
    );
    assert.deepStrictEqual(status.looseCommits, []);
    assert.deepStrictEqual(status.branches, []);
    assert.strictEqual(status.upstream?.baseHash, "515c3f5");
    assert.strictEqual(status.upstream?.commitsAhead, 0);
  });

  test("output without a zz block gives no local changes", () => {
    const status = parseStatusText(
      ["│╭─ fc [feat-c]", "│●    31a  feat: c 3143c55", "├╯", "│", "● e509757 (upstream) [origin/main] init"].join("\n"),
    );
    assert.deepStrictEqual(status.localChanges, []);
    assert.strictEqual(status.branches.length, 1);
  });

  test("a zz file named like the 'no changes' marker is still a change", () => {
    const status = parseStatusText(["╭─ zz [local changes]", "│   nc  M no changes", "│"].join("\n"));
    assert.deepStrictEqual(status.localChanges, [{ index: " ", worktree: "M", path: "no changes" }]);
  });

  test("remote marker ✓ maps to 'synced'", () => {
    const status = parseStatusText(
      ["│╭─ fc [feat-c] ✓", "│●    31a  feat: c 3143c55", "├╯"].join("\n"),
    );
    assert.strictEqual(status.branches[0].names[0].remote, "synced");
  });

  test("remote marker ↑ maps to 'ahead'", () => {
    const status = parseStatusText(
      ["│╭─ fc [feat-c] ↑", "│●    31a  feat: c 3143c55", "├╯"].join("\n"),
    );
    assert.strictEqual(status.branches[0].names[0].remote, "ahead");
  });

  test("remote marker ✗ maps to 'gone'", () => {
    const status = parseStatusText(
      ["│╭─ fc [feat-c] ✗", "│●    31a  feat: c 3143c55", "├╯"].join("\n"),
    );
    assert.strictEqual(status.branches[0].names[0].remote, "gone");
  });

  test("a subject containing brackets and ● is preserved verbatim", () => {
    const subject = "feat: handle [brackets] and ● dots in messages";
    const status = parseStatusText(
      ["│╭─ fc [feat-c]", `│●    31a  ${subject} 3143c55`, "├╯"].join("\n"),
    );
    assert.strictEqual(status.branches[0].commits[0].subject, subject);
  });

  test("empty input produces an empty status", () => {
    const status = parseStatusText("");
    assert.deepStrictEqual(status.localChanges, []);
    assert.deepStrictEqual(status.looseCommits, []);
    assert.deepStrictEqual(status.branches, []);
    assert.strictEqual(status.upstream, undefined);
  });
});

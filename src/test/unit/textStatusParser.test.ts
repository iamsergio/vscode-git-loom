import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { parseStatusText } from "../../loom/textStatusParser";

function loadFixture(name: string): string {
  // __dirname is out/test/unit here; fixtures live at <repo root>/test/fixtures/status.
  return fs.readFileSync(path.join(__dirname, "../../../test/fixtures/status", name), "utf8");
}

suite("textStatusParser", () => {
  test("simple.txt: loose commit, 3 branches, upstream with 0 ahead, zz skipped", () => {
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

    // Local changes (zz) are skipped entirely: a.txt only exists as a working-tree
    // change, never as a committed file.
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

  test("clean.txt: 'no changes' inside zz is skipped without error", () => {
    const status = parseStatusText(loadFixture("clean.txt"));

    assert.strictEqual(status.looseCommits.length, 1);
    assert.strictEqual(status.branches.length, 4); // feat-a-stack, feat-c, feat-stack, [feat-a-alias,feat-a]
    assert.ok(status.upstream);
    assert.strictEqual(status.upstream?.commitsAhead, 1);
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
    assert.deepStrictEqual(status.looseCommits, []);
    assert.deepStrictEqual(status.branches, []);
    assert.strictEqual(status.upstream, undefined);
  });
});

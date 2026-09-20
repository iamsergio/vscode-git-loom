import * as assert from "assert";
import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { runLoom } from "../../loom/runner";
import { TextStatusSource } from "../../loom/statusSource";
import { buildFoldArgs } from "../../tree/weaveDragAndDropController";
import { WeaveNode, WeaveTreeProvider } from "../../tree/weaveTreeProvider";

function loomAvailable(): boolean {
  try {
    cp.execFileSync("git-loom", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function sh(cmd: string, args: string[], cwd: string): void {
  cp.execFileSync(cmd, args, { cwd, stdio: "ignore" });
}

suite("smoke", () => {
  test("extension is present and activates", async () => {
    const ext = vscode.extensions.getExtension("iamsergio.vscode-git-loom");
    assert.ok(ext, "extension iamsergio.vscode-git-loom not found");
    await ext?.activate();
    assert.strictEqual(ext?.isActive, true);
  });

  test("gitLoom.refresh is registered", async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes("gitLoom.refresh"));
    assert.ok(commands.includes("gitLoom.reword"));
    assert.ok(commands.includes("gitLoom.dropCommit"));
    assert.ok(commands.includes("gitLoom.dropBranch"));
    assert.ok(commands.includes("gitLoom.update"));
    assert.ok(commands.includes("gitLoom.copyCommitHash"));
    assert.ok(commands.includes("gitLoom.copyBranchName"));
    assert.ok(commands.includes("gitLoom.newBranch"));
    assert.ok(commands.includes("gitLoom.mergeBranch"));
    assert.ok(commands.includes("gitLoom.unmergeBranch"));
    assert.ok(commands.includes("gitLoom.absorbFile"));
    assert.ok(commands.includes("gitLoom.openFileDiff"));
    assert.ok(commands.includes("gitLoom.hideFiles"));
    assert.ok(commands.includes("gitLoom.showFiles"));
  });

  test("TextStatusSource + reword against a real loom repo", async function () {
    if (!loomAvailable()) {
      this.skip();
      return;
    }
    this.timeout(30000);

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vscode-git-loom-smoke-"));
    const originDir = path.join(tmp, "origin.git");
    const demoDir = path.join(tmp, "demo");

    sh("git", ["init", "-q", "--bare", originDir], tmp);
    sh("git", ["clone", "-q", originDir, demoDir], tmp);
    sh("git", ["config", "user.email", "test@example.com"], demoDir);
    sh("git", ["config", "user.name", "Test"], demoDir);
    sh("git", ["commit", "-q", "--allow-empty", "-m", "init"], demoDir);
    sh("git", ["push", "-q", "origin", "HEAD:main"], demoDir);
    sh("git", ["branch", "-u", "origin/main"], demoDir);

    await runLoom("git-loom", ["init"], demoDir);

    fs.writeFileSync(path.join(demoDir, "a.txt"), "a\n");
    await runLoom("git-loom", ["commit", "-b", "feat-a", "-m", "feat: a", "a.txt"], demoDir);

    fs.writeFileSync(path.join(demoDir, "b.txt"), "b\n");
    await runLoom("git-loom", ["commit", "-b", "feat-b", "-m", "feat: b", "b.txt"], demoDir);

    const source = new TextStatusSource("git-loom");
    const status = await source.getStatus(demoDir);
    assert.strictEqual(status.branches.length, 2);

    const branchA = status.branches.find((b) => b.names.some((n) => n.name === "feat-a"));
    assert.ok(branchA);
    const hash = branchA?.commits[0].hash as string;

    await runLoom("git-loom", ["reword", hash, "-m", "feat: reworded\n\nbody line"], demoDir);

    const statusAfter = await source.getStatus(demoDir);
    const branchAAfter = statusAfter.branches.find((b) => b.names.some((n) => n.name === "feat-a"));
    assert.strictEqual(branchAAfter?.commits[0].subject, "feat: reworded");
  });

  test("WeaveTreeProvider builds real vscode.TreeItems from a live repo", async function () {
    if (!loomAvailable()) {
      this.skip();
      return;
    }
    this.timeout(30000);

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vscode-git-loom-tree-"));
    const originDir = path.join(tmp, "origin.git");
    const demoDir = path.join(tmp, "demo");

    sh("git", ["init", "-q", "--bare", originDir], tmp);
    sh("git", ["clone", "-q", originDir, demoDir], tmp);
    sh("git", ["config", "user.email", "test@example.com"], demoDir);
    sh("git", ["config", "user.name", "Test"], demoDir);
    sh("git", ["commit", "-q", "--allow-empty", "-m", "init"], demoDir);
    sh("git", ["push", "-q", "origin", "HEAD:main"], demoDir);
    sh("git", ["branch", "-u", "origin/main"], demoDir);
    await runLoom("git-loom", ["init"], demoDir);
    fs.writeFileSync(path.join(demoDir, "a.txt"), "a\n");
    await runLoom("git-loom", ["commit", "-b", "feat-a", "-m", "feat: a", "a.txt"], demoDir);

    const provider = new WeaveTreeProvider(new TextStatusSource("git-loom"), async () => demoDir);
    const roots = await provider.getChildren();

    const branchNode = roots.find((n) => n.kind === "branch");
    assert.ok(branchNode, "expected a branch node at the root");
    const branchItem = provider.getTreeItem(branchNode!);
    assert.strictEqual(branchItem.label, "feat-a");
    assert.strictEqual(branchItem.contextValue, "branch");

    const commitNodes = await provider.getChildren(branchNode);
    assert.strictEqual(commitNodes.length, 1);
    const commitItem = provider.getTreeItem(commitNodes[0]);
    assert.strictEqual(commitItem.contextValue, "commit");
    assert.strictEqual(commitItem.description, commitNodes[0].kind === "commit" ? commitNodes[0].commit.hash : undefined);

    const fileNodes = await provider.getChildren(commitNodes[0]);
    assert.strictEqual(fileNodes.length, 1);
    const fileItem = provider.getTreeItem(fileNodes[0]);
    assert.strictEqual(fileItem.contextValue, "file");
    assert.strictEqual(fileItem.label, "a.txt");
    assert.ok(fileItem.command);
    assert.strictEqual(fileItem.command?.command, "gitLoom.openFileDiff");

    // Toggling showFiles off hides files under a commit (and its expand arrow).
    assert.strictEqual(provider.getShowFiles(), true);
    provider.setShowFiles(false);
    assert.strictEqual(provider.getShowFiles(), false);
    const commitNodesNoFiles = await provider.getChildren(branchNode);
    const collapsedCommitItem = provider.getTreeItem(commitNodesNoFiles[0]);
    assert.strictEqual(collapsedCommitItem.collapsibleState, vscode.TreeItemCollapsibleState.None);
    assert.deepStrictEqual(await provider.getChildren(commitNodesNoFiles[0]), []);

    // Toggling back on restores them.
    provider.setShowFiles(true);
    assert.strictEqual((await provider.getChildren(commitNodesNoFiles[0])).length, 1);
  });

  test("buildFoldArgs: commit target moves above it, never plain fold", () => {
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

  test("buildFoldArgs: branch target moves to the top of that branch by name", () => {
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

  test("buildFoldArgs: integration target moves above its topmost loose commit", () => {
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

  test("buildFoldArgs: file/upstream/error targets are not droppable", () => {
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

  test("drag-move a commit across branches via fold --above against a real loom repo", async function () {
    if (!loomAvailable()) {
      this.skip();
      return;
    }
    this.timeout(30000);

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vscode-git-loom-dnd-"));
    const originDir = path.join(tmp, "origin.git");
    const demoDir = path.join(tmp, "demo");

    sh("git", ["init", "-q", "--bare", originDir], tmp);
    sh("git", ["clone", "-q", originDir, demoDir], tmp);
    sh("git", ["config", "user.email", "test@example.com"], demoDir);
    sh("git", ["config", "user.name", "Test"], demoDir);
    sh("git", ["commit", "-q", "--allow-empty", "-m", "init"], demoDir);
    sh("git", ["push", "-q", "origin", "HEAD:main"], demoDir);
    sh("git", ["branch", "-u", "origin/main"], demoDir);
    await runLoom("git-loom", ["init"], demoDir);

    fs.writeFileSync(path.join(demoDir, "a.txt"), "a\n");
    await runLoom("git-loom", ["commit", "-b", "feat-a", "-m", "feat: a", "a.txt"], demoDir);
    fs.writeFileSync(path.join(demoDir, "b.txt"), "b\n");
    await runLoom("git-loom", ["commit", "-b", "feat-b", "-m", "feat: b", "b.txt"], demoDir);

    const source = new TextStatusSource("git-loom");
    const status = await source.getStatus(demoDir);
    const branchA = status.branches.find((b) => b.names.some((n) => n.name === "feat-a"));
    const branchB = status.branches.find((b) => b.names.some((n) => n.name === "feat-b"));
    const sourceHash = branchA!.commits[0].hash;
    const targetNode: WeaveNode = {
      kind: "branch",
      section: branchB!,
      root: demoDir,
    };

    const args = buildFoldArgs([sourceHash], targetNode);
    assert.ok(args);
    await runLoom("git-loom", args!, demoDir);

    const statusAfter = await source.getStatus(demoDir);
    const branchAAfter = statusAfter.branches.find((b) => b.names.some((n) => n.name === "feat-a"));
    const branchBAfter = statusAfter.branches.find((b) => b.names.some((n) => n.name === "feat-b"));
    assert.strictEqual(branchAAfter?.commits.length, 0);
    assert.strictEqual(branchBAfter?.commits.length, 2);
    assert.strictEqual(branchBAfter?.commits[0].subject, "feat: a");
    assert.strictEqual(branchBAfter?.commits[1].subject, "feat: b");
  });

  test("WeaveTreeProvider shows an error node when the repo root resolver throws", async () => {
    const provider = new WeaveTreeProvider(new TextStatusSource("git-loom"), async () => {
      throw new Error("no workspace folder");
    });
    const roots = await provider.getChildren();
    assert.strictEqual(roots.length, 1);
    assert.strictEqual(roots[0].kind, "error");
    const item = provider.getTreeItem(roots[0]);
    assert.strictEqual(item.contextValue, "error");
  });
});

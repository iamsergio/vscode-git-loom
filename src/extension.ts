import * as vscode from "vscode";
import {
  GIT_SHOW_SCHEME,
  GitShowProvider,
  openFileDiff,
} from "./gitShowProvider";
import { LoomError } from "./loom/model";
import { runGit, runLoom } from "./loom/runner";
import { TextStatusSource } from "./loom/statusSource";
import { RewordController } from "./reword/rewordController";
import { WeaveDragAndDropController } from "./tree/weaveDragAndDropController";
import { WeaveNode, WeaveTreeProvider } from "./tree/weaveTreeProvider";

const REFRESH_DEBOUNCE_MS = 500;

function getExecutable(): string {
  return vscode.workspace
    .getConfiguration("gitLoom")
    .get<string>("executable", "git-loom");
}

async function resolveRepoRoot(): Promise<string> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    throw new LoomError("Open a folder that contains a git-loom repository.");
  }
  try {
    const out = await runGit(
      ["rev-parse", "--show-toplevel"],
      folder.uri.fsPath,
    );
    return out.trim();
  } catch {
    throw new LoomError(`Not a git repository: ${folder.uri.fsPath}`);
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const statusSource = new TextStatusSource(getExecutable());
  let currentStatusSource = statusSource;
  const provider = new WeaveTreeProvider(
    { getStatus: (root) => currentStatusSource.getStatus(root) },
    resolveRepoRoot,
  );

  const treeView = vscode.window.createTreeView("gitLoom.weave", {
    treeDataProvider: provider,
    dragAndDropController: new WeaveDragAndDropController(getExecutable, () =>
      provider.refresh(),
    ),
  });
  context.subscriptions.push(treeView);

  const setShowFilesContext = (value: boolean): void => {
    void vscode.commands.executeCommand(
      "setContext",
      "gitLoom.showFiles",
      value,
    );
  };
  setShowFilesContext(provider.getShowFiles());

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      GIT_SHOW_SCHEME,
      new GitShowProvider(),
    ),
  );

  const rewordController = new RewordController(context, getExecutable, () =>
    provider.refresh(),
  );
  context.subscriptions.push(rewordController);

  context.subscriptions.push(
    vscode.commands.registerCommand("gitLoom.refresh", () =>
      provider.refresh(),
    ),
    vscode.commands.registerCommand(
      "gitLoom.reword",
      async (node: WeaveNode | undefined) => {
        if (!node || node.kind !== "commit") {
          return;
        }
        try {
          await rewordController.reword(
            node.root,
            node.commit.hash,
            node.branchNames,
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(message);
        }
      },
    ),
    vscode.commands.registerCommand(
      "gitLoom.dropCommit",
      async (node: WeaveNode | undefined) => {
        if (!node || node.kind !== "commit") {
          return;
        }
        try {
          await runLoom(
            getExecutable(),
            ["drop", node.commit.hash, "-y"],
            node.root,
          );
          provider.refresh();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(message);
        }
      },
    ),
    vscode.commands.registerCommand(
      "gitLoom.dropBranch",
      async (node: WeaveNode | undefined) => {
        if (!node || node.kind !== "branch") {
          return;
        }
        const name = node.section.names[0]?.name;
        if (!name) {
          return;
        }
        const commitCount = node.section.commits.length;
        if (commitCount > 0) {
          const choice = await vscode.window.showWarningMessage(
            `Drop branch '${name}' and its ${commitCount} commit${commitCount === 1 ? "" : "s"}? This cannot be undone.`,
            { modal: true },
            "Drop Branch",
          );
          if (choice !== "Drop Branch") {
            return;
          }
        }
        try {
          await runLoom(getExecutable(), ["drop", name, "-y"], node.root);
          provider.refresh();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(message);
        }
      },
    ),
    vscode.commands.registerCommand(
      "gitLoom.unmergeBranch",
      async (node: WeaveNode | undefined) => {
        if (!node || node.kind !== "branch") {
          return;
        }
        const name = node.section.names[0]?.name;
        if (!name) {
          return;
        }
        try {
          await runLoom(
            getExecutable(),
            ["branch", "unmerge", name],
            node.root,
          );
          provider.refresh();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(message);
        }
      },
    ),
    vscode.commands.registerCommand("gitLoom.newBranch", async () => {
      let root: string;
      try {
        root = await resolveRepoRoot();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(message);
        return;
      }
      const name = await vscode.window.showInputBox({
        prompt: "New branch name",
        validateInput: (value) =>
          value.trim() === "" ? "Branch name cannot be empty" : undefined,
      });
      if (!name) {
        return;
      }
      try {
        await runLoom(getExecutable(), ["branch", "new", name.trim()], root);
        provider.refresh();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(message);
      }
    }),
    vscode.commands.registerCommand("gitLoom.mergeBranch", async () => {
      let root: string;
      try {
        root = await resolveRepoRoot();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(message);
        return;
      }
      try {
        const [status, branchesOut, currentBranch] = await Promise.all([
          currentStatusSource.getStatus(root),
          runGit(["branch", "--format=%(refname:short)"], root),
          runGit(["rev-parse", "--abbrev-ref", "HEAD"], root),
        ]);
        const woven = new Set(
          status.branches.flatMap((b) => b.names.map((n) => n.name)),
        );
        const current = currentBranch.trim();
        const candidates = branchesOut
          .split(/\r?\n/)
          .map((b) => b.trim())
          .filter((b) => b !== "" && b !== current && !woven.has(b));
        if (candidates.length === 0) {
          vscode.window.showInformationMessage(
            "No branches available to merge into the weave.",
          );
          return;
        }
        const picked = await vscode.window.showQuickPick(candidates, {
          placeHolder: "Select a branch to merge into the weave",
        });
        if (!picked) {
          return;
        }
        await runLoom(getExecutable(), ["branch", "merge", picked], root);
        provider.refresh();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(message);
      }
    }),
    vscode.commands.registerCommand(
      "gitLoom.absorbFile",
      async (node: WeaveNode | undefined) => {
        if (!node || node.kind !== "file") {
          return;
        }
        try {
          await runLoom(getExecutable(), ["absorb", node.file.path], node.root);
          provider.refresh();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(message);
        }
      },
    ),
    vscode.commands.registerCommand("gitLoom.update", async () => {
      let root: string;
      try {
        root = await resolveRepoRoot();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(message);
        return;
      }
      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Updating…",
          },
          () => runLoom(getExecutable(), ["update", "-y"], root),
        );
        provider.refresh();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(message);
      }
    }),
    vscode.commands.registerCommand(
      "gitLoom.copyCommitHash",
      async (node: WeaveNode | undefined) => {
        if (!node || node.kind !== "commit") {
          return;
        }
        await vscode.env.clipboard.writeText(node.commit.hash);
      },
    ),
    vscode.commands.registerCommand(
      "gitLoom.copyBranchName",
      async (node: WeaveNode | undefined) => {
        if (!node || node.kind !== "branch") {
          return;
        }
        const label = node.section.names.map((n) => n.name).join(", ");
        await vscode.env.clipboard.writeText(label);
      },
    ),
    vscode.commands.registerCommand(
      "gitLoom.openFileDiff",
      async (root: string, hash: string, path: string) => {
        try {
          await openFileDiff(root, hash, path);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(message);
        }
      },
    ),
    vscode.commands.registerCommand("gitLoom.hideFiles", () => {
      provider.setShowFiles(false);
      setShowFilesContext(false);
    }),
    vscode.commands.registerCommand("gitLoom.showFiles", () => {
      provider.setShowFiles(true);
      setShowFilesContext(true);
    }),
  );

  // Debounced refresh, so a burst of ref/index writes (a rebase, a status.rs-style
  // rewrite) only triggers one re-fetch. Skipped while the view is hidden.
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let staleWhileHidden = false;
  const scheduleRefresh = (): void => {
    if (!treeView.visible) {
      staleWhileHidden = true;
      return;
    }
    if (refreshTimer) {
      clearTimeout(refreshTimer);
    }
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      provider.refresh();
    }, REFRESH_DEBOUNCE_MS);
  };

  context.subscriptions.push(
    treeView.onDidChangeVisibility((e) => {
      if (e.visible && staleWhileHidden) {
        staleWhileHidden = false;
        provider.refresh();
      }
    }),
  );

  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder) {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(
        folder,
        ".git/{HEAD,index,refs/**,packed-refs}",
      ),
    );
    context.subscriptions.push(
      watcher,
      watcher.onDidChange(scheduleRefresh),
      watcher.onDidCreate(scheduleRefresh),
      watcher.onDidDelete(scheduleRefresh),
      vscode.workspace.onDidSaveTextDocument(scheduleRefresh),
    );
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("gitLoom.executable")) {
        currentStatusSource = new TextStatusSource(getExecutable());
        provider.refresh();
      }
    }),
  );
}

export function deactivate(): void {}

import * as path from "path";
import * as vscode from "vscode";
import {
  BranchSection,
  Commit,
  CommitFile,
  LoomError,
  UpstreamInfo,
} from "../loom/model";
import { LoomStatusSource } from "../loom/statusSource";

/** Resolves the repo root to run loom/git in, or throws a LoomError to show as an error node. */
export type RepoRootResolver = () => Promise<string>;

export type WeaveNode =
  | { kind: "error"; message: string }
  | { kind: "integration"; commits: Commit[]; root: string }
  | {
      kind: "branch";
      section: BranchSection;
      stackedOnLabel?: string;
      root: string;
    }
  | { kind: "upstream"; info: UpstreamInfo }
  | { kind: "commit"; commit: Commit; branchNames: string[]; root: string }
  | { kind: "file"; commit: Commit; file: CommitFile; root: string };

export class WeaveTreeProvider implements vscode.TreeDataProvider<WeaveNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<
    void | WeaveNode | WeaveNode[] | undefined
  >();
  public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private showFiles = true;

  public constructor(
    private readonly statusSource: LoomStatusSource,
    private readonly getRepoRoot: RepoRootResolver,
  ) {}

  public refresh(): void {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  public getShowFiles(): boolean {
    return this.showFiles;
  }

  public setShowFiles(value: boolean): void {
    if (this.showFiles === value) {
      return;
    }
    this.showFiles = value;
    this.refresh();
  }

  public getTreeItem(element: WeaveNode): vscode.TreeItem {
    switch (element.kind) {
      case "error":
        return errorItem(element.message);
      case "integration":
        return integrationItem(element);
      case "branch":
        return branchItem(element);
      case "upstream":
        return upstreamItem(element.info);
      case "commit":
        return commitItem(element, this.showFiles);
      case "file":
        return fileItem(element);
    }
  }

  public async getChildren(element?: WeaveNode): Promise<WeaveNode[]> {
    if (!element) {
      return this.rootChildren();
    }
    switch (element.kind) {
      case "integration":
        return element.commits.map((commit) => ({
          kind: "commit",
          commit,
          branchNames: [],
          root: element.root,
        }));
      case "branch":
        return element.section.commits.map((commit) => ({
          kind: "commit",
          commit,
          branchNames: element.section.names.map((n) => n.name),
          root: element.root,
        }));
      case "commit":
        if (!this.showFiles) {
          return [];
        }
        return element.commit.files.map((file) => ({
          kind: "file",
          commit: element.commit,
          file,
          root: element.root,
        }));
      case "upstream":
      case "file":
      case "error":
        return [];
    }
  }

  private async rootChildren(): Promise<WeaveNode[]> {
    let root: string;
    try {
      root = await this.getRepoRoot();
    } catch (err) {
      return [{ kind: "error", message: messageOf(err) }];
    }

    try {
      const status = await this.statusSource.getStatus(root);
      const nodes: WeaveNode[] = [];

      if (status.looseCommits.length > 0) {
        nodes.push({ kind: "integration", commits: status.looseCommits, root });
      }

      status.branches.forEach((section, i) => {
        const stackedOnLabel = section.stackedOnNext
          ? status.branches[i + 1]?.names[0]?.name
          : undefined;
        nodes.push({ kind: "branch", section, stackedOnLabel, root });
      });

      if (status.upstream) {
        nodes.push({ kind: "upstream", info: status.upstream });
      }

      return nodes;
    } catch (err) {
      return [{ kind: "error", message: messageOf(err) }];
    }
  }
}

function messageOf(err: unknown): string {
  if (err instanceof LoomError || err instanceof Error) {
    return err.message;
  }
  return String(err);
}

function errorItem(message: string): vscode.TreeItem {
  const item = new vscode.TreeItem(
    message,
    vscode.TreeItemCollapsibleState.None,
  );
  item.iconPath = new vscode.ThemeIcon("warning");
  item.contextValue = "error";
  return item;
}

function integrationItem(element: { commits: Commit[] }): vscode.TreeItem {
  const item = new vscode.TreeItem(
    "Integration",
    element.commits.length > 0
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.None,
  );
  item.iconPath = new vscode.ThemeIcon("git-merge");
  item.contextValue = "integration";
  item.description = `${element.commits.length} commit${element.commits.length === 1 ? "" : "s"}`;
  return item;
}

const REMOTE_MARKER: Record<string, string> = {
  synced: "✓",
  ahead: "↑",
  gone: "✗",
};

function branchItem(element: {
  section: BranchSection;
  stackedOnLabel?: string;
}): vscode.TreeItem {
  const { section, stackedOnLabel } = element;
  const label = section.names.map((n) => n.name).join(", ");
  const hasCommits = section.commits.length > 0;
  const item = new vscode.TreeItem(
    label,
    hasCommits
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.None,
  );
  item.iconPath = new vscode.ThemeIcon("git-branch");
  item.contextValue = "branch";

  const descriptionParts: string[] = [];
  const remotes = section.names
    .map((n) => (n.remote ? REMOTE_MARKER[n.remote] : undefined))
    .filter(Boolean);
  if (remotes.length > 0) {
    descriptionParts.push(remotes.join(" "));
  }
  if (stackedOnLabel) {
    descriptionParts.push(`stacked on ${stackedOnLabel}`);
  }
  if (!hasCommits) {
    descriptionParts.push("(empty)");
  }
  item.description = descriptionParts.join("  ");
  return item;
}

function upstreamItem(info: UpstreamInfo): vscode.TreeItem {
  const item = new vscode.TreeItem(
    info.label,
    vscode.TreeItemCollapsibleState.None,
  );
  item.iconPath = new vscode.ThemeIcon("cloud");
  item.contextValue = "upstream";
  const ahead =
    info.commitsAhead > 0
      ? `⏫ ${info.commitsAhead} new commit${info.commitsAhead === 1 ? "" : "s"} · `
      : "";
  item.description = `${ahead}base ${info.baseHash} ${info.baseSubject}`;
  return item;
}

function commitItem(
  element: { commit: Commit; branchNames: string[] },
  showFiles: boolean,
): vscode.TreeItem {
  const { commit } = element;
  const item = new vscode.TreeItem(
    commit.subject,
    showFiles && commit.files.length > 0
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None,
  );
  item.iconPath = new vscode.ThemeIcon("git-commit");
  item.contextValue = "commit";
  item.description = commit.hash;
  item.tooltip = `${commit.hash} — ${commit.subject}`;
  return item;
}

function fileItem(element: {
  commit: Commit;
  file: CommitFile;
  root: string;
}): vscode.TreeItem {
  const { commit, file, root } = element;
  const resourceUri = vscode.Uri.joinPath(vscode.Uri.file(root), file.path);
  const item = new vscode.TreeItem(
    resourceUri,
    vscode.TreeItemCollapsibleState.None,
  );
  item.label = path.basename(file.path);
  const dir = path.dirname(file.path);
  item.description = dir === "." ? file.status : `${dir} · ${file.status}`;
  item.contextValue = "file";
  item.command = {
    command: "gitLoom.openFileDiff",
    title: "Open Changes",
    arguments: [root, commit.hash, file.path],
  };
  return item;
}

import * as vscode from "vscode";
import { runGit } from "./loom/runner";

export const GIT_SHOW_SCHEME = "gitloom-show";

interface ShowQuery {
  root: string;
  ref: string;
  path: string;
}

/** Builds a `gitloom-show:` URI that GitShowProvider resolves to `git show <ref>:<path>` run in `root`. */
export function gitShowUri(
  root: string,
  ref: string,
  path: string,
): vscode.Uri {
  const query: ShowQuery = { root, ref, path };
  return vscode.Uri.parse(`${GIT_SHOW_SCHEME}:/${path}`).with({
    query: JSON.stringify(query),
  });
}

/**
 * Serves the content of a file at a given git ref, so `vscode.diff` can show
 * a commit's changes without checking anything out. Returns "" when the file
 * didn't exist at that ref (added or deleted by the commit).
 */
export class GitShowProvider implements vscode.TextDocumentContentProvider {
  public async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const { root, ref, path } = JSON.parse(uri.query) as ShowQuery;
    try {
      return await runGit(["show", `${ref}:${path}`], root);
    } catch {
      return "";
    }
  }
}

/** Opens a diff for `path` as changed by commit `hash`, comparing it against its parent. */
export async function openFileDiff(
  root: string,
  hash: string,
  path: string,
): Promise<void> {
  const left = gitShowUri(root, `${hash}^`, path);
  const right = gitShowUri(root, hash, path);
  const title = `${basename(path)} (${hash})`;
  await vscode.commands.executeCommand("vscode.diff", left, right, title);
}

/**
 * Opens a diff of the working-tree `path` against HEAD — staged and unstaged changes together,
 * like loom's zz block. A file deleted from the working tree has nothing to diff against, so
 * its HEAD version opens on its own instead.
 */
export async function openWorkingTreeDiff(
  root: string,
  path: string,
): Promise<void> {
  const head = gitShowUri(root, "HEAD", path);
  const workingFile = vscode.Uri.joinPath(vscode.Uri.file(root), path);
  try {
    await vscode.workspace.fs.stat(workingFile);
  } catch {
    await vscode.commands.executeCommand("vscode.open", head);
    return;
  }
  const title = `${basename(path)} (Working Tree)`;
  await vscode.commands.executeCommand("vscode.diff", head, workingFile, title);
}

function basename(p: string): string {
  const idx = p.lastIndexOf("/");
  return idx === -1 ? p : p.slice(idx + 1);
}

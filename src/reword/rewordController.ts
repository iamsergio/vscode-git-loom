import * as vscode from "vscode";
import { runGit, runLoom } from "../loom/runner";

interface PendingReword {
  hash: string;
  root: string;
  originalMessage: string;
}

/**
 * Reword-in-an-editor-tab flow, modeled on `git commit --amend` with
 * COMMIT_EDITMSG: `reword()` opens the full message (with a `-m` this size
 * would otherwise erase the body); saving the tab applies it via
 * `git-loom reword <hash> -m <message>`, closing it without saving cancels.
 */
export class RewordController implements vscode.Disposable {
  private readonly pending = new Map<string, PendingReword>(); // key: fsPath
  private readonly disposables: vscode.Disposable[];

  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly getExecutable: () => string,
    private readonly onApplied: () => void,
  ) {
    this.disposables = [
      vscode.workspace.onDidSaveTextDocument(
        (doc) => void this.handleSave(doc),
      ),
      vscode.workspace.onDidCloseTextDocument((doc) => this.handleClose(doc)),
    ];
  }

  public dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  public async reword(
    root: string,
    hash: string,
    branchNames: string[],
  ): Promise<void> {
    for (const [fsPath, p] of this.pending) {
      if (p.hash === hash && p.root === root) {
        const doc = await vscode.workspace.openTextDocument(
          vscode.Uri.file(fsPath),
        );
        await vscode.window.showTextDocument(doc);
        return;
      }
    }

    const rawMessage = await runGit(["log", "-1", "--format=%B", hash], root);
    const originalMessage = trimTrailing(rawMessage);

    const dir = vscode.Uri.joinPath(
      this.context.globalStorageUri,
      "reword",
      hash,
    );
    await vscode.workspace.fs.createDirectory(dir);
    const fileUri = vscode.Uri.joinPath(dir, "COMMIT_EDITMSG");

    const branchLabel =
      branchNames.length > 0 ? branchNames.join(", ") : "integration";
    const header = [
      "",
      `# Rewording ${hash} (branch: ${branchLabel}).`,
      "# Save (Ctrl+S) to apply the new message. Close the tab without saving to cancel.",
      "# Lines starting with '#' are ignored. An empty message aborts.",
      "",
    ].join("\n");
    await vscode.workspace.fs.writeFile(
      fileUri,
      Buffer.from(originalMessage + header, "utf8"),
    );

    this.pending.set(fileUri.fsPath, { hash, root, originalMessage });

    const doc = await vscode.workspace.openTextDocument(fileUri);
    try {
      await vscode.languages.setTextDocumentLanguage(doc, "git-commit");
    } catch {
      // "git-commit" is contributed by the built-in Git extension; harmless if it's disabled.
    }
    await vscode.window.showTextDocument(doc);
  }

  private async handleSave(doc: vscode.TextDocument): Promise<void> {
    const pending = this.pending.get(doc.uri.fsPath);
    if (!pending) {
      return;
    }

    const message = stripCommentLines(doc.getText());
    if (message === "") {
      vscode.window.showErrorMessage("Empty message, reword aborted");
      return; // keep the tab open, nothing was lost
    }
    if (message === pending.originalMessage) {
      await this.closeTab(doc.uri);
      this.cleanup(doc.uri);
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Rewording ${pending.hash}…`,
      },
      async () => {
        try {
          const result = await runLoom(
            this.getExecutable(),
            ["reword", pending.hash, "-m", message],
            pending.root,
          );
          await this.closeTab(doc.uri);
          this.cleanup(doc.uri);
          this.onApplied();
          const summary = result.agent?.messages?.[0];
          if (summary) {
            vscode.window.setStatusBarMessage(summary, 5000);
          }
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(errorMessage);
          // Keep the tab open on failure, so the user doesn't lose their edits.
        }
      },
    );
  }

  private handleClose(doc: vscode.TextDocument): void {
    if (this.pending.has(doc.uri.fsPath)) {
      this.cleanup(doc.uri);
    }
  }

  private cleanup(uri: vscode.Uri): void {
    this.pending.delete(uri.fsPath);
    void vscode.workspace.fs
      .delete(uri, { useTrash: false })
      .then(undefined, () => undefined);
  }

  private async closeTab(uri: vscode.Uri): Promise<void> {
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (
          tab.input instanceof vscode.TabInputText &&
          tab.input.uri.fsPath === uri.fsPath
        ) {
          await vscode.window.tabGroups.close(tab);
        }
      }
    }
  }
}

function stripCommentLines(text: string): string {
  return trimTrailing(
    text
      .split(/\r?\n/)
      .filter((line) => !line.startsWith("#"))
      .join("\n"),
  );
}

function trimTrailing(text: string): string {
  return text.replace(/\s+$/, "");
}

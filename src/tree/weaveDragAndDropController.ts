import * as vscode from "vscode";
import { runLoom } from "../loom/runner";
import { buildFoldArgs, WeaveNode } from "./weaveNode";

const MIME_TYPE = "application/vnd.code.tree.gitloom.weave";

/**
 * Drag-moves commits via `git-loom fold <source...> --above <target>` (never
 * plain `fold <source> <commit>`, which fixups/squashes instead of moving).
 * Dropping on a branch (empty or not) uses `fold <source...> <branchName>`,
 * which git-loom always treats as "move to the top of that branch", not a squash.
 */
export class WeaveDragAndDropController implements vscode.TreeDragAndDropController<WeaveNode> {
  public readonly dropMimeTypes = [MIME_TYPE];
  public readonly dragMimeTypes = [MIME_TYPE];

  public constructor(
    private readonly getExecutable: () => string,
    private readonly refresh: () => void,
  ) {}

  public handleDrag(
    source: readonly WeaveNode[],
    dataTransfer: vscode.DataTransfer,
  ): void {
    if (
      source.length === 0 ||
      !source.every((node) => node.kind === "commit")
    ) {
      return;
    }
    dataTransfer.set(MIME_TYPE, new vscode.DataTransferItem(source));
  }

  public async handleDrop(
    target: WeaveNode | undefined,
    dataTransfer: vscode.DataTransfer,
  ): Promise<void> {
    const item = dataTransfer.get(MIME_TYPE);
    if (!item || !target) {
      return;
    }
    const sources = (item.value as WeaveNode[]).filter(
      (node) => node.kind === "commit",
    );
    if (sources.length === 0) {
      return;
    }

    const args = buildFoldArgs(
      sources.map((node) => node.commit.hash),
      target,
    );
    if (!args) {
      return;
    }

    try {
      await runLoom(this.getExecutable(), args, sources[0].root);
      this.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(message);
    }
  }
}

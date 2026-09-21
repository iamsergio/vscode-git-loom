/**
 * WeaveNode is the tree's data model and buildFoldArgs is the drag-move logic; neither needs
 * "vscode" and both are unit-tested with plain mocha. Keep it that way — pull in vscode here
 * and buildFoldArgs's tests get dragged into the slow @vscode/test-cli integration suite.
 */

import {
  BranchSection,
  Commit,
  CommitFile,
  LocalChange,
  UpstreamInfo,
} from "../loom/model";

export type WeaveNode =
  | { kind: "error"; message: string }
  | { kind: "localChanges"; changes: LocalChange[]; root: string }
  | { kind: "localFile"; change: LocalChange; root: string }
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

/** Builds the `fold` args moving `hashes` onto `target`, or undefined if `target` can't be dropped on. */
export function buildFoldArgs(
  hashes: string[],
  target: WeaveNode,
): string[] | undefined {
  switch (target.kind) {
    case "commit":
      if (hashes.includes(target.commit.hash)) {
        return undefined;
      }
      return ["fold", ...hashes, "--above", target.commit.hash];
    case "branch": {
      const name = target.section.names[0]?.name;
      return name ? ["fold", ...hashes, name] : undefined;
    }
    case "integration": {
      const anchor = target.commits[0];
      if (!anchor || hashes.includes(anchor.hash)) {
        return undefined;
      }
      return ["fold", ...hashes, "--above", anchor.hash];
    }
    case "localChanges":
    case "localFile":
    case "upstream":
    case "file":
    case "error":
      return undefined;
  }
}

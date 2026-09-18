/**
 * Pure data types describing a parsed `git loom status` weave.
 *
 * Nothing in this file (or elsewhere under src/loom/) may import "vscode",
 * so it stays testable with plain mocha.
 */

export type RemoteState = "synced" | "ahead" | "gone"; // ✓ ↑ ✗ ; undefined = no remote

export interface CommitFile {
  status: string; // e.g. "A", "M", "D", "R"
  path: string; // repo-relative (loom is always run from the repo root)
}

export interface Commit {
  hash: string; // abbreviated hash as printed, e.g. "81ed772". Use this as identity, never a short ID.
  subject: string;
  files: CommitFile[];
}

export interface BranchName {
  name: string;
  remote?: RemoteState;
}

export interface BranchSection {
  names: BranchName[]; // >1 when several branches point at the same tip (co-located)
  commits: Commit[]; // newest first; may be empty (empty branch)
  stackedOnNext: boolean; // true when this section sits directly on top of the next one ("││")
}

export interface UpstreamInfo {
  label: string; // e.g. "origin/main"
  baseHash: string; // e.g. "e509757"
  baseSubject: string; // e.g. "init"
  commitsAhead: number; // 0 when upstream == base
}

export interface LoomStatus {
  looseCommits: Commit[]; // commits on the integration branch that belong to no feature branch
  branches: BranchSection[]; // in loom's display order
  upstream?: UpstreamInfo;
}

/** Error thrown by the loom/ layer: message is already suitable to show to the user. */
export class LoomError extends Error {}

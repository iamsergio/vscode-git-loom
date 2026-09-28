/**
 * Converts the status graph git-loom attaches to its `--agent` JSON (the
 * `graph` field of `git-loom --agent status -f`'s `ok` object, git-loom >= 0.25)
 * into a LoomStatus. This is the only place that knows the wire shape —
 * everything else in the extension talks to LoomStatus/Commit/BranchSection.
 *
 * No "vscode" import here: this file is unit-tested with plain mocha.
 */

import {
  BranchSection,
  Commit,
  LocalChange,
  LoomError,
  LoomStatus,
  RemoteState,
} from "./model";

/** git-loom bumps this on any breaking change to the graph's shape. */
const SUPPORTED_SCHEMA = 1;

interface WireFile {
  path: string;
  index: string;
  worktree: string;
}

interface WireWorkingFile extends WireFile {
  state: "conflicted" | "tracked" | "untracked";
}

interface WireCommit {
  hash: string;
  subject: string;
  files: WireFile[];
}

interface WireBranchGroup {
  names: { name: string; remote: "synced" | "different" | "gone" | null }[];
  stacked_on: string | null;
  commits: WireCommit[];
}

interface WireGraph {
  schema: number;
  local_changes: { files: WireWorkingFile[] };
  branches: WireBranchGroup[];
  loose_commits: WireCommit[];
  upstream: {
    label: string;
    base_hash: string;
    base_subject: string;
    commits_ahead: number;
  };
}

export function parseStatusGraph(graph: unknown): LoomStatus {
  if (typeof graph !== "object" || graph === null) {
    throw new LoomError(
      "git-loom printed no status graph; git-loom >= 0.25 is required",
    );
  }
  const g = graph as WireGraph;
  if (g.schema !== SUPPORTED_SCHEMA) {
    throw new LoomError(
      `Unsupported git-loom status schema ${String(g.schema)} (expected ${SUPPORTED_SCHEMA})`,
    );
  }

  return {
    localChanges: g.local_changes.files.map(localChange),
    looseCommits: g.loose_commits.map(commit),
    branches: g.branches.map(branchSection),
    upstream: {
      label: g.upstream.label,
      baseHash: g.upstream.base_hash,
      baseSubject: g.upstream.base_subject,
      commitsAhead: g.upstream.commits_ahead,
    },
  };
}

function localChange(f: WireWorkingFile): LocalChange {
  return f.state === "untracked"
    ? { index: "?", worktree: "?", path: f.path }
    : { index: f.index, worktree: f.worktree, path: f.path };
}

function branchSection(b: WireBranchGroup): BranchSection {
  return {
    names: b.names.map((n) => ({ name: n.name, remote: mapRemote(n.remote) })),
    commits: b.commits.map(commit),
    stackedOn: b.stacked_on ?? undefined,
  };
}

function commit(c: WireCommit): Commit {
  return {
    hash: c.hash,
    subject: c.subject,
    files: c.files.map((f) => ({
      status: f.index !== " " ? f.index : f.worktree,
      path: f.path,
    })),
  };
}

function mapRemote(
  remote: WireBranchGroup["names"][number]["remote"],
): RemoteState | undefined {
  switch (remote) {
    case "synced":
      return "synced";
    case "different":
      return "ahead";
    case "gone":
      return "gone";
    default:
      return undefined;
  }
}

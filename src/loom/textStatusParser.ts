/**
 * Parses the text graph printed by `git-loom --no-color status -f` into a
 * LoomStatus. This is the only place that knows loom's output grammar —
 * everything else in the extension talks to LoomStatus/Commit/BranchSection.
 *
 * git-loom has no machine-readable status output yet (--agent only adds one
 * JSON line to stderr; see runner.ts). Once it grows one, a JsonStatusSource
 * can replace TextStatusSource (statusSource.ts) without touching anything
 * outside this file and model.ts.
 *
 * No "vscode" import here: this file is unit-tested with plain mocha against
 * the real recorded outputs in test/fixtures/status/.
 */

import {
  BranchSection,
  Commit,
  LocalChange,
  LoomStatus,
  RemoteState,
  UpstreamInfo,
} from "./model";

const ZZ_HEADER = /^╭─ \S+ \[local changes\]$/;
const ZZ_NO_CHANGES = /^│\s+no changes$/;
// "│   aa  M a.txt": short ID, then porcelain-style XY; untracked is " ⁕" instead of "??".
const ZZ_FILE = /^│\s+\S+ (.)(.) (.+)$/;
const UNTRACKED_MARKER = "⁕";
const UPSTREAM_LINE = /^● ([0-9a-f]{4,40}) \(upstream\) \[([^\]]+)\] ?(.*)$/;
const UPSTREAM_AHEAD_LINE = /^│●\s+\[([^\]]+)\] ⏫ (\d+) new commits?$/;
const UPSTREAM_BASE_LINE = /^├╯ ([0-9a-f]{4,40}) \(common base\) \S+ (.*)$/;
const BRANCH_HEADER = /^│[╭├]─ \S+ \[([^\]]+)\](?: ([✓↑✗]))?$/;
// loom's short ID leads and the hash trails the subject (e.g. "│●    ovz  feat: x 60423f0"),
// not hash-first as in older loom versions — get this backwards and commits silently vanish.
const BRANCH_COMMIT = /^│●\s+\S+\s+(.*) ([0-9a-f]{4,40})$/;
const BRANCH_FILE = /^│┊\s+\S+:\d+ (.)(.) (.+)$/;
const LOOSE_COMMIT = /^●\s+\S+\s+(.*) ([0-9a-f]{4,40})$/;
const LOOSE_FILE = /^┊\s+\S+:\d+ (.)(.) (.+)$/;

export function parseStatusText(text: string): LoomStatus {
  const localChanges: LocalChange[] = [];
  const looseCommits: Commit[] = [];
  const branches: BranchSection[] = [];
  let current: BranchSection | undefined;
  let upstream: UpstreamInfo | undefined;
  let pendingAhead: { label: string; commitsAhead: number } | undefined;
  let inZZBlock = false;

  const closeCurrent = (stackedOnNext: boolean): void => {
    if (current) {
      current.stackedOnNext = stackedOnNext;
      branches.push(current);
      current = undefined;
    }
  };

  for (const line of text.split(/\r?\n/)) {
    if (inZZBlock) {
      let zz: RegExpMatchArray | null;
      if (line === "│") {
        inZZBlock = false;
      } else if (ZZ_NO_CHANGES.test(line)) {
        // clean working tree
      } else if ((zz = line.match(ZZ_FILE))) {
        localChanges.push(
          zz[2] === UNTRACKED_MARKER
            ? { index: "?", worktree: "?", path: zz[3] }
            : { index: zz[1], worktree: zz[2], path: zz[3] },
        );
      }
      continue;
    }

    if (line === "" || line === "│") {
      continue; // blank separator between sections
    }

    let m: RegExpMatchArray | null;

    if (ZZ_HEADER.test(line)) {
      inZZBlock = true;
      continue;
    }

    if ((m = line.match(UPSTREAM_LINE))) {
      closeCurrent(false);
      upstream = {
        label: m[2],
        baseHash: m[1],
        baseSubject: m[3],
        commitsAhead: 0,
      };
      continue;
    }

    if ((m = line.match(UPSTREAM_AHEAD_LINE))) {
      pendingAhead = { label: m[1], commitsAhead: Number(m[2]) };
      continue;
    }

    if ((m = line.match(UPSTREAM_BASE_LINE))) {
      if (pendingAhead) {
        upstream = {
          label: pendingAhead.label,
          commitsAhead: pendingAhead.commitsAhead,
          baseHash: m[1],
          baseSubject: m[2],
        };
        pendingAhead = undefined;
      }
      continue;
    }

    if ((m = line.match(BRANCH_HEADER))) {
      const name = m[1];
      const remote = mapRemote(m[2]);
      if (current && current.commits.length === 0) {
        // Co-located: another branch name pointing at the same tip, no commit in between.
        current.names.push({ name, remote });
      } else {
        closeCurrent(false);
        current = {
          names: [{ name, remote }],
          commits: [],
          stackedOnNext: false,
        };
      }
      continue;
    }

    if ((m = line.match(BRANCH_COMMIT))) {
      current?.commits.push({ hash: m[2], subject: m[1], files: [] });
      continue;
    }

    if ((m = line.match(BRANCH_FILE))) {
      const commit = current?.commits[current.commits.length - 1];
      commit?.files.push({ status: firstNonSpace(m[1], m[2]), path: m[3] });
      continue;
    }

    if ((m = line.match(LOOSE_COMMIT))) {
      looseCommits.push({ hash: m[2], subject: m[1], files: [] });
      continue;
    }

    if ((m = line.match(LOOSE_FILE))) {
      const commit = looseCommits[looseCommits.length - 1];
      commit?.files.push({ status: firstNonSpace(m[1], m[2]), path: m[3] });
      continue;
    }

    if (line === "││") {
      closeCurrent(true);
      continue;
    }

    if (line === "├╯") {
      closeCurrent(false);
      continue;
    }

    if (line.startsWith("· ")) {
      continue; // context commit below the base, ignored
    }

    // Unrecognized line: ignore. Loom's output evolves; be lenient rather than throwing.
  }

  closeCurrent(false); // safety net in case a section was left open

  return { localChanges, looseCommits, branches, upstream };
}

function firstNonSpace(a: string, b: string): string {
  if (a !== " ") {
    return a;
  }
  if (b !== " ") {
    return b;
  }
  return a;
}

function mapRemote(marker: string | undefined): RemoteState | undefined {
  switch (marker) {
    case "✓":
      return "synced";
    case "↑":
      return "ahead";
    case "✗":
      return "gone";
    default:
      return undefined;
  }
}

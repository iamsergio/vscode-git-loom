/**
 * Spawns `git-loom` / `git` and parses the one-line --agent JSON status that
 * git-loom prints as the last line of stderr.
 *
 * No "vscode" import here: pure Node child_process, unit-testable directly.
 */

import { execFile } from "child_process";
import { LoomError } from "./model";

export interface AgentStatus {
  status: "ok" | "error" | "needs_input" | "needs_confirmation" | "paused";
  message?: string;
  messages?: string[];
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  agent?: AgentStatus;
}

const MAX_BUFFER = 32 * 1024 * 1024;

/** Extracts and parses the last non-empty line of `stderr` as an AgentStatus, if it looks like one. */
export function parseAgentLine(stderr: string): AgentStatus | undefined {
  const lines = stderr.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line === "") {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(line);
      if (isAgentStatus(parsed)) {
        return parsed;
      }
    } catch {
      // Not JSON: the last non-empty stderr line isn't an agent status. Give up.
    }
    return undefined;
  }
  return undefined;
}

function isAgentStatus(value: unknown): value is AgentStatus {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const status = (value as { status?: unknown }).status;
  return (
    status === "ok" ||
    status === "error" ||
    status === "needs_input" ||
    status === "needs_confirmation" ||
    status === "paused"
  );
}

function run(
  executable: string,
  args: string[],
  cwd: string,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      args,
      { cwd, maxBuffer: MAX_BUFFER },
      (error, stdout, stderr) => {
        if (error && (error as NodeJS.ErrnoException).code === "ENOENT") {
          reject(
            new LoomError(
              `'${executable}' was not found on PATH. Install git-loom: https://github.com/narnaud/git-loom`,
            ),
          );
          return;
        }
        const exitCode =
          typeof error?.code === "number" ? error.code : error ? 1 : 0;
        resolve({ stdout, stderr, exitCode, agent: parseAgentLine(stderr) });
      },
    );
  });
}

/**
 * All loom invocations are serialized through this queue, so a background
 * refresh (triggered by a file watcher) can never race a reword.
 */
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task, task);
  queue = result.catch(() => undefined);
  return result;
}

/**
 * Runs `git-loom --agent <args>` in `cwd` and returns the result. Throws a
 * LoomError when the process fails to start, exits non-zero, or the agent
 * JSON reports anything other than "ok" or "paused".
 */
export function runLoom(
  executable: string,
  args: string[],
  cwd: string,
): Promise<RunResult> {
  return enqueue(async () => {
    const result = await run(executable, ["--agent", ...args], cwd);
    if (
      result.exitCode !== 0 ||
      (result.agent && result.agent.status === "error")
    ) {
      throw new LoomError(
        result.agent?.message ?? (result.stderr.trim() || "git-loom failed"),
      );
    }
    if (
      result.agent &&
      (result.agent.status === "needs_input" ||
        result.agent.status === "needs_confirmation")
    ) {
      throw new LoomError(result.agent.message ?? "git-loom needs more input");
    }
    return result;
  });
}

/** Runs plain `git` in `cwd`. Throws a LoomError with stderr on failure. */
export async function runGit(args: string[], cwd: string): Promise<string> {
  const result = await run("git", args, cwd);
  if (result.exitCode !== 0) {
    throw new LoomError(result.stderr.trim() || `git ${args.join(" ")} failed`);
  }
  return result.stdout;
}

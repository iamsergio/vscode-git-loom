/**
 * The seam between "how we learn the weave's shape" (today: parsing text)
 * and everything that consumes it (today: TextStatusSource; tomorrow,
 * possibly a JsonStatusSource once git-loom grows a machine-readable
 * `status` output). Nothing outside this file may know that text parsing is
 * involved.
 */

import { LoomStatus } from "./model";
import { runLoom } from "./runner";
import { parseStatusText } from "./textStatusParser";

export interface LoomStatusSource {
  /** Throws a LoomError on failure (not a loom repo, loom not installed, etc). */
  getStatus(repoRoot: string): Promise<LoomStatus>;
}

export class TextStatusSource implements LoomStatusSource {
  public constructor(private readonly executable: string) {}

  public async getStatus(repoRoot: string): Promise<LoomStatus> {
    // -f must be last: it consumes any following bare arguments as commit filters.
    const result = await runLoom(
      this.executable,
      ["--no-color", "status", "-f"],
      repoRoot,
    );
    return parseStatusText(result.stdout);
  }
}

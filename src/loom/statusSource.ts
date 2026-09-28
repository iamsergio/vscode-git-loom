/**
 * The seam between "how we learn the weave's shape" (the JSON graph git-loom's
 * `--agent status` prints) and everything that consumes it. Nothing outside
 * this file and jsonStatusParser.ts may know the wire format.
 */

import { parseStatusGraph } from "./jsonStatusParser";
import { LoomStatus } from "./model";
import { runLoom } from "./runner";

export interface LoomStatusSource {
  /** Throws a LoomError on failure (not a loom repo, loom not installed, etc). */
  getStatus(repoRoot: string): Promise<LoomStatus>;
}

export class JsonStatusSource implements LoomStatusSource {
  public constructor(private readonly executable: string) {}

  public async getStatus(repoRoot: string): Promise<LoomStatus> {
    // -f must be last: it consumes any following bare arguments as commit filters.
    const result = await runLoom(this.executable, ["status", "-f"], repoRoot);
    return parseStatusGraph(result.agent?.graph);
  }
}

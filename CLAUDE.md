# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Git Loom is a VS Code extension that shows a [git-loom](https://github.com/narnaud/git-loom) weave
in a sidebar tree view and drives loom mutations (reword, drop, branch new/merge/unmerge, absorb,
update, …) from it. Reword is the one flow that opens an editor tab (full message editing, like
`git commit --amend`); everything else is a direct `git-loom <subcommand>` call followed by a tree
refresh. No webview. See `PLAN.md` for the original design.

## Architecture

`src/loom/` is the seam. **Nothing under `src/loom/` may `import "vscode"`** — it must stay
unit-testable with plain mocha (`npm run test:unit`), independent of the VS Code test host.

- `model.ts` — plain data types (`LoomStatus`, `BranchSection`, `Commit`, …), `LoomError`.
- `runner.ts` — spawns `git-loom` / `git`, parses the one-line `--agent` JSON status git-loom
  prints as the last line of stderr. All loom calls are serialized through one queue so a
  background refresh can't race a reword.
- `textStatusParser.ts` — parses the text graph from `git-loom --no-color status -f` into a
  `LoomStatus`. git-loom has **no machine-readable status output yet**; this is the one place
  that knows its output grammar. Tested against real recorded outputs in
  `test/fixtures/status/*.txt`.
- `statusSource.ts` — `LoomStatusSource` interface + `TextStatusSource`. Everything outside
  `loom/` talks to `LoomStatusSource`, never to the parser directly, so a future
  `JsonStatusSource` (once git-loom grows one) can replace it without touching the tree or UI.

**Identify commits by their abbreviated hash, never by loom's short IDs** (`fa`, `81`, …) — those
are reallocated whenever other entities appear in the weave and are not stable across calls.

`src/tree/weaveTreeProvider.ts`, `src/tree/weaveDragAndDropController.ts`,
`src/reword/rewordController.ts`, `src/gitShowProvider.ts`, and `src/extension.ts` are the VS
Code-facing layer (tree data provider, drag-and-drop-to-move-commits, the reword-in-a-tab flow,
the diff content provider, and activation wiring). `weaveDragAndDropController.ts` moves commits
by dragging: it only accepts drags where every source is a `commit` node, and always moves via
`git-loom fold <source...> --above <target>` (or `fold <source...> <branchName>` when dropped on
a branch) — never plain `fold <source> <commit>`, which fixups/squashes instead of moving. Reword
is the only command with a dedicated controller; every other `gitLoom.*` command (drop, branch
new/merge/unmerge, absorb, update, copy hash/branch name, hide/show files) is registered inline in
`extension.ts` as a thin `runLoom(...)` call plus `provider.refresh()`, wrapped to show
`LoomError`/thrown messages via `vscode.window.showErrorMessage`. Follow that same shape for new
commands rather than adding
another controller class.

`extension.ts` also owns background refresh: a `FileSystemWatcher` on
`.git/{HEAD,index,refs/**,packed-refs}` plus `onDidSaveTextDocument` schedule a debounced
`provider.refresh()` (`REFRESH_DEBOUNCE_MS`), skipped while the tree view isn't visible and
caught up on when it becomes visible again.

## Commands

```bash
npm run watch                # recompile on change
npm run lint                 # ESLint, zero warnings allowed
npm run format:check         # Prettier
npm run format:fix

npm run test:unit            # loom/ parser + runner tests, no VS Code needed
npm test                     # VS Code integration tests (@vscode/test-cli)
./test.sh                    # both of the above; wraps in xvfb-run if no $DISPLAY

./build_package.sh           # lint + format:check + compile + vsce package
./run_manual_test.sh         # packages, builds a scratch git-loom repo, opens VS Code against it
```

Run `./test.sh` before considering a change done.

## Conventions

- **Conventional commits**: `feat:`, `fix:`, `chore:`, `ci:`, `test:`, `docs:`, `refactor:`
  (enforced by `.pre-commit-config.yaml`).
- **Releases**: `release-please` (`.github/workflows/release-please.yml`); merge the release PR
  to bump the version and tag.
- **Publishing**: `.github/workflows/package.yml` builds and uploads the `.vsix` to the GitHub
  release on `release: created`.
- This is a personal project (`iamsergio`), not a KDAB one — no KDAB SPDX headers, no KDAB
  branding.

# Git Loom

A VS Code extension that shows a [git-loom](https://github.com/narnaud/git-loom) weave
in its own sidebar view, and lets you reword commits without leaving the editor.

## What it does

- Adds a **Git Loom** section to the Activity Bar (next to Explorer, Source Control, Testing, …)
  with a tree view of the weave.
- The tree mirrors `git loom status`: loose commits on the integration branch, then one node
  per feature branch (co-located and stacked branches are grouped the same way loom shows them),
  each with its commits and the files each commit touched, then the upstream base.
- Click a file to open its diff.
- Reword a commit (inline icon or right-click ▸ Reword…): opens the full commit message in an
  editor tab, like `git commit --amend`. Save (`Ctrl+S`) to apply it, close the tab without
  saving to cancel.

This is a v1: browsing and rewording only. No webview, no commit/fold/drop/push, no branch
rename yet.

## Requirements

- [git-loom](https://github.com/narnaud/git-loom) `>= 0.23` on your `PATH`, or point
  `gitLoom.executable` at it.
- A repository set up with `git loom init`.

## Settings

| Setting | Default | Description |
|---|---|---|
| `gitLoom.executable` | `git-loom` | Path to the git-loom executable. |

## Development

```bash
npm install
npm run watch      # recompile on change

npm run lint                # ESLint, zero warnings
npm run format:check        # Prettier
npm run format:fix

./test.sh                   # unit tests, then the VS Code integration tests
./build_package.sh          # produces vscode-git-loom-*.vsix
./run_manual_test.sh        # packages, sets up a scratch loom repo, opens VS Code against it
```

`src/loom/` (the status parser, the loom/git runner, the `LoomStatusSource` interface) has no
`vscode` import, so it's unit-testable with plain mocha (`npm run test:unit`) against the real
recorded outputs in `test/fixtures/status/`.

git-loom has no machine-readable `status` output yet, so the tree is built by parsing its text
graph (`textStatusParser.ts`). That parsing is isolated behind `LoomStatusSource`
(`statusSource.ts`), so a JSON-based source can replace it later without touching the tree or UI.

## Releases

Managed by [release-please](https://github.com/googleapis/release-please) — merge the release PR
to bump the version and tag. `.github/workflows/package.yml` then builds and uploads the `.vsix`
to the GitHub release.

## License

MIT, see [LICENSE](LICENSE).

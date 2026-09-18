# vscode-git-loom — implementation plan (v0.1)

A VS Code extension that shows a [git-loom](https://github.com/narnaud/git-loom)
weave in its own Activity Bar container (next to Explorer, Source Control, Testing, …)
and lets the user **reword commits**. There is no webview, only a `TreeView`.

- Repo: `github.com/iamsergio/vscode-git-loom` (personal, **not KDAB**)
- `publisher`: `iamsergio`, `name`: `vscode-git-loom`, `displayName`: `Git Loom`
- License: MIT, copyright "Sergio Martins". Do **not** copy KDAB SPDX headers or the
  `kdab.png` icon. Where the reference repos have `SPDX-FileCopyrightText: … KDAB …`, use
  `SPDX-FileCopyrightText: 2026 Sergio Martins` instead.
- Tested against `git-loom 0.23.0`.

## Out of scope for v1

Anything that isn't "see the tree" or "reword a commit". That means no local-changes (`zz`) node,
no branch rename, no commit/fold/drop/push, no webview, and only one repo (the first workspace folder).

---

## 0. Reference material (read these first)

Copy the tooling from the sibling extension **`/pub_data/sources/kdab/products/vscode-qttest`**
and adapt it. Where the two repos differ, `/pub_data/sources/kdab/products/vscode-dap` is a second example.

| File | Action |
|---|---|
| `.codespellrc`, `.gitignore`, `.pre-commit-config.yaml`, `.prettierignore`, `.prettierrc` | copy; drop the CMake/Qt-specific lines from `.gitignore` |
| `.vscodeignore` | copy and adapt: also exclude `test/`, `scripts/`, `PLAN.md`, `media/*.png` sources if any |
| `.release-please-manifest.json` | `{ ".": "0.1.0" }` |
| `release-please-config.json` | copy; set `bump-minor-pre-major: true` |
| `.vscode-test.js` | new content, see §6 |
| `eslint.config.mjs`, `tsconfig.json`, `tsconfig.test.json` | copy; remove the `qttest-utils` exclude |
| `build_package.sh`, `run_manual_test.sh`, `test.sh`, `upload_package.sh` | rewrite for this project, see §7. Keep them at the **repo root**, as qttest does |
| `.github/workflows/{build,lints,package,pre-commit,release-please}.yml` | copy and adapt, see §8. Drop `qttest-utils.yml` |

git-loom's source is at `/pub_data/sources/git-loom`. The status renderer is
`src/core/graph.rs` (`render_branch`, `render_loose`, `render_upstream`, `render_working_changes`),
and it is the ground truth for the text grammar in §3.

---

## 1. Key facts about git-loom (verified with 0.23.0)

1. **git-loom has no JSON status output yet.** `--agent` does *not* make `status` output
   machine-readable; it only adds one JSON status line at the end of **stderr**.
   So we parse the text graph, and that parser **must stay isolated behind an interface**
   (§2), so we can switch to JSON once git-loom supports it.
2. Invoke the binary directly as `git-loom` (configurable). Global flags go **before** the
   subcommand: `git-loom --no-color status -f`. (`git-loom status -f --no-color` fails
   because `-f` takes the following arguments as its own values.) Output is uncolored when stdout is piped, but pass
   `--no-color` anyway.
3. The graph goes to **stdout**. With `--agent`, the **last line of stderr** is JSON:
   `{"status":"ok"|"error"|"needs_input"|"needs_confirmation"|"paused", "message"?: string, "messages"?: string[]}`.
   The exit codes are 0 for ok/paused, 1 for error, 10 for needs_*, and 2 for a CLI usage error (no JSON).
   Pass `--agent` to **every** invocation, and parse the last non-empty stderr line as JSON.
4. Errors seen:
   - not a git repo: `could not find repository at '…'`
   - a git repo that isn't set up for loom: `Branch 'master' has no upstream tracking branch …`
   Show the `message` from the JSON as-is.
5. **Short IDs (`fa`, `81`, …) are NOT stable.** They get reallocated when other entities appear
   (e.g. file `aa` became `aa1` after a branch `aa` was created). **Never store or pass short
   IDs.** Identify commits by the 7-char abbreviated hash printed on each commit line. That hash is
   accepted by `git-loom reword <hash>`.
6. **Reword:** `git-loom reword <hash> -m "<full message>" --agent`. `-m` replaces the **whole**
   message, including the body. Multi-line messages work; pass them as one argv element. Reword
   rewrites history, so all the descendant hashes change afterwards. Always refresh the tree when it finishes.
7. File paths in `status -f` are shown **relative to the process cwd**, so always run loom with
   `cwd = repo toplevel` (from `git rev-parse --show-toplevel`).

---

## 2. Architecture

```
src/
  extension.ts                 activate/deactivate: wiring only
  loom/
    model.ts                   pure data types (no vscode import)
    runner.ts                  spawns git-loom / git, parses the --agent JSON line (no vscode import)
    statusSource.ts            interface LoomStatusSource + TextStatusSource (no vscode import)
    textStatusParser.ts        parseStatusText(text): LoomStatus  — PURE, no vscode, no I/O
  tree/
    weaveTreeProvider.ts       vscode.TreeDataProvider<WeaveNode>
  reword/
    rewordController.ts        editor-tab reword flow
  gitShowProvider.ts           TextDocumentContentProvider for file diffs
  test/
    unit/textStatusParser.test.ts     plain mocha, no VS Code
    unit/runner.test.ts               plain mocha (agent-JSON parsing helper)
    integration/smoke.test.ts         @vscode/test-cli
test/fixtures/status/*.txt     real outputs of `git-loom --no-color status -f` (ALREADY CREATED, see §3)
media/loom.svg                 activity bar icon
```

Everything under `loom/` must not import `vscode`, so it can be unit-tested with plain mocha.

### 2.1 `model.ts`

```ts
export type RemoteState = "synced" | "ahead" | "gone"; // ✓ ↑ ✗ ; undefined = no remote

export interface CommitFile {
  status: string; // e.g. "A", "M", "D", "R" (first non-space char of the 2-char status field)
  path: string; // repo-relative (loom was run from the repo root)
}

export interface Commit {
  hash: string; // abbreviated hash as printed, e.g. "81ed772". Use this as identity.
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
  stackedOnNext: boolean; // true when the section is followed by "││" (this branch sits on top of the next section)
}

export interface UpstreamInfo {
  label: string; // "origin/main"
  baseHash: string; // "e509757"
  baseSubject: string; // "init"
  commitsAhead: number; // 0 when upstream == base
}

export interface LoomStatus {
  looseCommits: Commit[]; // commits on the integration branch that belong to no feature branch
  branches: BranchSection[]; // in loom's display order
  upstream?: UpstreamInfo;
}
```

### 2.2 `statusSource.ts` (the swappable seam)

```ts
export interface LoomStatusSource {
  getStatus(repoRoot: string): Promise<LoomStatus>; // throws LoomError(message) on failure
}
export class TextStatusSource implements LoomStatusSource {
  /* runs `git-loom --no-color --agent status -f`, checks agent JSON, returns parseStatusText(stdout) */
}
```

Later, a `JsonStatusSource` will implement the same interface. Nothing outside `loom/`
may know that text parsing is involved.

### 2.3 `runner.ts`

- `runLoom(args: string[], cwd: string): Promise<{stdout, stderr, exitCode, agent?: AgentStatus}>`
  uses `child_process.execFile(loomPath, ["--agent", ...args], {cwd, maxBuffer: 32MB})`, with **no shell**.
  (`--agent` also works as a global flag before the subcommand. Verified: `git-loom --no-color --agent status -f`.
  Always put `-f` **last**.)
- `parseAgentLine(stderr): AgentStatus | undefined` takes the last non-empty line, `JSON.parse` in try/catch.
  Export it and unit-test it.
- `runGit(args, cwd)` is the same thing for `git` (used for `rev-parse --show-toplevel`, `log -1 --format=%B`, `show`).
- **Serialize** all loom calls through a simple promise queue, so a watcher-triggered refresh can't
  run while a reword is in progress.
- Treat the call as failed if `exitCode !== 0`, or if `agent?.status` is not `"ok"`. The error text is
  `agent?.message ?? stderr.trim()`. Handle `ENOENT` (loom is not installed) with a clear message that
  links to https://github.com/narnaud/git-loom.

---

## 3. Text grammar (`textStatusParser.ts`)

Real fixtures are already in `test/fixtures/status/`:
`simple.txt`, `stacked-colocated.txt`, `upstream-ahead.txt`, `empty-branch.txt`, `clean.txt`.
They came from a scratch repo with git-loom 0.23.0. Here is `stacked-colocated.txt`:

```
╭─ zz [local changes]
│   aa1  M a.txt
│   lo  ⁕ loose.txt
│
●    c9a0ec2 chore: loose commit on integration
┊       c9:0 A  l.txt
│
│╭─ aa [feat-a-stack]
│●    81ed772 feat: stacked on a
│┊      81:0 A  s.txt
├╯
│
│╭─ fc [feat-c]
│●    3143c55 feat: c
│┊      31:0 A  c.txt
├╯
│
│╭─ fs [feat-stack]
│●    cd80931 feat: on top of a
│┊      cd:0 A  t.txt
││
│├─ ea [feat-a-alias]
│├─ fa [feat-a]
│●    162a27a feat: more a
│┊      16:0 A  b.txt
│●    b00f4f5 feat: add a (reworded)
│┊      b0:0 A  a.txt
├╯
│
● e509757 (upstream) [origin/main] init
```

The upstream variant, when upstream has moved past the base (`upstream-ahead.txt`), looks like this:

```
│●  [origin/main] ⏫ 1 new commit
├╯ e509757 (common base) 2026-09-18 init
```

A branch with a remote shows `│╭─ fc [feat-c] ✓` (also `↑` for ahead and `✗` for gone). An empty branch looks like this:

```
│╭─ eo [empty-one]
├╯
```

### Line rules

Classify each line by its **prefix**. Use regexes, and anchor them at the start of the line.
The short-id token is `[0-9a-z]+(?::\d+)?`, and loom **underlines** it only when colored, so it's plain with `--no-color`.

| Regex (JS, `u` flag) | Meaning |
|---|---|
| `^╭─ \S+ \[local changes\]$` | start of the working-changes block. **Skip** every line until the first empty-graph line `^│$`. |
| `^│[╭├]─ \S+ \[(.+?)\](?: ([✓↑✗]))?$` | branch header. See the section logic below. |
| `^│●\s+([0-9a-f]{4,40}) (.*)$` | commit inside a branch section |
| `^│┊\s+\S+:\d+ (.)(.) (.+)$` | file of the preceding branch commit: status = first non-space of the two chars, path = group 3 |
| `^●\s+([0-9a-f]{4,40}) (.*)$` | loose (integration) commit, **but** `^● [0-9a-f]+ \(upstream\) \[(.+?)\] ?(.*)$` must be checked **first** (upstream line, commitsAhead 0) |
| `^┊\s+\S+:\d+ (.)(.) (.+)$` | file of the preceding loose commit |
| `^││$` | ends the current branch section with `stackedOnNext = true` |
| `^├╯$` | ends the current branch section with `stackedOnNext = false` |
| `^│●\s+\[(.+?)\] ⏫ (\d+) new commits?$` | upstream label + commitsAhead |
| `^├╯ ([0-9a-f]+) \(common base\) \S+ (.*)$` | base hash + subject (pairs with the previous row) |
| `^· ` | context commit below the base. Ignore it. |
| `^│$`, empty line | separator. Ignore it. |
| anything else | ignore it, and record it in a `warnings: string[]` returned in debug builds (optional) |

**Branch section logic.** Keep a `current: BranchSection | undefined`.
- For a header line: if `current` exists **and has no commits yet**, push the name to `current.names`
  (co-located branches: `│├─ ea` followed by `│├─ fa`, with no commit between them). Otherwise start
  a new section. (A `│├─` right after `││` is a new *stacked* section, and it takes this path because the
  previous section was closed by `││`.)
- A commit line appends to `current.commits`. A file line appends to the last commit.
- `││` or `├╯` closes `current` and pushes it to `branches`.

**Mandatory unit tests** (mocha `tdd` ui, one per fixture):
- `simple.txt`: 1 loose commit, 3 branches, upstream `origin/main` with 0 ahead, zz skipped
  (so file `a.txt` from local changes is **not** in any commit)
- `stacked-colocated.txt`: section `feat-stack` has `stackedOnNext=true`; the next section has
  names `[feat-a-alias, feat-a]` and 2 commits `162a27a`, `b00f4f5`; files are attached correctly
- `upstream-ahead.txt`: `commitsAhead === 1`, `baseHash === "e509757"`, `baseSubject === "init"`
- `empty-branch.txt`: section `empty-one` with 0 commits
- `clean.txt`: "no changes" inside zz is skipped
- a remote marker `✓` → `remote: "synced"` (write an inline string test)
- a subject that contains `[brackets]` and `●` is preserved verbatim

To regenerate fixtures later, add `test/fixtures/make_fixtures.sh`. It creates a bare
`origin.git` plus a clone in a temp dir, runs `git loom init`, then `git loom commit -b <branch> -m … <file>`
for a few branches, `git loom branch new <name> -t <branch>` for co-located/stacked, a raw
`git commit` for a loose commit, and a push from a second clone for "upstream ahead". Finally it dumps
`git-loom --no-color status -f` into each fixture. This is nice-to-have, not required for v1.

---

## 4. UI

### 4.1 `package.json` contributes

```jsonc
"engines": { "vscode": "^1.90.0" },
"activationEvents": [],            // views auto-activate
"main": "./out/extension.js",
"contributes": {
  "viewsContainers": {
    "activitybar": [{ "id": "gitLoom", "title": "Git Loom", "icon": "media/loom.svg" }]
  },
  "views": {
    "gitLoom": [{ "id": "gitLoom.weave", "name": "Weave" }]
  },
  "viewsWelcome": [
    { "view": "gitLoom.weave", "contents": "Open a folder that contains a git-loom repository.", "when": "workbenchState == empty" }
  ],
  "commands": [
    { "command": "gitLoom.refresh", "title": "Refresh", "icon": "$(refresh)", "category": "Git Loom" },
    { "command": "gitLoom.reword",  "title": "Reword…", "icon": "$(edit)",    "category": "Git Loom" },
    { "command": "gitLoom.openFileDiff", "title": "Open Changes", "category": "Git Loom" }
  ],
  "menus": {
    "view/title":        [{ "command": "gitLoom.refresh", "when": "view == gitLoom.weave", "group": "navigation" }],
    "view/item/context": [
      { "command": "gitLoom.reword", "when": "view == gitLoom.weave && viewItem == commit", "group": "inline" },
      { "command": "gitLoom.reword", "when": "view == gitLoom.weave && viewItem == commit", "group": "1_modify" }
    ],
    "commandPalette": [
      { "command": "gitLoom.reword", "when": "false" },
      { "command": "gitLoom.openFileDiff", "when": "false" }
    ]
  },
  "configuration": {
    "title": "Git Loom",
    "properties": {
      "gitLoom.executable": { "type": "string", "default": "git-loom", "description": "Path to the git-loom executable." }
    }
  }
}
```

`media/loom.svg`: a simple monochrome 24×24 icon using `fill="currentColor"`/`stroke="currentColor"`
(e.g. three vertical warp threads crossed by a wavy weft line). The Activity Bar needs a monochrome SVG.

### 4.2 Tree (`weaveTreeProvider.ts`)

The top level follows loom's display order:

1. **Loose commits**, if any: one collapsible group node `Integration` (icon `$(git-merge)`), with its commits as children.
2. **One node per `BranchSection`**:
   - label: the branch names joined with `, ` (e.g. `feat-a-alias, feat-a`)
   - icon: `$(git-branch)`
   - description: the remote marker (`✓` synced, `↑` ahead, `✗` gone). If `stackedOnNext`, add
     `stacked on <first name of next section>`. If there are no commits, `(empty)`.
   - `contextValue = "branch"`, expanded by default (`TreeItemCollapsibleState.Expanded`), leaf if empty
3. **Upstream node** (leaf): label = `upstream.label`, icon `$(cloud)`; description = `base <baseHash> <baseSubject>`,
   prefixed with `⏫ N new commit(s) · ` when `commitsAhead > 0`.

**Commit node:** label = subject, description = hash, icon `$(git-commit)`,
tooltip = `hash — subject`, `contextValue = "commit"`, collapsed if it has files, otherwise none.
Store `hash` on the node. Selecting a commit does nothing in v1.

**File node:** `resourceUri = Uri.joinPath(repoRootUri, path)` (so the file icon theme applies),
label = basename, description = `dirname · status`, `contextValue = "file"`,
`command = gitLoom.openFileDiff(hash, path, status)`.

**Error state:** if `getStatus` throws, show one leaf node with label = the error message and
icon `$(warning)`. If git-loom is not found, show the install hint.

Use `onDidChangeTreeData` with a full refresh (fire `undefined`). The tree is small.

### 4.3 File diff (`gitShowProvider.ts`)

Register a `TextDocumentContentProvider` for the scheme `gitloom-show`. It serves the URI
`gitloom-show:/<path>?<json {root, ref, path}>` by running `git show <ref>:<path>` in `root`,
and it returns `""` when that fails (the file was added or deleted).
`openFileDiff(hash, path, status)` runs
`vscode.commands.executeCommand("vscode.diff", left, right, "<basename> (<hash>)")`
with left = `ref: hash + "^"` and right = `ref: hash`.
Keep the real file path as the URI path, so language detection works.

### 4.4 Repo root and refresh

- On activation, get `workspace.workspaceFolders?.[0]`, then run `git rev-parse --show-toplevel`
  there to find the root. If there's no folder or git fails, show the error node.
- Refresh triggers:
  - the `gitLoom.refresh` command
  - when a reword finishes
  - a `FileSystemWatcher` on `new RelativePattern(root, ".git/{HEAD,index,refs/**,packed-refs}")`
    (create/change/delete), plus `onDidSaveTextDocument`. **Debounce to 500 ms.**
  - `workspace.onDidChangeConfiguration("gitLoom.executable")`
- Don't refresh while the view is hidden. Check `treeView.visible`, and refresh on
  `onDidChangeVisibility` when it becomes visible and data is stale.

---

## 5. Reword in an editor tab (`rewordController.ts`)

This works like `git commit --amend` with `COMMIT_EDITMSG`.

1. The command `gitLoom.reword(node)` is called with a commit node (from the inline icon or the context menu).
2. Read the full message with `git log -1 --format=%B <hash>`, in the repo root.
3. Write it to `<context.globalStorageUri>/reword/<hash>/COMMIT_EDITMSG` (create the dirs with
   `workspace.fs`), with these comment lines appended:
   ```
   # Rewording <hash> (branch: <branch names or "integration">).
   # Save (Ctrl+S) to apply the new message. Close the tab without saving to cancel.
   # Lines starting with '#' are ignored. An empty message aborts.
   ```
4. Open it with `window.showTextDocument`, and call `languages.setTextDocumentLanguage(doc, "git-commit")`
   (the built-in Git extension provides this language, so you get the subject-length ruler/highlighting; ignore failures).
5. Keep a `Map<string /*fsPath*/, {hash, root}>` of pending rewords. On `workspace.onDidSaveTextDocument`,
   if the doc is pending:
   - message = the lines without `#` lines, with trailing whitespace trimmed and the result trimmed at the end
   - empty → `showErrorMessage("Empty message, reword aborted")` and keep the tab open
   - unchanged from the original → close the tab and do nothing else
   - otherwise → `runLoom(["reword", hash, "-m", message], root)` inside
     `window.withProgress({location: ProgressLocation.Notification or SourceControl})`
     - on ok: close the tab, delete the temp file, drop the map entry, refresh the tree, and show
       the loom `messages[0]` in the status bar for 5s (`setStatusBarMessage`)
     - on error: `showErrorMessage(message)` and keep the tab open, so the user doesn't lose the text
6. On `workspace.onDidCloseTextDocument` for a pending doc: drop the entry and delete the temp file.
7. Closing a tab programmatically: find it in `window.tabGroups.all.flatMap(g => g.tabs)` where
   `tab.input instanceof TabInputText && tab.input.uri.fsPath === fsPath`, then `window.tabGroups.close(tab)`.
8. If a reword for the same hash is already open, just reveal that editor.

Edge: a tree refresh while the tab is open doesn't matter, because the hash stays valid until
some other rewrite happens. If loom then fails with "not found", show its message.

---

## 6. Tests

`package.json` scripts, based on qttest:
```jsonc
"compile": "tsc -p ./",
"watch": "tsc -watch -p ./",
"pretest": "tsc -p tsconfig.test.json && npm run lint",
"lint": "eslint src/ --max-warnings 0",
"test": "vscode-test",
"test:unit": "tsc -p tsconfig.test.json && mocha --ui tdd 'out/test/unit/**/*.test.js'",
"format:check": "prettier --check \"src/**/*.ts\"",
"format:fix": "prettier --write \"src/**/*.ts\""
```
devDependencies: the same packages and versions as in vscode-qttest's `package.json` (`@types/mocha`, `@types/node`,
`@types/vscode ^1.90.0`, `@vscode/test-cli`, `@vscode/test-electron`, `eslint`, `mocha`, `prettier`,
`typescript`, `typescript-eslint`). There are **no runtime dependencies.**

Unit tests (`src/test/unit/`) read fixtures via
`path.join(__dirname, "../../../test/fixtures/status", name)`. `__dirname` is `out/test/unit`, so
verify that path.

`.vscode-test.js`:
```js
const { defineConfig } = require("@vscode/test-cli");
module.exports = defineConfig([
  { files: "out/test/integration/smoke.test.js", mocha: { timeout: 60000, ui: "tdd" } },
]);
```

`smoke.test.ts`:
- the extension is present and activates (`extensions.getExtension("iamsergio.vscode-git-loom")`)
- `gitLoom.refresh` is registered (`commands.getCommands(true)`)
- if `git-loom` is on PATH: create a temp loom repo in `os.tmpdir()` (bare origin + clone +
  `git loom init` + two `git loom commit -b`) and feed it to `TextStatusSource` directly. Assert that
  there are 2 branches. Then call `runLoom(["reword", hash, "-m", "new subject\n\nbody"])` and check it with
  `git log -1 --format=%B`. Skip this with `this.skip()` if git-loom is missing.

---

## 7. Shell scripts (repo root, `#!/bin/bash`, `set -e`, `cd "$(dirname "$(realpath "$0")")"`)

- **`build_package.sh`**: the same as qttest's: `rm -f *.vsix`, `npm install`, `format:check`, `lint`,
  `compile`, `vsce package`.
- **`test.sh`**: `npm run test:unit` then `npm test`. On Linux without `$DISPLAY`, wrap it in `xvfb-run -a`.
- **`run_manual_test.sh`**:
  1. `./build_package.sh`
  2. create a demo loom repo under `test/manual/build/` (wipe it first): bare `origin.git`, clone
     `demo`, initial commit pushed to `main`, `git branch -u origin/main`, `git loom init`, and 2–3 branches
     with commits (with multi-line messages, so the body preservation is visible), one stacked branch
     (`git loom branch new stack -t <branch>` + a commit), and one loose `git commit`
  3. `code --user-data-dir test/manual/build/vscode --extensions-dir test/manual/build/vscode --install-extension vscode-git-loom-*.vsix`
  4. `code --user-data-dir … --extensions-dir … test/manual/build/demo --disable-workspace-trust`
  Put a `code_clean` helper function in the script, like qttest does.
- **`upload_package.sh`**: the same as qttest's, with `PACKAGE_FILENAME=vscode-git-loom-$VERSION.vsix`.

Add `test/manual/build/` to `.gitignore`.

---

## 8. CI (`.github/workflows/`)

Copy them from qttest (keep the same action versions) and adapt:
- `build.yml`: ubuntu-latest + macos-latest; Node 22; `npm install`, `npm install -g @vscode/vsce typescript`;
  **install git-loom** (`cargo install git-loom --version 0.23.0 --locked`, with `actions/cache` on
  `~/.cargo/bin` + `~/.cargo/registry`, or a release binary if narnaud/git-loom publishes them). Then
  configure git's identity (`git config --global user.name/email ci`), then `npm run compile`,
  `npm run test:unit`, `xvfb-run -a npm test` (Linux) / `npm test` (macOS), then `vsce package`.
  Remove all the Qt/CMake/GTest/ninja steps.
- `lints.yml`, `pre-commit.yml`, `release-please.yml`: copy them unchanged.
- `package.yml`: copy unchanged. It calls `upload_package.sh`.

Default branch: `master` (the same as the other repos).

---

## 9. Docs

- `README.md`: what the extension does, a screenshot placeholder, requirements (git-loom ≥ 0.23 on PATH,
  or set `gitLoom.executable`), how reword works (save applies, close cancels), and the dev scripts.
- `CHANGELOG.md`: empty; release-please fills it.
- `LICENSE`: MIT, "Copyright (c) 2026 Sergio Martins".
- `CLAUDE.md`: short. Cover the architecture seam (§2.2), "loom/ must not import vscode", "identify commits
  by hash, never short IDs", "run `./test.sh` before finishing", and conventional commits.

---

## 10. Order of work (and definition of done)

1. `git init -b master`. Scaffold the dotfiles, `package.json`, tsconfigs, and eslint config. Then `npm install` and `npm run compile`, which should pass on an empty `extension.ts`.
2. `model.ts` + `textStatusParser.ts` + unit tests against **all 5 fixtures**, so `npm run test:unit` is green.
   **This is the riskiest part. Get it fully green before any UI work.**
3. `runner.ts` (+ a `parseAgentLine` unit test) and `statusSource.ts`.
4. The view container, the tree provider, refresh, and the error node. Check it manually with `run_manual_test.sh`.
5. The file diff provider.
6. The reword controller. Check it manually: the body is preserved, an empty message aborts,
   close cancels, and a loom error keeps the tab open.
7. The smoke integration test, the scripts, CI, and docs.
8. `./build_package.sh` and `./test.sh` both pass, and `npm run lint` + `format:check` are clean.

Don't create a GitHub remote, and don't push. Only commit when the user asks, using conventional commits
(`feat:`, `chore:`, `ci:`, `test:`, `docs:`), as `.pre-commit-config.yaml` enforces.

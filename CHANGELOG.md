# Changelog

## [1.1.0](https://github.com/iamsergio/vscode-git-loom/compare/v1.0.0...v1.1.0) (2026-10-06)


### Features

* color branch icons orange in the weave tree ([7627d3a](https://github.com/iamsergio/vscode-git-loom/commit/7627d3a2a609d9275e3dbd65e4f59e921932ef5e))
* color branch labels orange too ([9961bb9](https://github.com/iamsergio/vscode-git-loom/commit/9961bb96a8ecb955fbe8b33cabe398774ad8fabe))
* show the full commit message in the commit hover tooltip ([ce4a214](https://github.com/iamsergio/vscode-git-loom/commit/ce4a21480860a1f1b946652d0d9086f936509644))


### Bug Fixes

* don't set a tooltip eagerly so resolveTreeItem can fill it in ([f31b09f](https://github.com/iamsergio/vscode-git-loom/commit/f31b09fda277f318745e3c2cae231c496d5e3545))

## 1.0.0 (2026-09-28)


### Features

* add branch new/merge/unmerge and absorb commands ([f4ccbff](https://github.com/iamsergio/vscode-git-loom/commit/f4ccbfff19af80f7516be4a4e7a2784bfd9de159))
* copy commit hash and branch name from context menu ([83fdb89](https://github.com/iamsergio/vscode-git-loom/commit/83fdb892a6c2cac9bd72cfee0d0d75a89b9d23be))
* drag-and-drop to move commits ([1506f17](https://github.com/iamsergio/vscode-git-loom/commit/1506f17d94bc098f3923591d085aa9d805f18438))
* parse git-loom's local changes (zz) block into LoomStatus ([753213d](https://github.com/iamsergio/vscode-git-loom/commit/753213d3d7452e82da244f62d25ac2eb250de0c2))
* show local changes in the weave tree ([6abdd5e](https://github.com/iamsergio/vscode-git-loom/commit/6abdd5e118d6767a8b359006f7085834a1b35226))


### Bug Fixes

* build the weave from git-loom's JSON status graph ([d9aff90](https://github.com/iamsergio/vscode-git-loom/commit/d9aff9028445eeb4015f1a7ffecb2da2b8a4a09e))
* parse git-loom's newer commit-line format (short id + trailing hash) ([39816fc](https://github.com/iamsergio/vscode-git-loom/commit/39816fc72d0d6f80d5c81a1898a9010cc900981a))

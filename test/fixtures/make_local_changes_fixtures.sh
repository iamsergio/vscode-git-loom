#!/usr/bin/env bash
# Records the local-changes (zz block) fixtures in test/fixtures/status/ from a real git-loom run.
# Dates and identities are pinned so the recorded hashes are reproducible.
#
# Usage: test/fixtures/make_local_changes_fixtures.sh [git-loom executable]

set -euo pipefail

LOOM=${1:-git-loom}
OUT="$(cd "$(dirname "$0")" && pwd)/status"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

export GIT_AUTHOR_NAME=Test GIT_AUTHOR_EMAIL=test@example.com
export GIT_COMMITTER_NAME=Test GIT_COMMITTER_EMAIL=test@example.com
export GIT_AUTHOR_DATE="2026-09-18T12:00:00Z" GIT_COMMITTER_DATE="2026-09-18T12:00:00Z"

status() { "$LOOM" --no-color status -f; }

new_repo() {
    git init -q --bare "$TMP/$1.git"
    git clone -q "$TMP/$1.git" "$TMP/$1" 2>/dev/null
    cd "$TMP/$1"
    for f in a b c d e r; do echo "$f" >"$f.txt"; done
    git add .
    git commit -qm init
    git push -q origin HEAD:main
    git branch -q -u origin/main
    "$LOOM" init >/dev/null
}

dirty_worktree() {
    echo mod >>a.txt # unstaged modify
    echo st >>b.txt
    git add b.txt # staged modify
    echo both >>c.txt
    git add c.txt
    echo more >>c.txt # staged + unstaged
    git rm -q d.txt   # staged delete
    rm e.txt          # unstaged delete
    echo new >new.txt
    git add new.txt          # staged add
    git mv r.txt renamed.txt # staged rename, shown by loom as D + A
    echo u >untracked.txt
    mkdir -p "dir with space" sub
    echo s >"dir with space/staged.txt"
    git add "dir with space/staged.txt" # staged add, path with spaces
    echo u >"dir with space/extra.txt"   # untracked, path with spaces
    echo u >sub/untracked.txt         # untracked, collapsed to "sub/"
}

# A weave with a loose commit and a feature branch, plus every kind of local change.
new_repo weave
echo l >l.txt
"$LOOM" commit -i -m "chore: loose commit on integration" l.txt >/dev/null
echo f >f.txt
"$LOOM" commit -b feat-a -m "feat: a" f.txt >/dev/null
dirty_worktree
status >"$OUT/local-changes.txt"

# Nothing but local changes on top of upstream.
new_repo only
dirty_worktree
status >"$OUT/local-changes-only.txt"

echo "Wrote $OUT/local-changes.txt and $OUT/local-changes-only.txt"

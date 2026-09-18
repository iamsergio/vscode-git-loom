#!/bin/bash

# SPDX-FileCopyrightText: 2026 Sergio Martins
# SPDX-License-Identifier: MIT

set -e

SCRIPT_DIR=$(dirname "$(realpath "$0")")
cd "$SCRIPT_DIR"

BUILD_DIR=test/manual/build
ORIGIN_DIR=$BUILD_DIR/origin.git
DEMO_DIR=$BUILD_DIR/demo
VSCODE_DATA=$BUILD_DIR/vscode

code_clean() {
     # Alias for debugging purposes, when needed
    code --user-data-dir "$VSCODE_DATA" --extensions-dir "$VSCODE_DATA" "$@"
}

echo "Running build_package.sh..."
./build_package.sh

echo "Setting up a demo git-loom repository..."
rm -rf $BUILD_DIR
mkdir -p $BUILD_DIR

git init -q --bare "$ORIGIN_DIR"
git clone -q "$ORIGIN_DIR" "$DEMO_DIR"
(
    cd "$DEMO_DIR"
    git config user.email "demo@example.com"
    git config user.name "Demo"
    git commit -q --allow-empty -m "chore: initial commit"
    git push -q origin HEAD:main
    git branch -u origin/main

    git loom init --agent > /dev/null

    echo "feature A" > a.txt
    git loom commit -b feat-a -m "feat: add feature A

Longer description of feature A,
spanning several lines." a.txt --agent > /dev/null

    echo "feature B" > b.txt
    git loom commit -b feat-b -m "feat: add feature B" b.txt --agent > /dev/null

    git loom branch new feat-a-stack -t feat-a --agent > /dev/null
    echo "on top of A" > c.txt
    git loom commit -b feat-a-stack -m "feat: build on top of feature A" c.txt --agent > /dev/null

    echo "loose change" > d.txt
    git add d.txt
    git commit -q -m "chore: a loose commit on integration"
)

echo "Installing the packaged extension into a scratch VS Code profile..."
code_clean --install-extension vscode-git-loom-*.vsix

echo "Launching VS Code..."
code_clean "$DEMO_DIR" --disable-workspace-trust

#!/bin/bash

# SPDX-FileCopyrightText: 2026 Sergio Martins
# SPDX-License-Identifier: MIT

set -e

# nvm is a shell function, so it has to be sourced here. CI has no nvm and sets up node itself.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
    source "$NVM_DIR/nvm.sh"
    nvm use 24
fi

SCRIPT_DIR=$(dirname "$(realpath "$0")")
cd "$SCRIPT_DIR"

rm -rf *vsix &> /dev/null

echo "npm install..."
npm install

echo "npm run format:check..."
npm run format:check

echo "npm run lint..."
npm run lint

echo "Compiling..."
npm run compile

echo "vsce package..."
vsce package

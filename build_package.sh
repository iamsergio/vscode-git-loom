#!/bin/bash

# SPDX-FileCopyrightText: 2026 Sergio Martins
# SPDX-License-Identifier: MIT

set -e

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

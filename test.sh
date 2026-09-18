#!/bin/bash

# SPDX-FileCopyrightText: 2026 Sergio Martins
# SPDX-License-Identifier: MIT

set -e

SCRIPT_DIR=$(dirname "$(realpath "$0")")
cd "$SCRIPT_DIR"

# Parser/runner unit tests, no VS Code needed.
npm run test:unit

# Integration tests, run inside a real VS Code instance.
if [ -z "$DISPLAY" ] && command -v xvfb-run &> /dev/null; then
    xvfb-run -a npm test
else
    npm test
fi

#!/bin/bash
set -e

SCRIPT_DIR=$(dirname "$(realpath "$0")")
cd "$SCRIPT_DIR/.."

npm run compile
npm run lint
npm run format:check
npm run test:unit
npm test

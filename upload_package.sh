#!/bin/bash

# SPDX-FileCopyrightText: 2026 Sergio Martins
# Author: Sergio Martins <sergio.martins@kdab.com>
# SPDX-License-Identifier: MIT

# Uploads the vscode-git-loom-<version>.vsix package to GitHub Release
# Called by .github/workflows/package.yml

set -e

# Get latest version and tag:
VERSION=`jq -r '.version' package.json`
TAG_NAME=v$VERSION

PACKAGE_FILENAME=vscode-git-loom-$VERSION.vsix

if [ ! -f $PACKAGE_FILENAME ]; then
    # Doesn't happen. Package is created by package.yml
    echo "Package $PACKAGE_FILENAME does not exist"
    exit 1
fi

# Check if release exists:
if ! gh release view $TAG_NAME > /dev/null 2>&1; then
    # Should not happen, as releases are created by release-please
    echo "Release $TAG_NAME does not exist"
    exit 1
fi

# Check if release already contains the asset:
if gh release view $TAG_NAME --json assets -q '.assets[].name' | grep -qx $PACKAGE_FILENAME; then
    echo "Asset $PACKAGE_FILENAME already exists in release $TAG_NAME"
    exit 0
fi

gh release upload $TAG_NAME $PACKAGE_FILENAME

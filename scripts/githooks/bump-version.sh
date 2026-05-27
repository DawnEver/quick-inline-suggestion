#!/usr/bin/env bash
# Bump api patch version tag. Called by pre-commit at pre-push stage.
set -e

# Skip if HEAD is already exactly on a tag
if git describe --exact-match HEAD 2>/dev/null; then
  echo "Already on a release tag, skipping api version bump"
  exit 0
fi

LATEST_TAG=$(git describe --tags --abbrev=0 --match "v[0-9]*" 2>/dev/null || echo "v0.0.0")
VERSION="${LATEST_TAG#v}"
IFS='.' read -r MAJOR MINOR PATCH <<< "$VERSION"
NEW_TAG="v${MAJOR}.${MINOR}.$((PATCH + 1))"

git tag -a "$NEW_TAG" -m "Release $NEW_TAG"
echo "bump-version: tagged api ${NEW_TAG}"

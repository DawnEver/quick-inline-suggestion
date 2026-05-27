#!/usr/bin/env bash
# Generate changelog via commitizen. Called by pre-commit.
# Skips when there are no commits since the last reachable tag,
# or when incremental mode fails (e.g. CHANGELOG references a
# deleted tag after squash/rewrite).
set -e

cmd() { uv run python -m commitizen changelog; }

LATEST_TAG=$(git describe --tags --abbrev=0 --match "v[0-9]*" 2>/dev/null || echo "")
if [ -z "$LATEST_TAG" ]; then
  echo "generate-changelog: no version tag found, generating full changelog"
  cmd
  exit 0
fi

COMMIT_COUNT=$(git rev-list "$LATEST_TAG..HEAD" --count 2>/dev/null || echo 0)
if [ "$COMMIT_COUNT" -eq 0 ]; then
  echo "generate-changelog: no commits since $LATEST_TAG, skipping"
  exit 0
fi

echo "generate-changelog: $COMMIT_COUNT commits since $LATEST_TAG"
if cmd 2>/dev/null; then
  echo "generate-changelog: done"
else
  echo "generate-changelog: incremental failed, skipping (CHANGELOG.md preserved as-is)"
fi

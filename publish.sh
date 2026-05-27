#!/usr/bin/env bash
# publish.sh — bump version and publish webos-mcp to npm
#
# Usage:
#   ./publish.sh           # bump patch version (0.1.0 → 0.1.1)
#   ./publish.sh minor     # bump minor version (0.1.0 → 0.2.0)
#   ./publish.sh major     # bump major version (0.1.0 → 1.0.0)
#   ./publish.sh 1.2.3     # set exact version

set -e

BUMP=${1:-patch}

# ── Check npm login ──────────────────────────────────────────────────────────
echo "Checking npm login..."
if ! npm whoami &>/dev/null; then
  echo ""
  echo "  You are not logged in to npm."
  echo "  Run: npm login"
  echo "  Then re-run this script."
  exit 1
fi
echo "  Logged in as: $(npm whoami)"

# ── Verify we're in the right place ─────────────────────────────────────────
if [ ! -f "package.json" ] || [ ! -d "knowledge" ]; then
  echo "Error: run this script from the webos-mcp project root."
  exit 1
fi

# ── Preview what will be published ──────────────────────────────────────────
echo ""
echo "Files that will be published:"
npm pack --dry-run 2>&1 | grep "^npm notice" | grep -v "^npm notice $" || true

# ── Bump version ─────────────────────────────────────────────────────────────
echo ""
CURRENT=$(node -p "require('./package.json').version")

# If argument looks like a version number (x.y.z), use it directly
if [[ "$BUMP" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  npm version "$BUMP" --no-git-tag-version
else
  npm version "$BUMP" --no-git-tag-version
fi

NEW=$(node -p "require('./package.json').version")
echo "Version: $CURRENT → $NEW"

# ── Publish ──────────────────────────────────────────────────────────────────
echo ""
echo "Publishing webos-mcp@$NEW ..."
npm publish

echo ""
echo "✓ Published webos-mcp@$NEW"
echo ""
echo "Consumers running 'npx webos-mcp' will get this version on their next session."

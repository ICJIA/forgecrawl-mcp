#!/usr/bin/env bash
set -euo pipefail

# ForgeCrawl publish script
# Usage:
#   ./publish.sh              — first-time setup + publish
#   ./publish.sh patch        — bump patch version and publish (default)
#   ./publish.sh minor        — bump minor version and publish
#   ./publish.sh major        — bump major version and publish
#   ./publish.sh --dry-run    — dry run only, no publish

PACKAGE_NAME="@icjia/forgecrawl"
BUMP="${1:-patch}"
DRY_RUN=false

if [[ "$BUMP" == "--dry-run" ]]; then
  DRY_RUN=true
  BUMP="patch"
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

info()  { echo -e "${GREEN}[forgecrawl]${NC} $1"; }
warn()  { echo -e "${YELLOW}[forgecrawl]${NC} $1"; }
error() { echo -e "${RED}[forgecrawl]${NC} $1" >&2; }

# Helper to read package.json fields (ESM-safe — project uses "type": "module")
pkg_field() {
  node --input-type=commonjs -e "console.log(require('./package.json').$1)"
}

# ─── Preflight checks ───────────────────────────────────────────────

# Must be in project root
if [[ ! -f "package.json" ]]; then
  error "No package.json found. Run this from the forgecrawl-mcp project root."
  exit 1
fi

# Verify correct package
ACTUAL_NAME=$(pkg_field name)
if [[ "$ACTUAL_NAME" != "$PACKAGE_NAME" ]]; then
  error "package.json name is '$ACTUAL_NAME', expected '$PACKAGE_NAME'"
  exit 1
fi

# Check npm login
if ! npm whoami &>/dev/null; then
  warn "Not logged in to npm. Logging in now..."
  npm login
fi

NPM_USER=$(npm whoami)
info "Logged in as: $NPM_USER"

# Check for uncommitted changes
if [[ -n "$(git status --porcelain)" ]]; then
  error "Uncommitted changes detected. Commit or stash before publishing."
  git status --short
  exit 1
fi

# Validate bump type
if [[ "$BUMP" != "patch" && "$BUMP" != "minor" && "$BUMP" != "major" ]]; then
  error "Invalid bump type: '$BUMP'. Use patch, minor, or major."
  exit 1
fi

# ─── First-time detection ───────────────────────────────────────────

FIRST_TIME=false
if ! npm view "$PACKAGE_NAME" version &>/dev/null 2>&1; then
  FIRST_TIME=true
  warn "Package '$PACKAGE_NAME' not found on npm — this is a first-time publish."
fi

# ─── Version bump ───────────────────────────────────────────────────

CURRENT_VERSION=$(pkg_field version)
info "Current version: $CURRENT_VERSION"
info "Bumping: $BUMP"
NEW_VERSION=$(npm version "$BUMP" --no-git-tag-version)
NEW_VERSION="${NEW_VERSION#v}" # strip leading 'v'
info "New version: $NEW_VERSION"

# ─── Dry run ────────────────────────────────────────────────────────

info "Running dry run..."
echo ""

if [[ "$FIRST_TIME" == true ]]; then
  npm publish --access public --dry-run
else
  npm publish --dry-run
fi

echo ""

if [[ "$DRY_RUN" == true ]]; then
  # Revert the version bump since we're not publishing
  git checkout package.json
  info "Dry run complete. No changes made."
  exit 0
fi

# ─── Confirm ────────────────────────────────────────────────────────

echo ""
if [[ "$FIRST_TIME" == true ]]; then
  warn "About to publish $PACKAGE_NAME@$NEW_VERSION for the FIRST TIME."
else
  warn "About to publish $PACKAGE_NAME@$NEW_VERSION"
fi
read -p "Proceed? (y/N) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  # Revert the version bump
  git checkout package.json
  info "Aborted. No changes made."
  exit 0
fi

# ─── Publish ────────────────────────────────────────────────────────

if [[ "$FIRST_TIME" == true ]]; then
  npm publish --access public
else
  npm publish
fi

# ─── Post-publish smoke test ────────────────────────────────────────
# Re-fetch the just-published version through a fresh, isolated npm cache
# and run --help. Catches: missing files in the tarball, broken bin shim,
# bad shebang, postinstall failures — the class of bug that makes a
# package "published but unusable."
#
# Why an isolated cache: the FIRST_TIME check above runs `npm view`, which
# warms ~/.npm/_cacache with a packument that does NOT list the version
# we're about to publish. Without isolation, npm's installer consults
# that stale packument, decides $NEW_VERSION doesn't exist, and emits
# ETARGET — even though the registry already has it. ~/.npm/_npx (the
# unpacked-CLI layer) is a separate cache and worth clearing too.

info "Running post-publish smoke test..."
SMOKE_CACHE=$(mktemp -d 2>/dev/null || echo "/tmp/forgecrawl-smoke-cache-$$")
trap 'rm -rf "$SMOKE_CACHE" 2>/dev/null || true' EXIT
rm -rf "${HOME}/.npm/_npx" 2>/dev/null || true

SMOKE_OK=false
SMOKE_OUTPUT=""
for attempt in 1 2 3; do
  if SMOKE_OUTPUT=$(cd /tmp && npx -y --cache "$SMOKE_CACHE" "$PACKAGE_NAME@$NEW_VERSION" --help 2>&1) \
     && echo "$SMOKE_OUTPUT" | grep -q "^Usage: forgecrawl"; then
    SMOKE_OK=true
    break
  fi
  if [[ $attempt -lt 3 ]]; then
    warn "Smoke attempt $attempt did not succeed (registry CDN edge may still be propagating). Retrying in 5s..."
    sleep 5
  fi
done

if [[ "$SMOKE_OK" == true ]]; then
  info "Smoke test passed: npx -y $PACKAGE_NAME@$NEW_VERSION launches cleanly."
else
  error "Smoke test FAILED for $PACKAGE_NAME@$NEW_VERSION."
  error "Last output:"
  echo "$SMOKE_OUTPUT" >&2
fi

# ─── Git commit + tag ───────────────────────────────────────────────

git add package.json package-lock.json
git commit -m "release: v$NEW_VERSION"
git tag "v$NEW_VERSION"

git push && git push --tags

# ─── Done ───────────────────────────────────────────────────────────

echo ""
info "Published $PACKAGE_NAME@$NEW_VERSION"
info "npm: https://www.npmjs.com/package/$PACKAGE_NAME"
info ""
info "Users will get this version on next Claude Code restart via:"
info "  npx -y $PACKAGE_NAME"

if [[ "$SMOKE_OK" != true ]]; then
  echo ""
  error "NOTE: post-publish smoke test failed — verify manually before announcing."
  exit 1
fi

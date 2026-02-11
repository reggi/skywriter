#!/usr/bin/env bash
set -euo pipefail

# Railway Setup Script
# Provisions a PostgreSQL database, a volume, and sets environment variables.
# Prerequisites: `railway login` and `railway link` to your project/service.

echo "=== Railway Setup ==="

# 1. Add PostgreSQL database
echo "Adding PostgreSQL database..."
railway add --database postgres
echo "PostgreSQL added. DATABASE_URL will be injected automatically."

# 2. Add a volume mounted at /volume
echo "Adding volume at /volume..."
railway volume add --mount-path /volume
echo "Volume mounted at /volume."

# 3. Set environment variables for storage paths on the volume
echo "Setting environment variables..."
railway variables \
  --set 'DATABASE_URL=${{Postgres.DATABASE_URL}}' \
  --set "GIT_REPOS_PATH=/volume/.git-repos" \
  --set "UPLOADS_PATH=/volume/uploads"

echo ""
echo "=== Setup Complete ==="
echo "Environment variables set:"
echo "  GIT_REPOS_PATH=/volume/.git-repos"
echo "  UPLOADS_PATH=/volume/uploads"
echo ""
echo "Deploy with: railway up"

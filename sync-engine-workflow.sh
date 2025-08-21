#!/usr/bin/env bash
mkdir -p .github/workflows
cp engine/.github/workflows/engine.yml .github/workflows/engine.yml
echo "Synced engine workflow to root"

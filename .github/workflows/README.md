# GitHub Actions Workflows

## Check Fast-Forward to Upstream

This workflow checks whether the current branch can fast-forward to the HEAD of the repository it was forked from.

### When it runs

- On every push to the `main` branch
- On every pull request to the `main` branch
- Daily at 00:00 UTC (scheduled)
- Manually via workflow_dispatch

### What it does

1. **Detects if the repository is a fork**: Uses the GitHub API to check if this repository is a fork and retrieves the parent repository information.

2. **Fetches upstream changes**: If the repository is a fork, it adds the parent repository as a remote named `upstream` and fetches the same branch.

3. **Checks fast-forward capability**: Uses `git merge-base --is-ancestor` to determine if the current branch can fast-forward to the upstream branch.

4. **Reports the result**:
   - ✅ **Pass**: The branch can fast-forward to upstream (or is already up to date)
   - ❌ **Fail**: The branch has diverged from upstream and requires a manual merge or rebase
   - ℹ️ **Skip**: The repository is not a fork (check not applicable)

### Understanding the results

- **Up to date**: Your branch is identical to the upstream branch.
- **Can fast-forward**: Your branch is behind upstream but can be fast-forwarded without conflicts.
- **Diverged**: Your branch has commits that are not in upstream, requiring a manual merge or rebase.

### Manual trigger

You can manually trigger this workflow from the Actions tab in GitHub by selecting the workflow and clicking "Run workflow".

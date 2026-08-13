---
name: close-pr
description: >-
  Merge or close a sorta-fast pull request after an explicit human ask, then
  switch back to main and pull. Use when the user says a PR is good to merge,
  close, ship, LGTM, approve merge, or otherwise grants merge approval.
---

# Close / merge PR (Sorta Fast)

Never run `gh pr merge` unless the human explicitly asked to merge (or close/merge) in this conversation. Opening a PR is not permission to merge. See `.cursor/rules/no-self-merge.mdc`.

Claude reviews PRs as the human on another platform. A review from the PR author account is expected, not a merge blocker.

## Merge (explicit ask)

1. Confirm the PR is mergeable and CI is green (`gh pr view` / `gh pr checks`).
2. Merge with a **merge commit**, matching this repo's history: `gh pr merge <N> --merge --delete-branch`. Do not squash or rebase unless the human asked.
3. File any leftover discovered work as GitHub issues (do not commit follow-ups to `main`).
4. **Always make sure to switch back to the main branch and pull when you're finished:**

```bash
git checkout main
git pull
git fetch --prune
```

Delete the local feature branch if it still exists (`git branch -d issue-<n>-<slug>`).

5. Stop. Do not start the next issue unless asked. Never commit to `main` directly.

## Close without merging

If the human asked to close without merging: `gh pr close <N>` with a short reason, then the same `checkout main` + `git pull` + prune.

## Do not

- Merge as part of opening a PR or posting "ready for review"
- Wait for a different GitHub account to APPROVE
- Leave the session on the feature branch after merge

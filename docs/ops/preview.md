# Per-PR preview environments

## What it is

Adding the `preview` label to an internal pull request creates a temporary environment with:

- Cloudflare Worker preview URLs for the catalog API and web app.
- A Neon branch named `preview/pr-<N>` with Atlas migrations applied.
- A sticky PR comment containing stable aliases and per-commit preview URLs.

Closing or merging the PR automatically deletes its Neon branch.

## One-time setup

Set the Neon project ID as a repository variable:

```sh
gh variable set NEON_PROJECT_ID --body <project-id>
```

Find the project ID in Neon Console under **Project settings**, or run `neonctl projects list`.
Projects that do not use the defaults can also set `NEON_DATABASE_NAME` and `NEON_ROLE_NAME`;
the workflow otherwise uses `neondb` and `neondb_owner`.

Ensure the repository has a `preview` label. The first labeled run bootstraps the routeless
`catalog-preview` and `animichi-web-preview` Workers with a one-time
`wrangler deploy --env preview`. Later runs only upload undeployed versions.

## Daily use

```sh
gh pr edit <n> --add-label preview
```

Wait for the **Preview environment** PR comment. Stable aliases follow these forms:

- `https://pr-<N>-catalog-preview.<subdomain>.workers.dev`
- `https://pr-<N>-animichi-web-preview.<subdomain>.workers.dev`

Each push to the labeled PR refreshes both previews and updates the comment. Close or merge the
PR to tear down the Neon branch automatically.

## Costs and quotas

Neon branches count toward the project branch cap. The free plan defaults to 10 branches including
the default branch, allowing roughly nine concurrent previews. Storage is copy-on-write delta, and
compute autosuspends after the project's configured idle period. The branch is deleted on PR close.

Cloudflare `versions upload` is free, and preview URLs are served on `workers.dev`. Cloudflare keeps
only the 1,000 most recent preview aliases. Undeployed versions have no runtime cost. Keep the
`preview` label only on PRs that need a live environment.

## Guardrails

- Teardown only deletes names matching `preview/pr-<N>`, with an additional denylist for `main`,
  `master`, `production`, `staging`, and `development`.
- Preview automation never targets staging or production Workers, or the default Neon branch.
- Connection strings are masked and passed only through step environment variables and stdin; they
  are never written to logs, files, or artifacts.

## Troubleshooting

- **Atlas fails:** verify `NEON_DATABASE_NAME` and `NEON_ROLE_NAME` for the project.
- **The label is present but no run starts:** only `labeled`, `synchronize`, and `reopened` events
  create or update previews. Push another commit or remove and re-add the label.
- **Atlas reports migration hash drift after a rebase:** close and reopen the PR to delete the old
  branch and create a fresh one.

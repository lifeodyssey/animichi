# Orca delivery tooling

Two read-only local CLIs. Neither writes to the repository, GitHub, or Orca state.

## Pull request feedback inventory

Capture the complete read-only feedback inventory for a pull request:

```sh
ruby scripts/orca/pr-feedback.rb --repo lifeodyssey/animichi --pr 123
ruby scripts/orca/pr-feedback.rb --repo lifeodyssey/animichi --pr 123 --output /tmp/pr-123-feedback.json
```

The JSON inventories comments, submitted reviews, inline threads, replies, and pull request
metadata. It does not evaluate CI or merge readiness; follow the
[Orca card delivery workflow](../../docs/ops/orca-card-delivery.md) for the surrounding process.

## Card state reconciler

Derive every card's state from live facts and print the next action, oldest-stuck first:

```sh
ruby scripts/orca/card-reconcile.rb
ruby scripts/orca/card-reconcile.rb --json > /tmp/cards.json
```

It reads lane state directories, verdict files, `git worktree`, GitHub, and the Run's Orca tasks; the
Run mailbox only corroborates the tasks. It writes nothing, and exit 0 means the report was printed —
the report is the product. A refused hold or an invalid option exits 1 with the reason on stderr, and
a failed source becomes a `degraded:` note while the rest of the report is still printed.

The one thing it cannot derive is a hold, kept in a small JSON file (`--holds`, default
`~/.orca/card-holds.json`). Every hold carries a
machine-checkable release condition — `{"card": 1625, "until": {"pr_merged": 1607}}` or
`{"card": 1672, "until": {"no_open_pr_touches": "pnpm-lock.yaml"}}`. A hold with free text, or with a
predicate outside that closed set, is refused at load with a message naming it. Automatic
transitions are not implemented; a Monitor loop acts on the table itself.

## Tests

Run the focused tests without network access:

```sh
ruby scripts/orca/test/run.rb
```

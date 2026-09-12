# Pull request feedback inventory

Capture the complete read-only feedback inventory for a pull request:

```sh
ruby scripts/orca/pr-feedback.rb --repo lifeodyssey/animichi --pr 123
ruby scripts/orca/pr-feedback.rb --repo lifeodyssey/animichi --pr 123 --output /tmp/pr-123-feedback.json
```

The JSON inventories comments, submitted reviews, inline threads, replies, and pull request
metadata. It does not evaluate CI or merge readiness; follow the
[Orca card delivery workflow](../../docs/ops/orca-card-delivery.md) for the surrounding process.

Run the focused tests without network access:

```sh
ruby scripts/orca/test/run.rb
```

---
paths:
  - "db/**"
---
# Atlas migration rules (shared Neon schema)

- Versioned migrations live in `db/migrations/*.sql` with `atlas.sum`. Regenerate the sum with
  `atlas migrate hash` — never hand-edit it.
- New migration: `atlas migrate diff <name> --dir file://db/migrations --to <schema-source>
  --dev-url <ephemeral-neon-branch>`; commit the `.sql` + updated `atlas.sum`. Use a throwaway **Neon
  branch** as `--dev-url`; never diff against prod.
- CI applies on deploy (`_deploy-component.yml`, gated on `NEON_DATABASE_URL`):
  `atlas migrate apply --dir file://db/migrations --url "$NEON_DATABASE_URL" --revisions-schema public`.

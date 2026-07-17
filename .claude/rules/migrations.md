---
paths:
  - "db/**"
---
# Atlas migration rules (shared Neon schema)

- Versioned migrations live in `db/migrations/*.sql` with `atlas.sum`. Regenerate the sum with
  `atlas migrate hash --dir file://db/migrations` after any edit — never hand-edit it.
- Migrations are append-only shared history. Seed/reference data rides migrations; never move
  catalog/user data-plane work into auth-only `supabase/migrations/`.
- New migration: `atlas migrate diff <name> --dir file://db/migrations --to <schema-source>
  --dev-url <ephemeral-neon-branch>`; commit the `.sql` + updated `atlas.sum`. Use a throwaway **Neon
  branch** as `--dev-url`; never diff against prod.
- CI applies on deploy (`_deploy-component.yml`, gated on `NEON_DATABASE_URL`):
  `atlas migrate apply --dir file://db/migrations --url "$NEON_DATABASE_URL" --revisions-schema public`.

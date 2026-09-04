---
paths:
  - "infra/**"
---
# Pulumi IaC rules

- Pulumi (TypeScript, `infra/index.ts`) is the IaC for Cloudflare. Use the `pulumi` skill.
- **Scope**: R2 (catalog media), Worker Custom Domains/routes, DNS, secrets. **No
  Hyperdrive** — the catalog reaches Neon over `@neondatabase/serverless` (neon-http). DNS for the
  web Custom Domains is intentionally absent from Pulumi: Cloudflare creates and owns those records
  as part of the Custom Domain resource. The Pulumi-owned DNS surface is the proxied `www`
  placeholder used by the redirect rule.
- **Split-brain rule**: *routes belong to Pulumi, worker code belongs to wrangler* — a no-route
  `wrangler deploy` must not clobber Pulumi-managed routes.
- **State backend = Pulumi Cloud**, org `lifeodyssey`, declared by `backend.url` in each
  `Pulumi.yaml`; stack encryption is Pulumi Cloud's managed provider (#1077). CI logs in with
  `pulumi/auth-actions` (GitHub OIDC) — no access token, backend URL, R2 state keys, or passphrase.
- Stacks: `Pulumi.yaml` + `Pulumi.staging.yaml` + `Pulumi.prod.yaml`.
- **Secrets** live in Pulumi encrypted config (`secure:` in the stack file) / ESC — never plaintext.
  CF Worker secrets are pushed via CI (`wrangler secret put`) from Pulumi outputs
  (`@pulumi/cloudflare` v6 has no `WorkersSecret` resource), not hand-set.
- Production `pulumi up` requires explicit user approval; normal deploys use the GitHub
  `production` environment gate.

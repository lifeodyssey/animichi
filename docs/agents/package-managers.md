# Package managers

Read before adding or bumping a dependency, editing `pnpm-workspace.yaml`, or running the Ruby
contract suites.

- **pnpm 12** workspace for all TypeScript (`pnpm-workspace.yaml`). **uv** only installs the pinned
  semgrep lint tool. **Bundler** runs the Ruby contract suites: install `.ruby-version`'s Ruby
  (rbenv, mise and asdf read it), then `bundle install` and `bundle exec ruby <file>` — the
  `contracts` job's form; it refuses other Rubies.
- **Project settings live in `pnpm-workspace.yaml`** — pnpm 11 moved them here out of `.npmrc` and
  removed the `package.json#pnpm` field; pnpm 12 rejects a key it does not recognise and ignores a
  kebab-case one. Keys are camelCase. This repository tracks no `.npmrc`; auth, registry
  credentials and global config stay per-machine, per pnpm's documentation. CI installs with
  `--frozen-lockfile`.
- **Catalogs are the version surface.** Every external dependency two or more importers declare is
  defined once in the default `catalog:` and referenced as `catalog:`; `catalogMode: strict` refuses a
  `pnpm add`/`pnpm update` that asks for a version outside a catalog entry. Add the catalog entry
  first, then reference it — `test/repo-config/pnpm-workspace-settings.test.rb` fails otherwise.
- **Ranges in the catalog; the lockfile pins** (owner, 2026-11-18: "我是喜欢能更新就更新的"). A
  dependency is declared in the catalog with a range (`^x.y.z`), even one only a single importer
  uses; no `package.json` carries an exact version; no test asserts a version string; and
  `pnpm-lock.yaml` is what pins, with `minimumReleaseAge` deciding how new a resolved release may
  be. Why: an exact version in a manifest, and a test that asserts it, turn every upgrade into hand
  edits in two places, so updates wait; with a range, `pnpm update` takes the newest release the age
  gate admits while CI's frozen install still installs exactly what the lockfile recorded. The rule
  was set on a draft that declared `"neonctl": "9.4.0"` in `infra/package.json`, outside the
  catalog, beside a test that asserted the string. A version held below the newest on purpose is a
  hold-back, not an exact pin: it is registered in `pnpm-workspace.yaml` as
  `# hold-back: <package>@<declared> -> <latest> fails <gate> — #<issue>, expires <YYYY-MM-DD>`,
  naming the gate it fails, the issue that retires it and the date the exception lapses: from that
  date `test/repo-config/dependency-hold-back-expiry.test.rb` is red until the pin is retired or the
  owner extends the date (`docs/agents/code-standards.md`). The exact versions left in the
  catalog and the manifests are held where something else decides them: the Pi packages (the pi
  version line in `docs/agents/owner-decisions.md`), the Prisma family, `@prisma/cli-engine`
  included (#1741), and the eval package's `logfire` with `@pydantic/logfire-node`, which
  `packages/eval/PINS.json` and `packages/eval/test/pins.test.ts` hold to one exact runtime.
- **A scoped override retires itself** (#2058; written 2026-11-18, merged 2026-11-19). neonctl's
  `neon` package pins `diff` 5.2.0 exactly, which GHSA-73rr-hh4g-fpgx covers. The override
  `"neon>diff@5.2.0": "5.2.2"` in `pnpm-workspace.yaml` applies only while `neon`'s `diff` range
  admits 5.2.0: the workspace's 8.x and 9.x `diff` copies stay where they are, and once `neon`
  moves on the override stops applying by itself (a control with a non-matching range left it
  inert). Scope an override for a pin a parent holds the same way, to the parent and its spec.

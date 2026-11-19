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
  `# hold-back: <package>@<declared> -> <latest> fails <gate> — #<issue>`, naming the gate it fails
  and the issue that retires it (the line has no expiry field). Exact versions that predate the rule
  are still in the tree.

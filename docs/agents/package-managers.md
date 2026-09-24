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

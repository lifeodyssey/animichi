# install-atlas

Composite action that installs the repository-pinned **Atlas CLI**
(`v0.30.0` linux/amd64) under `$RUNNER_TEMP/atlas-bin` and prepends it to
`GITHUB_PATH`, verified by a pinned SHA-256.

Single source of truth for the pinned version + SHA. Callers use
`uses: ./.github/actions/install-atlas` instead of copying the
curl/sha256sum block (AC2, #679).

## Inputs

| input     | required | default | description |
|-----------|----------|---------|-------------|
| `version` | no  | `0.30.0` | Atlas CLI release to install |
| `sha256`  | no  | `dbaaf350…6011a` | SHA-256 of the linux/amd64 binary |

Keep the default `sha256` in sync with
`apps/agent/src/animichi/tests/atlas_helper.py`
`ATLAS_LINUX_AMD64_SHA256`.

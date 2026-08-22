# CI identity federation — Builds doorbell + Pulumi Cloud

- Status: PROPOSED — grilling complete (owner Q1–Q10 sign-offs recorded 2026-08-16); pending dual-seat spec review
- Tracking: GitHub issue #1071 (parent #1004). Cards #1072–#1081. Sibling of #1046 (migration executor + first secrets-zeroing wave). Supersedes #1045 (least-privilege scoping of the residual seven deployer credentials — those credentials are removed here, not scoped)
- Related: #1004 (production-readiness track, parent) · #1046 / #1047–#1057 (first wave; this campaign does not edit those cards) · #1048 + #1051 (minimum blockers before implementation starts) · #1054 (staging-gate OIDC — stays on #1046) · ADR 0003 (Secrets Store is runtime truth; ESC is not a DSN source)

## Problem Statement

The first secrets-zeroing wave (#1046) takes database credentials, runtime API keys, the Neon control-plane key, and the shared staging-gate token out of GitHub Secrets. It deliberately stops at **~7 deployer-identity credentials**: the Wrangler Cloudflare token, the Pulumi Cloudflare token, the account id, the R2 state keys, the Pulumi backend URL, and the state passphrase. #1045 was filed to shrink the permissions on those seven, on the assumption they had to stay.

They do not have to stay. Cloudflare still has no API-side OIDC federation, so Wrangler on a GitHub runner will always need a long-lived token **in that process**. Pulumi on a self-managed R2 backend will always need a backend URL, S3 keys, and a passphrase. Those are platform facts, not reasons to keep the strings in GitHub Settings.

The remaining posture is still the one the owner rejected for the database: a compromised third-party Action in a deploy job can silently read standing deployer credentials (this repo has already had an npm typosquat). #1045 would only narrow blast radius. It would not remove the standing keys from the cabinet.

## Solution

A second, sibling campaign that **removes** the residual seven instead of scoping them, without reopening #1046.

Worker and web deploys leave the GitHub runner. A dedicated **Builds doorbell** Worker — a separate isolate from the migrator — verifies the pipeline's per-run GitHub OIDC identity and calls the Cloudflare Workers Builds API. Cloudflare's own build token performs `wrangler deploy`. The doorbell never runs Wrangler, never runs Pulumi, and cannot publish itself through its own API. Staging and production both go through this door: migrator green (skipped only when this SHA does not touch the migration chain), then ring. There is no release branch; production Builds do not auto-fire on `main`.

Pulumi stays on the GitHub runner, but only in **independent infra jobs**. State and stack encryption move to Pulumi Cloud. Those jobs authenticate to Pulumi Cloud with the official GitHub OIDC action, open an ESC environment, and run `pulumi up` / neon-secrets. The Pulumi-plane Cloudflare API token and the Neon API key used by neon-secrets live in ESC, not GitHub. Official `esc run wrangler` is forbidden: it would pour the Wrangler token back into the runner and undo the doorbell.

Runtime secrets stay in Cloudflare Secrets Store (ADR 0003 is not reopened). The Pulumi / Wrangler ownership split (routes, Custom Domains, WAF, zone hardening vs Worker code) is unchanged. The staging-gate OIDC channel stays #1054. Eval model keys stay out of this campaign.

End state of **this** campaign: GitHub Settings holds no Wrangler token, no Pulumi/R2/passphrase, no Pulumi access token. The only process that briefly sees a Cloudflare API token is the infra `pulumi up` job, via ESC injection. Machine-checkable contract tests lock the posture. #1045 is closed as superseded when this spec is signed.

## User Stories

1. As the maintainer, I want the remaining deployer credentials out of GitHub Secrets, so that a compromised Action cannot silently steal the ability to publish Workers or rewrite DNS.
2. As the maintainer, I want this campaign to sit beside #1046 rather than inside it, so that the already-filed eleven cards keep their "leave ~7" end state until this wave replaces it.
3. As the maintainer, I want implementation blocked until the Secrets Store production DSN cutover and the staging migrator exist, so that we do not retie the deploy DAG while those cards are still moving.
4. As the maintainer, I want #1045 superseded rather than executed, so that we do not spend a card scoping tokens this campaign deletes.
5. As the CI pipeline, I want to publish a Worker by presenting my per-run GitHub OIDC identity, so that I never hold a Cloudflare API token.
6. As the CI pipeline, I want the doorbell to call Workers Builds rather than run Wrangler, so that compile and upload stay on Cloudflare's build token.
7. As the maintainer, I want the doorbell to be a Worker of its own, so that the Builds token and the migrator DSN never share an isolate.
8. As the maintainer, I want the doorbell and the migrator to share the OIDC verifier module, so that claims checks do not drift.
9. As the maintainer, I want the doorbell's only abilities to be "start an allowlisted build" and "report that build's status", so that a stolen trigger is a doorbell, not a shell.
10. As the maintainer, I want the doorbell to refuse to start a build of itself, so that a malicious commit cannot rewrite the door and then publish the rewrite through the door.
11. As the maintainer, I want the doorbell's own updates to go through a Workers Builds connection on `main` (or a one-time human dashboard/local deploy), so that GitHub Settings never stores its bootstrap token.
12. As the CI pipeline, I want to start a build and then poll the same door for status, so that a multi-minute container build does not have to finish inside one Worker request.
13. As the maintainer, I want component names mapped to trigger ids in the doorbell's own config, so that the request body cannot name an arbitrary trigger.
14. As the CI pipeline, I want a staging ring to require a main-ref token whose `sha` claim equals the requested commit, so that a staging job cannot publish some other revision.
15. As the CI pipeline, I want a production ring to require the GitHub `production` environment claim, so that the existing human approval gate is inherited automatically.
16. As the maintainer, I want a production ring's commit to equal the SAFE-1 pinned revision recorded in the already-committed eligibility manifest at the token's `sha`, so that a campaign commit cannot ask the door to publish an arbitrary hash.
17. As the maintainer, I want `job_workflow_ref` pinned to the one deploy workflow, so that a Dependabot or quality workflow that grants itself `id-token: write` cannot ring.
18. As the maintainer, I want audience to be a fixed project-specific value for this door, distinct from the migrator's audience, so that a ticket minted for one door cannot open the other.
19. As the maintainer, I want staging Worker deploys to go through the doorbell rather than auto-build on `main`, so that "schema before app" is a GitHub `needs:` edge and not a race.
20. As the maintainer, I want merge-to-main to still mean "migrate if needed, then publish staging", so that the operational model stays one push.
21. As the CI pipeline, I want to skip calling the migrator when this SHA does not touch the migration chain, so that we do not pay a no-op apply on every frontend-only commit.
22. As the CI pipeline, I want that skip to drop only the migrator invocation, so that a SHA that *does* touch migrations still cannot publish before the migrator is green.
23. As the maintainer, I want production Builds to ignore pushes to `main`, so that production never publishes without the GitHub environment approval.
24. As the maintainer, I do not want a long-lived release branch, so that `main` remains the only git source of truth.
25. As the maintainer, I want rollback to be "ring the door with a previous eligible SHA" (or promote an already-uploaded Worker version), so that rollback.yml no longer holds a Wrangler token.
26. As the maintainer, I want catalog, users, web, root, and jobs each to have a staging and production Builds project with the correct Wrangler environment flag, so that today's separate Worker names stay intact.
27. As the maintainer, I want Worker versions to remain per-Worker, so that we do not pretend a staging version can be promoted onto the production Worker.
28. As the maintainer, I want web's env-neutral bundle and runtime-config injection to run in the Builds build command, so that staging and production still receive the right public origins without GitHub vars being the only injector.
29. As the maintainer, I want the root/edge Builds deploy command to remain a full `wrangler deploy` (not versions-upload), so that the agent container image still updates.
30. As the maintainer, I want preview URLs and non-production branch Builds left off the staging web Worker, so that preview hosts cannot bypass the staging WAF.
31. As the maintainer, I want Pulumi state to live in Pulumi Cloud, so that the R2 backend URL and the two state S3 keys leave GitHub.
32. As the maintainer, I want stack encryption to use Pulumi Cloud's secrets provider, so that the passphrase leaves GitHub and we are no longer one lost string away from undecryptable state.
33. As the CI pipeline, I want to log into Pulumi Cloud with GitHub OIDC, so that there is no `PULUMI_ACCESS_TOKEN` in Settings.
34. As the CI pipeline, I want ESC to inject the Pulumi-plane Cloudflare token (and neon-secrets' Neon API key) only into infra jobs, so that Worker-publish jobs never see those values.
35. As the maintainer, I want official `esc run wrangler` / `esc-action` injection of the Wrangler token forbidden, so that the doorbell's "token never enters the runner" property cannot regress.
36. As the maintainer, I want runtime DSNs and model keys to stay in Secrets Store, so that ADR 0003 is not reopened and ESC does not become a second runtime cabinet.
37. As the maintainer, I want routes, Custom Domains, WAF, and zone hardening to stay Pulumi-owned, so that this campaign does not rewrite topology while it moves identity.
38. As the maintainer, I want `pulumi up` of the main stack to be its own job, so that ringing a Worker and applying infra no longer share a catalog-shaped job.
39. As the maintainer, I want neon-secrets to remain its own Pulumi project and job, so that role/DSN provisioning stays a single-purpose apply.
40. As the CI pipeline, I want the deploy lane to **always** run the infra job (a no-op apply when there is no drift), so that we never skip an apply because a path filter missed a real dependency.
41. As the CI pipeline, I want path filters only to skip **doorbell** rings, so that a WAF-only commit does not rebuild Workers, but still applies infra.
42. As the CI pipeline, I want catalog, users, web, and root publish jobs to `needs` both infra and the migrator job, so that "infra before catalog" and "schema before app" are declared edges, not inferred imports.
43. As the maintainer, I do not want CI to scan catalog source to guess Pulumi needs, so that a missed static edge cannot ship a binding to a bucket that does not exist.
44. As the maintainer, I want a both-changed commit to apply infra first and then ring catalog, so that a new bucket and its binding land in the right order.
45. As the maintainer, I want production's approved job to apply infra at the SAFE-1 pinned SHA and then ring at that same SHA, so that topology and code stay on one revision.
46. As the maintainer, I want `CLOUDFLARE_ACCOUNT_ID` demoted to a GitHub variable (or Wrangler/Pulumi config), so that a non-credential stops occupying Secrets.
47. As the maintainer, I want the staging-gate OIDC channel left on #1054, so that two campaigns do not delete `STAGING_GATE_TOKEN` twice.
48. As the maintainer, I want eval model keys left untouched, so that this campaign does not grow an eval runner.
49. As a security reviewer, I want contract tests that deploy workflows no longer reference the deleted deployer secret names, so that the empty-cabinet posture cannot silently regress.
50. As a security reviewer, I want contract tests that Worker-publish jobs do not run `esc-action` / `wrangler` / `pulumi`, so that the two identity planes cannot be re-entangled by a copy-paste.
51. As a security reviewer, I want contract tests that the doorbell allowlist cannot name itself as a trigger target, so that the self-publish ban is machine-checked.
52. As the maintainer, I want `docs/ops/secrets.md` rewritten as a pointer to Store / ESC / Builds rather than a GitHub cabinet inventory for the deleted names, so that the consistency test tracks the new truth.
53. As the operator, I want build outcomes (component, SHA, trigger, exit) visible in existing observability, so that every publish has an audit trail.
54. As the maintainer, I want a one-time human bootstrap for the doorbell and the Pulumi Cloud org, so that agents never need secret *values* to start the campaign.
55. As the maintainer, I want existing passphrase-encrypted stack config re-encrypted under Pulumi Cloud once, so that `pulumi up` after cutover can read `secure:` values.
56. As the maintainer, I want the pre-`up` R2 `stack export` backup step retired after Pulumi Cloud history exists, so that we stop writing rollback snapshots into the same bucket that used to hold live state.
57. As the maintainer, I want GitHub's `production` environment approval to remain the human gate, so that moving the executor does not move who says yes.

## Implementation Decisions

- **Sibling campaign, not an edit of #1046.** #1046's cards and "leave ~7" acceptance stay until this wave lands. Implementation of this spec is blocked on the Secrets Store production DSN cutover and the staging migrator Worker (the two pieces that freeze the deploy DAG's schema and runtime-secret shape). #1045 is superseded at owner sign-off of this spec, not left half-alive as a scoping task.
- **Two OIDC relying parties, three audiences.** GitHub is the issuer in every case. The migrator verifies one audience (#1046). The doorbell verifies a second, distinct audience. Pulumi Cloud verifies a third via the official auth action. A token minted for one party is rejected by the others.
- **Doorbell Worker is single-purpose.** HTTP surface: start an allowlisted Builds run; read that run's status. No Wrangler, no Pulumi, no arbitrary command, no caller-supplied trigger id, no caller-supplied account. Component name → trigger id is config on the Worker, split by staging vs production, selected from the OIDC environment / ref claims.
- **Start is async.** `POST` returns a build id (or an equivalent handle) and a non-success if the ticket is bad or the component is unknown. `GET` proxies status. The GitHub job polls the door. The door does not hold the request open for a container build.
- **Claims allowlist** (same shape as the migrator, different audience): repository must be this repo; staging requires the main ref and `sha` == requested commit; production requires the GitHub environment claim `production` and requested commit == the SAFE-1 pinned revision declared in the eligibility manifest **at the token's `sha`**; `job_workflow_ref` is the one deploy workflow; expired / wrong-audience / wrong-repo tokens fail closed.
- **Self-publish ban.** The allowlist must not include the doorbell Worker. Its shipping path is a dedicated Builds connection on `main`, or a human one-shot. The first copy is bootstrapped outside GitHub Settings.
- **No release branch.** Production Builds are not attached to `main`. Staging publish is not attached to a delayed pointer branch either: GitHub rings the door after the migrator job (or after that job is legitimately skipped).
- **Migrator skip is path-based and narrow.** If this SHA does not touch the Neon migration directory, the pipeline skips **calling** the migrator. Publish jobs still `needs` the migrator job (the skip counts as success). If the directory changed, a red or missing migrator blocks every ring.
- **Workers Builds layout.** One Builds project per Worker name that already exists (staging and production names stay as today). Deploy commands pass the matching Wrangler environment. Preview Builds and preview URLs stay disabled on the staging web Worker. Root/edge production and staging deploy commands are full deploys so containers update. Web's runtime-config injection moves into the Builds build command; it is not a reason to keep Wrangler on the runner.
- **Pulumi Cloud is three things, all in.** Backend (state leaves R2). Secrets provider (passphrase leaves GitHub; existing ciphertext is re-encrypted once). ESC (Pulumi-plane Cloudflare token and neon-secrets' Neon API key). Login is official GitHub OIDC, not a standing Pulumi PAT, not a second doorbell.
- **ESC is not a Wrangler feed and not a runtime store.** Infra jobs may open ESC. Worker-publish jobs must not. `wrangler secret put` driven from ESC is out: runtime values stay in Secrets Store. The official Cloudflare ESC guide's "inject token, run Wrangler on this machine" path is explicitly rejected for CI publish.
- **Infra jobs are the only remaining Cloudflare-token window.** `pulumi up` for the main stack and for neon-secrets run on GitHub-hosted runners, as they do today, but in jobs whose only purpose is Pulumi. Those jobs always run on the deploy lane; a clean preview is a successful no-op. They do not share a job with a doorbell ring.
- **Declared dependency, not detected dependency.** Publish jobs `needs` the infra job and the migrator job. Path filters may skip rings when only infra changed. Path filters must not skip the infra job on the deploy lane. No source-graph analysis of catalog vs Pulumi.
- **Ownership split unchanged.** Routes, Custom Domains, WAF, zone hardening, R2 buckets remain Pulumi. Worker implementation and bindings remain Wrangler / Builds.
- **Account id is not a secret.** Demote it to a variable or checked-in config. Rotation of a non-credential must not look like a secret rotation.
- **Rollback.** No Wrangler token in rollback automation. Re-ring at a previously eligible SHA, or promote an already uploaded Worker version. Pulumi rollback uses Pulumi Cloud history, not an R2 export copied before every apply.
- **Observability.** Doorbell responses carry component, commit, trigger identity (not the Builds token), and terminal status. Infra jobs keep today's Pulumi logs. No new dashboard product.
- **Human-only bootstrap.** Creating the Pulumi Cloud org, connecting GitHub as an OIDC issuer, writing the first ESC values, connecting the doorbell's Builds repo, and the first doorbell deploy are owner actions. Agents never receive secret values.

## Testing Decisions

Good tests assert **external behavior at existing seams**. Nothing tests Cloudflare Builds internals, Pulumi Cloud, or ESC encryption. Prefer the fewest seams; two are enough, and both already exist in this repo's style.

1. **Doorbell HTTP seam** (primary; same shape as the migrator Worker). Drive the Worker through its HTTP interface. Valid staging token + matching `sha` → start is accepted and the fake Builds client is called with the allowlisted trigger and that commit. Valid production token + SAFE-1-matching commit → accepted. Invalid / expired / wrong-repo / wrong-audience / wrong-workflow / staging token asking for another commit / production token asking for a commit that is not the pinned revision at the token's `sha` / request naming an unknown component / request naming the doorbell itself → rejected and the fake Builds client is not called. Status GET returns whatever the fake client reports, including a failed build. JWTs are signed with a test key pair via the injected JWKS seam. The Builds API is a constructor-injected client (the only new test seam). Prior art: #1046's migrator HTTP tests; the users Worker's jose verification tests.

2. **Workflow / docs contract seam** (existing). Invert and extend the secrets-and-deploy contract tests: deploy and rollback workflows must not reference the deleted GitHub secret names (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_PULUMI_API_TOKEN`, `PULUMI_BACKEND_URL`, `PULUMI_CONFIG_PASSPHRASE`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`). Worker-publish jobs must not invoke Wrangler, must not invoke Pulumi, and must not run the ESC action. Infra jobs must authenticate with the official Pulumi OIDC action and must not use an R2 backend login. Publish jobs must `needs` infra and migrator. The doorbell allowlist config must not include the doorbell's own Worker name. `secrets.md` consistency follows the names that remain. Prior art: the migration-boundary / session-cutover workflow contracts; the secrets-docs consistency test; the auth-config workflow greps.

Not tested: Pulumi Cloud UX; ESC ciphertext; Workers Builds YAML in the Cloudflare dashboard (beyond "our repo's deploy command strings if they live in-repo"); eval jobs; the staging-gate channel; live apply against production.

## Out of Scope

- #1046's eleven cards, including the staging-gate OIDC channel and `STAGING_GATE_TOKEN` deletion (#1054).
- Relocating, deleting, or redesigning eval (including `ZEN_GO_API_KEY`).
- Moving routes / Custom Domains / WAF / zone hardening from Pulumi into Wrangler.
- A Worker that runs Wrangler or Pulumi (the rejected "deployer" shape).
- A long-lived release / `cf-prod` branch as a promotion pointer.
- Promoting a staging Worker version onto a production Worker (versions are per script).
- Putting runtime DSNs or model keys in ESC (ADR 0003).
- Neon OIDC / short-lived database credentials (still do not exist).
- Cloudflare API-side OIDC / trusted publishing for Wrangler (still does not exist; Builds is the substitute).
- Executing #1045's permission-trim program. If this spec dies, #1045 can be reopened; it is not a fallback card inside this wave.
- Creating the Pulumi Cloud organization and pasting the first ESC values (owner).

## Further Notes

- **Evidence.** Owner grilling Q1–Q10 (2026-08-16): sibling campaign; Builds doorbell for staging and production; Pulumi Cloud backend + hosted encryption + ESC; official OIDC only on infra `pulumi up` jobs; eval out of scope; no release branch; infra always on the deploy lane; path filters skip rings only; gate OIDC stays on #1054; tracker parent #1004; dedicated doorbell Worker sharing only the verifier module. Primary sources: Workers Builds API (trigger by `commit_hash`, not by a required release branch); Pulumi ESC Cloudflare guide (static API token, not federated CF credentials); Pulumi ESC GitHub Actions guide (OIDC to Pulumi Cloud, then inject into the runner); ADR 0003; #1046 end-state table; #1045's now-obsolete "scope the seven" premise.
- **Sequencing.** Dual-seat spec review (Fable + Codex adversarial) → owner sign-off → `/to-tickets`. Implementation waits on #1048 and #1051. Staging doorbell first; production rings only after staging has published through the door for real. Pulumi Cloud cutover is its own ticket wave with a documented rollback to the R2 backend until Settings are deleted.
- **Security honesty.** CI remains the deployer: it can still ask that an eligible SHA be published, and published code can still read Secrets Store. This campaign removes every **standing** Cloudflare and Pulumi credential from GitHub Settings and from Worker-publish runners. The remaining window is ESC injection inside infra jobs, which is unavoidable while `pulumi up` runs on a GitHub runner, and is smaller than today's catalog job that also held Wrangler.
- **#1046 compatibility.** "Schema before app" becomes `needs: [migrator]` plus a doorbell, instead of `needs: [migrator]` plus Wrangler-on-the-runner. The migrator's capability boundary is unchanged. This spec must not add Builds rights to the migrator Worker.

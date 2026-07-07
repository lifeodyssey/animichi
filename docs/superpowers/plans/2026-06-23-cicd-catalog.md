# CI/CD Pipeline — catalog 接入双级 GitOps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` tracking.

**Goal:** 按 `2026-06-23-cicd-pipeline-design.md` 把 CI/CD 拆成纯 CI + 双级 CD(staging/prod),用 composite action + reusable workflow 复用,Atlas 管 migration,catalog 作为第一个组件走双级 GitOps 上 prod(替代本地手动)。

**Architecture:** `ci.yml`(纯 CI:affected lint/type/test + PR Neon branch 验 migration)+ `_deploy-component.yml`(reusable:atlas→pulumi→wrangler→smoke,唯一一处部署逻辑)+ `cd-staging.yml`(merge→main)/`cd-prod.yml`(tag v*,需 approval),共用 `actions/setup` composite。全官方 action、最新版、SHA-pin。

**Tech Stack:** GitHub Actions(composite action + reusable workflow)、Atlas(`ariga/atlas-action`)、Pulumi(R2 state,stack staging/prod)、Neon(branching)、wrangler、pnpm、Node 24。

## Global Constraints
- worktree `backend-survey`;Node 24。基线:Wave 2 Task 1-4 done(commit 到 `70c595e`)——catalog 已连 neon-http、Pulumi prod stack 在 R2、`supabase/neon/0001_init.sql` 存在。
- **prod 写全部走 CD,绝不本地**(本地被 auto-mode classifier 拦正是信号)。prod deploy 经 GH environment `production`(required reviewer)。
- **所有 action SHA-pin + `# vX.Y.Z` 注释**(过 Sonar 供应链规则)。pin 清单(已查实):
  ```
  actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0          # v7.0.0
  actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e        # v6.4.0
  pnpm/action-setup@0ebf47130e4866e96fce0953f49152a61190b271         # v6.0.9
  astral-sh/setup-uv@fac544c07dec837d0ccb6301d7b5580bf5edae39        # v8.2.0
  dorny/paths-filter@fbd0ab8f3e69293af611ebaee6363fc25e6d187d        # v4.0.1
  ariga/atlas-action@e7cdee90ecc06996f1c055bc01a62f03666cecb4        # v1.15.5
  pulumi/actions@8e5e406f4007fca908480587cb9893c07090f58d           # v7.0.0
  cloudflare/wrangler-action@ebbaa1584979971c8614a24965b4405ff95890e0 # v4.0.0
  neondatabase/create-branch-action@fb620d43d4c565abaf088b848a4e28e5c4ea4d9c # 6.3.1
  neondatabase/delete-branch-action@4468d825d5a88ef4012f1705a82f02ec3072f776 # v3.2.1
  ```
- **零手写脚本** —— 每步用官方 action。无抑制。
- 每个 yaml task 验证:`actionlint`(若装,catch workflow 语法)+ `ruby -ryaml -e "YAML.load_file('<f>'); puts 'ok'"`。
- **不碰** frontend `deploy` job(OpenNext,Wave 4 迁移)——本计划只移 `deploy-catalog`,`deploy` 暂留 ci.yml 并标注 Wave 4。

## 范围
spec §8 的 Wave 2 部分:catalog 走 pipeline。agent/edge/web 后续 wave 按同模式接入。Neon project `$NEON_PROJECT_ID`(animichi),production branch `$NEON_BRANCH_ID`,org `$NEON_ORG_ID`。

---

### Task 1: composite action `actions/setup`

**Files:** Create `.github/actions/setup/action.yml`

**Interfaces:** Produces: 一个 composite action,封装 checkout 后的 pnpm+node 安装。inputs: `python`(bool,默认 false,true 时装 uv)。被 CI 各 job + reusable workflow 当一步用。

- [ ] **Step 1: 写 composite action**

```yaml
name: "Setup toolchain"
description: "pnpm + Node 24 + install (optionally uv for Python)"
inputs:
  python:
    description: "Also set up uv for Python"
    required: false
    default: "false"
runs:
  using: "composite"
  steps:
    - uses: pnpm/action-setup@0ebf47130e4866e96fce0953f49152a61190b271 # v6.0.9
    - uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0
      with:
        node-version: "24"
        cache: "pnpm"
        cache-dependency-path: pnpm-lock.yaml
    - run: pnpm install --frozen-lockfile
      shell: bash
    - if: inputs.python == 'true'
      uses: astral-sh/setup-uv@fac544c07dec837d0ccb6301d7b5580bf5edae39 # v8.2.0
```

- [ ] **Step 2: 验证 yaml**

```bash
which actionlint >/dev/null 2>&1 && actionlint .github/actions/setup/action.yml || true
ruby -ryaml -e "YAML.load_file('.github/actions/setup/action.yml'); puts 'ok'"
```
Expected: `ok`(+ actionlint 0 issue 若装)。

- [ ] **Step 3: Commit**

```bash
git add .github/actions/setup/action.yml
git commit -m "ci: composite action actions/setup (pnpm+node+install, optional uv)"
```

---

### Task 2: ci.yml — 升级 action + affected + 移除 deploy-catalog

**Files:** Modify `.github/workflows/ci.yml`

**Interfaces:** Consumes: Task 1 `./.github/actions/setup`。Produces: 纯 CI workflow(无 catalog CD);新增 `changes` job 输出 affected flags(`catalog`/`agent`/`frontend`/`contract`)供其它 job `if` gate。

- [ ] **Step 1: 加 affected 检测 job(置于 jobs 顶部)**

```yaml
  changes:
    runs-on: ubuntu-latest
    outputs:
      catalog: ${{ steps.f.outputs.catalog }}
      agent: ${{ steps.f.outputs.agent }}
      frontend: ${{ steps.f.outputs.frontend }}
      contract: ${{ steps.f.outputs.contract }}
    steps:
      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
      - uses: dorny/paths-filter@fbd0ab8f3e69293af611ebaee6363fc25e6d187d # v4.0.1
        id: f
        with:
          filters: |
            contract: ['packages/contract/**']
            catalog: ['workers/catalog/**', 'packages/contract/**']
            agent: ['apps/agent/**', 'packages/contract/**']
            frontend: ['frontend/**']
```
(contract 变动扇出到 catalog+agent —— 它们依赖契约。)

- [ ] **Step 2: 各 CI job 加 affected gate + 用 composite setup**

`catalog-quality`: `needs: changes` + `if: ${{ needs.changes.outputs.catalog == 'true' }}`;把 pnpm+node 手动步骤换成 `- uses: ./.github/actions/setup`。`backend-quality`/`backend-test`/`agent-eval`: gate `needs.changes.outputs.agent`,setup 用 `./.github/actions/setup` with `python: true`。`frontend-quality`/`frontend-test`/`frontend-build`: gate `needs.changes.outputs.frontend`。`db-validate`: gate `catalog || agent`(schema 相关)。

- [ ] **Step 3: 升级残余 action 到 SHA-pin + 删 deploy-catalog**

把 `actions/checkout@v6`→`@9c091bb…# v7.0.0`、`setup-node@v6`→`@48b55a0…# v6.4.0`、`setup-uv@v7`→`@fac544c…# v8.2.0`、`pnpm/action-setup@v4`→`@0ebf471…# v6.0.9`(若某 job 还没换成 composite)。**删除整个 `deploy-catalog` job**(line 393,移到 cd-prod/staging,Task 5)。`deploy`(frontend OpenNext)job 暂留,顶部加注释 `# TODO(Wave 4): migrate to cd-*.yml when edge/web decoupled`。

- [ ] **Step 4: 验证**

```bash
which actionlint >/dev/null 2>&1 && actionlint .github/workflows/ci.yml || true
ruby -ryaml -e "YAML.load_file('.github/workflows/ci.yml'); puts 'ok'"
grep -c 'deploy-catalog' .github/workflows/ci.yml   # expect 0
grep -cE 'uses: actions/checkout@v|setup-node@v|action-setup@v4|setup-uv@v7' .github/workflows/ci.yml  # expect 0 (all pinned)
```
Expected: `ok`、deploy-catalog=0、旧版本=0。

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: pure-CI ci.yml — affected (paths-filter) + composite setup + actions pinned latest; remove deploy-catalog (→ cd-*)"
```

---

### Task 3: Atlas 落地(atlas.hcl + 0001 转 baseline)

**Files:** Create `atlas.hcl`、`db/migrations/20260623000001_init.sql`(= 0001 内容)、`db/migrations/atlas.sum`

**Interfaces:** Produces: Atlas versioned migration dir `db/migrations/`;`atlas.hcl` env `neon`(url 来自 env var `DATABASE_URL`,dev 用临时 Neon branch)。供 reusable workflow `atlas migrate apply`。

- [ ] **Step 1: 写 atlas.hcl**

```hcl
env "neon" {
  url = getenv("DATABASE_URL")
  migration {
    dir = "file://db/migrations"
  }
}
```

- [ ] **Step 2: 把 0001_init.sql 转成 baseline migration**

```bash
mkdir -p db/migrations
cp supabase/neon/0001_init.sql db/migrations/20260623000001_init.sql
# 生成 atlas.sum(需要 atlas CLI;CI 用 action,本地若无 atlas 则装)
command -v atlas >/dev/null || curl -sSf https://atlasgo.sh | sh
atlas migrate hash --dir "file://db/migrations"
ls db/migrations/   # expect 20260623000001_init.sql + atlas.sum
```

- [ ] **Step 3: 验证 migration 可 apply(对 Neon spike branch,非 prod)**

```bash
source ~/.nvm/nvm.sh && nvm use 24 >/dev/null 2>&1
DSN=$(neonctl connection-string wave2-spike --project-id $NEON_PROJECT_ID --org-id $NEON_ORG_ID 2>/dev/null)
# spike branch 已有 0001 的表;validate + status 应识别 baseline
atlas migrate validate --dir "file://db/migrations" --dev-url "$DSN" 2>&1 | tail -5 || \
  atlas migrate validate --dir "file://db/migrations" 2>&1 | tail -5
```
Expected: validate 通过(migration 文件 + atlas.sum 一致)。
Fail 回退:若 spike branch schema 与 baseline 冲突,用 `atlas migrate apply --baseline 20260623000001` 标记已应用。

- [ ] **Step 4: Commit**

```bash
git add atlas.hcl db/migrations/
git commit -m "feat(migration): Atlas baseline from 0001_init.sql (db/migrations + atlas.hcl)"
```

---

### Task 4: reusable workflow `_deploy-component.yml`

**Files:** Create `.github/workflows/_deploy-component.yml`

**Interfaces:** Consumes: Task 1 composite, Task 3 atlas dir。Produces: reusable workflow,`workflow_call` inputs `component`(string)/`environment`(string)/`neon_branch`(string);secrets inherit。被 cd-staging/cd-prod 调用。steps: setup → atlas migrate apply(DATABASE_URL=该环境 Neon connStr)→ pulumi up(--stack = environment)→ wrangler deploy(workingDirectory=workers/<component>,注入 DATABASE_URL secret)→ smoke。

- [ ] **Step 1: 写 reusable workflow(以 catalog 为首个 component;component 暂只支持 catalog)**

```yaml
name: deploy-component
on:
  workflow_call:
    inputs:
      component: { required: true, type: string }
      environment: { required: true, type: string }
      pulumi_stack: { required: true, type: string }
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: ${{ inputs.environment }}
    steps:
      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
      - uses: ./.github/actions/setup
      - name: Atlas migrate
        uses: ariga/atlas-action@e7cdee90ecc06996f1c055bc01a62f03666cecb4 # v1.15.5
        with:
          action: migrate/apply
          dir: "file://db/migrations"
          url: ${{ secrets.NEON_DATABASE_URL }}
      - name: Pulumi up
        uses: pulumi/actions@8e5e406f4007fca908480587cb9893c07090f58d # v7.0.0
        with:
          command: up
          stack-name: ${{ inputs.pulumi_stack }}
          work-dir: infra
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          PULUMI_CONFIG_PASSPHRASE: ${{ secrets.PULUMI_CONFIG_PASSPHRASE }}
          PULUMI_BACKEND_URL: ${{ secrets.PULUMI_BACKEND_URL }}
          AWS_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
      - name: Deploy Worker
        uses: cloudflare/wrangler-action@ebbaa1584979971c8614a24965b4405ff95890e0 # v4.0.0
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          wranglerVersion: "4.79.0"
          workingDirectory: workers/${{ inputs.component }}
          command: deploy
          secrets: |
            DATABASE_URL
        env:
          DATABASE_URL: ${{ secrets.NEON_DATABASE_URL }}
      - name: Smoke
        run: echo "smoke for ${{ inputs.component }}@${{ inputs.environment }} — catalog has no public route; verify via service binding / wrangler tail in follow-up"
        shell: bash
```

- [ ] **Step 2: 验证 yaml**

```bash
which actionlint >/dev/null 2>&1 && actionlint .github/workflows/_deploy-component.yml || true
ruby -ryaml -e "YAML.load_file('.github/workflows/_deploy-component.yml'); puts 'ok'"
```
Expected: `ok`。

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/_deploy-component.yml
git commit -m "ci: reusable workflow _deploy-component (atlas→pulumi→wrangler→smoke)"
```

---

### Task 5: cd-staging.yml + cd-prod.yml

**Files:** Create `.github/workflows/cd-staging.yml`、`.github/workflows/cd-prod.yml`

**Interfaces:** Consumes: Task 4 reusable, paths-filter。各自 `changes` job 算 affected → 对 affected 组件 `uses: ./.github/workflows/_deploy-component.yml`。

- [ ] **Step 1: cd-staging.yml(merge→main)**

```yaml
name: CD staging
on:
  push:
    branches: [main]
jobs:
  changes:
    runs-on: ubuntu-latest
    outputs:
      catalog: ${{ steps.f.outputs.catalog }}
    steps:
      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
      - uses: dorny/paths-filter@fbd0ab8f3e69293af611ebaee6363fc25e6d187d # v4.0.1
        id: f
        with:
          filters: |
            catalog: ['workers/catalog/**', 'packages/contract/**', 'db/migrations/**', 'infra/**']
  catalog:
    needs: changes
    if: ${{ needs.changes.outputs.catalog == 'true' }}
    uses: ./.github/workflows/_deploy-component.yml
    with:
      component: catalog
      environment: staging
      pulumi_stack: staging
    secrets: inherit
```

- [ ] **Step 2: cd-prod.yml(tag v*)**

同结构,改 `on: push: tags: ['v*']`,job `catalog` 的 `with.environment: production`、`with.pulumi_stack: prod`。`changes` job 对 tag 用 `dorny/paths-filter` 需 `base`/`ref` —— tag 上用 `predicate-quantifier` 不可靠,改为 `with.base: ${{ github.event.before }}` 或直接对 tag 全部署 catalog(单组件时简单)。**MVP:cd-prod 直接部 catalog**(单组件,affected 等多组件时再加),注释说明。environment `production` 触发 GH 的 required-reviewer gate。

- [ ] **Step 3: 验证**

```bash
for f in cd-staging cd-prod; do
  which actionlint >/dev/null 2>&1 && actionlint .github/workflows/$f.yml || true
  ruby -ryaml -e "YAML.load_file('.github/workflows/$f.yml'); puts '$f ok'"
done
```
Expected: 两个 `ok`。

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/cd-staging.yml .github/workflows/cd-prod.yml
git commit -m "ci: cd-staging (merge→main) + cd-prod (tag v*, prod approval) calling _deploy-component"
```

---

### Task 6: Neon staging branch + GH environments/secrets

**Files:** (无代码;云配置)

**Interfaces:** Produces: Neon `staging` branch + GH environments `staging`/`production` + per-environment secrets。供 cd-* 运行。

- [ ] **Step 1: 建 Neon staging branch**

```bash
source ~/.nvm/nvm.sh && nvm use 24 >/dev/null 2>&1
neonctl branches create --project-id $NEON_PROJECT_ID --org-id $NEON_ORG_ID --name staging --parent production 2>&1 | tail -3
```
Expected: staging branch 建成(从 production fork,带 schema+数据)。

- [ ] **Step 2: 建 GH environments**

```bash
gh api -X PUT repos/lifeodyssey/Seichijunrei-agent/environments/staging 2>&1 | tail -2
# production with required reviewer (self):
gh api -X PUT repos/lifeodyssey/Seichijunrei-agent/environments/production \
  -f "reviewers[][type]=User" -F "reviewers[][id]=$(gh api user --jq .id)" 2>&1 | tail -2
```

- [ ] **Step 3: 设 per-environment secrets(值从 .env / neonctl,不回显)**

```bash
set -a; source ~/Documents/Seichijunrei-agent/.env; set +a
STG=$(neonctl connection-string staging --project-id $NEON_PROJECT_ID --org-id $NEON_ORG_ID 2>/dev/null)
PRD=$(neonctl connection-string production --project-id $NEON_PROJECT_ID --org-id $NEON_ORG_ID 2>/dev/null)
REPO=lifeodyssey/Seichijunrei-agent
for envn in staging production; do
  case $envn in staging) DSN="$STG";; production) DSN="$PRD";; esac
  printf '%s' "$DSN"                       | gh secret set NEON_DATABASE_URL       --env $envn --repo $REPO
  printf '%s' "$PULUMI_BACKEND_URL"        | gh secret set PULUMI_BACKEND_URL      --env $envn --repo $REPO
  printf '%s' "$PULUMI_CONFIG_PASSPHRASE"  | gh secret set PULUMI_CONFIG_PASSPHRASE --env $envn --repo $REPO
  printf '%s' "$R2_ACCESS_KEY_ID"          | gh secret set R2_ACCESS_KEY_ID        --env $envn --repo $REPO
  printf '%s' "$R2_SECRET_ACCESS_KEY"      | gh secret set R2_SECRET_ACCESS_KEY    --env $envn --repo $REPO
  printf '%s' "$CLOUDFLARE_API_TOKEN"      | gh secret set CLOUDFLARE_API_TOKEN    --env $envn --repo $REPO
  printf '%s' "$CLOUDFLARE_ACCOUNT_ID"     | gh secret set CLOUDFLARE_ACCOUNT_ID   --env $envn --repo $REPO
done
gh secret list --env production --repo $REPO | wc -l   # expect 7
```
Expected: 每个 environment 7 个 secret。
Note: staging 的 Pulumi 还需 `pulumi stack init staging` + `pulumi config set` —— 在 Task 7 首次 staging 部署前补,或本地 `pulumi stack init staging` 一次。

- [ ] **Step 4: 记录**(ledger;无 commit —— 纯云配置)

---

### Task 7: catalog 走 CD 上 prod 【端到端 · prod 需 approval】

**Files:** Modify `workers/catalog/wrangler.toml`(uncomment R2 binding)

**Interfaces:** Consumes: Task 1-6。端到端验证整条 pipeline。

- [ ] **Step 1: uncomment catalog R2 binding**

`workers/catalog/wrangler.toml` 取消注释:
```toml
[[r2_buckets]]
binding = "MEDIA_BUCKET"
bucket_name = "catalog-media"
```
(Pulumi `pulumi up` 会建 `catalog-media` bucket;binding 让 catalog 用上。)

- [ ] **Step 2: 本地 pulumi stack init staging(一次性,补 Task 6 Note)**

```bash
cd infra && source ~/Documents/Seichijunrei-agent/.env && export PATH=$HOME/.pulumi/bin:$PATH
export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
pulumi stack init staging 2>&1 | tail -2
STG=$(neonctl connection-string staging --project-id $NEON_PROJECT_ID --org-id $NEON_ORG_ID 2>/dev/null)
pulumi config set --secret catalogDatabaseUrl "$STG" --stack staging
pulumi config set cloudflareAccountId "$CLOUDFLARE_ACCOUNT_ID" --stack staging
```

- [ ] **Step 3: commit + merge backend-survey → main(触发 cd-staging)**

```bash
cd ~/Documents/Seichijunrei-agent/.claude/worktrees/backend-survey
git add workers/catalog/wrangler.toml && git commit -m "feat(wave2): bind catalog MEDIA_BUCKET (catalog-media R2)"
git push origin HEAD:backend-survey
```
然后 **PR backend-survey → main + merge**(CI 绿后)。merge 触发 `cd-staging` → catalog 上 staging。
Expected: cd-staging 绿(atlas migrate staging branch → pulumi up staging → wrangler deploy catalog staging)。

- [ ] **Step 4: tag → cd-prod(prod,需你在 GH 点 approve)**

```bash
git tag v0.4.0 && git push origin v0.4.0
```
`cd-prod` 触发 → 在 `production` environment 等你 **approve** → atlas migrate production → pulumi up prod → wrangler deploy catalog prod。
Expected: approve 后 prod 部署绿;catalog Worker 在 prod 连 Neon production。

- [ ] **Step 5: 验证 prod**

catalog 无 public route → `wrangler tail catalog` 或临时 service-binding 验证 catalog 连 Neon production + 一个读查询返回。确认 0001 schema 在 production branch(`SELECT count(*) FROM points`,管线/seed 后有数据)。

- [ ] **Step 6: 清理 + ledger**

`neonctl branches delete wave2-spike`(Wave 2 spike branch 用完);ledger 记 CI/CD pipeline + catalog prod done。

---

## Self-Review
- **Spec coverage:** §1 职责分离→Task 2(移 CD 出 ci.yml);§2 双级 GitOps→Task 5;§3 affected→Task 2/5(paths-filter);§4 Atlas+Neon branching→Task 3(atlas)+Task 6(staging branch)+ci.yml PR branch(见下 gap);§5 composite+reusable→Task 1+4;§6 action 最新+SHA-pin→Global+全 task;§7 多环境→Task 6;§8 catalog 先行→Task 7。
- **Gap:** spec §4 的 **PR 临时 Neon branch 验 migration**(ci.yml 里 create-branch→atlas→test→delete)本计划未单列 task —— 标为 **Task 2 的后续增强**(catalog 单组件 + staging branch 已验 migration,PR branch 是 P2;多组件时再加,用 `neondatabase/create-branch-action`+`delete-branch-action`)。已在 Global/范围注明,不阻塞 catalog 上线。
- **Placeholder scan:** action SHA、文件、命令均具体;atlas baseline 有 fallback。
- **Consistency:** secret 名统一 `NEON_DATABASE_URL`(reusable)对应 Task 6 设的同名;pulumi stack `staging`/`prod` 一致;component=catalog 贯穿。
- **不在本计划:** agent/edge/web 接入(后续 wave);frontend `deploy` job 迁移(Wave 4);PR Neon branch(P2)。

## Execution Handoff
推荐 **Subagent-Driven**。注意:Task 6(Neon branch + GH env/secrets)+ Task 7(prod 上线)含云操作 + **prod approval 必须由用户在 GitHub 点**;controller 在 Task 7 Step 4(tag→prod)前与用户确认,且 prod 写全在 CD(不本地)。

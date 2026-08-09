# CI/CD Pipeline 重设计 — 严格质量栈 + 单 workflow gate + 全 reusable + 官方 action

## Context

现有 pipeline 首次真跑暴露设计缺陷(CI 假绿 / CD 不 gate CI / deploy 混在 ci.yml / CI 全内联无复用),用户判断"没设计好",要求按 best practice + **严格质量** + `.github/` monorepo 化重做。三轮调研(best practice / 现有 testing-strategy + lint / 网上严格工具 / 官方 action)结论已整合。

**用户硬要求:** ① 单 gate(single workflow + needs);② `.github/` 当 monorepo(CI+CD 全 reusable workflow / composite action,主 workflow 只组合);③ prod human approve;④ **严格 coverage 硬闸**(全局 floor + PR patch);⑤ 测试分层 unit + integration(testcontainer) + contract;⑥ lint **很严**;⑦ security check;⑧ test 并行;⑨ 有 staging 接 api/e2e/smoke;⑩ **有官方 GitHub Action 就用官方 + SHA-pin,没有才 run CLI**。

## 严格质量栈(调研定型)

### Python(agent) — `_python-ci.yml`
- **Ruff**(官方 `astral-sh/ruff-action@0ce1b0bf8b818ef400413f810f8a11cdbda0034b # v4.0.0`):现有 `E/W/F/I/B/C4/UP` + 新增 **`C90`**(`max-complexity=10`,对齐 1-10-50)+ **`S`**(flake8-bandit security,免单独 bandit)
- **mypy --strict**(run CLI;保留 — agent 重度 pydantic/PydanticAI,需 plugin)
- **vulture**(run CLI;dead code,带 whitelist)
- **pip-audit**(官方 `pypa/gh-action-pip-audit@1220774d901786e6f652ae159f7b6bc8fea6d266 # v1.1.0`;依赖 CVE)

### TypeScript(catalog + frontend) — `_ts-ci.yml`(catalog)/`_web-ci.yml`(frontend)
- **tsc**(run CLI):`strict` + **`noUncheckedIndexedAccess`** + **`exactOptionalPropertyTypes`**
- **oxlint**(官方 `oxc-project/oxlint-action@b78c21302e4bc637e83927135c35a6684de1053e # v3.1.0`;快 pre-pass)
- **ESLint**(run CLI):`strictTypeChecked` + `stylisticTypeChecked` + 复杂度规则 + `--max-warnings=0`;**catalog 补 ESLint**(现在完全无 lint)
- **type-coverage**(run CLI):`--at-least 99 --strict`(ratchet up)

### 安全(跨语言) — `_security.yml`
- **Semgrep**(run CLI;官方 action 已废弃 → `pip install semgrep` 跑)
- **gitleaks**(官方 `gitleaks/gitleaks-action@e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e # v3.0.0`;个人/公开 repo 免费 — 本 repo lifeodyssey 个人,OK)
- **TruffleHog**(官方 `trufflesecurity/trufflehog@30d5bb91af1a771378349dbbb0c82129392acf70 # v3.95.6`;`--results=verified`)
- **osv-scanner**(官方 `google/osv-scanner-action@9a498708959aeaef5ef730655706c5a1df1edbc2 # v2.3.8`;多语言 lockfile CVE)
- **actionlint**(run CLI;GHA 语义)+ **zizmor**(官方 `zizmorcore/zizmor-action@192e21d79ab29983730a13d1382995c2307fbcaa # v0.5.7`;GHA 安全)
- **sqlfluff**(run CLI;`supabase/neon/*.sql` migration lint,postgres dialect)

### 测试分层(落地 testing-strategy.md)
- **unit**(pytest,cov floor)· **integration**(testcontainer,镜像换 **`pgvector/pgvector:pg16`** 消 vector 偏差)· **contract**(catalog `tsc` 编译时 oRPC parity 断言)· **api**(FastAPI TestClient + testcontainer)· **eval L1**(deterministic,CI 闸)+ **L2**(single-LLM,CI 闸);L3 monitor-only
- **coverage 硬闸**:全局 floor(backend 80% / frontend 72%↑,只升)+ **PR patch ≥95%**(changed-lines,防灌水);catalog 补 vitest coverage 闸

### 砍掉(避免堆砌)
bandit(Ruff `S` 含)· ty(beta)· Biome 当 type gate(用 ESLint)· SonarQube/Codacy(付费且不如 native 严)· MegaLinter(native 直接进 reusable)· hadolint(agent Dockerfile Wave 3 转 Python Worker 即删)· Pyright(mypy 保留 for pydantic)

## Pipeline 结构

### `.github/` monorepo
```
.github/
├── actions/setup/action.yml          composite: pnpm+node(+uv)
└── workflows/
    ├── _python-ci.yml    reusable: ruff(action)+mypy+vulture+pip-audit(action)+pytest+cov   [agent]
    ├── _ts-ci.yml        reusable: tsc+oxlint(action)+eslint+type-coverage+vitest+cov         [catalog]
    ├── _web-ci.yml        reusable: 同 _ts-ci + next build                                     [frontend]
    ├── _integration.yml  reusable: testcontainer(pgvector)+pytest integration+api+contract
    ├── _security.yml      reusable: semgrep+gitleaks(action)+trufflehog(action)+osv(action)+actionlint+zizmor(action)+sqlfluff
    ├── _eval.yml          reusable: eval L1 + L2
    ├── _deploy-component.yml  reusable: atlas→pulumi→wrangler→smoke (已有,atlas subaction fix)
    ├── _post-deploy-test.yml  reusable: api/e2e/smoke,参数 environment+suite
    └── ci.yml             orchestrator: changes + ci-*/security/integration/eval + deploy-*(needs)
       # 删: cd-staging.yml, cd-prod.yml
```

### orchestrator `ci.yml`(瘦组合)
```
on: push[main]+tags[v*]+pull_request[main]
  changes(paths-filter)
  ci-agent      uses _python-ci   (if PR? affected : 全跑)
  ci-catalog    uses _ts-ci
  ci-frontend   uses _web-ci
  integration   uses _integration (if catalog||agent)
  security      uses _security    (全跑)
  eval          uses _eval        (if agent)
  deploy-staging needs[全部 CI] if push main → _deploy-component(staging) → _post-deploy-test(staging, api+e2e)
  deploy-prod    needs[全部 CI] if tag v*    → ⏸ environment=production(human approve) → _deploy-component(prod) → _post-deploy-test(prod, smoke)
```

### 分层 gate(按速度 — 严且快反馈)
```
pre-commit(<5s,本地 hook): ruff · oxlint · gitleaks
CI PR(并行 reusable,各自 fail-fast):  ci-* · integration · security · eval
   全 needs 绿 ─→ deploy-staging ─→ api+e2e(staging) ─→ tag ─⏸approve─→ deploy-prod ─→ smoke(prod)
```
- **affected 只 PR;push main/tag 全跑**(`if: github.event_name != 'pull_request' || needs.changes.outputs.<X> == 'true'`)
- **CI 全绿才 CD**(deploy `needs:` 所有 CI reusable job)
- **官方 action SHA-pin;无官方的 run CLI(经 setup composite)**

## 文件改动
- 新建 reusable:`_python-ci.yml`/`_ts-ci.yml`/`_web-ci.yml`/`_integration.yml`/`_security.yml`/`_eval.yml`/`_post-deploy-test.yml`
- 重写 `ci.yml` 为 orchestrator;删 `cd-staging.yml`+`cd-prod.yml`;保留 `_deploy-component.yml`+`actions/setup`
- lint 配置:`apps/agent/pyproject.toml`(ruff +C90+S, mypy strict 已严)、`workers/catalog`(加 eslint config + tsconfig strict flags)、`frontend`(eslint strictTypeChecked + tsconfig flags)、`.sqlfluff`、vulture whitelist
- testcontainer 镜像 → `pgvector/pgvector:pg16`(`conftest_db.py`)
- pre-commit:`.pre-commit-config.yaml` 加 ruff+oxlint+gitleaks
- GitHub environments:production(reviewer)、staging

## Verification
- PR:affected 组件的 ci-* + security + integration(if 相关)跑;lint/type/test/cov/security 任一红 → 阻 merge;无 deploy。
- push main:全跑 → 全绿 → deploy-staging → staging api+e2e。**故意推红 commit 验 deploy 被 needs 挡**。
- tag v*:全跑 → 全绿 → ⏸approve → deploy-prod → prod smoke。
- 各严格闸验证:ruff C90 触发(写个 >10 复杂度函数)、type-coverage <99 fail、patch coverage <95% fail、gitleaks 抓假 secret、zizmor 抓 unpinned action。
- 全 workflow `actionlint` + `ruby -ryaml` 校验。

## 落地(分阶段,subagent-driven)
量大,拆波:① lint 配置加严(ruff/eslint/tsconfig/sqlfluff/vulture)+ 本地验证 → ② 建 reusable CI workflows(_python/_ts/_web/_integration/_eval)+ orchestrator 雏形 → ③ _security reusable(官方 action SHA-pin)→ ④ coverage patch 闸 + testcontainer pgvector → ⑤ _post-deploy-test + deploy-* needs gate + 删 cd-* → ⑥ pre-commit hook。每波 PR(这次 CI 真跑全验证)→ 你 merge。先并入未合的 #192(atlas fix)。

# Lint engine migration L1 parity audit

Date: 2026-07-15  
Branch: `feat/lint-oxlint-migration`  
Scope: `workers/catalog`, `workers/users`, and `apps/web`; retired `frontend/` and config-less `packages/contract` are intentionally excluded.

## Method

The audit resolved the final ESLint flat config for a representative production TypeScript file in each package, after inspecting the installed preset definitions in `@eslint/js/src/configs/eslint-recommended.js`, `@typescript-eslint/eslint-plugin/dist/configs/flat/strict-type-checked.js`, and `stylistic-type-checked.js`. Later overrides were applied before counting, so disabled core rules replaced by TypeScript equivalents are not double-counted.

Coverage was checked against installed `oxlint` 1.74.0 and `oxlint-tsgolint` 0.24.0. The mapped 140-rule configuration parses under `oxlint --type-aware --print-config`; adding `no-octal` produces the exact configuration error `Rule no-octal not found in plugin eslint`. The official migration guide confirms flat-config conversion, type-aware tsgolint support, overrides, and side-by-side adoption: https://oxc.rs/docs/guide/usage/linter/migrate-from-eslint. Configuration inheritance and package-local overrides are documented at https://oxc.rs/docs/guide/usage/linter/config.html.

Category definitions:

- **a** — covered under the same rule name.
- **b** — covered under a different name; mapping is recorded below.
- **c** — covered by the tsgolint type-aware backend.
- **d** — not covered and CI-critical; blocks L3.
- **e** — not covered and judged droppable; each entry requires a reason.

## Summary

| Package/effective context | a | b | c | d | e | Total |
|---|---:|---:|---:|---:|---:|---:|
| `workers/catalog` | 51 | 41 | 48 | 0 | 1 | 141 |
| `workers/users` | 51 | 41 | 48 | 0 | 1 | 141 |
| `apps/web` production | 51 | 41 | 48 | 0 | 1 | 141 |
| `apps/web` tests | 51 | 41 | 48 | 0 | 1 | 141 |

The rule names are identical across packages. `apps/web` production changes `max-lines-per-function` from 50 to 10; its `tests/**/*.ts(x)` override restores 50. All variants keep `skipBlankLines` and `skipComments` enabled.

### Full category-d blocker list

None. Category d count is **0**.

### Category-e recorded decision

- `no-octal`: drop. Oxlint 1.74 has no rule by that name, while a temporary `010` TypeScript canary still produced oxlint's parser error `'0'-prefixed octal literals ... are deprecated`. This does not remove protection for valid modern `0o` literals.

## Historical CI-critical rules

| Existing rule | Replacement | Result |
|---|---|---|
| `max-lines-per-function` | same name | Covered by oxlint; package-specific 50 and web 10/50 limits preserved. |
| `@typescript-eslint/no-non-null-assertion` | `typescript/no-non-null-assertion` | Covered natively. |
| `@typescript-eslint/restrict-template-expressions` | `typescript/restrict-template-expressions` | Covered by tsgolint with all original `allow*` options false. |
| `@typescript-eslint/no-confusing-void-expression` | `typescript/no-confusing-void-expression` | Covered by tsgolint. |
| `@typescript-eslint/no-explicit-any` | `typescript/no-explicit-any` | Covered natively. |
| `@typescript-eslint/no-unused-vars` | `typescript/no-unused-vars` | Covered natively; both `argsIgnorePattern` and `varsIgnorePattern` remain `^_`. |

A temporary TypeScript canary produced diagnostics for all six rules above. It also reconfirmed `typescript/no-floating-promises`. The canary file was removed after verification.

## Complete effective-rule inventory

| ESLint effective rule | Effective setting | Category | Oxlint/tsgolint rule | Coverage note |
|---|---|:---:|---|---|
| `for-direction` | error | a | `for-direction` | Native oxlint rule, same name. |
| `no-async-promise-executor` | error | a | `no-async-promise-executor` | Native oxlint rule, same name. |
| `no-case-declarations` | error | a | `no-case-declarations` | Native oxlint rule, same name. |
| `no-compare-neg-zero` | error | a | `no-compare-neg-zero` | Native oxlint rule, same name. |
| `no-cond-assign` | error; "except-parens" | a | `no-cond-assign` | Native oxlint rule, same name. |
| `no-constant-binary-expression` | error | a | `no-constant-binary-expression` | Native oxlint rule, same name. |
| `no-constant-condition` | error; {"checkLoops":"allExceptWhileTrue"} | a | `no-constant-condition` | Native oxlint rule, same name. |
| `no-control-regex` | error | a | `no-control-regex` | Native oxlint rule, same name. |
| `no-debugger` | error | a | `no-debugger` | Native oxlint rule, same name. |
| `no-delete-var` | error | a | `no-delete-var` | Native oxlint rule, same name. |
| `no-dupe-else-if` | error | a | `no-dupe-else-if` | Native oxlint rule, same name. |
| `no-duplicate-case` | error | a | `no-duplicate-case` | Native oxlint rule, same name. |
| `no-empty` | error; {"allowEmptyCatch":false} | a | `no-empty` | Native oxlint rule, same name. |
| `no-empty-character-class` | error | a | `no-empty-character-class` | Native oxlint rule, same name. |
| `no-empty-pattern` | error; {"allowObjectPatternsAsParameters":false} | a | `no-empty-pattern` | Native oxlint rule, same name. |
| `no-empty-static-block` | error | a | `no-empty-static-block` | Native oxlint rule, same name. |
| `no-ex-assign` | error | a | `no-ex-assign` | Native oxlint rule, same name. |
| `no-extra-boolean-cast` | error; {} | a | `no-extra-boolean-cast` | Native oxlint rule, same name. |
| `no-fallthrough` | error; {"allowEmptyCase":false,"reportUnusedFallthroughComment":false} | a | `no-fallthrough` | Native oxlint rule, same name. |
| `no-global-assign` | error; {"exceptions":[]} | a | `no-global-assign` | Native oxlint rule, same name. |
| `no-invalid-regexp` | error; {} | a | `no-invalid-regexp` | Native oxlint rule, same name. |
| `no-irregular-whitespace` | error; {"skipComments":false,"skipJSXText":false,"skipRegExps":false,"skipStrings":true,"skipTemplates":false} | a | `no-irregular-whitespace` | Native oxlint rule, same name. |
| `no-loss-of-precision` | error | a | `no-loss-of-precision` | Native oxlint rule, same name. |
| `no-misleading-character-class` | error; {"allowEscape":false} | a | `no-misleading-character-class` | Native oxlint rule, same name. |
| `no-nonoctal-decimal-escape` | error | a | `no-nonoctal-decimal-escape` | Native oxlint rule, same name. |
| `no-octal` | error | e | — | Droppable: legacy octal literals are syntax errors in the TypeScript/ES-module code this scope lints. |
| `no-prototype-builtins` | error | a | `no-prototype-builtins` | Native oxlint rule, same name. |
| `no-regex-spaces` | error | a | `no-regex-spaces` | Native oxlint rule, same name. |
| `no-self-assign` | error; {"props":true} | a | `no-self-assign` | Native oxlint rule, same name. |
| `no-shadow-restricted-names` | error; {"reportGlobalThis":false} | a | `no-shadow-restricted-names` | Native oxlint rule, same name. |
| `no-sparse-arrays` | error | a | `no-sparse-arrays` | Native oxlint rule, same name. |
| `no-unassigned-vars` | error | a | `no-unassigned-vars` | Native oxlint rule, same name. |
| `no-unexpected-multiline` | error | a | `no-unexpected-multiline` | Native oxlint rule, same name. |
| `no-unsafe-finally` | error | a | `no-unsafe-finally` | Native oxlint rule, same name. |
| `no-unsafe-optional-chaining` | error; {"disallowArithmeticOperators":false} | a | `no-unsafe-optional-chaining` | Native oxlint rule, same name. |
| `no-unused-labels` | error | a | `no-unused-labels` | Native oxlint rule, same name. |
| `no-unused-private-class-members` | error | a | `no-unused-private-class-members` | Native oxlint rule, same name. |
| `no-useless-assignment` | error | a | `no-useless-assignment` | Native oxlint rule, same name. |
| `no-useless-backreference` | error | a | `no-useless-backreference` | Native oxlint rule, same name. |
| `no-useless-catch` | error | a | `no-useless-catch` | Native oxlint rule, same name. |
| `no-useless-escape` | error; {"allowRegexCharacters":[]} | a | `no-useless-escape` | Native oxlint rule, same name. |
| `preserve-caught-error` | error; {"requireCatchParameter":false} | a | `preserve-caught-error` | Native oxlint rule, same name. |
| `require-yield` | error | a | `require-yield` | Native oxlint rule, same name. |
| `use-isnan` | error; {"enforceForIndexOf":false,"enforceForSwitchCase":true} | a | `use-isnan` | Native oxlint rule, same name. |
| `valid-typeof` | error; {"requireStringLiterals":false} | a | `valid-typeof` | Native oxlint rule, same name. |
| `no-var` | error | a | `no-var` | Native oxlint rule, same name. |
| `prefer-const` | error; {"destructuring":"any","ignoreReadBeforeAssign":false} | a | `prefer-const` | Native oxlint rule, same name. |
| `prefer-rest-params` | error | a | `prefer-rest-params` | Native oxlint rule, same name. |
| `prefer-spread` | error | a | `prefer-spread` | Native oxlint rule, same name. |
| `@typescript-eslint/await-thenable` | error | c | `typescript/await-thenable` | Type-aware rule executed by tsgolint. |
| `@typescript-eslint/ban-ts-comment` | error; {"minimumDescriptionLength":10} | b | `typescript/ban-ts-comment` | Native TypeScript syntax rule; namespace changes only. |
| `@typescript-eslint/no-array-constructor` | error | b | `typescript/no-array-constructor` | Native TypeScript syntax rule; namespace changes only. |
| `@typescript-eslint/no-array-delete` | error | c | `typescript/no-array-delete` | Type-aware rule executed by tsgolint. |
| `@typescript-eslint/no-base-to-string` | error | c | `typescript/no-base-to-string` | Type-aware rule executed by tsgolint. |
| `@typescript-eslint/no-confusing-void-expression` | error | c | `typescript/no-confusing-void-expression` | Type-aware rule executed by tsgolint. |
| `@typescript-eslint/no-deprecated` | error | c | `typescript/no-deprecated` | Type-aware rule executed by tsgolint. |
| `@typescript-eslint/no-duplicate-enum-values` | error | b | `typescript/no-duplicate-enum-values` | Native TypeScript syntax rule; namespace changes only. |
| `@typescript-eslint/no-duplicate-type-constituents` | error | c | `typescript/no-duplicate-type-constituents` | Type-aware rule executed by tsgolint. |
| `@typescript-eslint/no-dynamic-delete` | error | b | `typescript/no-dynamic-delete` | Native TypeScript syntax rule; namespace changes only. |
| `@typescript-eslint/no-empty-object-type` | error | b | `typescript/no-empty-object-type` | Native TypeScript syntax rule; namespace changes only. |
| `@typescript-eslint/no-explicit-any` | error | b | `typescript/no-explicit-any` | Native TypeScript syntax rule; namespace changes only. |
| `@typescript-eslint/no-extra-non-null-assertion` | error | b | `typescript/no-extra-non-null-assertion` | Native TypeScript syntax rule; namespace changes only. |
| `@typescript-eslint/no-extraneous-class` | error | b | `typescript/no-extraneous-class` | Native TypeScript syntax rule; namespace changes only. |
| `@typescript-eslint/no-floating-promises` | error | c | `typescript/no-floating-promises` | Type-aware rule executed by tsgolint. |
| `@typescript-eslint/no-for-in-array` | error | c | `typescript/no-for-in-array` | Type-aware rule executed by tsgolint. |
| `@typescript-eslint/no-implied-eval` | error | c | `typescript/no-implied-eval` | Type-aware rule executed by tsgolint. |
| `@typescript-eslint/no-invalid-void-type` | error | b | `typescript/no-invalid-void-type` | Native TypeScript syntax rule; namespace changes only. |
| `@typescript-eslint/no-meaningless-void-operator` | error | c | `typescript/no-meaningless-void-operator` | Type-aware rule executed by tsgolint. |
| `@typescript-eslint/no-misused-new` | error | b | `typescript/no-misused-new` | Native TypeScript syntax rule; namespace changes only. |
| `@typescript-eslint/no-misused-promises` | error | c | `typescript/no-misused-promises` | Type-aware rule executed by tsgolint. |
| `@typescript-eslint/no-misused-spread` | error | c | `typescript/no-misused-spread` | Type-aware rule executed by tsgolint. |
| `@typescript-eslint/no-mixed-enums` | error | c | `typescript/no-mixed-enums` | Type-aware rule executed by tsgolint. |
| `@typescript-eslint/no-namespace` | error | b | `typescript/no-namespace` | Native TypeScript syntax rule; namespace changes only. |
| `@typescript-eslint/no-non-null-asserted-nullish-coalescing` | error | b | `typescript/no-non-null-asserted-nullish-coalescing` | Native TypeScript syntax rule; namespace changes only. |
| `@typescript-eslint/no-non-null-asserted-optional-chain` | error | b | `typescript/no-non-null-asserted-optional-chain` | Native TypeScript syntax rule; namespace changes only. |
| `@typescript-eslint/no-non-null-assertion` | error | b | `typescript/no-non-null-assertion` | Native TypeScript syntax rule; namespace changes only. |
| `@typescript-eslint/no-redundant-type-constituents` | error | c | `typescript/no-redundant-type-constituents` | Type-aware rule executed by tsgolint. |
| `@typescript-eslint/no-require-imports` | error | b | `typescript/no-require-imports` | Native TypeScript syntax rule; namespace changes only. |
| `@typescript-eslint/no-this-alias` | error | b | `typescript/no-this-alias` | Native TypeScript syntax rule; namespace changes only. |
| `@typescript-eslint/no-unnecessary-boolean-literal-compare` | error | c | `typescript/no-unnecessary-boolean-literal-compare` | Type-aware rule executed by tsgolint. |
| `@typescript-eslint/no-unnecessary-condition` | error | c | `typescript/no-unnecessary-condition` | Type-aware rule executed by tsgolint. |
| `@typescript-eslint/no-unnecessary-template-expression` | error | c | `typescript/no-unnecessary-template-expression` | Type-aware rule executed by tsgolint. |
| `@typescript-eslint/no-unnecessary-type-arguments` | error | c | `typescript/no-unnecessary-type-arguments` | Type-aware rule executed by tsgolint. |
| `@typescript-eslint/no-unnecessary-type-assertion` | error | c | `typescript/no-unnecessary-type-assertion` | Type-aware rule executed by tsgolint. |
| `@typescript-eslint/no-unnecessary-type-constraint` | error | b | `typescript/no-unnecessary-type-constraint` | Native TypeScript syntax rule; namespace changes only. |
| `@typescript-eslint/no-unnecessary-type-conversion` | error | c | `typescript/no-unnecessary-type-conversion` | Type-aware rule executed by tsgolint. |
| `@typescript-eslint/no-unnecessary-type-parameters` | error | c | `typescript/no-unnecessary-type-parameters` | Type-aware rule executed by tsgolint. |
| `@typescript-eslint/no-unsafe-argument` | error | c | `typescript/no-unsafe-argument` | Type-aware rule executed by tsgolint. |
| `@typescript-eslint/no-unsafe-assignment` | error | c | `typescript/no-unsafe-assignment` | Type-aware rule executed by tsgolint. |
| `@typescript-eslint/no-unsafe-call` | error | c | `typescript/no-unsafe-call` | Type-aware rule executed by tsgolint. |
| `@typescript-eslint/no-unsafe-declaration-merging` | error | b | `typescript/no-unsafe-declaration-merging` | Native TypeScript syntax rule; namespace changes only. |
| `@typescript-eslint/no-unsafe-enum-comparison` | error | c | `typescript/no-unsafe-enum-comparison` | Type-aware rule executed by tsgolint. |
| `@typescript-eslint/no-unsafe-function-type` | error | b | `typescript/no-unsafe-function-type` | Native TypeScript syntax rule; namespace changes only. |
| `@typescript-eslint/no-unsafe-member-access` | error | c | `typescript/no-unsafe-member-access` | Type-aware rule executed by tsgolint. |
| `@typescript-eslint/no-unsafe-return` | error | c | `typescript/no-unsafe-return` | Type-aware rule executed by tsgolint. |
| `@typescript-eslint/no-unsafe-unary-minus` | error | c | `typescript/no-unsafe-unary-minus` | Type-aware rule executed by tsgolint. |
| `@typescript-eslint/no-unused-expressions` | error; {"allowShortCircuit":false,"allowTaggedTemplates":false,"allowTernary":false} | b | `typescript/no-unused-expressions` | Native TypeScript syntax rule; namespace changes only. |
| `@typescript-eslint/no-unused-vars` | error; {"argsIgnorePattern":"^_","varsIgnorePattern":"^_"} | b | `typescript/no-unused-vars` | Native TypeScript syntax rule; namespace changes only. |
| `@typescript-eslint/no-useless-constructor` | error | b | `typescript/no-useless-constructor` | Native TypeScript syntax rule; namespace changes only. |
| `@typescript-eslint/no-useless-default-assignment` | error | c | `typescript/no-useless-default-assignment` | Type-aware rule executed by tsgolint. |
| `@typescript-eslint/no-wrapper-object-types` | error | b | `typescript/no-wrapper-object-types` | Native TypeScript syntax rule; namespace changes only. |
| `@typescript-eslint/only-throw-error` | error | c | `typescript/only-throw-error` | Type-aware rule executed by tsgolint. |
| `@typescript-eslint/prefer-as-const` | error | b | `typescript/prefer-as-const` | Native TypeScript syntax rule; namespace changes only. |
| `@typescript-eslint/prefer-literal-enum-member` | error | b | `typescript/prefer-literal-enum-member` | Native TypeScript syntax rule; namespace changes only. |
| `@typescript-eslint/prefer-namespace-keyword` | error | b | `typescript/prefer-namespace-keyword` | Native TypeScript syntax rule; namespace changes only. |
| `@typescript-eslint/prefer-promise-reject-errors` | error | c | `typescript/prefer-promise-reject-errors` | Type-aware rule executed by tsgolint. |
| `@typescript-eslint/prefer-reduce-type-parameter` | error | c | `typescript/prefer-reduce-type-parameter` | Type-aware rule executed by tsgolint. |
| `@typescript-eslint/prefer-return-this-type` | error | c | `typescript/prefer-return-this-type` | Type-aware rule executed by tsgolint. |
| `@typescript-eslint/related-getter-setter-pairs` | error | c | `typescript/related-getter-setter-pairs` | Type-aware rule executed by tsgolint. |
| `@typescript-eslint/require-await` | error | c | `typescript/require-await` | Type-aware rule executed by tsgolint. |
| `@typescript-eslint/restrict-plus-operands` | error; {"allowAny":false,"allowBoolean":false,"allowNullish":false,"allowNumberAndString":false,"allowRegExp":false} | c | `typescript/restrict-plus-operands` | Type-aware rule executed by tsgolint. |
| `@typescript-eslint/restrict-template-expressions` | error; {"allowAny":false,"allowBoolean":false,"allowNever":false,"allowNullish":false,"allowNumber":false,"allowRegExp":false} | c | `typescript/restrict-template-expressions` | Type-aware rule executed by tsgolint. |
| `@typescript-eslint/return-await` | error; "error-handling-correctness-only" | c | `typescript/return-await` | Type-aware rule executed by tsgolint. |
| `@typescript-eslint/triple-slash-reference` | error | b | `typescript/triple-slash-reference` | Native TypeScript syntax rule; namespace changes only. |
| `@typescript-eslint/unbound-method` | error | c | `typescript/unbound-method` | Type-aware rule executed by tsgolint. |
| `@typescript-eslint/unified-signatures` | error | b | `typescript/unified-signatures` | Native TypeScript syntax rule; namespace changes only. |
| `@typescript-eslint/use-unknown-in-catch-callback-variable` | error | c | `typescript/use-unknown-in-catch-callback-variable` | Type-aware rule executed by tsgolint. |
| `@typescript-eslint/adjacent-overload-signatures` | error | b | `typescript/adjacent-overload-signatures` | Native TypeScript syntax rule; namespace changes only. |
| `@typescript-eslint/array-type` | error | b | `typescript/array-type` | Native TypeScript syntax rule; namespace changes only. |
| `@typescript-eslint/ban-tslint-comment` | error | b | `typescript/ban-tslint-comment` | Native TypeScript syntax rule; namespace changes only. |
| `@typescript-eslint/class-literal-property-style` | error | b | `typescript/class-literal-property-style` | Native TypeScript syntax rule; namespace changes only. |
| `@typescript-eslint/consistent-generic-constructors` | error | b | `typescript/consistent-generic-constructors` | Native TypeScript syntax rule; namespace changes only. |
| `@typescript-eslint/consistent-indexed-object-style` | error | b | `typescript/consistent-indexed-object-style` | Native TypeScript syntax rule; namespace changes only. |
| `@typescript-eslint/consistent-type-assertions` | error | b | `typescript/consistent-type-assertions` | Native TypeScript syntax rule; namespace changes only. |
| `@typescript-eslint/consistent-type-definitions` | error | b | `typescript/consistent-type-definitions` | Native TypeScript syntax rule; namespace changes only. |
| `@typescript-eslint/dot-notation` | error; {"allowIndexSignaturePropertyAccess":false,"allowKeywords":true,"allowPattern":"","allowPrivateClassPropertyAccess":false,"allowProtectedClassPropertyAccess":false} | c | `typescript/dot-notation` | Type-aware rule executed by tsgolint. |
| `@typescript-eslint/no-confusing-non-null-assertion` | error | b | `typescript/no-confusing-non-null-assertion` | Native TypeScript syntax rule; namespace changes only. |
| `@typescript-eslint/no-empty-function` | error; {"allow":[]} | b | `typescript/no-empty-function` | Native TypeScript syntax rule; namespace changes only. |
| `@typescript-eslint/no-inferrable-types` | error | b | `typescript/no-inferrable-types` | Native TypeScript syntax rule; namespace changes only. |
| `@typescript-eslint/non-nullable-type-assertion-style` | error | c | `typescript/non-nullable-type-assertion-style` | Type-aware rule executed by tsgolint. |
| `@typescript-eslint/prefer-find` | error | c | `typescript/prefer-find` | Type-aware rule executed by tsgolint. |
| `@typescript-eslint/prefer-for-of` | error | b | `typescript/prefer-for-of` | Native TypeScript syntax rule; namespace changes only. |
| `@typescript-eslint/prefer-function-type` | error | b | `typescript/prefer-function-type` | Native TypeScript syntax rule; namespace changes only. |
| `@typescript-eslint/prefer-includes` | error | c | `typescript/prefer-includes` | Type-aware rule executed by tsgolint. |
| `@typescript-eslint/prefer-nullish-coalescing` | error | c | `typescript/prefer-nullish-coalescing` | Type-aware rule executed by tsgolint. |
| `@typescript-eslint/prefer-optional-chain` | error | c | `typescript/prefer-optional-chain` | Type-aware rule executed by tsgolint. |
| `@typescript-eslint/prefer-regexp-exec` | error | c | `typescript/prefer-regexp-exec` | Type-aware rule executed by tsgolint. |
| `@typescript-eslint/prefer-string-starts-ends-with` | error | c | `typescript/prefer-string-starts-ends-with` | Type-aware rule executed by tsgolint. |
| `complexity` | error; 10 | a | `complexity` | Native oxlint rule, same name. |
| `max-depth` | error; 2 | a | `max-depth` | Native oxlint rule, same name. |
| `max-lines-per-function` | error; {"max":50,"skipBlankLines":true,"skipComments":true} | a | `max-lines-per-function` | Native oxlint rule, same name. |

## L2 configuration decisions

- Root `.oxlintrc.json` owns the 140 supported rules, disables oxlint default categories to avoid adding unaudited rules, and enables type-aware analysis.
- Each live package has a local `.oxlintrc.json` extending the root, with its existing generated/build/config ignore patterns preserved.
- `apps/web` retains its production and test function-length distinction through an oxlint override.
- `workers/catalog/scripts/tsconfig.json` gives the already-linted Node build script a discoverable TS7 project. Without it, tsgolint treated Node APIs as error types; the script is not excluded and no semantic rule is weakened.
- L2 kept ESLint scripts/workflow commands unchanged so oxlint could run as a dual-run canary before the L3 flip.

## Verification

- `workers/catalog`: `pnpm run lint:oxlint` exited 0 with no diagnostics.
- `workers/users`: `pnpm run lint:oxlint` exited 0 with no diagnostics.
- `apps/web`: `pnpm run lint:oxlint` exited 0 with no diagnostics.
- Root `pnpm run lint:oxlint` ran all three filters and exited 0.
- The L3 Oxlint gate, `pnpm run lint:oxlint`, uses `--deny-warnings` so warning-level diagnostics fail the command.
- Pre- and post-change `make check` both passed Ruff, formatting, mypy, and 1,039 unit tests at 85.60% coverage, then stopped during integration-test collection because `SUPABASE_DB_URL` and `DEEPSEEK_API_KEY` are absent from this environment.

## L3 outcome

There were **no category-d blockers** in oxlint 1.74 + oxlint-tsgolint 0.24. The live package and CI gates now use strict, type-aware Oxlint with warning denial; ESLint remains only for the retired-frozen `frontend/` surface.

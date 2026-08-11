# Deep-refactor published tickets

Parent: [#936 — Deep Code Refactor: One Turn, One Contract, One Owner](https://github.com/lifeodyssey/animichi/issues/936)  
Published: 2026-08-10  
State: 27 of 27 tickets carry `ready-for-agent`, are native sub-issues of #936, and have native GitHub dependency counts matching the owner-approved Spec.

| Card | Issue | Blocked by |
|---|---|---|
| SAFE-1 | [#937](https://github.com/lifeodyssey/animichi/issues/937) | None |
| CONTRACT-1 | [#938](https://github.com/lifeodyssey/animichi/issues/938) | #937 |
| TURN-1 | [#939](https://github.com/lifeodyssey/animichi/issues/939) | #937 |
| RETENTION-1 | [#940](https://github.com/lifeodyssey/animichi/issues/940) | #937 |
| CATALOG-1 | [#941](https://github.com/lifeodyssey/animichi/issues/941) | #937 |
| CATALOG-2 | [#942](https://github.com/lifeodyssey/animichi/issues/942) | #937 |
| CATALOG-3 | [#943](https://github.com/lifeodyssey/animichi/issues/943) | #937 |
| CATALOG-4 | [#944](https://github.com/lifeodyssey/animichi/issues/944) | #937 |
| AUTH-1 | [#945](https://github.com/lifeodyssey/animichi/issues/945) | #937, #938 |
| CATALOG-5 | [#946](https://github.com/lifeodyssey/animichi/issues/946) | #941, #942 |
| CATALOG-6 | [#947](https://github.com/lifeodyssey/animichi/issues/947) | #942 |
| CATALOG-7 | [#948](https://github.com/lifeodyssey/animichi/issues/948) | #941, #942 |
| TURN-2 | [#949](https://github.com/lifeodyssey/animichi/issues/949) | #937, #938, #939, #945 |
| AUTH-2 | [#950](https://github.com/lifeodyssey/animichi/issues/950) | #937, #945 |
| TURN-3 | [#951](https://github.com/lifeodyssey/animichi/issues/951) | #949 |
| AGENT-1 | [#952](https://github.com/lifeodyssey/animichi/issues/952) | #938, #950, #941, #943 |
| AGENT-2 | [#953](https://github.com/lifeodyssey/animichi/issues/953) | #938, #950 |
| USERS-1 | [#954](https://github.com/lifeodyssey/animichi/issues/954) | #950 |
| TURN-4 | [#955](https://github.com/lifeodyssey/animichi/issues/955) | #951 |
| USERS-2 | [#956](https://github.com/lifeodyssey/animichi/issues/956) | #954, #942, #947 |
| USERS-3 | [#957](https://github.com/lifeodyssey/animichi/issues/957) | #954 |
| WEB-1 | [#958](https://github.com/lifeodyssey/animichi/issues/958) | #937, #955, #950, #954 |
| SESSION-1 | [#959](https://github.com/lifeodyssey/animichi/issues/959) | #938, #955, #950 |
| SESSION-2 | [#960](https://github.com/lifeodyssey/animichi/issues/960) | #955, #950, #958, #959 |
| SESSION-3 | [#961](https://github.com/lifeodyssey/animichi/issues/961) | #937, #955, #950, #958, #940, #959, #960 |
| AGENT-3 | [#962](https://github.com/lifeodyssey/animichi/issues/962) | #938, #961 |
| EDGE-1 | [#963](https://github.com/lifeodyssey/animichi/issues/963) | #955, #950, #952, #953, #962, #954, #956, #957, #961, #941, #942, #943, #944, #946, #947 |

The Spec `needs` column remains the semantic source. This ledger records its GitHub projection. Per-card scratchpad `needs` files are created by `/implement` when the fleet materializes each card; they must contain these exact blocker issue numbers and cannot weaken the native dependency graph.

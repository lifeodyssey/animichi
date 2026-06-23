-- Fix wrong bangumi IDs in seed data.
-- 14 out of 18 seed IDs were incorrect (wrong Bangumi.tv subject IDs).
-- Verified correct IDs via Anitabi API (api.anitabi.cn) and Bangumi.tv (bgm.tv).
--
-- Strategy: delete wrong records; API-first write-through will repopulate
-- correct data from Anitabi on the next user search.

-- Wrong IDs mapped to correct ones:
-- 262243 (ヲタクに恋は難しい) → 160209 (君の名は。)
-- 120632 (Friends Again CD)   → 115908 (響け！ユーフォニアム)
-- 227543 (unknown)            → 183878 (ヴァイオレット・エヴァーガーデン)
-- 11291  (SAO LN)             → 485    (涼宮ハルヒの憂鬱)
-- 18809  (LN)                 → 1424   (けいおん！)
-- 387120 (music album)        → 362577 (すずめの戸締まり)
-- 378862 (おにまい)           → 328609 (ぼっち・ざ・ろっく！)
-- 404804 (天国大魔境)         → 386809 (【推しの子】)
-- 396387 (game)               → 329906 (SPY×FAMILY)
-- 328609 (ぼっち — was swapped with ゆるキャン) → 207195 (ゆるキャン△)
-- 1482   (ef theme song)      → 276    (らき☆すた)
-- 36954  (404)                → 27364  (氷菓)

-- Step 1: Delete orphan points referencing wrong bangumi IDs
DELETE FROM points WHERE bangumi_id IN (
  '262243', '120632', '227543', '11291', '18809', '387120',
  '378862', '404804', '396387', '1482', '36954'
);

-- Step 2: Delete wrong bangumi records
-- Note: 328609 is special — it existed as ゆるキャン△ in seed but is actually
-- ぼっち・ざ・ろっく！ on Anitabi. Delete its stale points too.
DELETE FROM points WHERE bangumi_id = '328609';
DELETE FROM bangumi WHERE id IN (
  '262243', '120632', '227543', '11291', '18809', '387120',
  '378862', '404804', '396387', '328609', '1482', '36954'
);

-- Correct data will be populated by API-first write-through on next user search.
-- The remaining 6 correct IDs (1608, 49294, 165553, 3375, 269235, 324720)
-- are left untouched.

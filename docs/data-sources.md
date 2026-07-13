# Gazetteer data sources

The catalog gazetteer is compiled into an Atlas data migration. Raw source files are not committed.

## MLIT N02-2023 railway stations

- Source: 出典:「国土数値情報（鉄道データ）」国土交通省, [国土数値情報ダウンロードサイト](https://nlftp.mlit.go.jp/ksj/)
- Dataset: N02-2023 station GeoJSON (`N02-23_Station.geojson`)
- Retrieved: 2026-07-14
- SHA256: `0251e06aa68236ca17a613d7b183353fdf6ac9ecb904232fafaa548de42d0e17`

## GeoNames cities500

- Source: [GeoNames](https://www.geonames.org/)
- Dataset: `cities500.zip` / `cities500.txt`
- License: [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/)
- Retrieved: 2026-07-14
- Download archive SHA256: `8dbb6e455549a9775223026b91b43c7d3c19999d6d0f6f84cb6a3a1868bf2767`

## Generation

From the repository root, with the lead-provided raw files in `../gazetteer-raw`:

```sh
node --import tsx workers/catalog/scripts/build-gazetteer.ts \
  --stations ../gazetteer-raw/n02/UTF-8/N02-23_Station.geojson \
  --cities ../gazetteer-raw/cities500.txt \
  --out-sql db/migrations/20260714000002_gazetteer_data.sql \
  --out-audit workers/catalog/data/gazetteer-audit.csv
atlas migrate hash --dir file://db/migrations
```

The generator reads the checked-in Japanese/Chinese city-name mapping at
`apps/agent/agent/agents/data/city_names_jp.json`. It emits stable ordering,
500-row SQL batches, source-file SHA256 values, and the exact command in the
generated migration header. Re-running with identical inputs is byte-identical.

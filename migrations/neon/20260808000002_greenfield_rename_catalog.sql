-- Catalog greenfield rename (#852, PR-2): itinerary_snapshots + bangumi_id columns.
--
-- Per docs/superpowers/specs/2026-08-06-greenfield-language-and-data-plane.md §3.1:
--   route_snapshots  -> itinerary_snapshots (key column bangumi_id)
--   aliases.work_id  -> bangumi_id
--   series_edges.from_work_id/to_work_id -> from_bangumi_id/to_bangumi_id
--   cluster_version.work_id -> bangumi_id
-- ingest_jobs / raw_* / media_assets KEEP work_id (platform tables, D6) —
-- deliberately NOT renamed.
--
-- Pure renames (ALTER TABLE ... RENAME preserves privileges, so the N1 role
-- matrix grants follow the renamed objects automatically).

-- Snapshot table: rename + key column.
ALTER TABLE route_snapshots RENAME TO itinerary_snapshots;
ALTER TABLE itinerary_snapshots RENAME COLUMN work_id TO bangumi_id;
ALTER SEQUENCE route_snapshots_id_seq RENAME TO itinerary_snapshots_id_seq;
ALTER INDEX idx_route_snapshots_work_version RENAME TO idx_itinerary_snapshots_bangumi_version;

-- Blue/green publish pointer.
ALTER TABLE cluster_version RENAME COLUMN work_id TO bangumi_id;

-- Alias pipeline.
ALTER TABLE aliases RENAME COLUMN work_id TO bangumi_id;

-- Series relation graph.
ALTER TABLE series_edges RENAME COLUMN from_work_id TO from_bangumi_id;
ALTER TABLE series_edges RENAME COLUMN to_work_id TO to_bangumi_id;
ALTER INDEX idx_series_edges_to RENAME TO idx_series_edges_to_bangumi;

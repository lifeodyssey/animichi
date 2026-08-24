import { mapSource, type ChainSource } from "./chain";
import atlasSum from "../../../migrations/neon/atlas.sum";
import m00 from "../../../migrations/neon/20260809000000_extensions.sql";
import m01 from "../../../migrations/neon/20260809000001_roles.sql";
import m02 from "../../../migrations/neon/20260809000002_functions.sql";
import m03 from "../../../migrations/neon/20260809000003_sequences.sql";
import m04 from "../../../migrations/neon/20260809000004_table_agent_memory.sql";
import m05 from "../../../migrations/neon/20260809000005_table_agent_memory_metadata.sql";
import m06 from "../../../migrations/neon/20260809000006_table_agent_memory_operations.sql";
import m07 from "../../../migrations/neon/20260809000007_table_aliases.sql";
import m08 from "../../../migrations/neon/20260809000008_table_anon_daily_message_count.sql";
import m09 from "../../../migrations/neon/20260809000009_table_api_keys.sql";
import m10 from "../../../migrations/neon/20260809000010_table_bangumi.sql";
import m11 from "../../../migrations/neon/20260809000011_table_cluster_version.sql";
import m12 from "../../../migrations/neon/20260809000014_table_daily_usage.sql";
import m13 from "../../../migrations/neon/20260809000015_table_feedback.sql";
import m14 from "../../../migrations/neon/20260809000016_table_ingest_jobs.sql";
import m15 from "../../../migrations/neon/20260809000017_table_itinerary_snapshots.sql";
import m16 from "../../../migrations/neon/20260809000018_table_leg_cache.sql";
import m17 from "../../../migrations/neon/20260809000019_table_locations.sql";
import m18 from "../../../migrations/neon/20260809000020_table_location_aliases.sql";
import m19 from "../../../migrations/neon/20260809000021_table_media_assets.sql";
import m20 from "../../../migrations/neon/20260809000022_table_points.sql";
import m21 from "../../../migrations/neon/20260809000023_table_raw_anitabi.sql";
import m22 from "../../../migrations/neon/20260809000024_table_raw_bangumi.sql";
import m23 from "../../../migrations/neon/20260809000025_table_request_log.sql";
import m24 from "../../../migrations/neon/20260809000026_table_saved_routes.sql";
import m25 from "../../../migrations/neon/20260809000027_table_saved_route_anime.sql";
import m26 from "../../../migrations/neon/20260809000028_table_series_edges.sql";
import m27 from "../../../migrations/neon/20260809000029_table_sessions.sql";
import m28 from "../../../migrations/neon/20260809000030_grants.sql";
import m29 from "../../../migrations/neon/20260809000031_defaults.sql";
import m30 from "../../../migrations/neon/20260809000032_drop_api_keys.sql";
import m31 from "../../../migrations/neon/20260811000000_table_turn_reservations.sql";
import m32 from "../../../migrations/neon/20260811000001_turn_outcome.sql";
import m33 from "../../../migrations/neon/20260811000002_table_messages.sql";
import m34 from "../../../migrations/neon/20260811000003_table_saved_route_idempotency.sql";
import m35 from "../../../migrations/neon/20260812000000_catalog_daily_run.sql";
import m36 from "../../../migrations/neon/20260814191301_turn_idempotency_outbox.sql";
import m37 from "../../../migrations/neon/20260824150000_sessions_baseline_drift_repair.sql";

const files: Record<string, string> = {
  "20260809000000_extensions.sql": m00,
  "20260809000001_roles.sql": m01,
  "20260809000002_functions.sql": m02,
  "20260809000003_sequences.sql": m03,
  "20260809000004_table_agent_memory.sql": m04,
  "20260809000005_table_agent_memory_metadata.sql": m05,
  "20260809000006_table_agent_memory_operations.sql": m06,
  "20260809000007_table_aliases.sql": m07,
  "20260809000008_table_anon_daily_message_count.sql": m08,
  "20260809000009_table_api_keys.sql": m09,
  "20260809000010_table_bangumi.sql": m10,
  "20260809000011_table_cluster_version.sql": m11,
  "20260809000014_table_daily_usage.sql": m12,
  "20260809000015_table_feedback.sql": m13,
  "20260809000016_table_ingest_jobs.sql": m14,
  "20260809000017_table_itinerary_snapshots.sql": m15,
  "20260809000018_table_leg_cache.sql": m16,
  "20260809000019_table_locations.sql": m17,
  "20260809000020_table_location_aliases.sql": m18,
  "20260809000021_table_media_assets.sql": m19,
  "20260809000022_table_points.sql": m20,
  "20260809000023_table_raw_anitabi.sql": m21,
  "20260809000024_table_raw_bangumi.sql": m22,
  "20260809000025_table_request_log.sql": m23,
  "20260809000026_table_saved_routes.sql": m24,
  "20260809000027_table_saved_route_anime.sql": m25,
  "20260809000028_table_series_edges.sql": m26,
  "20260809000029_table_sessions.sql": m27,
  "20260809000030_grants.sql": m28,
  "20260809000031_defaults.sql": m29,
  "20260809000032_drop_api_keys.sql": m30,
  "20260811000000_table_turn_reservations.sql": m31,
  "20260811000001_turn_outcome.sql": m32,
  "20260811000002_table_messages.sql": m33,
  "20260811000003_table_saved_route_idempotency.sql": m34,
  "20260812000000_catalog_daily_run.sql": m35,
  "20260814191301_turn_idempotency_outbox.sql": m36,
  "20260824150000_sessions_baseline_drift_repair.sql": m37,
};

/** Compile-time Text modules of `migrations/neon` + `atlas.sum`. */
export const productionChain: ChainSource = mapSource(atlasSum, files);


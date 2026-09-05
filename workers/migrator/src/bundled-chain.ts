import { mapSource, type ChainSource } from "./chain";
import atlasSum from "../../../migrations/neon/atlas.sum";
import m00 from "../../../migrations/neon/20260826000000_extensions.sql";
import m01 from "../../../migrations/neon/20260826000001_roles.sql";
import m02 from "../../../migrations/neon/20260826000002_functions.sql";
import m03 from "../../../migrations/neon/20260826000003_catalog.sql";
import m04 from "../../../migrations/neon/20260826000004_agent.sql";
import m05 from "../../../migrations/neon/20260826000005_users.sql";
import m06 from "../../../migrations/neon/20260829000000_fix_coordinate_sync_precedence.sql";
import m07 from "../../../migrations/neon/20260902000000_agent_runs.sql";
import m08 from "../../../migrations/neon/20260904000000_platform_usage_scope.sql";

const files: Record<string, string> = {
  "20260826000000_extensions.sql": m00,
  "20260826000001_roles.sql": m01,
  "20260826000002_functions.sql": m02,
  "20260826000003_catalog.sql": m03,
  "20260826000004_agent.sql": m04,
  "20260826000005_users.sql": m05,
  "20260829000000_fix_coordinate_sync_precedence.sql": m06,
  "20260902000000_agent_runs.sql": m07,
  "20260904000000_platform_usage_scope.sql": m08,
};

/** Compile-time Text modules of `migrations/neon` + `atlas.sum`. */
export const productionChain: ChainSource = mapSource(atlasSum, files);

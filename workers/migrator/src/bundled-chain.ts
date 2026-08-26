import { mapSource, type ChainSource } from "./chain";
import atlasSum from "../../../migrations/neon/atlas.sum";
import m00 from "../../../migrations/neon/20260826000000_extensions.sql";
import m01 from "../../../migrations/neon/20260826000001_roles.sql";
import m02 from "../../../migrations/neon/20260826000002_functions.sql";
import m03 from "../../../migrations/neon/20260826000003_catalog.sql";
import m04 from "../../../migrations/neon/20260826000004_agent.sql";
import m05 from "../../../migrations/neon/20260826000005_users.sql";

const files: Record<string, string> = {
  "20260826000000_extensions.sql": m00,
  "20260826000001_roles.sql": m01,
  "20260826000002_functions.sql": m02,
  "20260826000003_catalog.sql": m03,
  "20260826000004_agent.sql": m04,
  "20260826000005_users.sql": m05,
};

/** Compile-time Text modules of `migrations/neon` + `atlas.sum`. */
export const productionChain: ChainSource = mapSource(atlasSum, files);


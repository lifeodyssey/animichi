import { definePrismaConfig } from "@prisma/cli-engine";
import { defineConfig } from "@prisma/orm-postgres/config";
import geographyExtensionDescriptor from "./src/geography/control.ts";

export default definePrismaConfig({
  orm: defineConfig({
    contract: "./src/contract.prisma",
    migrations: { dir: "./migrations" },
    extensions: [geographyExtensionDescriptor],
  }),
});

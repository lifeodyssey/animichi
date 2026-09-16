/**
 * Restores the repository's final-newline convention after Prisma's emitter has run.
 * Wired into `contract:emit` so emitting and normalizing are one command.
 */
import { normalizeGeneratedArtifacts, packageRoot } from "./generated-artifacts.ts";

const changed = await normalizeGeneratedArtifacts(packageRoot);
for (const path of changed) process.stdout.write(`newline restored: ${path}\n`);
if (changed.length === 0) process.stdout.write("generated artifacts already end with a newline\n");

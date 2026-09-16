import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { test } from 'node:test';
import { tamperedContract } from './migration-fixtures.ts';
import { prisma, prismaCliOutput } from './prisma-migration.ts';

void test('migration check rejects a tampered body and names the divergent migration', async () => {
  const { directory, firstMigration } = await tamperedContract();
  try {
    await assert.rejects(prisma(['migration', 'check'], directory), (failure: unknown) => {
      const output = prismaCliOutput(failure);
      assert.match(output, /MIGRATION\.CHECK_HASH_MISMATCH/);
      assert.match(output, new RegExp(firstMigration));
      return true;
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

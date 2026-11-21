#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/4890cb20ea2d530b31466b35757be8c25781f5e0d7fa1de46d36cc1cbf1bf5d2/contract';
import startContract from '../../snapshots/4890cb20ea2d530b31466b35757be8c25781f5e0d7fa1de46d36cc1cbf1bf5d2/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/efbac76665a59889ae66de0502ef143733f844ce2545017c54dfd4a8ff1e27c5/contract';
import endContract from '../../snapshots/efbac76665a59889ae66de0502ef143733f844ce2545017c54dfd4a8ff1e27c5/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropTable({ schema: 'public', table: 'cluster_version' }),
      this.dropTable({ schema: 'public', table: 'itinerary_snapshots' }),
    ];
  }
}

await MigrationCLI.run(import.meta.url, M);

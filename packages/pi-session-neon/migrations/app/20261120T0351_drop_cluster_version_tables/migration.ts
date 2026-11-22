#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/b46e7495f3a2bb743df3b178087f4ab828d26d7b646e2e8022baae7caea4f0cc/contract';
import startContract from '../../snapshots/b46e7495f3a2bb743df3b178087f4ab828d26d7b646e2e8022baae7caea4f0cc/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/7d73a5f2acfa6928474c6f724649901767218fb8dde08645960a5ad271d98470/contract';
import endContract from '../../snapshots/7d73a5f2acfa6928474c6f724649901767218fb8dde08645960a5ad271d98470/contract.json' with { type: 'json' };
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

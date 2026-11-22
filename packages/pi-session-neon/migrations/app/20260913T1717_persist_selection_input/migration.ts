#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/76631dc53cd456e89842c1028eebb1568d976bb8748c7e38fa278be878ff6dcd/contract';
import startContract from '../../snapshots/76631dc53cd456e89842c1028eebb1568d976bb8748c7e38fa278be878ff6dcd/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/b46e7495f3a2bb743df3b178087f4ab828d26d7b646e2e8022baae7caea4f0cc/contract';
import endContract from '../../snapshots/b46e7495f3a2bb743df3b178087f4ab828d26d7b646e2e8022baae7caea4f0cc/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

const SELECTION_REQUEST_COLUMN = {
  schema: 'public',
  table: 'agent_admissions',
  column: col('selection_request', 'jsonb', { codecRef: { codecId: 'pg/jsonb@1' } }),
} as const;

const SELECTION_REQUEST_CHECK = {
  schema: 'public',
  table: 'agent_admissions',
  constraint: 'agent_admissions_selection_input_b6697af9',
  expression: "(kind = 'selection') = (selection_request IS NOT NULL)",
} as const;

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn(SELECTION_REQUEST_COLUMN),
      this.addCheckConstraint(SELECTION_REQUEST_CHECK),
    ];
  }
}

await MigrationCLI.run(import.meta.url, M);

#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/a365d7a592491ddc1c965b949b6b6d3b92f4a5b2eb0e482995efb268c3e29fbe/contract';
import startContract from '../../snapshots/a365d7a592491ddc1c965b949b6b6d3b92f4a5b2eb0e482995efb268c3e29fbe/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/4890cb20ea2d530b31466b35757be8c25781f5e0d7fa1de46d36cc1cbf1bf5d2/contract';
import endContract from '../../snapshots/4890cb20ea2d530b31466b35757be8c25781f5e0d7fa1de46d36cc1cbf1bf5d2/contract.json' with { type: 'json' };
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

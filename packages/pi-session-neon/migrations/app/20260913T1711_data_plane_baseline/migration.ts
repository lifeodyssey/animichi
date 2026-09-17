#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/a365d7a592491ddc1c965b949b6b6d3b92f4a5b2eb0e482995efb268c3e29fbe/contract';
import endContract from '../../snapshots/a365d7a592491ddc1c965b949b6b6d3b92f4a5b2eb0e482995efb268c3e29fbe/contract.json' with { type: 'json' };
import { DATA_PLANE_ACCESS } from './access.ts';
import { AGENT_TABLES } from './agent-tables.ts';
import { CATALOG_TABLES } from './catalog-tables.ts';
import { CONVERSATION_LEDGER } from './conversation-ledger.ts';
import { INDEXES, UNIQUE_CONSTRAINTS } from './constraints.ts';
import { DATA_PLANE_INDEXES } from './data-plane-indexes.ts';
import { POSTGRES_EXTENSION_OPERATIONS } from './extensions.ts';
import { FOREIGN_KEYS } from './foreign-keys.ts';
import { GENERATED_COORDINATES } from './generated-columns.ts';
import { NATIVE_TABLES } from './native-tables.ts';
import { UPDATED_AT_TRIGGERS } from './triggers.ts';
import { USAGE_METERS } from './usage-meters.ts';
import { USER_TABLES } from './user-tables.ts';
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

/** The raw DDL the baseline applies once the contract's tables and constraints exist. Order is
 * load-bearing: the ledger's `sessions` must exist before the trigger operation attaches
 * `trg_sessions_updated_at` to it, and every table must exist before the grant matrix runs. */
const POST_CONTRACT_OPERATIONS = [
  GENERATED_COORDINATES, CONVERSATION_LEDGER, USAGE_METERS, UPDATED_AT_TRIGGERS, DATA_PLANE_ACCESS,
];

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return this.baselineOperations();
  }

  /** Application order: schema, extensions, contract tables, constraints, then the raw DDL. */
  private baselineOperations() {
    return [
      this.createSchema({ schema: 'public' }),
      ...POSTGRES_EXTENSION_OPERATIONS,
      ...this.contractTables(),
      ...this.dataPlaneConstraints(),
      ...POST_CONTRACT_OPERATIONS,
    ];
  }

  private contractTables() {
    const tables = [...AGENT_TABLES, ...CATALOG_TABLES, ...NATIVE_TABLES, ...USER_TABLES];
    return tables.map((table) => this.createTable(table));
  }

  private dataPlaneConstraints() {
    return [
      ...UNIQUE_CONSTRAINTS.map((constraint) => this.addUnique(constraint)),
      ...INDEXES.map((index) => this.createIndex(index)),
      DATA_PLANE_INDEXES,
      ...FOREIGN_KEYS.map((foreignKey) => this.addForeignKey(foreignKey)),
    ];
  }
}

await MigrationCLI.run(import.meta.url, M);

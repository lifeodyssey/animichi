#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/fceeee3ce8771dd689472b5ce6e03eb56f14863fe75e801b43dfd1cfb15a8924/contract';
import endContract from '../../snapshots/fceeee3ce8771dd689472b5ce6e03eb56f14863fe75e801b43dfd1cfb15a8924/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createSchema({ schema: 'public' }),
      this.createTable({
        schema: 'public',
        table: 'geo_points',
        columns: [
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('location', 'geography(Point,4326)', {
            notNull: true,
            codecRef: { codecId: 'pg/geography@1', typeParams: { srid: 4326 } },
          }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createIndex({
        schema: 'public',
        table: 'geo_points',
        index: 'geo_points_location_gist_fb41678c',
        columns: ['location'],
        extras: { type: 'gist' },
      }),
    ];
  }
}

await MigrationCLI.run(import.meta.url, M);

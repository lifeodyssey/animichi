import { rawSql } from '@prisma/orm-postgres/migration';

const POINT_COORDINATES = `
  FROM pg_attribute AS a
  JOIN pg_class AS c ON c.oid = a.attrelid
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'points'
    AND a.attname IN ('latitude', 'longitude')
    AND a.attnum > 0
    AND NOT a.attisdropped`;

const POINT_COORDINATE_COLUMNS = `SELECT a.attgenerated = '' AND a.attnotnull AS ordinary_not_null ${POINT_COORDINATES}`;

const GENERATED_POINT_COORDINATES = `
  SELECT count(*) = 2
    AND bool_and(a.attgenerated = 's' AND a.attnotnull) AS generated_not_null
  ${POINT_COORDINATES}`;

export const GENERATED_COORDINATES = rawSql({
  id: 'points-generated-coordinates',
  label: 'Derive point coordinates from geography',
  operationClass: 'destructive',
  target: { id: 'postgres' },
  precheck: [{
    description: 'ensure point coordinates are ordinary NOT NULL columns',
    sql: `SELECT count(*) = 2 AND bool_and(ordinary_not_null) AS result FROM (${POINT_COORDINATE_COLUMNS}) AS columns`,
  }],
  execute: [{
    description: 'replace point coordinates with stored generated columns',
    sql: `ALTER TABLE public.points
      DROP COLUMN latitude,
      DROP COLUMN longitude,
      ADD COLUMN latitude double precision GENERATED ALWAYS AS (ST_Y(location::geometry)) STORED NOT NULL,
      ADD COLUMN longitude double precision GENERATED ALWAYS AS (ST_X(location::geometry)) STORED NOT NULL`,
  }],
  postcheck: [{
    description: 'verify point coordinates are stored generated NOT NULL columns',
    sql: `SELECT generated_not_null AS result FROM (${GENERATED_POINT_COORDINATES}) AS columns`,
  }],
});

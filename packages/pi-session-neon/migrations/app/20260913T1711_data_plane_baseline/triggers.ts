import { rawSql } from '@prisma/orm-postgres/migration';

const UPDATE_TRIGGER_TARGETS = [
  { trigger: 'trg_bangumi_updated_at', table: 'bangumi', label: 'bangumi' },
  { trigger: 'trg_points_updated_at', table: 'points', label: 'points' },
  { trigger: 'trg_routes_updated_at', table: 'saved_routes', label: 'saved-routes' },
] as const;

const triggerSteps = UPDATE_TRIGGER_TARGETS.map(({ trigger, table, label }) => ({
  description: `create the ${label} updated-at trigger`,
  sql: `CREATE TRIGGER ${trigger}
      BEFORE UPDATE ON public.${table}
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at()`,
}));

export const UPDATED_AT_TRIGGERS = rawSql({
  id: 'data-plane-updated-at-triggers',
  label: 'Maintain data-plane updated-at timestamps',
  operationClass: 'additive',
  target: { id: 'postgres' },
  precheck: [],
  execute: [{
    description: 'create the shared updated-at trigger function',
    sql: `CREATE OR REPLACE FUNCTION public.update_updated_at() RETURNS trigger
      LANGUAGE plpgsql
      AS $function$
      BEGIN
        NEW.updated_at := NOW();
        RETURN NEW;
      END;
      $function$`,
  }, ...triggerSteps],
  postcheck: [{
    description: 'verify updated-at triggers and removed coordinate synchronization',
    sql: `SELECT to_regprocedure('public.update_updated_at()') IS NOT NULL
      AND (SELECT count(*) = 3
        FROM pg_trigger AS trigger_record
        JOIN pg_class AS target_table ON target_table.oid = trigger_record.tgrelid
        JOIN pg_namespace AS target_namespace ON target_namespace.oid = target_table.relnamespace
        WHERE target_namespace.nspname = 'public'
          AND trigger_record.tgname = ANY(ARRAY['${UPDATE_TRIGGER_TARGETS.map(({ trigger }) => trigger).join("','")}'])
          AND NOT trigger_record.tgisinternal)
      AND NOT EXISTS (
        SELECT 1
        FROM pg_trigger AS trigger_record
        JOIN pg_class AS target_table ON target_table.oid = trigger_record.tgrelid
        JOIN pg_namespace AS target_namespace ON target_namespace.oid = target_table.relnamespace
        WHERE target_namespace.nspname = 'public'
          AND trigger_record.tgname LIKE '%sync%coordinates%') AS result`,
  }],
});

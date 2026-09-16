import { rawSql } from '@prisma/orm-postgres/migration';

const POSTGRES_EXTENSIONS = ['postgis', 'pgcrypto', 'pg_trgm', 'vector'] as const;

type PostgresExtension = (typeof POSTGRES_EXTENSIONS)[number];

const extensionSql = (extension: PostgresExtension) => `CREATE EXTENSION IF NOT EXISTS "${extension}"`;

const extensionVersionSql = (extension: PostgresExtension) =>
  `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = '${extension}' AND extversion <> '') AS result`;

function extensionOperation(extension: PostgresExtension) {
  const execute = [{ description: `create extension "${extension}"`, sql: extensionSql(extension) }];
  const postcheck = [{ description: `verify extension "${extension}" has a version`, sql: extensionVersionSql(extension) }];
  return rawSql({ id: `extension.${extension}`, label: `Create extension "${extension}"`,
    operationClass: 'additive', target: { id: 'postgres' }, precheck: [], execute, postcheck });
}

export const POSTGRES_EXTENSION_OPERATIONS = POSTGRES_EXTENSIONS.map(extensionOperation);

export function requiredString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`Catalog row ${key} is not a string`);
  return value;
}

export function nullableString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error(`Catalog row ${key} is not nullable text`);
  return value;
}

export function requiredNumber(row: Record<string, unknown>, key: string): number {
  const value = Number(row[key]);
  if (!Number.isFinite(value)) throw new Error(`Catalog row ${key} is not numeric`);
  return value;
}

export function nullableNumber(row: Record<string, unknown>, key: string): number | null {
  if (row[key] === null || row[key] === undefined) return null;
  return requiredNumber(row, key);
}

export function nullableTimestamp(row: Record<string, unknown>, key: string): Date | string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (value instanceof Date || typeof value === "string") return value;
  throw new Error(`Catalog row ${key} is not a timestamp`);
}

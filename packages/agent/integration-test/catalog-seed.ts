import type { NeonQueryFunction } from "@neondatabase/serverless";

export async function seedCatalog(sql: NeonQueryFunction<false, false>) {
  await sql.transaction([
    sql`INSERT INTO bangumi(id,title,points_count) VALUES ('1556','Native Catalog Proof',2)`,
    sql`INSERT INTO points(id,bangumi_id,name,latitude,longitude,episode) VALUES
      ('catalog-south','1556','South Shrine',35,139,1),
      ('catalog-north','1556','North Shrine',35.002,139,2)`,
    sql`INSERT INTO aliases(bangumi_id,alias,alias_normalized,source,priority)
      VALUES ('1556','Native Catalog Proof','native catalog proof','manual',100)`,
  ]);
}

/** Twelve points of one work, so a route's frozen summary carries every ordered stop id. */
export async function seedSubsetCatalog(sql: NeonQueryFunction<false, false>) {
  const points = Array.from({ length: 12 }, (_unused, index) => ({ id: `route-${String(index + 1).padStart(2, "0")}`,
    name: `Route Stop ${String(index + 1)}`, latitude: 35 + index / 100, longitude: 139 + index / 100, episode: index + 1 }));
  await sql.transaction([
    sql`INSERT INTO bangumi(id,title,points_count) VALUES ('1557','Subset Proof',12)`,
    ...points.map((point) => sql`INSERT INTO points(id,bangumi_id,name,latitude,longitude,episode)
      VALUES (${point.id},'1557',${point.name},${point.latitude},${point.longitude},${point.episode})`),
    sql`INSERT INTO aliases(bangumi_id,alias,alias_normalized,source,priority)
      VALUES ('1557','Subset Proof','subset proof','manual',100)`,
  ]);
}

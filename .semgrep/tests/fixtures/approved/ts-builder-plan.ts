// APPROVED: a builder plan whose PostgreSQL-specific expressions are `fns.raw` /
// `match.raw` fragments. Their interpolations are BOUND values, so no caller
// input reaches SQL text — this is the shape the repository's query layer is
// made of, and the rule must not flag it.
export function popularPlan(query: any, minRating: number): unknown {
  return query.builder.public.bangumi
    .select("id", "title")
    .select("points", (fields: any, fns: any) =>
      fns.raw`coalesce(${fields.points_count}, 0)`.returns("pg/int4@1"))
    .where((fields: any, match: any) =>
      match.raw`${fields.rating} >= ${minRating}`.returns("pg/bool@1"))
    .orderBy((fields: any, fns: any) => fns.raw`${fields.rating} is null`.returns("pg/bool@1"))
    .limit(20)
    .build();
}

export const UNIQUE_CONSTRAINTS = [{
  schema: 'public', table: 'agent_admissions', constraint: 'agent_admissions_operation_id_key', columns: ['operation_id'],
}, {
  schema: 'public', table: 'agent_admissions', constraint: 'agent_admissions_session_id_client_message_id_key', columns: ['session_id', 'client_message_id'],
}, {
  schema: 'public', table: 'aliases', constraint: 'aliases_bangumi_id_alias_source_key', columns: ['bangumi_id', 'alias', 'source'],
}, {
  schema: 'public', table: 'catalog_provenance', constraint: 'catalog_provenance_scope_entity_id_key', columns: ['scope', 'entity_id'],
}, {
  schema: 'public', table: 'cluster_version', constraint: 'cluster_version_bangumi_id_version_key', columns: ['bangumi_id', 'version'],
}, {
  schema: 'public', table: 'pi_records', constraint: 'pi_records_session_id_seq_key', columns: ['session_id', 'seq'],
}, {
  schema: 'public', table: 'saved_route_anime', constraint: 'saved_route_anime_saved_route_id_position_key', columns: ['saved_route_id', 'position'],
}] as const;

export const INDEXES = [{
  schema: 'public', table: 'agent_admissions', index: 'agent_admissions_unresolved_4731a1b2', columns: ['kind', 'created_at'], extras: { where: "state IN ('pending', 'accepted')" },
}, {
  schema: 'public', table: 'agent_settlements', index: 'agent_settlements_unsettled_3325215f', columns: ['operation_id'], extras: { where: 'settled_at IS NULL' },
}, {
  schema: 'public', table: 'aliases', index: 'idx_aliases_normalized', columns: ['alias_normalized'],
}, {
  schema: 'public', table: 'catalog_provenance', index: 'idx_catalog_provenance_work', columns: ['work_id'],
}, {
  schema: 'public', table: 'catalog_runs', index: 'idx_catalog_runs_status', columns: ['status'],
}, {
  schema: 'public', table: 'cluster_version', index: 'idx_cluster_version_current', columns: ['bangumi_id', 'is_current'],
}, {
  schema: 'public', table: 'cluster_version', index: 'uq_cluster_version_one_current', columns: ['bangumi_id'], extras: { where: 'is_current', unique: true },
}, {
  schema: 'public', table: 'itinerary_snapshots', index: 'idx_itinerary_snapshots_bangumi_version', columns: ['bangumi_id', 'cluster_version'],
}, {
  schema: 'public', table: 'location_aliases', index: 'idx_location_aliases_norm', columns: ['alias_normalized'],
}, {
  schema: 'public', table: 'points', index: 'idx_points_bangumi', columns: ['bangumi_id'],
}, {
  schema: 'public', table: 'points', index: 'idx_points_location', columns: ['location'], extras: { type: 'gist' },
}, {
  schema: 'public', table: 'saved_route_anime', index: 'idx_saved_route_anime_bangumi', columns: ['bangumi_id'],
}, {
  schema: 'public', table: 'saved_route_idempotency', index: 'idx_saved_route_idempotency_expires', columns: ['expires_at'],
}, {
  schema: 'public', table: 'saved_routes', index: 'idx_saved_routes_user', columns: ['user_id'],
}, {
  schema: 'public', table: 'series_edges', index: 'idx_series_edges_to_bangumi', columns: ['to_bangumi_id'],
}] as const;

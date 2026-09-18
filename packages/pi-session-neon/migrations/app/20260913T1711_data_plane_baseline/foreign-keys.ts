export const FOREIGN_KEYS = [{
  schema: 'public', table: 'agent_admissions',
  foreignKey: { name: 'agent_admissions_session_id_fkey', columns: ['session_id'], references: { schema: 'public', table: 'pi_sessions', columns: ['id'] }, onDelete: 'cascade' },
}, {
  schema: 'public', table: 'agent_open_operations',
  foreignKey: { name: 'agent_open_operations_operation_id_fkey', columns: ['operation_id'], references: { schema: 'public', table: 'agent_admissions', columns: ['operation_id'] }, onDelete: 'cascade' },
}, {
  schema: 'public', table: 'agent_settlements',
  foreignKey: { name: 'agent_settlements_operation_id_fkey', columns: ['operation_id'], references: { schema: 'public', table: 'agent_admissions', columns: ['operation_id'] }, onDelete: 'cascade' },
}, {
  schema: 'public', table: 'location_aliases',
  foreignKey: { name: 'location_aliases_location_id_fkey', columns: ['location_id'], references: { schema: 'public', table: 'locations', columns: ['id'] }, onDelete: 'cascade' },
}, {
  schema: 'public', table: 'pi_list_values',
  foreignKey: { name: 'pi_list_values_session_id_fkey', columns: ['session_id'], references: { schema: 'public', table: 'pi_sessions', columns: ['id'] }, onDelete: 'cascade' },
}, {
  schema: 'public', table: 'pi_records',
  foreignKey: { name: 'pi_records_session_id_fkey', columns: ['session_id'], references: { schema: 'public', table: 'pi_sessions', columns: ['id'] }, onDelete: 'cascade' },
}, {
  schema: 'public', table: 'pi_scalar_values',
  foreignKey: { name: 'pi_scalar_values_session_id_fkey', columns: ['session_id'], references: { schema: 'public', table: 'pi_sessions', columns: ['id'] }, onDelete: 'cascade' },
}, {
  schema: 'public', table: 'points',
  foreignKey: { name: 'points_bangumi_id_fkey', columns: ['bangumi_id'], references: { schema: 'public', table: 'bangumi', columns: ['id'] } },
}, {
  schema: 'public', table: 'saved_route_anime',
  foreignKey: { name: 'saved_route_anime_saved_route_id_fkey', columns: ['saved_route_id'], references: { schema: 'public', table: 'saved_routes', columns: ['id'] }, onDelete: 'cascade' },
}, {
  schema: 'public', table: 'saved_route_anime',
  foreignKey: { name: 'saved_route_anime_bangumi_id_fkey', columns: ['bangumi_id'], references: { schema: 'public', table: 'bangumi', columns: ['id'] } },
}] as const;

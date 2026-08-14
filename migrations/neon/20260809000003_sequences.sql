-- Sequences (+ setval)
--
-- Only the memory-version sequence remains: serial identities for
-- Animichi-owned entities were retired in the #992 UUIDv7 cutover and the
-- native uuidv7() default owns identity generation (20260809000007_table_aliases,
-- 20260809000011_table_cluster_version, 20260809000017_table_itinerary_snapshots,
-- 20260811000000_table_turn_reservations, 20260811000002_table_messages).

CREATE SEQUENCE public.agent_memory_versions
    START WITH 0
    INCREMENT BY 1
    MINVALUE 0
    NO MAXVALUE
    CACHE 1;

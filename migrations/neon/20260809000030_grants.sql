-- Grants

GRANT USAGE ON SCHEMA public TO readonly;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.agent_memory TO agent_svc;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.agent_memory_metadata TO agent_svc;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.agent_memory_operations TO agent_svc;

GRANT SELECT,USAGE ON SEQUENCE public.agent_memory_versions TO agent_svc;

GRANT ALL ON TABLE public.aliases TO catalog_svc;
GRANT SELECT ON TABLE public.aliases TO readonly;

GRANT SELECT,USAGE ON SEQUENCE public.aliases_id_seq TO catalog_svc;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.anon_daily_message_count TO agent_svc;
GRANT SELECT,DELETE ON TABLE public.anon_daily_message_count TO jobs_svc;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.api_keys TO agent_svc;

GRANT ALL ON TABLE public.bangumi TO catalog_svc;
GRANT SELECT ON TABLE public.bangumi TO agent_svc;
GRANT SELECT ON TABLE public.bangumi TO readonly;

GRANT ALL ON TABLE public.cluster_version TO catalog_svc;
GRANT SELECT ON TABLE public.cluster_version TO readonly;

GRANT SELECT,USAGE ON SEQUENCE public.cluster_version_id_seq TO catalog_svc;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.conversation_messages TO agent_svc;
GRANT SELECT,DELETE ON TABLE public.conversation_messages TO jobs_svc;

GRANT SELECT,USAGE ON SEQUENCE public.conversation_messages_id_seq TO agent_svc;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.conversations TO agent_svc;
GRANT SELECT,DELETE ON TABLE public.conversations TO jobs_svc;

GRANT SELECT,INSERT,UPDATE ON TABLE public.daily_usage TO agent_svc;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.feedback TO agent_svc;

GRANT ALL ON TABLE public.ingest_jobs TO catalog_svc;

GRANT ALL ON TABLE public.itinerary_snapshots TO catalog_svc;
GRANT SELECT ON TABLE public.itinerary_snapshots TO readonly;

GRANT SELECT,USAGE ON SEQUENCE public.itinerary_snapshots_id_seq TO catalog_svc;

GRANT ALL ON TABLE public.leg_cache TO catalog_svc;
GRANT SELECT ON TABLE public.leg_cache TO readonly;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.location_aliases TO catalog_svc;
GRANT SELECT ON TABLE public.location_aliases TO readonly;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.locations TO catalog_svc;
GRANT SELECT ON TABLE public.locations TO readonly;

GRANT ALL ON TABLE public.media_assets TO catalog_svc;
GRANT SELECT ON TABLE public.media_assets TO readonly;

GRANT ALL ON TABLE public.points TO catalog_svc;
GRANT SELECT ON TABLE public.points TO agent_svc;
GRANT SELECT ON TABLE public.points TO readonly;

GRANT ALL ON TABLE public.raw_anitabi TO catalog_svc;
GRANT SELECT ON TABLE public.raw_anitabi TO readonly;

GRANT ALL ON TABLE public.raw_bangumi TO catalog_svc;
GRANT SELECT ON TABLE public.raw_bangumi TO readonly;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.request_log TO agent_svc;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.saved_route_anime TO users_svc;
GRANT SELECT ON TABLE public.saved_route_anime TO readonly;

GRANT SELECT ON TABLE public.saved_routes TO agent_svc;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.saved_routes TO users_svc;
GRANT SELECT ON TABLE public.saved_routes TO readonly;
GRANT SELECT ON TABLE public.saved_routes TO jobs_svc;

GRANT ALL ON TABLE public.series_edges TO catalog_svc;
GRANT SELECT ON TABLE public.series_edges TO readonly;

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.sessions TO agent_svc;
GRANT SELECT,DELETE ON TABLE public.sessions TO jobs_svc;

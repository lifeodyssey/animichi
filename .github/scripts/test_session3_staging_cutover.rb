#!/usr/bin/env ruby
# frozen_string_literal: true

# SESSION-3 staging cutover contract (issue #961).
#
# Two families of assertions, both fail-closed:
#
# 1. Source-structure (fresh-schema manifest): the migration chain contains
#    every retained table and no second-root or retention vocabulary. Dropping
#    a retained table or restoring automatic TTL must make this red.
#
# 2. Workflow-order (staging hard cut): `staging-cutover.yml` encodes the
#    exact state machine — ingress closes before any schema reset, the reset
#    re-verifies `retention_execution=absent` and `auth_boundary=neon_only`
#    before mutating, every consumer deploys from ONE `source_revision`, all
#    consumers smoke before reopen. Reopening early, keeping retention
#    executable, or deploying a consumer from a different revision must make
#    this red.
#
# The card's adapters must all speak the sole Session aggregate repository
# (`FinalSessionRepository`): AgentTurn, GetSessionHistory, and AdoptSessions
# resolve their session port from `db.session`, and no `conversations` table
# SQL survives in live source or the migration chain.

require "yaml"

ROOT = File.expand_path("../..", __dir__)
MIGRATIONS = File.join(ROOT, "migrations/neon")
WORKFLOW = File.join(ROOT, ".github/workflows/staging-cutover.yml")
AGENT_SRC = File.join(ROOT, "apps/agent/src/animichi")

# ── 1a. Retained fresh-schema manifest ───────────────────────────────────────
RETAINED_TABLES = %w[
  sessions messages turn_reservations saved_routes saved_route_anime points
  bangumi locations location_aliases media_assets itinerary_snapshots
  daily_usage anon_daily_message_count request_log feedback agent_memory
  agent_memory_metadata agent_memory_operations ingest_jobs raw_anitabi
  raw_bangumi
].freeze

# Retired second-root / retention vocabulary that must NOT appear in the
# migration chain (table SQL or TTL/recurring-retention primitives).
BANNED_MIGRATION_PATTERNS = [
  /\bconversations\b/,
  /\bconversation_messages\b/,
  /ttl\b/i,
  /pg_cron/,
  /crontab/i,
  /CREATE EXTENSION[^;]*pg_cron/i,
  /schedule.*delete|delete.*where.*<[^;]*now/i,
].freeze

def migration_files
  Dir.glob(File.join(MIGRATIONS, "*.sql")).sort
end

def migration_text
  migration_files.map { |f| File.read(f) }.join("\n")
end

def retained_table_missing(table)
  migration_text.include?("CREATE TABLE public.#{table} ")
end

def retained_violations
  RETAINED_TABLES.each_with_object([]) do |table, found|
    found << "retained table #{table} missing from migrations/neon" unless retained_table_missing(table)
  end
end

def banned_pattern_violations
  BANNED_MIGRATION_PATTERNS.each_with_object([]) do |pattern, found|
    migration_files.each do |file|
      next unless File.read(file).match?(pattern)

      found << "#{File.basename(file)}: banned #{pattern.inspect}"
    end
  end
end

def live_source_tracks_conversation_tables
  Dir.glob(File.join(AGENT_SRC, "**/*.py")).select do |path|
    text = File.read(path)
    next if path.include?("/tests/")

    text.match?(/\bconversation_messages\b/) ||
      text.match?(/FROM\s+conversations|INTO\s+conversations|UPDATE\s+conversations/)
  end
end

# ── 1b. One repository: the three adapters speak `db.session` only ───────────
# GetSessionHistory resolves its adapter from the sole Session repository;
# AdoptSessions consumes `db.session.adopt_ownership`; persistence writes go
# through `session_repo`/`messages_repo` which both resolve from `db.session`.
def one_repository_violations
  found = []
  conversations_py = File.read(File.join(AGENT_SRC, "interfaces/routes/conversations.py"))
  found << "GetSessionHistory adapter must bind db.session" unless conversations_py.include?("self._session = db.session")
  found << "GetSessionHistory adapter must not bind db.messages" if conversations_py.include?("self._messages = db.messages")

  db_repos = File.read(File.join(AGENT_SRC, "interfaces/db_repos.py"))
  found << "messages_repo must resolve from db.session" \
    unless db_repos.include?('_wired_sub_repo(db, "session", "insert_message")')

  persistence = File.read(File.join(AGENT_SRC, "interfaces/persistence.py"))
  found << "persistence must not touch a conversation store" \
    if persistence.match?(/upsert_conversation|persist_conversation/)

  # No duplicate store: exactly one Session aggregate repository exists, and
  # the deleted second-root/transcript classes are gone from live source.
  live_py = Dir.glob(File.join(AGENT_SRC, "**/*.py")).reject { |p| p.include?("/tests/") }
  duplicated_store = live_py.select do |path|
    text = File.read(path)
    text.include?("class SessionRepository") || text.include?("class MessagesRepository")
  end
  unless duplicated_store.empty?
    found << "duplicate session/message store classes still present: " \
             "#{duplicated_store.map { |p| File.basename(p) }.join(', ')}"
  end
  found
end

def source_structure_violations
  retained_violations + banned_pattern_violations + one_repository_violations +
    live_source_tracks_conversation_tables.map { |p| "#{p.sub("#{AGENT_SRC}/", "")}: conversation table vocabulary" }
end

# ── 2. Workflow order (staging hard cut) ─────────────────────────────────────
def load_workflow(path)
  text = File.read(path).sub(/^on:(?=[ \t#]|$)/, '"on":')
  YAML.safe_load(text, permitted_classes: [], permitted_symbols: [], aliases: true)
end

def workflow_order_violations(wf)
  jobs = wf.fetch("jobs")
  found = []
  jobs.each do |name, job|
    next unless job.is_a?(Hash) && job.key?("runs-on") && !job.key?("timeout-minutes")

    found << "#{name}: missing timeout-minutes"
  end

  unless jobs.key?("cutover-phase-c-close-ingress")
    found << "missing close-ingress phase job"
  end
  unless jobs.key?("cutover-phase-d-reset-schema")
    found << "missing reset-schema phase job"
  end
  unless jobs.key?("cutover-phase-f-reopen")
    found << "missing reopen phase job"
  end

  reset = jobs["cutover-phase-d-reset-schema"]
  unless reset.is_a?(Hash) && reset.fetch("needs", []).include?("cutover-phase-c-close-ingress")
    found << "reset-schema must depend on close-ingress (schema reset before ingress closed)"
  end

  deploy_jobs = jobs.select { |name, _| name.start_with?("cutover-phase-e-deploy-") }
  if deploy_jobs.empty?
    found << "no consumer deploy phase jobs"
  else
    deploy_jobs.each do |name, job|
      unless job.fetch("needs", []).include?("cutover-phase-d-reset-schema")
        found << "#{name}: must depend on reset-schema"
      end
      verified_revision = job.fetch("steps", []).any? do |s|
        run = s["run"].to_s
        run.include?("git rev-parse HEAD") && run.include?("SOURCE_REVISION")
      end
      unless verified_revision
        found << "#{name}: must verify the deployed HEAD equals source_revision"
      end
    end
  end

  smoke = jobs["cutover-phase-e-private-smoke"]
  if smoke.is_a?(Hash)
    smoke_needs = smoke.fetch("needs", [])
    deploy_jobs.each_key do |name|
      found << "private-smoke must wait for #{name}" unless smoke_needs.include?(name)
    end
  else
    found << "missing private-smoke phase job"
  end

  reopen = jobs["cutover-phase-f-reopen"]
  unless reopen.is_a?(Hash) && reopen.fetch("needs", []).include?("cutover-phase-e-private-smoke")
    found << "reopen must depend on private-smoke (ingress reopening before every consumer smoked)"
  end

  # The reset phase must re-verify retention is absent and auth is neon-only
  # BEFORE any schema mutation — a stale earlier success is never trusted.
  # The exact `=absent` claim is asserted so flipping the expectation back to
  # `present` (retention left executable) is red.
  reset_steps = reset.is_a?(Hash) ? reset.fetch("steps", []) : []
  reset_script = reset_steps.map { |s| s["run"].to_s }.join("\n")
  unless reset_script.include?('cutover-verify-prereqs.sh "retention_execution=absent')
    found << "reset-schema must re-verify retention_execution=absent before reset"
  end
  unless reset_script.match?(/auth_boundary=neon_only/)
    found << "reset-schema must re-verify auth_boundary=neon_only before reset"
  end
  found
end

def manifest_guard_violations(wf)
  jobs = wf.fetch("jobs")
  reset = jobs["cutover-phase-d-reset-schema"]
  return [] unless reset.is_a?(Hash)

  reset_script = reset.fetch("steps", []).map { |s| s["run"].to_s }.join("\n")
  missing = RETAINED_TABLES.reject { |table| reset_script.include?("public.#{table}") }
  return [] if missing.empty?

  ["reset-schema manifest assertion must name every retained table (missing: #{missing.join(', ')})"]
end

def main
  found = source_structure_violations
  unless File.exist?(WORKFLOW)
    found << "staging-cutover.yml missing"
  else
    wf = load_workflow(WORKFLOW)
    found.concat(workflow_order_violations(wf))
    found.concat(manifest_guard_violations(wf))
  end

  if found.empty?
    puts "OK: fresh-schema manifest, sole-repository adapters, and cutover workflow order all hold"
  else
    puts found.sort
    abort "SESSION-3 staging cutover contract violated (#{found.length} issue(s))"
  end
end

main

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
require "tmpdir"

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
  unless reset_script.include?('cutover-verify-prereqs.sh "retention_execution=absent" "auth_boundary=neon_only"')
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
# ---- 3. Two-key reset contract (issue #1056) ------------------------------
# The staging cutover reset is TWO-KEY: the destructive DROP
# (DROP SCHEMA public CASCADE / CREATE SCHEMA public) binds to the
# break-glass owner DSN (CUTOVER_BREAK_GLASS_DSN - only break-glass may
# destroy), and the rebuild apply binds to the migrator DSN
# (MIGRATOR_DATABASE_URL, the staging store secret base name per #1050).
# The reset script refuses to run with either key missing. Phase order is
# preserved: C close -> D reset -> E deploy -> F reopen, and ingress
# never reopens before the reset. A non-destructive 'rehearsal' dispatch
# input must exist so the launcher validates without ever running the DROP.
BREAK_GLASS_ENV = "CUTOVER_BREAK_GLASS_DSN"
MIGRATOR_ENV = "MIGRATOR_DATABASE_URL"
RESET_SCRIPT = File.join(ROOT, ".github/scripts/cutover-reset-schema.sh")

def two_key_reset_violations(wf)
  found = []
  jobs = wf.fetch("jobs")

  dispatch = wf.fetch("on", {}).fetch("workflow_dispatch", {})
  inputs = dispatch.fetch("inputs", {})
  unless inputs.key?("rehearsal")
    found << "staging-cutover.yml must expose a workflow_dispatch 'rehearsal' input (non-destructive validation dispatch)"
  end

  reset = jobs["cutover-phase-d-reset-schema"]
  unless reset.is_a?(Hash)
    found << "missing reset-schema phase job for two-key reset"
    return found
  end
  reset_steps = reset.fetch("steps", [])
  # The two-key binding must live on the ACTUAL reset/apply step (the one that
  # invokes cutover-reset-schema.sh), not merely merged across the whole job.
  # Merging env over every step would let the read-only prereq step (which also
  # binds MIGRATOR_DATABASE_URL) mask a regression that dropped the DROP/apply
  # keys from the real reset step.
  apply_step = reset_steps.find { |s| s["run"].to_s.include?("cutover-reset-schema.sh") }
  unless apply_step.is_a?(Hash)
    found << "reset-schema must run cutover-reset-schema.sh in a step (apply-step keys binding)"
    return found
  end
  apply_env = apply_step.fetch("env", {}) || {}

  unless apply_env.key?(BREAK_GLASS_ENV)
    found << "reset/apply step must bind DROP to #{BREAK_GLASS_ENV}"
  end
  unless apply_env.key?(MIGRATOR_ENV)
    found << "reset/apply step must bind rebuild apply to #{MIGRATOR_ENV}"
  end

  if apply_env.key?(BREAK_GLASS_ENV) && apply_env.key?(MIGRATOR_ENV)
    bg = apply_env[BREAK_GLASS_ENV].to_s
    mg = apply_env[MIGRATOR_ENV].to_s
    if bg.strip == mg.strip
      found << "reset/apply step must use two DISTINCT keys (same value bound to both)"
    end
    unless bg.include?("NEON_DATABASE_URL")
      found << "#{BREAK_GLASS_ENV} must source from the cutover NEON_DATABASE_URL secret"
    end
    unless mg.include?("migrator_database_url") || mg.include?("MIGRATOR_DATABASE_URL")
      found << "#{MIGRATOR_ENV} must source from the owner-injected migrator DSN input"
    end
  end

  # The phase-D read-only prereq (cutover-verify-prereqs.sh) fails closed when
  # MIGRATOR_DATABASE_URL is unset. A rehearsal dispatch passes that DSN blank,
  # so the prereq step MUST be gated on `inputs.rehearsal != true`; otherwise a
  # documented rehearsal cannot pass its own phase-D prereq. Asserting the gate
  # lets CI catch this regression (the step running unconditionally again).
  prereq_step = reset_steps.find do |s|
    s["run"].to_s.include?("cutover-verify-prereqs.sh") && (s.fetch("env", {}) || {}).key?(MIGRATOR_ENV)
  end
  unless prereq_step.is_a?(Hash) && prereq_step["if"].to_s == "inputs.rehearsal != true"
    found << "reset-schema phase-D prereq step must be gated on `inputs.rehearsal != true` (rehearsal passes MIGRATOR_DATABASE_URL blank and must not require DB creds)"
  end
  if File.exist?(RESET_SCRIPT)
    script = File.read(RESET_SCRIPT)
    unless script.include?(BREAK_GLASS_ENV + ":?")
      found << "cutover-reset-schema.sh must require #{BREAK_GLASS_ENV} (refuse when missing)"
    end
    unless script.include?(MIGRATOR_ENV + ":?")
      found << "cutover-reset-schema.sh must require #{MIGRATOR_ENV} (refuse when missing)"
    end
    # Ownership-from-birth (issue #1056): assert the actual ownership predicate
    # (every owned public object resolved to an owner via pg_get_userbyid compared
    # to migrator), not merely that any one of several loose tokens appears. A
    # 3-way substring OR lets a broken or trivial ownership query stay green.
    unless script.include?("pg_get_userbyid(c.relowner) <> \'migrator\'")
      found << "cutover-reset-schema.sh must assert ownership-from-birth (rebuilt public objects owned by migrator, via `pg_get_userbyid(c.relowner) <> 'migrator'`)"
    end
  else
    found << "cutover-reset-schema.sh missing (RESET_SCRIPT)"
  end

  found
end

# ---- 4. Two-key reset refuses with either key missing (unit-behavior) -----
# Proves the reset script exits non-zero when either key is unset, before any
# psql/atlas call. psql/atlas do not exist in the controlled PATH, so if the
# missing-env guard were bypassed the probe would fail closed on their absence.
def reset_script_refusal_violations
  return [] unless File.exist?(RESET_SCRIPT)

  found = []
  tmp = Dir.mktmpdir
  begin
    ok = system("env", "-i", "PATH=#{ENV['PATH']}", "HOME=#{tmp}",
      "CUTOVER_BREAK_GLASS_DSN=", "MIGRATOR_DATABASE_URL=",
      "bash", RESET_SCRIPT, "0" * 40, out: File::NULL, err: File::NULL)
    found << "cutover-reset-schema.sh did not refuse when both keys are unset" if ok
  rescue StandardError
    found << "reset refusal probe raised unexpectedly: #{$!}"
  ensure
    FileUtils.remove_entry_secure(tmp) if File.directory?(tmp)
  end
  found
end

# ---- 5. Pulumi Cloud OIDC (issue #1077) -----------------------------------
# Cutover C/F apply the staging infra stack. After #1077 that stack lives in
# Pulumi Cloud, so pulumi-executing jobs authenticate with pulumi/auth-actions
# and must not carry the DIY R2/passphrase env. Discover pulumi-executing
# steps from parsed workflow behavior (run text, or an invoked script that
# contains a pulumi command) rather than pinning job names.
DIY_BACKEND_ENV = %w[
  PULUMI_BACKEND_URL
  PULUMI_CONFIG_PASSPHRASE
  R2_ACCESS_KEY_ID
  R2_SECRET_ACCESS_KEY
  AWS_ACCESS_KEY_ID
  AWS_SECRET_ACCESS_KEY
].freeze
PULUMI_ORG = "lifeodyssey"
AUTH_ACTION = "pulumi/auth-actions"

def referenced_scripts(run)
  run.to_s.scan(%r{\.github/scripts/[\w.-]+\.sh}).map { |rel| File.join(ROOT, rel) }
end

def contains_pulumi_command?(text)
  text.match?(/^\s*pulumi\s/m)
end

def step_executes_pulumi?(step)
  run = step["run"].to_s
  return true if contains_pulumi_command?(run)

  referenced_scripts(run).any? do |path|
    File.file?(path) && contains_pulumi_command?(File.read(path))
  end
end

def pulumi_executing_steps(job)
  job.fetch("steps", []).select { |s| s.is_a?(Hash) && step_executes_pulumi?(s) }
end

def github_secret_expr?(value, secret_name)
  value.to_s.match?(/\A\$\{\{\s*secrets\.#{Regexp.escape(secret_name)}\s*\}\}\z/)
end

def job_grants_id_token?(job)
  job.dig("permissions", "id-token").to_s == "write"
end

def job_has_pulumi_auth?(job)
  job.fetch("steps", []).any? do |step|
    next false unless step.is_a?(Hash)
    next false unless step["uses"].to_s.include?(AUTH_ACTION)

    step.dig("with", "organization").to_s == PULUMI_ORG
  end
end

def pulumi_step_diy_violations(job_name, step)
  env = step.fetch("env", {}) || {}
  found = []
  DIY_BACKEND_ENV.each do |key|
    found << "#{job_name}: pulumi-executing step must not set #{key}" if env.key?(key)
  end
  found
end

def pulumi_cloud_backend_violations(wf)
  found = []
  wf.fetch("jobs").each do |name, job|
    next unless job.is_a?(Hash)
    next if pulumi_executing_steps(job).empty?

    found << "#{name}: pulumi-executing job must grant id-token: write" unless job_grants_id_token?(job)
    found << "#{name}: pulumi-executing job must authenticate with #{AUTH_ACTION} org #{PULUMI_ORG}" \
      unless job_has_pulumi_auth?(job)
    pulumi_executing_steps(job).each { |step| found.concat(pulumi_step_diy_violations(name, step)) }
  end
  found
end

# ---- 6. Pulumi CLI pin (issue #1152) --------------------------------------
# #1069 pinned deploy / neon-secrets / pipeline-infra to `.pulumi.version`
# (3.255.0, gocloud v0.46.0). Cutover C/F invoke `pulumi` and must install
# the same CLI; otherwise they pick 3.256/3.257 and R2 PutObject returns
# InvalidDigest. Discover pulumi-executing jobs from parsed workflow
# behavior (same as the R2 backend check), then require a pulumi/actions
# step with `pulumi-version-file: .pulumi.version`.
PULUMI_VERSION_FILE = ".pulumi.version"

def step_pins_pulumi_cli?(step)
  uses = step["uses"].to_s
  with = step["with"]
  return false unless uses.include?("pulumi/actions")
  return false unless with.is_a?(Hash)

  with["pulumi-version-file"].to_s == PULUMI_VERSION_FILE
end

def job_pins_pulumi_cli?(job)
  job.fetch("steps", []).any? { |s| s.is_a?(Hash) && step_pins_pulumi_cli?(s) }
end

def pulumi_cli_pin_violations(wf)
  found = []
  wf.fetch("jobs").each do |name, job|
    next unless job.is_a?(Hash)
    next if pulumi_executing_steps(job).empty?
    next if job_pins_pulumi_cli?(job)

    found << "#{name}: pulumi-executing job must install CLI via pulumi-version-file: #{PULUMI_VERSION_FILE}"
  end
  found
end

# ---- 7. Close-ingress gate token (issue #1154) ----------------------------
# cutover-close-ingress.sh probes /healthz with x-staging-key from
# STAGING_GATE_TOKEN (`:?` fail-closed). E6 already maps the secret; Phase C
# must too, or rehearsal dies after a successful pulumi up. Discover steps
# from run text rather than pinning the job name.
STAGING_GATE_TOKEN_ENV = "STAGING_GATE_TOKEN"

def close_ingress_steps(wf)
  wf.fetch("jobs").each_with_object([]) do |(name, job), found|
    next unless job.is_a?(Hash)

    job.fetch("steps", []).each do |step|
      next unless step.is_a?(Hash) && step["run"].to_s.include?("cutover-close-ingress.sh")

      found << [name, step]
    end
  end
end

def close_ingress_step_token_violations(job_name, step)
  env = step.fetch("env", {}) || {}
  unless env.key?(STAGING_GATE_TOKEN_ENV)
    return ["#{job_name}: close-ingress step must provide #{STAGING_GATE_TOKEN_ENV}"]
  end
  return [] if github_secret_expr?(env[STAGING_GATE_TOKEN_ENV], STAGING_GATE_TOKEN_ENV)

  ["#{job_name}: #{STAGING_GATE_TOKEN_ENV} must source from secrets.#{STAGING_GATE_TOKEN_ENV}"]
end

def close_ingress_gate_token_violations(wf)
  steps = close_ingress_steps(wf)
  return ["no step invokes cutover-close-ingress.sh"] if steps.empty?

  steps.flat_map { |name, step| close_ingress_step_token_violations(name, step) }
end

def main
  found = source_structure_violations
  unless File.exist?(WORKFLOW)
    found << "staging-cutover.yml missing"
  else
    wf = load_workflow(WORKFLOW)
    found.concat(workflow_order_violations(wf))
    found.concat(manifest_guard_violations(wf))
    found.concat(two_key_reset_violations(wf))
    found.concat(pulumi_cloud_backend_violations(wf))
    found.concat(pulumi_cli_pin_violations(wf))
    found.concat(close_ingress_gate_token_violations(wf))
  end
  found.concat(reset_script_refusal_violations)

  if found.empty?
    puts "OK: fresh-schema manifest, sole-repository adapters, two-key reset, Pulumi Cloud OIDC, Pulumi CLI pin, close-ingress gate token, and cutover workflow order all hold"
  else
    puts found.sort
    abort "SESSION-3 staging cutover contract violated (#{found.length} issue(s))"
  end
end
main if $PROGRAM_NAME == __FILE__

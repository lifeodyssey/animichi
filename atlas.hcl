env "neon" {
  url = getenv("DATABASE_URL")
  migration {
    dir = "file://db/migrations"
  }
  # Scope atlas to public so its (DB-wide) clean check ignores Neon's built-in
  # neon_auth schema (undeletable → the DB is never DB-wide "clean"). public holds
  # the revisions table; the init migration itself creates the catalog schema +
  # tables. Verified via dry-run against the staging branch.
  schemas = ["public"]
}

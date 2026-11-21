/** `@neondatabase/serverless` 1.2.0 and later name themselves in every connection string they send. */
const DRIVER_APPLICATION_NAME = "pkg:npm/%40neondatabase/serverless@";

/**
 * The DSN the code under test handed `@neondatabase/serverless`, read back off the request the
 * driver sent to Neon's HTTP endpoint. Since 1.2.0 the driver appends its own `application_name`
 * (`pkg:npm/%40neondatabase/serverless@<version>`) to the `Neon-Connection-String` header; that
 * parameter is the driver's, not the caller's, so it is the one thing removed before a test
 * compares the DSN. An absent header reads as no DSN at all.
 */
export function dsnGivenToDriver(headers: Headers): string {
  const sent = headers.get("Neon-Connection-String");
  if (sent === null) return "";
  const url = new URL(sent);
  if ((url.searchParams.get("application_name") ?? "").startsWith(DRIVER_APPLICATION_NAME)) url.searchParams.delete("application_name");
  return url.href;
}

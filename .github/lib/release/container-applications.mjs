import { execFileSync } from 'node:child_process';

/** The container applications the platform lists right now, as the deploy
 * evidence records them: an id and a name, nothing the account could not
 * publish. Both reads #1596 AC5 is judged by — the one before the smoke and the
 * recorder's own after it — come from here, so they cannot disagree on shape. */
export function readContainerApplications() {
  const listed = JSON.parse(execFileSync('pnpm', ['exec', 'wrangler', 'containers', 'list', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }));
  return listed.map((application) => ({ id: application.id, name: application.name }));
}

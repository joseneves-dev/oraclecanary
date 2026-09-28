// Container health check: exits 1 when the indexer (or the alerts notifier) has not completed a run
// recently. Usage: tsx src/healthcheck.ts  (reads HEARTBEAT_FILE and CHECK_INTERVAL_SECONDS like they do)
import { stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HEARTBEAT_FILE = process.env.HEARTBEAT_FILE ?? join(tmpdir(), 'oraclecanary-indexer.heartbeat');
const INTERVAL_SECONDS = Number(process.env.CHECK_INTERVAL_SECONDS ?? 60);
// Allow a few slow or failed runs before reporting the container as unhealthy.
const MAX_AGE_MS = INTERVAL_SECONDS * 3 * 1000 + 60_000;

try {
  const age = Date.now() - (await stat(HEARTBEAT_FILE)).mtimeMs;
  if (age > MAX_AGE_MS) {
    console.error(`Last complete run was ${Math.round(age / 1000)}s ago`);
    process.exit(1);
  }
} catch {
  console.error('No complete run recorded yet');
  process.exit(1);
}

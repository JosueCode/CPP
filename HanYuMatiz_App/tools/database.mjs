import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export function databaseConfig({ admin = false } = {}) {
  const url = admin ? process.env.HANYUMATIZ_DATABASE_ADMIN_URL : process.env.HANYUMATIZ_DATABASE_URL;
  if (url) {
    const parsed = new URL(url);
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
    // pg connection-string SSL options can override the explicit TLS object.
    // External connections always verify certificates; trust custom CAs through Node's CA configuration.
    if (!local) for (const key of ['ssl','sslmode','sslcert','sslkey','sslrootcert']) parsed.searchParams.delete(key);
    return { connectionString: local ? url : parsed.toString(), ...(local ? {} : { ssl: { rejectUnauthorized: true } }),
      connectionTimeoutMillis: 5000, max: 8 };
  }
  const path = process.env.HANYUMATIZ_DB_CONFIG || `${ROOT}.local/postgres.json`;
  let value;
  try { value = JSON.parse(readFileSync(path, 'utf8')); }
  catch { throw new Error('No hay conexión PostgreSQL configurada. Ejecuta npm run db:start y npm run db:import.'); }
  return { ...(admin ? value.admin : value.runtime), connectionTimeoutMillis: 5000, max: 8 };
}
export function createPool(options = {}) { return new pg.Pool(databaseConfig(options)); }
export async function readBootstrap(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const current = await client.query('SELECT v.version,v.metadata,a.delivery_mode FROM catalog_active a JOIN catalog_versions v ON v.version=a.version');
    if (!current.rows.length) throw new Error('Catálogo PostgreSQL aún no importado.');
    const { version, metadata, delivery_mode } = current.rows[0];
    const rows = await client.query('SELECT kind,payload FROM content_entities WHERE content_version=$1 ORDER BY ordinal,id', [version]);
    const byKind = new Map();
    for (const row of rows.rows) {
      if (!byKind.has(row.kind)) byKind.set(row.kind, []);
      byKind.get(row.kind).push(row.payload);
    }
    const map = { words:'word', contrasts:'contrast', scenarios:'scenario', exercises:'exercise',
      examples:'example', relations:'relation', fixtures:'fixture', levels:'level', lessons:'lesson' };
    const output = { ...metadata, mode: delivery_mode, dataVersion: version };
    for (const [key,kind] of Object.entries(map)) output[key] = byKind.get(kind) || [];
    await client.query('COMMIT');
    return output;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

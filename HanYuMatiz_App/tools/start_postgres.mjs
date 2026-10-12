import { mkdirSync, readFileSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { ROOT } from './database.mjs';

const container = 'hanyumatiz-postgres';
export async function startPostgres() {
  const dir = `${ROOT}.local`;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const configPath = `${dir}/postgres.json`;
  let config;
  if (existsSync(configPath)) config = JSON.parse(readFileSync(configPath, 'utf8'));
  else {
    const base = { host:'127.0.0.1', port:5434, database:'hanyumatiz' };
    config = { admin:{ ...base,user:'hanyumatiz_owner',password:randomBytes(32).toString('base64url') },
      runtime:{ ...base,user:'hanyumatiz_app',password:randomBytes(32).toString('base64url') } };
    writeFileSync(configPath, JSON.stringify(config), { mode:0o600, flag:'wx' });
  }
  chmodSync(configPath, 0o600);
  const envPath = `${dir}/postgres-container.env`;
  writeFileSync(envPath, `POSTGRES_DB=${config.admin.database}\nPOSTGRES_USER=${config.admin.user}\nPOSTGRES_PASSWORD=${config.admin.password}\n`, { mode:0o600 });
  chmodSync(envPath, 0o600);
  const exists = spawnSync('docker',['inspect','--format','{{.State.Running}}',container],{encoding:'utf8'});
  let run;
  if (exists.status === 0) run = spawnSync('docker',['start',container],{encoding:'utf8'});
  else run = spawnSync('docker',['run','--detach','--name',container,'--restart','unless-stopped',
    '--publish',`127.0.0.1:${config.admin.port}:5432`,'--env-file',envPath,
    '--mount',`type=volume,source=hanyumatiz-postgres-data,target=/var/lib/postgresql/data`,
    'postgres:17-alpine'],{encoding:'utf8'});
  if (run.status !== 0) throw new Error('Docker no pudo arrancar PostgreSQL; revisa disponibilidad del puerto y del contenedor.');
  let ready = false;
  for (let i=0;i<40;i++) {
    const client = new pg.Client({ ...config.admin, connectionTimeoutMillis:1000 });
    try { await client.connect(); await client.query('SELECT 1'); ready=true; }
    catch { await new Promise(resolve => setTimeout(resolve,500)); }
    finally { await client.end().catch(()=>{}); }
    if (ready) break;
  }
  if (!ready) throw new Error('PostgreSQL no respondió dentro de 20 segundos.');
  return { host:config.admin.host,port:config.admin.port,database:config.admin.database };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startPostgres().then(info => console.log(`PostgreSQL listo en ${info.host}:${info.port}; credenciales privadas en .local/postgres.json.`))
    .catch(error => { console.error(error.message); process.exitCode=1; });
}

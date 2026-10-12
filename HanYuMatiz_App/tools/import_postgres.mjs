import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPool, databaseConfig, ROOT } from './database.mjs';

const topKinds = { words:'word',contrasts:'contrast',scenarios:'scenario',exercises:'exercise',examples:'example',
  relations:'relation',fixtures:'fixture',levels:'level',lessons:'lesson' };

export function normalizeCatalog(catalog) {
  if (!catalog || typeof catalog.dataVersion !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(catalog.dataVersion))
    throw new Error('Versión del catálogo inválida.');
  const entities = [], links = [], seen = new Map();
  function add(kind,value,ordinal) {
    const id = String(value?.id ?? '');
    if (!id || id.length>180) throw new Error(`ID inválido en ${kind}.`);
    const key = `${kind}:${id}`;
    if (seen.has(key)) { if (JSON.stringify(seen.get(key).payload) !== JSON.stringify(value)) throw new Error(`ID duplicado con contenido distinto: ${key}`); return; }
    const item = { kind,id,ordinal,payload:value }; seen.set(key,item); entities.push(item);
  }
  for (const [key,kind] of Object.entries(topKinds)) {
    const values = catalog[key] || [];
    if (!Array.isArray(values)) throw new Error(`${key} debe ser una lista.`);
    values.forEach((value,index)=>add(kind,value,index));
  }
  for (const [index,word] of (catalog.words || []).entries()) {
    (word.readings || []).forEach((reading,number)=>add('reading',reading,index*1000+number));
    (word.senses || []).forEach((sense,number)=>add('sense',sense,index*1000+number));
  }
  // Catalogs may nest lessons under levels while also supplying a top-level lessons array.
  let lessonNumber = (catalog.lessons || []).length;
  for (const level of catalog.levels || []) for (const unit of level.units || [])
    for (const lesson of unit.lessons || []) add('lesson',lesson,lessonNumber++);
  function link(source,relation,targetKind,targetId) {
    if (targetId === undefined || targetId === null || targetId === '') return;
    if (!seen.has(`${targetKind}:${targetId}`)) throw new Error(`Vínculo roto: ${source.kind}:${source.id} -> ${targetKind}:${targetId}`);
    links.push({ sourceKind:source.kind,sourceId:source.id,relation,targetKind,targetId:String(targetId) });
  }
  for (const item of entities) {
    const p=item.payload;
    if (item.kind==='word') {
      for (const r of p.readings||[]) link(item,'reading','reading',r.id);
      for (const s of p.senses||[]) link(item,'sense','sense',s.id);
    }
    if (item.kind==='sense' || item.kind==='reading') link(item,'word','word',p.lexeme_id||p.word_id);
    if (item.kind==='sense') link(item,'reading','reading',p.pronunciation_id);
    if (item.kind==='contrast') {
      link(item,'left_word','word',p.word_id_a||p.left_word_id); link(item,'right_word','word',p.word_id_b||p.right_word_id);
      link(item,'left_sense','sense',p.left_sense_id||p.sense_id_a); link(item,'right_sense','sense',p.right_sense_id||p.sense_id_b);
    }
    if (item.kind==='scenario') {
      link(item,'contrast','contrast',p.contrast_id);
      link(item,'left_sense','sense',p.left_sense_id||p.sense_id_a);
      link(item,'right_sense','sense',p.right_sense_id||p.sense_id_b);
    }
    if (item.kind==='exercise') link(item,'scenario','scenario',p.scenario_id);
    if (item.kind==='fixture') link(item,'scenario','scenario',p.related_scenario_id);
    if (item.kind==='relation') { link(item,'from_sense','sense',p.from_sense_id); link(item,'to_sense','sense',p.to_sense_id); }
    if (item.kind==='example') { link(item,'sense','sense',p.target_sense_id); link(item,'relation','relation',p.relation_id); link(item,'word','word',p.lexeme_id); }
    if (item.kind==='lesson') for (const [key,kind] of Object.entries({wordIds:'word',senseIds:'sense',contrastIds:'contrast',exerciseIds:'exercise'}))
      for (const id of p[key]||[]) link(item,key,kind,id);
  }
  return { entities,links };
}

export async function migrate(pool) { await pool.query(readFileSync(`${ROOT}sql/001_catalog_and_reports.sql`,'utf8')); }
export async function configureRuntimeRole(pool) {
  const runtime=databaseConfig();
  if (runtime.user !== 'hanyumatiz_app' || !runtime.password) return; // Managed deployments provision their own roles.
  const exists=await pool.query('SELECT 1 FROM pg_roles WHERE rolname=$1',['hanyumatiz_app']);
  const statement=await pool.query(`SELECT format('${exists.rows.length ? 'ALTER' : 'CREATE'} ROLE hanyumatiz_app LOGIN PASSWORD %L', $1::text) AS sql`,[runtime.password]);
  await pool.query(statement.rows[0].sql);
  await pool.query('GRANT USAGE ON SCHEMA public TO hanyumatiz_app');
  await pool.query('GRANT SELECT ON catalog_versions,catalog_active,content_entities,content_links TO hanyumatiz_app');
  await pool.query('GRANT SELECT,INSERT,UPDATE ON nuance_reports TO hanyumatiz_app');
  await pool.query('GRANT SELECT,INSERT ON report_history TO hanyumatiz_app');
  await pool.query('GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO hanyumatiz_app');
}
export async function importCatalog(pool,catalog) {
  const { entities,links }=normalizeCatalog(catalog);
  const metadata={ ...catalog }; for (const key of [...Object.keys(topKinds),'mode']) delete metadata[key];
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(714421)');
    const existing=await client.query('SELECT metadata FROM catalog_versions WHERE version=$1',[catalog.dataVersion]);
    if (!existing.rows.length) {
      await client.query('INSERT INTO catalog_versions(version,metadata) VALUES($1,$2)',[catalog.dataVersion,metadata]);
      for (const entity of entities) await client.query('INSERT INTO content_entities(content_version,kind,id,ordinal,payload) VALUES($1,$2,$3,$4,$5)',[catalog.dataVersion,entity.kind,entity.id,entity.ordinal,entity.payload]);
      for (const l of links) await client.query('INSERT INTO content_links(content_version,source_kind,source_id,relation,target_kind,target_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',[catalog.dataVersion,l.sourceKind,l.sourceId,l.relation,l.targetKind,l.targetId]);
    } else {
      // Never overwrite content underneath reports that reference an existing version.
      const stored=await client.query('SELECT kind,id,payload FROM content_entities WHERE content_version=$1',[catalog.dataVersion]);
      const incoming=new Map(entities.map(e=>[`${e.kind}:${e.id}`,e.payload]));
      // jsonb normalizes key order, so compare structurally rather than string order.
      const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,stable(v)])):value;
      if (!(stored.rows.length===entities.length&&stored.rows.every(row=>JSON.stringify(stable(row.payload))===JSON.stringify(stable(incoming.get(`${row.kind}:${row.id}`))))))
        throw new Error('La misma versión contiene datos diferentes; genera una nueva dataVersion.');
      if (JSON.stringify(stable(existing.rows[0].metadata))!==JSON.stringify(stable(metadata))) throw new Error('Metadata distinta bajo la misma versión.');
    }
    const mode=catalog.mode||'public';if(!['public','private'].includes(mode))throw new Error('Modo de publicación inválido.');
    await client.query('INSERT INTO catalog_active(singleton,version,delivery_mode) VALUES(true,$1,$2) ON CONFLICT(singleton) DO UPDATE SET version=EXCLUDED.version,delivery_mode=EXCLUDED.delivery_mode',[catalog.dataVersion,mode]);
    await client.query('COMMIT');
    return {version:catalog.dataVersion,entities:entities.length,links:links.length};
  } catch(error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

if (process.argv[1]===fileURLToPath(import.meta.url)) {
  let pool;
  try {
    const {buildCatalog}=await import('./catalog.mjs');
    pool=createPool({admin:true}); await migrate(pool); await configureRuntimeRole(pool);
    console.log(JSON.stringify(await importCatalog(pool,buildCatalog({mode:process.argv.includes('--private')?'private':'public'}))));
  } catch(error) { console.error(error.message); process.exitCode=1; }
  finally { await pool?.end(); }
}

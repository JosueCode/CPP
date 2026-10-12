import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {request} from 'node:http';
import {ROOT} from '../tools/catalog.mjs';
import pg from 'pg';
import {createApp,validateReport} from '../server.mjs';
import {databaseConfig,readBootstrap} from '../tools/database.mjs';
import {migrate,configureRuntimeRole,importCatalog,normalizeCatalog} from '../tools/import_postgres.mjs';
import {provisionRuntimeRole} from '../tools/provision_runtime_role.mjs';

const sample=(version='test_catalog_v0001')=>({mode:'public',dataVersion:version,editorial:{policy:'owner_reports'},standard:{status:'unverified'},
  words:[{id:'word_a',zh:'看',readings:[{id:'reading_a',lexeme_id:'word_a',pinyin:'kàn'}],senses:[{id:'sense_a',lexeme_id:'word_a',pronunciation_id:'reading_a',gloss:'mirar'}]},
    {id:'word_b',zh:'看见',readings:[{id:'reading_b',lexeme_id:'word_b',pinyin:'kànjiàn'}],senses:[{id:'sense_b',lexeme_id:'word_b',pronunciation_id:'reading_b',gloss:'ver, percibir con la vista'}]}],
  contrasts:[{id:'contrast_ab',word_id_a:'word_a',word_id_b:'word_b',left_sense_id:'sense_a',right_sense_id:'sense_b'}],
  scenarios:[{id:'scenario_ab',contrast_id:'contrast_ab',sentence:'我〔词〕了。'}],
  exercises:[{id:'exercise_ab',scenario_id:'scenario_ab',explanation_es:'Una explicación original para la prueba.'}],
  examples:[{id:'example_a',target_sense_id:'sense_a',sentence_zh:'我看书。'}],relations:[],fixtures:[],
  levels:[{id:1,units:[]}],lessons:[{id:'lesson_a',wordIds:['word_a','word_b'],senseIds:['sense_a'],contrastIds:['contrast_ab'],exerciseIds:['exercise_ab']}]});

test('PostgreSQL y endpoints reales: migración, privacidad y reportes',async t=>{
  const database=`hymy_test_${randomBytes(6).toString('hex')}`;
  const managedRole=`hanyumatiz_app_${randomBytes(6).toString('hex')}`;
  const controller=new pg.Pool(databaseConfig({admin:true}));
  let owner,runtime,app;
  try{
    await controller.query(`CREATE DATABASE ${database}`);
    owner=new pg.Pool({...databaseConfig({admin:true}),database});runtime=new pg.Pool({...databaseConfig(),database});
    await migrate(owner);await configureRuntimeRole(owner);
    await t.test('no inicia sin catálogo PostgreSQL y no usa JSON de respaldo',async()=>{
      await assert.rejects(createApp({pool:runtime,credentials:{user:'test',password:'unused-test-credential'}}),/Catálogo PostgreSQL aún no importado/);
    });
    await t.test('configuración SQL externa mantiene verificación TLS aunque URL pida no verificar',()=>{
      const previous=process.env.HANYUMATIZ_DATABASE_URL;
      try{process.env.HANYUMATIZ_DATABASE_URL='postgresql://example:example@database.example/test?sslmode=no-verify';const configuration=databaseConfig();assert.equal(configuration.ssl.rejectUnauthorized,true);assert.ok(!configuration.connectionString.includes('sslmode'));}
      finally{if(previous===undefined)delete process.env.HANYUMATIZ_DATABASE_URL;else process.env.HANYUMATIZ_DATABASE_URL=previous;}
    });
    await importCatalog(owner,sample());
    await t.test('aprovisiona un rol SQL independiente con lectura de catálogo y escritura limitada de reportes',async()=>{
      const password=randomBytes(32).toString('base64url');
      assert.deepEqual(await provisionRuntimeRole(owner,{user:managedRole,password}),{role:managedRole,restricted:true});
      const limited=new pg.Pool({...databaseConfig(),database,user:managedRole,password});
      try{
        assert.deepEqual(await readBootstrap(limited),sample());
        await assert.rejects(limited.query("UPDATE content_entities SET payload='{}'"),error=>error.code==='42501');
        await assert.rejects(limited.query('DELETE FROM nuance_reports'),error=>error.code==='42501');
        await assert.rejects(limited.query('CREATE TABLE unauthorized_content (id integer)'),error=>error.code==='42501');
        await limited.query("UPDATE nuance_reports SET status='reviewing' WHERE false");
        await limited.query('SELECT * FROM report_history');
        // A repeated setup preserves restrictions and safely refreshes the same role's password.
        await provisionRuntimeRole(owner,{user:managedRole,password});
      }finally{await limited.end();}
    });
    const credentials={user:'backend_test',password:randomBytes(24).toString('base64url')};
    app=await createApp({pool:runtime,credentials,port:0,rateLimit:50});const port=await app.listen(),base=`http://127.0.0.1:${port}`;
    const auth='Basic '+Buffer.from(`${credentials.user}:${credentials.password}`).toString('base64');
    let cookie,csrfToken,reportId;
    const csrf=async()=>{const response=await fetch(`${base}/api/csrf`);assert.equal(response.status,200);cookie=response.headers.get('set-cookie').split(';')[0];csrfToken=(await response.json()).csrfToken;};
    const valid=()=>({targetType:'word',targetId:'word_a',contentVersion:'test_catalog_v0001',reason:'meaning',comment:'Creo que este matiz requiere un ejemplo adicional.'});
    const send=(body,headers={})=>fetch(`${base}/api/reports`,{method:'POST',headers:{'Content-Type':'application/json',Origin:base,Cookie:cookie,'X-CSRF-Token':csrfToken,...headers},body:JSON.stringify(body)});
    await t.test('alojamiento escucha en 0.0.0.0, sirve SQL y acepta solo el origen HTTPS configurado',async()=>{
      const origin='https://hanyumatiz-test.onrender.com';
      const hosted=await createApp({pool:runtime,credentials,port:0,host:'0.0.0.0',allowedOrigins:[origin]});
      const hostedPort=await hosted.listen(),endpoint=`http://127.0.0.1:${hostedPort}`,host=new URL(origin).host;
      // Undici deliberately replaces Host. Use real HTTP requests to exercise a terminating proxy's Host.
      const hostedRequest=(path,{method='GET',headers={},body}={})=>new Promise((resolve,reject)=>{
        const outgoing=request(endpoint+path,{method,headers},incoming=>{
          const chunks=[];incoming.on('data',chunk=>chunks.push(chunk));incoming.on('error',reject);
          incoming.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:incoming.statusCode,
            headers:Object.fromEntries(Object.entries(incoming.headers).map(([key,value])=>[key,Array.isArray(value)?value.join(', '):value]))})));
        });outgoing.on('error',reject);outgoing.end(body);
      });
      try{
        assert.equal(hosted.server.address().address,'0.0.0.0');
        const bootstrap=await hostedRequest('/api/bootstrap',{headers:{Host:host,Origin:origin}});
        assert.equal(bootstrap.status,200);assert.deepEqual(await bootstrap.json(),sample());
        const readiness=await hostedRequest('/healthz',{headers:{Host:host}});
        assert.equal(readiness.status,200);assert.deepEqual(await readiness.json(),{status:'ok'});
        assert.equal(readiness.headers.get('content-version'),null);
        assert.equal((await hostedRequest('/api/bootstrap',{headers:{Host:'untrusted.example'}})).status,400);
        assert.equal((await hostedRequest('/api/bootstrap',{headers:{Host:host,Origin:'https://untrusted.example'}})).status,403);
        const tokenResponse=await hostedRequest('/api/csrf',{headers:{Host:host}});
        const sessionCookie=tokenResponse.headers.get('set-cookie'),token=(await tokenResponse.json()).csrfToken;
        assert.match(sessionCookie,/; Secure/);
        // A deliberate invalid reason proves same-origin and CSRF guards pass without writing a report.
        const validation=await hostedRequest('/api/reports',{method:'POST',headers:{Host:host,Origin:origin,Cookie:sessionCookie.split(';')[0],
          'X-CSRF-Token':token,'Content-Type':'application/json'},body:JSON.stringify({...valid(),reason:'invalid'})});
        assert.equal(validation.status,400);
      }finally{await hosted.close();}
    });
    await t.test('bootstrap se reconstruye desde SQL conservando IDs y vínculos',async()=>{
      const response=await fetch(`${base}/api/bootstrap`);assert.equal(response.status,200);assert.deepEqual(await response.json(),sample());
      const count=await owner.query('SELECT count(*)::int AS n FROM content_links');assert.ok(count.rows[0].n>=15);
      const entityCounts=await owner.query('SELECT kind,count(*)::int AS n FROM content_entities GROUP BY kind');const byKind=Object.fromEntries(entityCounts.rows.map(row=>[row.kind,row.n]));assert.equal(byKind.reading,2);assert.equal(byKind.sense,2);
      const senseLinks=await owner.query("SELECT count(*)::int AS n FROM content_links WHERE source_kind='contrast' AND target_kind='sense'");assert.equal(senseLinks.rows[0].n,2);
    });
    await t.test('rol de aplicación no puede modificar ni borrar contenido',async()=>{
      await assert.rejects(runtime.query("UPDATE content_entities SET payload='{}'"),error=>error.code==='42501');
      await assert.rejects(runtime.query('DELETE FROM nuance_reports'),error=>error.code==='42501');
    });
    await t.test('bandeja y assets privados requieren autenticación',async()=>{
      for(const path of ['/admin','/admin.js','/admin.css','/api/admin/reports']){const r=await fetch(base+path);assert.equal(r.status,401);assert.ok(r.headers.get('www-authenticate'));}
      assert.equal((await fetch(`${base}/api/admin/reports`,{headers:{Authorization:'Basic '+Buffer.from('wrong:password').toString('base64')}})).status,401);
    });
    await t.test('no expone código, configuración, SQL ni API de lectura de reportes',async()=>{
      for(const path of ['/api/reports','/.local/postgres.json','/server.mjs','/sql/001_catalog_and_reports.sql','/data/candidates.json','/tools/catalog.mjs'])assert.equal((await fetch(base+path)).status,404);
      const r=await fetch(base+'/');assert.equal(r.status,200);assert.ok(r.headers.get('content-security-policy').includes("connect-src 'self'"));assert.equal(r.headers.get('access-control-allow-origin'),null);
    });
    await t.test('sirve motores OCR y dictado íntegros con CSP para trabajadores locales',async()=>{
      for(const name of ['dictation.js','dictationcore.js','dictationaudio.js','dictationstore.js','dictationocr.js','dictation.css']){
        const response=await fetch(base+'/'+name);assert.equal(response.status,200,name);
        assert.equal(await response.text(),readFileSync(ROOT+'/web/'+name,'utf8'));
      }
      const manifest=JSON.parse(readFileSync(ROOT+'/web/vendor/ocr/manifest.json','utf8'));
      for(const asset of manifest.assets){
        const response=await fetch(base+'/vendor/ocr/'+asset.name);assert.equal(response.status,200,asset.name);
        const bytes=Buffer.from(await response.arrayBuffer());
        assert.equal(bytes.length,asset.bytes,asset.name);
        assert.equal(createHash('sha256').update(bytes).digest('hex'),asset.sha256,asset.name);
        if(asset.name.endsWith('.mjs'))assert.match(response.headers.get('content-type'),/javascript/);
        if(asset.name.endsWith('.wasm'))assert.equal(response.headers.get('content-type'),'application/wasm');
      }
      for(const path of ['/vendor/ocr/not-declared.js','/vendor/ocr/..%2f..%2f..%2f.local/postgres.json'])assert.equal((await fetch(base+path)).status,404);
      const policy=(await fetch(base+'/')).headers.get('content-security-policy');
      assert.ok(policy.includes("worker-src 'self' blob:"));
      assert.ok(policy.includes("'wasm-unsafe-eval'"));
      assert.ok(!policy.includes("'unsafe-eval'"));
    });
    await t.test('CSRF cookie privada y token son obligatorios',async()=>{
      await csrf();assert.equal((await send(valid(),{'X-CSRF-Token':''})).status,403);
      assert.equal((await send(valid(),{Cookie:''})).status,403);
      assert.equal((await send(valid(),{Origin:''})).status,403);
      assert.equal((await send(valid(),{Origin:'https://attacker.example'})).status,403);
      assert.equal((await send(valid(),{Origin:`http://localhost:${port}`})).status,403);
      assert.equal((await fetch(`${base}/api/reports`,{method:'OPTIONS',headers:{Origin:'https://attacker.example'}})).status,403);
    });
    await t.test('valida motivos, límites y campos; nunca ejecuta SQL aportado',async()=>{
      for(const body of [{...valid(),reason:'incorrect'}, {...valid(),comment:'corto'}, {...valid(),comment:'x'.repeat(2001)}, {...valid(),contact:'x'.repeat(121)}, {...valid(),extra:true}])assert.equal((await send(body)).status,400);
      assert.equal((await send({...valid(),targetId:"word_a' OR '1'='1"})).status,404);
      assert.equal((await send({...valid(),contentVersion:'obsolete_version_000'})).status,409);
      assert.equal((await send(valid(),{'Content-Type':'text/plain'})).status,415);
      assert.equal((await send({...valid(),comment:'x'.repeat(17000)})).status,413);
    });
    await t.test('reporte real se guarda privado con referencia y estado pending',async()=>{
      const response=await send({...valid(),comment:'<img src=x onerror=alert(1)> Creo que falta un ejemplo.'});assert.equal(response.status,201);const body=await response.json();assert.equal(body.status,'pending');assert.ok(body.id);reportId=body.id;
      const rows=await owner.query('SELECT * FROM nuance_reports WHERE id=$1',[reportId]);assert.equal(rows.rows.length,1);assert.equal(rows.rows[0].target_id,'word_a');assert.equal(rows.rows[0].status,'pending');
      const publicResponse=await fetch(base+'/api/bootstrap');assert.ok(!JSON.stringify(await publicResponse.json()).includes('onerror'));
    });
    await t.test('lista privada incluye snapshot y maneja filtros',async()=>{
      const r=await fetch(base+'/api/admin/reports?status=pending',{headers:{Authorization:auth}});assert.equal(r.status,200);const body=await r.json();assert.equal(body.reports.length,1);assert.equal(body.reports[0].target.zh,'看');assert.equal(body.totals.pending,1);
      assert.equal((await fetch(base+'/api/admin/reports?status=unknown',{headers:{Authorization:auth}})).status,400);
    });
    await t.test('cambio de estado privado mantiene historial/version e IDs',async()=>{
      const r=await fetch(`${base}/api/admin/reports/${reportId}`,{method:'PATCH',headers:{Authorization:auth,Origin:base,Cookie:cookie,'X-CSRF-Token':csrfToken,'Content-Type':'application/json'},body:JSON.stringify({status:'resolved',ownerNote:'Añadida la precisión solicitada.',correctionVersion:'test_catalog_v0001'})});assert.equal(r.status,200);assert.equal((await r.json()).status,'resolved');
      const history=await owner.query('SELECT * FROM report_history WHERE report_id=$1 ORDER BY id',[reportId]);assert.equal(history.rows.length,2);assert.equal(history.rows[1].previous_status,'pending');assert.equal(history.rows[1].correction_version,'test_catalog_v0001');assert.equal(history.rows[1].target_id,'word_a');
      const denied=await fetch(`${base}/api/admin/reports/${reportId}`,{method:'PATCH',headers:{Origin:base,Cookie:cookie,'X-CSRF-Token':csrfToken,'Content-Type':'application/json'},body:JSON.stringify({status:'dismissed'})});assert.equal(denied.status,401);
    });
    await t.test('reimportación idempotente conserva reportes e historial',async()=>{
      await migrate(owner);await importCatalog(owner,sample());const row=await owner.query('SELECT count(*)::int AS n FROM nuance_reports');assert.equal(row.rows[0].n,1);
      const hist=await owner.query('SELECT count(*)::int AS n FROM report_history');assert.equal(hist.rows[0].n,2);assert.deepEqual(await readBootstrap(runtime),sample());
    });
    await t.test('modo privado se aplica inmediatamente sin falsear versión ni snapshot',async()=>{
      const hidden={...sample(),mode:'private'};await importCatalog(owner,hidden);assert.equal((await readBootstrap(runtime)).mode,'private');
      assert.equal((await fetch(base+'/api/bootstrap')).status,401);assert.equal((await fetch(base+'/')).status,401);
      const health=await fetch(base+'/healthz');assert.equal(health.status,200);assert.deepEqual(await health.json(),{status:'ok'});
      assert.equal((await fetch(base+'/api/bootstrap',{headers:{Authorization:auth}})).status,200);
      await importCatalog(owner,sample());assert.equal((await fetch(base+'/api/bootstrap')).status,200);
    });
    await t.test('sonda ligera devuelve 503 si no existe catálogo activo sin exponer datos',async()=>{
      await owner.query('DELETE FROM catalog_active');
      try{
        const response=await fetch(base+'/healthz');assert.equal(response.status,503);
        assert.deepEqual(await response.json(),{status:'unavailable'});
      }finally{await importCatalog(owner,sample());}
    });
    await t.test('no permite reescribir datos bajo la misma versión',async()=>{
      const changed=sample();changed.words[0].zh='错误';await assert.rejects(importCatalog(owner,changed),/misma versión/);assert.equal((await readBootstrap(runtime)).words[0].zh,'看');
    });
    await t.test('versiones nuevas conservan snapshot de reportes anteriores',async()=>{
      const next=sample('test_catalog_v0002');next.words[0].senses[0].gloss='mirar; leer según el objeto';await importCatalog(owner,next);
      const r=await fetch(base+'/api/admin/reports?status=all',{headers:{Authorization:auth}});const body=await r.json();assert.equal(body.reports[0].target.senses[0].gloss,'mirar');
      assert.equal((await readBootstrap(runtime)).dataVersion,'test_catalog_v0002');assert.equal((await send(valid())).status,409);
    });
    await t.test('importación aborta transaccionalmente si hay un vínculo roto',async()=>{
      const broken=sample('test_catalog_v0003');broken.exercises[0].scenario_id='missing';await assert.rejects(importCatalog(owner,broken),/Vínculo roto/);assert.equal((await readBootstrap(runtime)).dataVersion,'test_catalog_v0002');
    });
    await t.test('rate limit real limita el envío repetido',async()=>{
      const other=await createApp({pool:runtime,credentials,port:0,rateLimit:1});const otherPort=await other.listen(),otherBase=`http://127.0.0.1:${otherPort}`;
      try{const r=await fetch(otherBase+'/api/csrf');const cookie2=r.headers.get('set-cookie').split(';')[0],token2=(await r.json()).csrfToken;
        const options={method:'POST',headers:{'Content-Type':'application/json',Origin:otherBase,Cookie:cookie2,'X-CSRF-Token':token2},body:JSON.stringify({...valid(),contentVersion:'test_catalog_v0002'})};
        assert.equal((await fetch(otherBase+'/api/reports',options)).status,201);assert.equal((await fetch(otherBase+'/api/reports',options)).status,429);
      }finally{await other.close();}
    });
    await t.test('JSON tipado y exposición de errores controlada',()=>{
      assert.throws(()=>validateReport({}),/inválido/);assert.throws(()=>normalizeCatalog({...sample(),dataVersion:'x'}),/Versión/);
    });
    await t.test('sonda devuelve 503 cuando la conexión SQL deja de estar disponible',async()=>{
      const disconnected=new pg.Pool({...databaseConfig(),database});
      const isolated=await createApp({pool:disconnected,credentials,port:0});
      try{
        const isolatedPort=await isolated.listen();await disconnected.end();
        const response=await fetch(`http://127.0.0.1:${isolatedPort}/healthz`);
        assert.equal(response.status,503);
        assert.deepEqual(await response.json(),{error:'El servicio no está disponible. Inténtalo de nuevo en unos minutos.'});
      }finally{await isolated.close();}
    });
  }finally{
    await app?.close();await runtime?.end();await owner?.end();
    await controller.query(`DROP DATABASE IF EXISTS ${database}`);
    await controller.query(`DROP ROLE IF EXISTS ${managedRole}`);await controller.end();
  }
});

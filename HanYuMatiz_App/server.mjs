import http from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync, realpathSync } from 'node:fs';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, readBootstrap, ROOT } from './tools/database.mjs';

const CSP="default-src 'none'; script-src 'self' blob: 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
const REASONS=new Set(['meaning','naturalness','grammar','translation','answer','other']);
const STATES=new Set(['pending','reviewing','resolved','dismissed']);
const TYPES=new Set(['word','contrast','exercise']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
class HTTPError extends Error { constructor(status,message){super(message);this.status=status;} }
const reject=(status,message)=>{throw new HTTPError(status,message);};
const safeEqual=(a,b)=>{const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&timingSafeEqual(x,y);};
const length=value=>[...value].length;

const LOOPBACK_HOSTS=new Set(['127.0.0.1','localhost','[::1]']);
const BIND_HOSTS=new Set(['127.0.0.1','0.0.0.0','::1','::']);
export function allowedDeploymentOrigins(env=process.env) {
  const values=(env.HANYUMATIZ_ALLOWED_ORIGINS||'').split(',').map(value=>value.trim()).filter(Boolean);
  if(env.RENDER_EXTERNAL_URL)values.push(env.RENDER_EXTERNAL_URL);
  return [...new Set(values.map(value=>{
    let url;
    try{url=new URL(value);}catch{throw new Error('El origen público debe ser una URL HTTPS válida.');}
    if(url.username||url.password||url.pathname!=='/'||url.search||url.hash||
      !(url.protocol==='https:'||(url.protocol==='http:'&&LOOPBACK_HOSTS.has(url.hostname))))
      throw new Error('Configura un origen HTTPS exacto, sin ruta, credenciales ni parámetros.');
    return url.origin;
  }))];
}
export function deploymentConfig(env=process.env) {
  // PORT is supplied by managed web hosts. Local development remains loopback-only.
  const hosted=env.RENDER==='true'||!!env.PORT;
  const port=Number(env.PORT||env.HANYUMATIZ_PORT||8770);
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('El puerto debe ser un entero entre 1 y 65535.');
  const host=env.HANYUMATIZ_HOST||(hosted?'0.0.0.0':'127.0.0.1');
  if(!BIND_HOSTS.has(host))throw new Error('HANYUMATIZ_HOST debe ser una dirección de escucha local válida.');
  return {port,host,allowedOrigins:allowedDeploymentOrigins(env)};
}

export function adminCredentials() {
  const user=process.env.HANYUMATIZ_ADMIN_USER,password=process.env.HANYUMATIZ_ADMIN_PASSWORD;
  if (!!user!==!!password) throw new Error('Configura ambos HANYUMATIZ_ADMIN_USER y HANYUMATIZ_ADMIN_PASSWORD.');
  if (user) {
    if (password.length<20||/[:\r\n]/.test(user)) throw new Error('Credenciales de administración inválidas.');
    return {user,password};
  }
  if(process.env.RENDER==='true'||process.env.PORT||['0.0.0.0','::'].includes(process.env.HANYUMATIZ_HOST))
    throw new Error('Configura las credenciales privadas HANYUMATIZ_ADMIN_USER y HANYUMATIZ_ADMIN_PASSWORD antes de publicar.');
  const directory=`${ROOT}.local`;mkdirSync(directory,{recursive:true,mode:0o700});chmodSync(directory,0o700);
  const path=`${directory}/node-admin.json`;
  if (!existsSync(path)) writeFileSync(path,JSON.stringify({user:'hanyumatiz',password:randomBytes(32).toString('base64url')}),{mode:0o600,flag:'wx'});
  chmodSync(path,0o600);
  return JSON.parse(readFileSync(path,'utf8'));
}
function authorized(req,credentials) {
  const header=req.headers.authorization||'';
  if (!header.startsWith('Basic ')||header.length>2048) return false;
  let value;
  try { value=Buffer.from(header.slice(6),'base64').toString('utf8'); } catch { return false; }
  const index=value.indexOf(':'); if(index<1)return false;
  return safeEqual(value.slice(0,index),credentials.user)&&safeEqual(value.slice(index+1),credentials.password);
}
function readJSON(req) {
  if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type']||'')) reject(415,'Envía el formulario como JSON.');
  if(Number(req.headers['content-length']||0)>16384) reject(413,'El formulario es demasiado grande.');
  return new Promise((resolve,rejectPromise)=>{
    let size=0,done=false;const chunks=[];
    req.on('data',chunk=>{if(done)return;size+=chunk.length;if(size>16384){done=true;chunks.length=0;rejectPromise(new HTTPError(413,'El formulario es demasiado grande.'));}else chunks.push(chunk);});
    req.on('end',()=>{if(done)return;try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw 0;resolve(value);}catch{rejectPromise(new HTTPError(400,'JSON inválido.'));}});
    req.on('error',()=>rejectPromise(new HTTPError(400,'No se pudo leer el formulario.')));
  });
}
function textField(value,min,max,label,{optional=false}={}) {
  if(value===undefined&&optional)return null;
  if(typeof value!=='string')reject(400,`${label}: texto inválido.`);
  const result=value.trim();
  if(length(result)<min||length(result)>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(result))reject(400,`${label}: usa entre ${min} y ${max} caracteres.`);
  return result;
}
export function validateReport(input) {
  if(Object.keys(input).some(key=>!['targetType','targetId','contentVersion','reason','comment','contact'].includes(key)))reject(400,'El formulario contiene campos desconocidos.');
  if(!TYPES.has(input.targetType)||!REASONS.has(input.reason))reject(400,'Tipo o motivo del reporte inválido.');
  return {targetType:input.targetType,targetId:textField(input.targetId,1,180,'Contenido'),
    contentVersion:textField(input.contentVersion,8,128,'Versión'),reason:input.reason,
    comment:textField(input.comment,10,2000,'Comentario'),contact:textField(input.contact,0,120,'Contacto',{optional:true})};
}
function serializeReport(row) {
  return {id:row.id,targetType:row.target_type,targetId:row.target_id,contentVersion:row.content_version,
    reason:row.reason,comment:row.comment,contact:row.contact,status:row.status,ownerNote:row.owner_note,
    receivedAt:row.received_at,updatedAt:row.updated_at,target:row.payload,
    history:(row.history||[]).map(h=>({previousStatus:h.previous_status,status:h.status,ownerNote:h.owner_note,
      correctionVersion:h.correction_version,contentVersion:h.content_version,targetId:h.target_id,changedAt:h.changed_at}))};
}

export async function createApp({pool=createPool(),credentials=adminCredentials(),port=8770,host='127.0.0.1',
  allowedOrigins=allowedDeploymentOrigins(),rateLimit=5}={}) {
  if(!Number.isInteger(port)||port<0||port>65535||!BIND_HOSTS.has(host))throw new Error('Dirección de escucha inválida.');
  allowedOrigins=allowedDeploymentOrigins({HANYUMATIZ_ALLOWED_ORIGINS:allowedOrigins.join(',')});
  // Fail at startup if SQL is unavailable or unimported. No JSON fallback.
  await readBootstrap(pool);
  const sessions=new Map(),rates=new Map();
  let actualPort=port;
  const origins=()=>new Set([`http://127.0.0.1:${actualPort}`,`http://localhost:${actualPort}`,...allowedOrigins]);
  const hosts=()=>new Set([...origins()].map(origin=>new URL(origin).host));
  const sameOrigin=(req,origin)=>origins().has(origin)&&new URL(origin).host===req.headers.host;
  const respond=(res,status,value,{mime='application/json; charset=utf-8',auth=false,headers={}}={})=>{
    const body=Buffer.isBuffer(value)?value:Buffer.from(typeof value==='string'?value:JSON.stringify(value));
    res.writeHead(status,{'Content-Type':mime,'Content-Length':body.length,'Content-Security-Policy':CSP,
      'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY',
      'Permissions-Policy':'camera=(), microphone=(), geolocation=()','Cache-Control':'no-store',
      ...(auth?{'WWW-Authenticate':'Basic realm="HanYuMatiz administración privada", charset="UTF-8"'}:{}),...headers});
    if(res.req.method==='HEAD')res.end();else res.end(body);
  };
  function mutateGuard(req) {
    if(!sameOrigin(req,req.headers.origin||''))reject(403,'Origen no permitido.');
    if(req.headers['sec-fetch-site']&&req.headers['sec-fetch-site']!=='same-origin'&&req.headers['sec-fetch-site']!=='none')reject(403,'Solicitud externa no permitida.');
    const cookie=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('hymy_csrf='))?.slice(10);
    const session=sessions.get(cookie);
    if(!session||session.expires<Date.now()||!safeEqual(req.headers['x-csrf-token']||'',session.token))reject(403,'Recarga el formulario para enviarlo con seguridad.');
  }
  function checkRate(req,{success=false}={}) {
    const key=req.socket.remoteAddress,now=Date.now();
    let state=rates.get(key);if(!state||now-state.start>30*60*1000){state={start:now,attempts:0,successes:0};rates.set(key,state);}
    if(success){state.successes++;return;}
    state.attempts++;
    if(state.attempts>40||state.successes>=rateLimit)reject(429,'Has enviado varios reportes. Inténtalo de nuevo en 30 minutos.');
  }
  const server=http.createServer(async(req,res)=>{
    try {
      if(!hosts().has(req.headers.host||''))reject(400,'Host no permitido.');
      if(req.headers.origin&&!sameOrigin(req,req.headers.origin))reject(403,'Origen no permitido.');
      if(req.method==='OPTIONS')reject(403,'Solicitudes externas no permitidas.');
      const url=new URL(req.url,`http://${req.headers.host}`);
      let path;
      try {path=decodeURIComponent(url.pathname);}catch{reject(404,'No encontrado.');}
      if(/[\\\u0000]/.test(path)||path.includes('..')||path.includes('%'))reject(404,'No encontrado.');
      const isAdmin=path==='/admin'||path==='/admin.html'||path==='/admin.js'||path==='/admin.css'||path.startsWith('/api/admin/');
      const activeMode=await pool.query('SELECT delivery_mode FROM catalog_active WHERE singleton=true');
      const privateCatalog=activeMode.rows[0]?.delivery_mode==='private';
      if(path==='/healthz'&&['GET','HEAD'].includes(req.method)){
        // Cheap readiness probe: verifies active SQL state without downloading the catalogue.
        respond(res,activeMode.rows.length?200:503,{status:activeMode.rows.length?'ok':'unavailable'});return;
      }
      if((isAdmin||privateCatalog)&&!authorized(req,credentials)){
        respond(res,401,{error:'Acceso privado: introduce tus credenciales.'},{auth:true});return;
      }
      if(path==='/api/csrf'&&req.method==='GET') {
        for(const[id,value]of sessions)if(value.expires<Date.now())sessions.delete(id);
        if(sessions.size>2000)reject(503,'Inténtalo de nuevo en unos minutos.');
        const id=randomBytes(24).toString('base64url'),token=randomBytes(32).toString('base64url');
        sessions.set(id,{token,expires:Date.now()+3600*1000});
        const secure=req.headers.origin?.startsWith('https://')||allowedOrigins.some(o=>o.startsWith('https://')&&new URL(o).host===req.headers.host);
        respond(res,200,{csrfToken:token},{headers:{'Set-Cookie':`hymy_csrf=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600${secure?'; Secure':''}`}});return;
      }
      if(path==='/api/bootstrap'&&['GET','HEAD'].includes(req.method)) {
        const value=await readBootstrap(pool);
        // The mode can change while a content import commits. Check the exact snapshot returned.
        if(value.mode==='private'&&!authorized(req,credentials)){respond(res,401,{error:'Acceso privado: introduce tus credenciales.'},{auth:true});return;}
        respond(res,200,value,{headers:{'Content-Version':value.dataVersion}});return;
      }
      if(path==='/api/reports'&&req.method==='POST') {
        mutateGuard(req);checkRate(req);const value=validateReport(await readJSON(req));
        const client=await pool.connect();
        try {
          await client.query('BEGIN');
          const active=await client.query('SELECT version FROM catalog_active WHERE singleton=true');
          if(active.rows[0]?.version!==value.contentVersion)reject(409,'El contenido se actualizó. Recarga la página y vuelve a enviar el reporte.');
          const target=await client.query('SELECT kind FROM content_entities WHERE content_version=$1 AND id=$2 AND (kind=$3 OR ($3=\'exercise\' AND kind=\'fixture\'))',[value.contentVersion,value.targetId,value.targetType]);
          if(!target.rows.length)reject(404,'No se encontró el contenido señalado.');
          const id=randomUUID();
          const inserted=await client.query('INSERT INTO nuance_reports(id,content_version,target_type,target_kind,target_id,reason,comment,contact) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING received_at',[id,value.contentVersion,value.targetType,target.rows[0].kind,value.targetId,value.reason,value.comment,value.contact]);
          await client.query('INSERT INTO report_history(report_id,content_version,target_type,target_id,status) VALUES($1,$2,$3,$4,\'pending\')',[id,value.contentVersion,value.targetType,value.targetId]);
          await client.query('COMMIT');checkRate(req,{success:true});
          respond(res,201,{id,status:'pending',receivedAt:inserted.rows[0].received_at});
        } catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}return;
      }
      if(path==='/api/admin/reports'&&req.method==='GET') {
        const status=url.searchParams.get('status')||'all';if(status!=='all'&&!STATES.has(status))reject(400,'Estado inválido.');
        const limit=Number(url.searchParams.get('limit')||50),offset=Number(url.searchParams.get('offset')||0);
        if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(offset)||offset<0||offset>100000)reject(400,'Paginación inválida.');
        const rows=await pool.query(`SELECT r.*,e.payload,(SELECT jsonb_agg(h ORDER BY h.changed_at,h.id) FROM report_history h WHERE h.report_id=r.id) AS history
          FROM nuance_reports r JOIN content_entities e ON e.content_version=r.content_version AND e.kind=r.target_kind AND e.id=r.target_id
          WHERE ($1='all' OR r.status=$1) ORDER BY r.received_at DESC,r.id LIMIT $2 OFFSET $3`,[status,limit,offset]);
        const totals=await pool.query('SELECT status,count(*)::int AS count FROM nuance_reports GROUP BY status');
        respond(res,200,{reports:rows.rows.map(serializeReport),totals:Object.fromEntries(totals.rows.map(row=>[row.status,row.count])),limit,offset});return;
      }
      const match=path.match(/^\/api\/admin\/reports\/([^/]+)$/);
      if(match&&req.method==='PATCH') {
        mutateGuard(req);if(!UUID.test(match[1]))reject(404,'Reporte no encontrado.');
        const input=await readJSON(req);
        if(Object.keys(input).some(key=>!['status','ownerNote','correctionVersion'].includes(key))||!STATES.has(input.status))reject(400,'Actualización inválida.');
        const note=textField(input.ownerNote??'',0,4000,'Nota privada');
        const correction=input.correctionVersion?textField(input.correctionVersion,8,128,'Versión corregida'):null;
        const client=await pool.connect();
        try {
          await client.query('BEGIN');const old=await client.query('SELECT * FROM nuance_reports WHERE id=$1 FOR UPDATE',[match[1]]);
          if(!old.rows.length)reject(404,'Reporte no encontrado.');
          if(correction&&!(await client.query('SELECT 1 FROM catalog_versions WHERE version=$1',[correction])).rows.length)reject(400,'Versión corregida desconocida.');
          const record=old.rows[0];
          const updated=await client.query('UPDATE nuance_reports SET status=$2,owner_note=$3,updated_at=now() WHERE id=$1 RETURNING *',[match[1],input.status,note]);
          await client.query('INSERT INTO report_history(report_id,content_version,target_type,target_id,previous_status,status,owner_note,correction_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[match[1],record.content_version,record.target_type,record.target_id,record.status,input.status,note,correction]);
          await client.query('COMMIT');respond(res,200,serializeReport(updated.rows[0]));
        }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}return;
      }
      if(!['GET','HEAD'].includes(req.method))reject(405,'Método no permitido.');
      if(path.startsWith('/api/'))reject(404,'No encontrado.');
      const relative=path==='/'?'index.html':path==='/admin'?'admin.html':path.slice(1);
      const rootAssets=new Set(['index.html','main.js','styles.css','v9-base.css','engine.js','progress.js','scheduler.js','practice.js','reports.js','dictation.js','dictationcore.js','dictationaudio.js','dictationstore.js','dictationocr.js','dictation.css','admin.html','admin.js','admin.css']);
      const fontAssets=new Set(['fonts/AtelierUI-Regular.woff2','fonts/AtelierUI-Bold.woff2','fonts/AtelierHanzi.woff2','fonts/Lato-OFL.txt','fonts/NotoSansSC-OFL.txt']);
      let vendorAllowed=false;
      if(relative.startsWith('vendor/ocr/')){
        const manifestPath=resolve(ROOT,'web/vendor/ocr/manifest.json');
        if(existsSync(manifestPath)){
          const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
          vendorAllowed=(manifest.assets||[]).some(asset=>relative==='vendor/ocr/'+(asset.name||asset.file||asset.filename||asset.path));
        }
      }
      if(!rootAssets.has(relative)&&!fontAssets.has(relative)&&!vendorAllowed)reject(404,'No encontrado.');
      const web=resolve(ROOT,'web'),candidate=resolve(web,relative);
      if(!existsSync(candidate)||!realpathSync(candidate).startsWith(`${web}${sep}`))reject(404,'No encontrado.');
      const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8','.json':'application/json; charset=utf-8','.gz':'application/gzip','.wasm':'application/wasm'}[extname(candidate)]||'application/octet-stream';
      respond(res,200,readFileSync(candidate),{mime});
    } catch(error) {
      if(res.headersSent){res.end();return;}
      if(error instanceof HTTPError)respond(res,error.status,{error:error.message});
      else {console.error('La operación PostgreSQL o del servidor no se pudo completar.');respond(res,503,{error:'El servicio no está disponible. Inténtalo de nuevo en unos minutos.'});}
    }
  });
  server.requestTimeout=15000;server.headersTimeout=10000;server.keepAliveTimeout=5000;server.maxHeadersCount=50;
  const cleanup=setInterval(()=>{for(const[id,value]of sessions)if(value.expires<Date.now())sessions.delete(id);for(const[id,value]of rates)if(Date.now()-value.start>30*60*1000)rates.delete(id);},60000);cleanup.unref();
  server.on('close',()=>clearInterval(cleanup));
  return { server,pool,listen:()=>new Promise((resolve,rejectPromise)=>{
    server.once('error',rejectPromise);server.listen(port,host,()=>{actualPort=server.address().port;resolve(actualPort);});
  }),close:()=>new Promise(resolve=>server.close(()=>resolve())) };
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  let app,pool;
  try {const configuration=deploymentConfig();pool=createPool();app=await createApp({pool,...configuration});const port=await app.listen();console.log(`HanYuMatiz Node.js + PostgreSQL: escucha ${configuration.host}:${port}. Administración privada: /admin.`);}
  catch(error){console.error(error.message);await pool?.end();process.exitCode=1;}
  const stop=async()=>{await app?.close();await pool?.end();process.exit(0);};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
}

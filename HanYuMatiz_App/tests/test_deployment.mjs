import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,statSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {deploymentConfig,allowedDeploymentOrigins,adminCredentials} from '../server.mjs';
import {runtimeRoleConfiguration} from '../tools/provision_runtime_role.mjs';
import {loadManagedDatabaseConfiguration} from '../tools/setup_managed_database.mjs';

test('desarrollo conserva loopback y el puerto de alojamiento permite conexión pública',()=>{
  assert.deepEqual(deploymentConfig({}),{port:8770,host:'127.0.0.1',allowedOrigins:[]});
  assert.deepEqual(deploymentConfig({HANYUMATIZ_PORT:'8780'}),{port:8780,host:'127.0.0.1',allowedOrigins:[]});
  assert.deepEqual(deploymentConfig({PORT:'10000',HANYUMATIZ_PORT:'8780',RENDER:'true',RENDER_EXTERNAL_URL:'https://hanyumatiz-example.onrender.com'}),
    {port:10000,host:'0.0.0.0',allowedOrigins:['https://hanyumatiz-example.onrender.com']});
  assert.equal(deploymentConfig({PORT:'10000',HANYUMATIZ_HOST:'127.0.0.1'}).host,'127.0.0.1');
  for(const port of ['-1','0','65536','1.5','not-a-port'])assert.throws(()=>deploymentConfig({PORT:port}),/puerto/);
  assert.throws(()=>deploymentConfig({HANYUMATIZ_HOST:'attacker.example'}),/escucha/);
});

test('el origen público exige HTTPS exacto y no permite comodines ni URLs de terceros en la ruta',()=>{
  assert.deepEqual(allowedDeploymentOrigins({HANYUMATIZ_ALLOWED_ORIGINS:' https://study.example/,https://study.example,http://localhost:8770',RENDER_EXTERNAL_URL:'https://hanyumatiz-example.onrender.com'}),
    ['https://study.example','http://localhost:8770','https://hanyumatiz-example.onrender.com']);
  for(const value of ['http://study.example','https://study.example/path','https://study.example?query=1','https://study.example#fragment','https://user:password@study.example','*','file:///tmp/test'])
    assert.throws(()=>allowedDeploymentOrigins({HANYUMATIZ_ALLOWED_ORIGINS:value}));
});

test('un servidor publicado exige credenciales privadas explícitas y no genera una contraseña efímera',()=>{
  const keys=['PORT','RENDER','HANYUMATIZ_ADMIN_USER','HANYUMATIZ_ADMIN_PASSWORD'];
  const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  try{
    process.env.PORT='10000';process.env.RENDER='true';delete process.env.HANYUMATIZ_ADMIN_USER;delete process.env.HANYUMATIZ_ADMIN_PASSWORD;
    assert.throws(()=>adminCredentials(),/antes de publicar/);
    process.env.HANYUMATIZ_ADMIN_USER='hanyumatiz';process.env.HANYUMATIZ_ADMIN_PASSWORD='private-test-password-never-used';
    assert.equal(adminCredentials().user,'hanyumatiz');
  }finally{
    for(const key of keys)if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];
  }
});

const connections=()=>({HANYUMATIZ_DATABASE_ADMIN_URL:'postgresql://owner:owner-test-password@ep-test.region.neon.tech/hanyumatiz?sslmode=require',
  HANYUMATIZ_DATABASE_URL:'postgresql://hanyumatiz_app:application-test-password-long@ep-test-pooler.region.neon.tech/hanyumatiz?sslmode=require'});
test('el aprovisionamiento separa propietario y rol limitado y acepta la conexión agrupada del mismo proyecto',()=>{
  const configuration=runtimeRoleConfiguration(connections());
  assert.equal(configuration.user,'hanyumatiz_app');
  assert.ok(configuration.password.length>=20);
  assert.throws(()=>runtimeRoleConfiguration({}),/dos conexiones/);
  for(const replacement of [
    'postgresql://owner:application-test-password-long@ep-test.region.neon.tech/hanyumatiz',
    'postgresql://hanyumatiz_app:short@ep-test.region.neon.tech/hanyumatiz',
    'postgresql://hanyumatiz_app:application-test-password-long@ep-other.region.neon.tech/hanyumatiz',
    'postgresql://hanyumatiz_app:application-test-password-long@ep-test.region.neon.tech/other',
    'https://hanyumatiz_app:application-test-password-long@ep-test.region.neon.tech/hanyumatiz'
  ])assert.throws(()=>runtimeRoleConfiguration({...connections(),HANYUMATIZ_DATABASE_URL:replacement}));
});

test('la preparación lee un archivo privado válido, reduce permisos y rechaza configuraciones extrañas',()=>{
  const directory=mkdtempSync(join(tmpdir(),'hanyumatiz-managed-config-')),path=join(directory,'managed.json');
  try{
    writeFileSync(path,JSON.stringify(connections()),{mode:0o644});
    const configuration=loadManagedDatabaseConfiguration(path);
    assert.equal(configuration.role.user,'hanyumatiz_app');
    assert.equal(statSync(path).mode&0o777,0o600);
    writeFileSync(path,JSON.stringify({...connections(),publicPassword:'do-not-accept-an-extra-field'}));
    assert.throws(()=>loadManagedDatabaseConfiguration(path),/solamente las dos/);
    writeFileSync(path,'not-json-private-test-marker');
    assert.throws(()=>loadManagedDatabaseConfiguration(path),error=>!error.message.includes('private-test-marker'));
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('el Blueprint solo contiene un servicio Free y no migra con secretos de propietario en el alojamiento',()=>{
  const localBlueprint=new URL('../render.yaml',import.meta.url);
  const blueprint=readFileSync(existsSync(localBlueprint)?localBlueprint:new URL('../../render.yaml',import.meta.url),'utf8');
  assert.match(blueprint,/plan: free/);assert.match(blueprint,/rootDir: HanYuMatiz_App/);
  assert.match(blueprint,/branch: hanyumatiz-publicacion-gratis/);
  assert.match(blueprint,/healthCheckPath: \/healthz/);
  assert.match(blueprint,/startCommand: npm start/);
  assert.match(blueprint,/HANYUMATIZ_DATABASE_URL\s+sync: false/);
  assert.doesNotMatch(blueprint,/^\s*(databases:|disk:|preDeployCommand:|HANYUMATIZ_DATABASE_ADMIN_URL)/m);
  assert.equal((blueprint.match(/- type:/g)||[]).length,1);
});

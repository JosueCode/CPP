import {readFileSync,chmodSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildCatalog} from './catalog.mjs';
import {createPool,readBootstrap,ROOT} from './database.mjs';
import {migrate,importCatalog} from './import_postgres.mjs';
import {runtimeRoleConfiguration,provisionRuntimeRole} from './provision_runtime_role.mjs';

export function loadManagedDatabaseConfiguration(path) {
  let value;
  try{value=JSON.parse(readFileSync(path,'utf8'));}
  catch{throw new Error('No se pudo leer la configuración privada de la base gestionada.');}
  if(!value||typeof value!=='object'||Array.isArray(value)||
    Object.keys(value).some(key=>!['HANYUMATIZ_DATABASE_ADMIN_URL','HANYUMATIZ_DATABASE_URL'].includes(key)))
    throw new Error('La configuración privada debe contener solamente las dos conexiones SQL.');
  const role=runtimeRoleConfiguration(value);
  chmodSync(path,0o600);
  return {env:value,role};
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  let owner,runtime;
  try{
    const path=resolve(process.argv[2]||`${ROOT}.local/managed-database.json`);
    const configuration=loadManagedDatabaseConfiguration(path);
    Object.assign(process.env,configuration.env);
    const catalog=buildCatalog({mode:'public'});
    owner=createPool({admin:true});
    await migrate(owner);await importCatalog(owner,catalog);
    await provisionRuntimeRole(owner,configuration.role);
    runtime=createPool();
    const snapshot=await readBootstrap(runtime);
    if(snapshot.dataVersion!==catalog.dataVersion)throw new Error('La versión activa no coincide con el catálogo importado.');
    console.log(`Base gestionada preparada: ${snapshot.words.length} palabras. El acceso limitado puede leer el catálogo. No se publicaron credenciales.`);
  }catch{
    console.error('No se pudo preparar la base gestionada. Comprueba el archivo privado, permisos del propietario y conexiones al mismo proyecto. No se han mostrado credenciales.');
    process.exitCode=1;
  }finally{await runtime?.end();await owner?.end();}
}

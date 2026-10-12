import {fileURLToPath} from 'node:url';
import {createPool} from './database.mjs';

export function runtimeRoleConfiguration(env=process.env) {
  if(!env.HANYUMATIZ_DATABASE_ADMIN_URL||!env.HANYUMATIZ_DATABASE_URL)
    throw new Error('Configura las dos conexiones privadas: propietario para importar y aplicación para servir.');
  let admin,runtime;
  try{admin=new URL(env.HANYUMATIZ_DATABASE_ADMIN_URL);runtime=new URL(env.HANYUMATIZ_DATABASE_URL);}
  catch{throw new Error('Las conexiones deben ser URLs PostgreSQL válidas.');}
  if(!['postgres:','postgresql:'].includes(admin.protocol)||!['postgres:','postgresql:'].includes(runtime.protocol))
    throw new Error('Las conexiones deben utilizar PostgreSQL.');
  const directHost=value=>value.hostname.replace('-pooler.','.');
  if(directHost(admin)!==directHost(runtime)||admin.port!==runtime.port||admin.pathname!==runtime.pathname)
    throw new Error('Las conexiones deben apuntar al mismo proyecto y base de datos.');
  let user,password,owner;
  try{user=decodeURIComponent(runtime.username);password=decodeURIComponent(runtime.password);owner=decodeURIComponent(admin.username);}
  catch{throw new Error('Las credenciales de las conexiones no tienen una codificación válida.');}
  if(!/^hanyumatiz_app(?:_[a-z0-9]+)?$/.test(user)||user===owner)
    throw new Error('Utiliza un rol distinto del propietario, llamado hanyumatiz_app o hanyumatiz_app seguido de un sufijo.');
  if(password.length<20)throw new Error('La contraseña del rol de aplicación debe tener al menos 20 caracteres.');
  return {user,password};
}

export async function provisionRuntimeRole(pool,configuration) {
  const {user,password}=configuration;
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const existing=await client.query('SELECT oid,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=$1',[user]);
    if(existing.rows.length){
      const role=existing.rows[0];
      const members=await client.query('SELECT 1 FROM pg_auth_members WHERE member=$1 LIMIT 1',[role.oid]);
      const owned=await client.query("SELECT 1 FROM pg_class WHERE relowner=$1 AND relnamespace='public'::regnamespace LIMIT 1",[role.oid]);
      if(role.rolsuper||role.rolcreatedb||role.rolcreaterole||role.rolreplication||role.rolbypassrls||members.rows.length||owned.rows.length)
        throw new Error('El rol elegido tiene privilegios u objetos de propietario. Utiliza un rol nuevo limitado.');
    }
    // PostgreSQL quotes identifiers and password literals. No constructed SQL or URL is logged.
    const statement=await client.query(`SELECT format('${existing.rows.length?'ALTER':'CREATE'} ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',$1::text,$2::text) AS sql`,[user,password]);
    await client.query(statement.rows[0].sql);
    for(const statement of [
      'REVOKE ALL ON catalog_versions,catalog_active,content_entities,content_links,nuance_reports,report_history FROM %I',
      'REVOKE CREATE ON SCHEMA public FROM %I',
      'GRANT USAGE ON SCHEMA public TO %I',
      'GRANT SELECT ON catalog_versions,catalog_active,content_entities,content_links TO %I',
      'GRANT SELECT,INSERT,UPDATE ON nuance_reports TO %I',
      'GRANT SELECT,INSERT ON report_history TO %I',
      'GRANT USAGE,SELECT ON SEQUENCE report_history_id_seq TO %I'
    ]){
      const quoted=await client.query('SELECT format($1::text,$2::text) AS sql',[statement,user]);
      await client.query(quoted.rows[0].sql);
    }
    const permissions=await client.query("SELECT has_schema_privilege($1,'public','CREATE') AS can_create",[user]);
    if(permissions.rows[0]?.can_create)throw new Error('El esquema concede CREATE mediante permisos generales. Utiliza una base dedicada con public limitado.');
    await client.query('COMMIT');
    return {role:user,restricted:true};
  }catch(error){await client.query('ROLLBACK');throw error;}
  finally{client.release();}
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  let pool;
  try{
    const configuration=runtimeRoleConfiguration();
    pool=createPool({admin:true});
    await provisionRuntimeRole(pool,configuration);
    console.log('Rol de aplicación preparado. Usa su conexión limitada en el alojamiento.');
  }catch{
    // Provider errors can contain SQL, URLs, or password values. Keep CLI output private-data-free.
    console.error('No se pudo preparar el rol limitado. Comprueba las dos conexiones, importa el catálogo y utiliza un rol nuevo sin privilegios de propietario.');
    process.exitCode=1;
  }finally{await pool?.end();}
}

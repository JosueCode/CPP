# Base de datos y reportes privados

La aplicación web utiliza HTML, CSS y JavaScript, con un servidor **Node.js** y una base de datos **PostgreSQL 17**. El HTML autónomo sigue siendo una copia local para probar y estudiar: no sustituye al servidor de reportes. El servidor Node no utiliza Python ni devuelve un JSON local como sustituto silencioso de SQL.

## Arranque en este entorno

Requisitos: Node 22 o posterior y Docker. PostgreSQL ya está disponible en el contenedor `hanyumatiz-postgres`, con puerto enlazado solo a `127.0.0.1:5434` y volumen persistente `hanyumatiz-postgres-data`.

```sh
npm ci --cache .local/npm-cache
npm run db:start
npm run db:import
npm start
```

La aplicación abre en `http://127.0.0.1:8770`. La bandeja privada está en `/admin` y requiere autenticación HTTP Basic. Las credenciales de administración se generan aleatoriamente en `.local/node-admin.json`. Las de SQL están en `.local/postgres.json`; estos archivos tienen permisos `0600`, están fuera de los assets web y nunca deben subirse a un repositorio ni incluirse en la entrega pública. No hay una contraseña predeterminada.

`db:start` es idempotente: conserva el contenedor, la contraseña y el volumen existente. No borra contenido ni reportes. Para detener PostgreSQL conservando los datos, utiliza `docker stop hanyumatiz-postgres`; para volver a arrancarlo, `npm run db:start`.

## Modelo y migración

`tools/catalog.mjs` compone el catálogo a partir de fuentes editoriales originales y del expediente histórico inmutable. `tools/import_postgres.mjs` importa el catálogo validado mediante una transacción; `sql/001_catalog_and_reports.sql` es la migración de esquema idempotente.

| Tabla | Contenido |
|---|---|
| `catalog_versions` | Versión del contenido, metadatos de procedencia y fecha de importación. |
| `catalog_active` | Versión que muestra la aplicación y modo de acceso. |
| `content_entities` | Palabras, pronunciaciones, acepciones, comparaciones, situaciones, ejercicios, ejemplos, relaciones y lecciones. Cada entidad conserva su ID, orden y ficha JSONB. |
| `content_links` | Vínculos normalizados entre entidades, comprobados con claves foráneas. |
| `nuance_reports` | Comentarios privados vinculados a la entidad y a su versión exacta. |
| `report_history` | Cambios de estado, notas de la persona propietaria y, si corresponde, versión corregida. |

Las claves de contenido son `(content_version, kind, id)`. Las pronunciaciones y las acepciones tienen sus propias entidades y vínculos; no quedan únicamente como texto opaco dentro de una palabra. Las fichas JSONB permiten conservar sin pérdida las explicaciones, opciones, procedencia y campos adicionales del modelo de aprendizaje.

La importación conserva IDs y relaciones, valida referencias y utiliza una transacción y un bloqueo de importación. Una referencia rota aborta toda la importación. Reimportar la misma versión es seguro; modificar su contenido sin una nueva `dataVersion` se rechaza. Una versión nueva se activa al terminar, manteniendo las anteriores para que los reportes continúen mostrando el contexto que vio el usuario. **No hay `TRUNCATE`, borrado ni recreación de tablas de reportes al reimportar.**

El modo de transporte público/privado se guarda aparte de la versión editorial. `npm run db:import -- --private` requiere autenticación para la aplicación completa y aplica el cambio inmediatamente. La entrega actual usa el modo público, según la decisión de la persona propietaria; la bandeja y los reportes siguen siempre privados. Esto no declara aprobaciones externas ni modifica el registro P12.

## Reportar un error de matiz

La versión web ofrece un formulario vinculado a la palabra, comparación o ejercicio actual. El usuario aporta motivo, comentario y contacto opcional. El servidor recibe:

```json
{
  "targetType": "word",
  "targetId": "ID_DE_PALABRA",
  "contentVersion": "VERSION_DEL_CATALOGO",
  "reason": "meaning",
  "comment": "Qué parece incorrecto y por qué.",
  "contact": "Opcional"
}
```

`targetType` admite `word`, `contrast`, `exercise`; `reason` admite `meaning`, `naturalness`, `grammar`, `translation`, `answer`, `other`. El comentario debe contener de 10 a 2.000 caracteres y el contacto como máximo 120. El límite total del cuerpo JSON es 16 KiB.

El navegador obtiene primero `GET /api/csrf`, que entrega `{csrfToken}` y una cookie `HttpOnly; SameSite=Strict`. Después envía `POST /api/reports` con el token en `X-CSRF-Token`. El servidor exige el mismo origen, comprueba que la entidad existe en la versión activa y guarda el reporte mediante consultas parametrizadas. La respuesta `201` contiene `{id, status: "pending", receivedAt}`: confirma recepción y no implica aceptación de la corrección.

Una versión obsoleta devuelve `409` y pide recargar; un contenido inexistente devuelve `404`. No hay un endpoint público para consultar comentarios. No se publican contactos ni se envían correos automáticamente. Hay un límite de cinco reportes exitosos por dirección de conexión en 30 minutos, además de un límite de intentos. En un despliegue con proxy se deberá conservar el límite en el proxy para evitar tratar todos los alumnos como una sola dirección; el servidor no confía en `X-Forwarded-For` aportado por cualquiera.

En el HTML autónomo, el reporte solo se guarda como borrador local o se exporta para compartirlo: se indica expresamente que **no se ha enviado**. El archivo descargable no puede recibir comentarios en una bandeja remota sin conexión y sin una dirección de servidor desplegada.

## Bandeja de administración

`/admin` muestra filtros para `pending`, `reviewing`, `resolved`, `dismissed`. Para cada reporte, muestra comentario, contacto opcional, contenido y versión reportados, fecha e historial. Permite cambiar estado, escribir una nota privada y asociar la versión donde se realizó una corrección. Guardar una decisión no modifica automáticamente las explicaciones: una corrección del contenido se incorpora al catálogo y se importa como una versión nueva.

`GET /api/admin/reports` y `PATCH /api/admin/reports/:id` requieren credenciales reales. Las mutaciones también exigen CSRF y mismo origen. Los textos de usuarios se representan con `textContent`, sin `innerHTML`, por lo que un comentario con etiquetas no se ejecuta como código.

## Operación y publicación

El servidor escucha únicamente en loopback. Para ofrecer la aplicación en Internet hace falta un dominio, un proxy HTTPS y persistencia fuera del entorno efímero. **Una prueba local no significa que la aplicación ya esté desplegada públicamente.** Basic auth no debe transmitirse por HTTP abierto.

Para PostgreSQL gestionado, configura `HANYUMATIZ_DATABASE_URL` (rol de aplicación) y `HANYUMATIZ_DATABASE_ADMIN_URL` (rol de migración) mediante un almacén privado de secretos. Las conexiones externas verifican el certificado TLS. Para acceso externo configura `HANYUMATIZ_ALLOWED_ORIGINS` con el origen HTTPS exacto, y `HANYUMATIZ_ADMIN_USER`/`HANYUMATIZ_ADMIN_PASSWORD` con una clave aleatoria de al menos 20 caracteres. El servidor no expone configuración, archivos de datos, scripts de migración ni claves. El rol local de aplicación solo puede leer contenido y crear/gestionar reportes; no puede editar o borrar las tablas de contenido.

Ejemplo de copia de seguridad local (incluye reportes privados y no debe publicarse):

```sh
umask 077
docker exec hanyumatiz-postgres pg_dump -U hanyumatiz_owner -d hanyumatiz > .local/copia-privada.sql
```

La bandeja conserva el contacto que el usuario proporciona; una política de conservación y borrado debe decidirse antes del lanzamiento público. No se guardan direcciones IP en los reportes: el control temporal de envíos vive solo en memoria.

## Verificación

```sh
npm run test:backend
```

Los tests arrancan un servidor HTTP real y utilizan PostgreSQL real en una base temporal aislada, que eliminan al terminar. Comprueban migración, IDs y vínculos, restricciones del rol, reportes privados, CSRF y origen, límites, inyección SQL, historial, preservación al reimportar y contexto de versiones anteriores. No son pruebas con una base simulada y no dejan reportes de prueba en la base principal.

# Publicar la versión conectada con Render Free y Neon Free

Este procedimiento prepara una aplicación pública con Node.js, PostgreSQL y bandeja privada de reportes. No crea cuentas, no contrata servicios y no representa un despliegue ya realizado. Se necesitan cuentas propias de GitHub, Render y Neon y acceso a sus paneles. Si el panel no ofrece un plan gratuito para tu cuenta, detente antes de elegir un plan de pago.

El Blueprint `render.yaml` define **un servicio web `plan: free`**, sin disco persistente, base de datos de Render, trabajador, cron ni comando previo al despliegue. Su carpeta de código es `HanYuMatiz_App`. Si utilizas otro repositorio que tiene el proyecto en su raíz, cambia `rootDir` a `.` antes de crear el servicio. El código del servidor obtiene `PORT` y `RENDER_EXTERNAL_URL` del alojamiento: escucha en `0.0.0.0` y permite únicamente ese origen HTTPS. No requiere un dominio comprado.

## 1. Crear una base gratuita dedicada

En Neon selecciona **Free**, crea un proyecto y una base dedicada a HanYuMatiz. Conserva privada la conexión PostgreSQL del propietario. No pongas esa conexión en GitHub, el chat, capturas, el HTML ni las variables permanentes de Render.

Para la aplicación utiliza un rol nuevo llamado `hanyumatiz_app`, con contraseña aleatoria de al menos 20 caracteres. El script de preparación crea ese rol mediante SQL después de importar el catálogo. No uses en Render el propietario de Neon ni un rol con membresía en `neon_superuser`. Los permisos de creación de roles dependen del proyecto y del proveedor: el script se ha probado con PostgreSQL local, no con una cuenta Neon real. Si Neon rechaza la creación, comprueba los permisos en su panel; no sustituyas la conexión limitada por la de propietario como solución.

Neon ofrece conexiones directas y agrupadas. Usa la directa para preparación y la agrupada para la aplicación. Ambas deben apuntar al mismo proyecto, base y puerto. Al construir la conexión del nuevo rol, conserva el host y parámetros del proyecto, sustituye usuario y contraseña y codifica los caracteres especiales de la contraseña como corresponde a una URL.

## 2. Importar el catálogo y preparar el rol una vez

Esto se ejecuta en tu ordenador con **Node.js 22 o posterior**, o en un entorno de desarrollo autorizado. No requiere Python ni Docker. Render Free no necesita Shell ni `preDeployCommand` para este procedimiento.

Extrae el proyecto conectado y ejecuta:

```bash
npm ci --cache .local/npm-cache --no-fund --no-audit
```

Crea la carpeta privada `.local` y, con un editor local, guarda `.local/managed-database.json` usando las conexiones reales:

```json
{
  "HANYUMATIZ_DATABASE_ADMIN_URL": "postgresql://PROPIETARIO:CLAVE@HOST_DIRECTO/BASE?sslmode=require",
  "HANYUMATIZ_DATABASE_URL": "postgresql://hanyumatiz_app:CLAVE_NUEVA@HOST_AGRUPADO/BASE?sslmode=require"
}
```

No subas ese archivo. El script limita sus permisos a lectura y escritura del propietario cuando el sistema admite permisos POSIX y no imprime las conexiones ni contraseñas. En Windows conserva el archivo en tu perfil privado:

```bash
node tools/setup_managed_database.mjs
```

El proceso importa el catálogo público, crea o actualiza el rol restringido y comprueba que ese rol puede leer el catálogo desde PostgreSQL. Los errores de configuración dejan una salida genérica para evitar revelar secretos. Las conexiones externas verifican certificados TLS. Una preparación repetida mantiene los reportes y el historial; no debes volver a generar la contraseña del rol en cada despliegue.

El rol de aplicación puede leer el catálogo, insertar y actualizar reportes e insertar historial. No puede editar el contenido, borrar reportes ni crear tablas. Para futuras actualizaciones de contenido vuelve a ejecutar el mismo procedimiento desde el entorno privado con la conexión del propietario. **La aplicación de Render nunca necesita esa conexión de propietario.**

## 3. Crear el servicio gratuito de Render

En Render, conecta `JosueCode/CPP` y crea un Blueprint. Selecciona en el panel la rama `hanyumatiz-pdf-corregido`, que contiene `render.yaml` en la raíz. El servicio del Blueprint también declara esa rama explícitamente. Revisa la pantalla antes de confirmar: debe mostrar un único servicio web **Free** y ninguna base de datos o recurso de pago.

El Blueprint solicita `HANYUMATIZ_DATABASE_URL`. Introduce únicamente la conexión de `hanyumatiz_app`. Genera una contraseña privada larga para la administración y utiliza el usuario `hanyumatiz`. La contraseña del panel es distinta de la contraseña SQL. Guárdala en un gestor de contraseñas y consulta la variable privada generada en el panel de Render cuando necesites acceder a `/admin`.

El servicio utiliza:

| Configuración | Valor |
|---|---|
| Runtime | Node.js |
| Plan | Free |
| Root Directory | `HanYuMatiz_App` |
| Build Command | `npm ci --cache .local/npm-cache --no-fund --no-audit` |
| Start Command | `npm start` |
| Health Check Path | `/healthz` |
| `HANYUMATIZ_DATABASE_URL` | Secreto de conexión del rol limitado |
| `HANYUMATIZ_ADMIN_USER` | `hanyumatiz` |
| `HANYUMATIZ_ADMIN_PASSWORD` | Secreto aleatorio, mínimo 20 caracteres |

No añadas `HANYUMATIZ_DATABASE_ADMIN_URL`. No ejecutes `npm run build` para servir esta versión: el servidor entrega `web/index.html` y carga el catálogo desde SQL. `npm run build` genera la edición estática independiente.

Si prefieres crear el Web Service manualmente, usa exactamente la tabla y selecciona Free. Render proporciona `PORT` y el origen público; con otro alojamiento configura `PORT`, `HANYUMATIZ_HOST=0.0.0.0` y `HANYUMATIZ_ALLOWED_ORIGINS=https://TU_DIRECCION` mediante su panel. Para un dominio propio posterior, añade su origen HTTPS exacto a `HANYUMATIZ_ALLOWED_ORIGINS`.

## 4. Comprobar la dirección pública

La dirección será similar a `https://hanyumatiz-xxxx.onrender.com`. Comprueba desde esa dirección:

1. `/healthz` devuelve únicamente `{"status":"ok"}` cuando existe catálogo SQL activo. Es una sonda ligera para el alojamiento y devuelve 503 si la base falla o no tiene versión activa, sin descargar los datos completos. `/api/bootstrap` devuelve el catálogo actual; no una página de error ni un catálogo de respaldo. El servidor no arranca si la base está inaccesible o vacía.
2. Las lecciones, introducciones, HSK y comparaciones cargan. El progreso personal se conserva en el navegador.
3. Una imagen y un PDF producen texto editable en Dictado. Los archivos se procesan en el dispositivo, sin subirlos a PostgreSQL.
4. Enviar un reporte devuelve confirmación real. En `/admin`, entra con tus credenciales y comprueba que llegó y que la bandeja permanece privada.
5. Una voz de mandarín instalada reproduce el dictado. No todos los navegadores incluyen esa voz. Prueba además un móvil real; no se ha probado aquí una cámara física ni lectura audible china.

## Qué implica usar los planes gratuitos

Una dirección gratuita admite visitantes igual que un dominio comprado. El plan gratuito del servidor puede suspenderse cuando no hay actividad y tardar en volver a arrancar. La base gratuita también tiene cuotas de almacenamiento y cómputo. Consulta los límites actuales en los paneles antes de anunciar la aplicación y mantén ambos planes en Free; estas instrucciones no prometen capacidad ilimitada ni disponibilidad continua.

Los textos de Dictado y el progreso no se sincronizan entre dispositivos. Los reportes y el catálogo sí están en PostgreSQL. No confíes en el disco efímero de Render para credenciales o datos: se guardan en variables privadas y Neon. La limitación de reportes de esta versión agrupa solicitudes por conexión al servidor; detrás de un proxy compartido puede aplicar a varios visitantes. Antes de promocionarla a gran escala, adapta ese límite al proxy o a la protección de abuso disponible en tu alojamiento.

Conserva copias de seguridad privadas de reportes y versiones del catálogo. Un plan gratuito puede tener retención limitada y no sustituye una copia propia. Para costes y cuotas vigentes consulta [Render Free](https://render.com/docs/free) y [Neon Free](https://neon.com/pricing).

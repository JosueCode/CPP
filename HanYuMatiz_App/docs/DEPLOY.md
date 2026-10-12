# Publicar HanYuMatiz

Hay dos entregas: un sitio estático con aprendizaje y dictado local, y una web conectada con PostgreSQL y reportes privados. Ambas usan HTML, CSS y JavaScript. Python no se necesita para ejecutar ninguna.

## Sitio estático con HTTPS

Desde el proyecto de desarrollo o el ZIP Node/PostgreSQL, usa Node.js 22 o posterior:

```bash
npm ci --cache .local/npm-cache --no-fund --no-audit
npm run build
```

La salida es `dist/index.html`. Incorpora catálogo, fuentes, módulos, modelos chinos y recursos PDF. No necesita una carpeta vendor externa, CDN ni OCR instalado en el servidor. El generador comprueba tamaño y SHA-256 de cada recurso contra `web/vendor/ocr/manifest.json`.

Publica `dist` en un hosting estático con HTTPS. En Netlify o un servicio equivalente, el comando de construcción es `npm run build` y la carpeta de publicación es `dist`. En GitHub Pages, publica ese archivo desde la carpeta o artefacto elegido por el flujo de despliegue. También puedes cargar directamente el HTML ya generado. Las rutas usan fragmentos como `#learn` y `#dictation`; no necesitan reescritura SPA.

El documento incluye su política CSP. Si el hosting añade otra, ambas se aplican: permite los hashes del script y estilo incorporados, recursos `blob:` para scripts/trabajadores/conexiones locales, `wasm-unsafe-eval` para OCR y fuentes/imágenes `data:` o `blob:`. No requiere `unsafe-eval` general ni dominios externos. Una política adicional que bloquee esos recursos impedirá OCR/PDF; comprueba la causa antes de cambiarla.

El OCR procesa documentos en el navegador y exige revisar el texto. Dictados y progreso se guardan localmente. El dispositivo necesita una voz real de mandarín: los modelos OCR no son voces. Las voces remotas requieren consentimiento y pueden utilizar servicios del navegador. No se ha comprobado lectura audible en el entorno de construcción, que carece de voces chinas.

El sitio estático guarda o exporta reportes como borradores; no tiene bandeja privada remota. Para recibirlos utiliza la entrega conectada.

## Web conectada con Node.js y PostgreSQL

Para una primera publicación sin contratar un plan de pago, consulta [Render Free + Neon Free](DEPLOY_GRATIS_RENDER_NEON.md). El repositorio incluye un Blueprint que solo declara un servicio web Free y un script privado de importación inicial; todavía requieren las cuentas del propietario y una base configurada.

Para una prueba local con Docker:

```bash
npm ci --cache .local/npm-cache --no-fund --no-audit
npm run db:start
npm run db:import
npm start
```

Abre `http://127.0.0.1:8770`. `/admin` usa credenciales aleatorias en `.local/node-admin.json`; la configuración SQL está en `.local/postgres.json`. No publiques esa carpeta.

En producción instala Node.js 22 o posterior y usa PostgreSQL persistente. En un VPS coloca un proxy HTTPS delante del servidor y conserva la escucha en loopback. En alojamientos gestionados, `PORT` permite escuchar en `0.0.0.0`; en Render también se obtiene y valida automáticamente `RENDER_EXTERNAL_URL` como origen público HTTPS. Configura mediante secretos privados:

- `HANYUMATIZ_DATABASE_URL`: conexión del rol de aplicación.
- `HANYUMATIZ_DATABASE_ADMIN_URL`: conexión del rol de importación/migración, solo en el entorno privado que realiza esa tarea; no la guardes en el servidor público.
- `HANYUMATIZ_ALLOWED_ORIGINS`: origen HTTPS exacto.
- `HANYUMATIZ_ADMIN_USER` y `HANYUMATIZ_ADMIN_PASSWORD`: acceso privado con contraseña aleatoria larga.

Ejecuta `npm run db:import` en el entorno privado para actualizar el catálogo y `npm start` en el servidor público para servir la web. Para preparar una base gestionada y un rol limitado usa `node tools/setup_managed_database.mjs` como explica la guía gratuita. Conserva base y reportes en PostgreSQL; las credenciales de producción van en secretos del alojamiento y se exigen antes de publicar. Las conexiones SQL externas verifican TLS. Configura límites de reportes también en el proxy cuando varias personas compartan su dirección de conexión.

Conserva la carpeta completa `web/vendor/ocr`, con sus archivos anidados, manifiesto y licencias. La web sirve solamente los recursos OCR enumerados. El reconocimiento se ejecuta en el navegador y no necesita endpoints para subir documentos. PostgreSQL guarda catálogo y comentarios privados, no los textos personales de Dictado.

Consulta [BASE_DATOS_REPORTES.md](BASE_DATOS_REPORTES.md) para roles, migraciones, privacidad, autenticación y copias de seguridad.

## Corregir contenido y regenerar

En el proyecto de desarrollo corrige las fuentes originales. En el paquete portátil edita `data/catalog.json`, conservando IDs. Ejecuta `npm run db:import` para activar la versión conectada y `npm run build` para regenerar el HTML. La importación conserva versiones y reportes anteriores.

Para reconstruir las descargas del proyecto de desarrollo:

```bash
node tools/package_pass_01.mjs
```

También se admiten destinos explícitos:

```bash
node tools/build_preview.mjs --output-dir dist --filename index.html
node tools/package_pass_01.mjs --output-dir /tmp/hanyumatiz-entrega --name HanYuMatiz_HSK_y_Dictado
```

Se entregan licencias de fuentes, referencia HSK y OCR. Los recursos OCR están fijados por versión e integridad. Credenciales, reportes, documentos personales y node_modules no forman parte del paquete.

Antes de anunciar un sitio publicado verifica su URL HTTPS, una extracción real de imagen/PDF, almacenamiento, rutas, acceso privado a `/admin` si corresponde y una voz de mandarín en un dispositivo que la tenga instalada. Los archivos descargables y estas instrucciones no configuran por sí solos un hosting externo.

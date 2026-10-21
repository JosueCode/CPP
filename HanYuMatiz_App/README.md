# HanYuMatiz — HTML, CSS, JavaScript, Node.js y PostgreSQL

236 palabras, 20 lecciones, 74 pares, 277 casos comparados y 292 ejercicios. Incluye introducción a las palabras, selección HSK, dictado y extracción local de imágenes/PDF.

Para estudiar descarga `HanYuMatiz_PDF_Corregido.zip`, descomprímelo y abre `HanYuMatiz_PDF_Corregido.html` en un navegador actualizado. No necesita Node.js ni Python. El ZIP de fuente es para desarrollar la aplicación: requiere Node.js 22 o posterior. La versión conectada necesita Docker o PostgreSQL externo.

Para importar un PDF entra en **Dictado → Crear un dictado → Subir PDF**. Selecciona el archivo, indica las páginas y pulsa **Extraer texto**. Revisa y corrige el resultado; confírmalo y pulsa **Revisar frases** para preparar la práctica. Puedes consultar cada página del original antes de extraer. Si cancelas o falla la apertura, usa **Reintentar abrir PDF**. Se admiten PDF de hasta 25 MB y 100 páginas; cada extracción incluye como máximo 10 páginas. Los documentos se procesan en tu navegador.

Instala y genera el sitio estático:

```bash
npm ci --cache .local/npm-cache --no-fund --no-audit
npm run build
```

Para generar los dos ZIP de entrega desde el HTML compilado:

```bash
node tools/package_delivery.mjs --html dist/index.html --output-dir /workspace/shared/downloads/HanYuMatiz_PDF_Corregido
```

El empaquetador usa Node.js y módulos estándar, conserva las licencias y genera hashes SHA256. El ZIP de estudio incluye el HTML y una guía breve. El ZIP de fuente selecciona los archivos públicos; excluye configuración local, credenciales, dependencias instaladas, reportes, bases de datos y documentos personales.

Publica dist/index.html por HTTPS. Lleva el catálogo, fuentes, módulos y modelos OCR incorporados; no depende de un CDN. El dictado procesa tus documentos en el navegador. La voz depende de las voces de mandarín disponibles en tu dispositivo; las remotas requieren consentimiento. El sitio estático conserva borradores de reportes, pero no aloja la bandeja del propietario.

Para la versión conectada:

```bash
npm run db:start
npm run db:import
npm start
```

Abre http://127.0.0.1:8770. La bandeja privada está en /admin. Las credenciales se generan en .local/node-admin.json y nunca deben publicarse. Consulta docs/DEPLOY.md y docs/BASE_DATOS_REPORTES.md para HTTPS, hosting y PostgreSQL gestionado.

El catálogo editable portátil está en data/catalog.json. Conserva IDs al corregirlo; ejecuta npm run db:import para activar otra versión SQL y npm run build para regenerar el HTML. La importación mantiene versiones anteriores y sus reportes. Los archivos data/hsk/sources y su manifiesto permiten comprobar la transcripción de referencia; no incluyen explicaciones originales de otros servicios ni atribuyen verificación directa del PDF oficial.

Pruebas unitarias del módulo: `node --test tests/test_dictation*.mjs tests/test_pdf_geometry.mjs tests/test_hsk_selection.mjs`. Pruebas con PostgreSQL real: `npm run test:backend`. Las pruebas de navegador y sus limitaciones deben describirse por separado: una prueba del mismo HTML servido por HTTP no demuestra apertura por `file://`. El Chromium gestionado de este entorno bloquea esa navegación antes de cargar la aplicación. Los archivos de licencia acompañan la referencia HSK, las fuentes y todos los recursos OCR.

Este paquete excluye expedientes privados, comentarios, credenciales, imágenes/PDF personales, node_modules y volúmenes de base de datos. Un paquete descargable y una prueba local no implican que exista un hosting externo desplegado.

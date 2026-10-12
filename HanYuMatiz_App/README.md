# HanYuMatiz — HTML, CSS, JavaScript, Node.js y PostgreSQL

236 palabras, 20 lecciones, 74 pares, 277 casos comparados y 292 ejercicios. Incluye introducción a las palabras, selección HSK, dictado y extracción local de imágenes/PDF.

Para estudiar usa el ZIP HTML; no necesita Node.js ni Python. Este paquete contiene la web conectada y el generador estático. Requiere Node.js 22 o posterior. La versión conectada necesita Docker o PostgreSQL externo.

Instala y genera el sitio estático:

```bash
npm ci --cache .local/npm-cache --no-fund --no-audit
npm run build
```

Publica dist/index.html por HTTPS. Lleva el catálogo, fuentes, módulos y modelos OCR incorporados; no depende de un CDN. El dictado procesa tus documentos en el navegador. La voz depende de las voces de mandarín disponibles en tu dispositivo; las remotas requieren consentimiento. El sitio estático conserva borradores de reportes, pero no aloja la bandeja del propietario.

Para la versión conectada:

```bash
npm run db:start
npm run db:import
npm start
```

Abre http://127.0.0.1:8770. La bandeja privada está en /admin. Las credenciales se generan en .local/node-admin.json y nunca deben publicarse. Consulta docs/DEPLOY.md y docs/BASE_DATOS_REPORTES.md para HTTPS, hosting y PostgreSQL gestionado.

El catálogo editable portátil está en data/catalog.json. Conserva IDs al corregirlo; ejecuta npm run db:import para activar otra versión SQL y npm run build para regenerar el HTML. La importación mantiene versiones anteriores y sus reportes. Los archivos data/hsk/sources y su manifiesto permiten comprobar la transcripción de referencia; no incluyen explicaciones originales de otros servicios ni atribuyen verificación directa del PDF oficial.

Pruebas unitarias del módulo: node --test tests/test_dictation*.mjs tests/test_hsk_selection.mjs. Pruebas con PostgreSQL real: npm run test:backend. Los archivos de licencia acompañan la referencia HSK, las fuentes y todos los recursos OCR.

Este paquete excluye expedientes privados, comentarios, credenciales, imágenes/PDF personales, node_modules y volúmenes de base de datos. Un paquete descargable y una prueba local no implican que exista un hosting externo desplegado.

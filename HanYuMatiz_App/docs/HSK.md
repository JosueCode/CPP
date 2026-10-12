# Selección de vocabulario HSK 1–6

La selección usa el programa de **noviembre de 2025**, identificado como `HSK_SYLLABUS_2025_11_2026_07`. Conserva la edición del expediente P12. La referencia de 2021, a menudo también denominada «HSK 3.0», tiene otro vocabulario y otros recuentos y no se mezcla con esta.

El sistema ya permite obtener vocabulario por nivel y localizar las fichas, lecturas y ejercicios que están disponibles en HanYuMatiz. Una posición incluida en el programa y una lección propia son entidades distintas: trabajar un par no convierte toda la lección en un curso oficial de ese nivel.

## Evidencia obtenida

Las consultas HTTPS al programa oficial, al PDF de `hsk.cn-bj.ufileos.com` y al espejo indicado por P12 fueron rechazadas por el proxy con `Tunnel connection failed: 403 Forbidden`. Ese rechazo limita la comprobación directa y no significa que los documentos sean inaccesibles al público.

Se obtuvo por HTTPS la transcripción secundaria [HSK 3.0, sección 2025-11, de Mani/krmanik](https://github.com/krmanik/HSK-3.0/blob/182692ce5a11bc30bdc771835d2f0f27491c25de/README.md). Esa sección enlaza el programa oficial y proporciona tablas numeradas con nivel, palabra, pinyin y categoría gramatical. Se conserva el commit `182692ce5a11bc30bdc771835d2f0f27491c25de`, los seis archivos exactos, sus bytes y sus SHA-256 en [reference.json](../data/hsk/reference.json).

La procedencia es **transcripción secundaria identificada**, con `officialDirectVerified: false`. La fecha de aplicación `2026-07` sigue siendo una declaración del expediente recibido; esta investigación no demuestra implantación efectiva del examen en un país, centro o convocatoria concreta.

El registro de acceso, recuentos y límites está en [HSK_SELECTION_SOURCE_REVIEW.json](research/HSK_SELECTION_SOURCE_REVIEW.json). Los archivos `hsk-official.json` y `hsk-official-hsk.json` conservan los intentos anteriores, sin sobrescribirlos.

## Posiciones y recuentos

| Nivel | Posiciones nuevas | Acumuladas |
| --- | ---: | ---: |
| HSK 1 | 300 | 300 |
| HSK 2 | 200 | 500 |
| HSK 3 | 500 | 1.000 |
| HSK 4 | 1.000 | 2.000 |
| HSK 5 | 1.600 | 3.600 |
| HSK 6 | 1.800 | 5.400 |

Las tablas contienen todas las posiciones del **1 al 5.400**, sin huecos ni discrepancias entre las filas que se repiten. Tras separar marcadores de homógrafos, contienen 5.334 grafías distintas. Por eso 5.400 posiciones no equivale a 5.400 palabras únicas ni a 5.400 pares de sinónimos.

Las listas simples del proveedor suman 5.483 filas: también repiten palabras cuyas acepciones o categorías se incorporan en niveles posteriores. Por ejemplo, `好` aparece como `1（2）（4）`. El módulo mantiene una sola posición con nivel de introducción 1 y conserva los niveles adicionales como metadatos; no crea otra palabra ni atribuye automáticamente todas esas acepciones a la ficha del producto.

La selección del producto se recalcula al añadir o corregir contenido. Distingue posiciones del programa, posiciones con ficha propia, palabras con ficha y palabras que además tienen práctica de matices. Esos recuentos describen recursos disponibles; no certifican cobertura curricular.

## Asignación por palabra y lectura

[tools/hsk.mjs](../tools/hsk.mjs) expone:

```js
import { enrichCatalogHSK } from './hsk.mjs';
enrichCatalogHSK(catalog);
```

La llamada añade `hskCatalog`, `hskSelection` y `words[].hsk_classification`. Se ejecuta después de crear las lecciones y antes de calcular la versión del catálogo. El módulo verifica los hashes de sus fuentes y los recuentos de posiciones en cada reconstrucción.

La coincidencia requiere **hanzi y pinyin con tonos**. Solo ignora espacios, apóstrofos y mayúsculas. Cada asignación conserva `pronunciation_id`, posición, nivel, URI con línea, SHA-256 y tipo de evidencia. Así `还 huán` corresponde a HSK 3, mientras que `还 hái` corresponde a HSK 1; `行 xíng` y `行 háng` conservan niveles 3 y 5 respectivamente.

La etiqueta general de una palabra es el menor nivel de sus lecturas coincidentes. Al presentar una palabra con varias lecturas, deben mostrarse las asignaciones de cada lectura para evitar extender ese nivel a todas.

Las formas no coincidentes mantienen nivel `null` y estado `no_match`. Un hanzi coincidente con otra lectura mantiene `null` y estado `reading_mismatch`, conservando la candidatura para comprobarla. Por ejemplo, `留下 liúxià` no se convierte silenciosamente en la lectura `liúxia` del listado. Tampoco se extiende una etiqueta de `接` a `接到`, o de `聊天儿` a `聊天`.

La evidencia indica dónde aparece una palabra en esta fuente concreta. No afirma que una variante sin etiqueta sea incorrecta, poco útil o inexistente.

## Selección y práctica

`hskSelection.levels` ofrece, para cada nivel, `entryIds`, `wordIds`, `pronunciationIds`, `practiceWordIds`, `contrastIds`, `exerciseIds` y `lessonIds`. La práctica puede enseñar una palabra seleccionada junto a un compañero de otro nivel o sin clasificar. Las etiquetas individuales se mantienen; el compañero no hereda el nivel.

`hskCatalog.entries` conserva las 5.400 posiciones, sus lecturas, ordinales y fuente. `hasCard`, `wordIds` y `pronunciationIds` permiten distinguir las fichas que ya tienen contenido propio del resto del programa.

Las [40 recomendaciones de vocabulario](../data/hsk/recommendations.json) son propuestas para futuras explicaciones originales. No se publican automáticamente y no se confunden con las tandas de contenido activo.

## Procedencia, licencias e historial

Las listas transcritas declaran **CC BY-SA 4.0** para «HSK 3.0 word lists» en su [License.md](https://github.com/krmanik/HSK-3.0/blob/182692ce5a11bc30bdc771835d2f0f27491c25de/License.md). El proyecto conserva [atribución](../data/hsk/ATTRIBUTION.md) y [texto de licencia](../data/hsk/CC-BY-SA-4.0.txt). Los términos comunes y sus niveles se usan como información de referencia; no se importan definiciones, ejemplos, ejercicios, imágenes ni audio del proveedor o del examen. Las explicaciones de HanYuMatiz son originales y siguen la política del propietario de reportes privados, con revisión externa opcional.

Los archivos históricos de `data/audit` permanecen intactos, incluidos sus estados y restricciones de ingestión. Las asignaciones actuales son datos del producto con una nueva evidencia secundaria identificada; no fabrican aprobaciones históricas. `ingest_official_hsk_syllabus` continúa en `false`, pues no se ha incorporado el PDF oficial.

La denominación HSK describe la referencia de vocabulario. No se usan logotipos oficiales ni se anuncian afiliación, certificados, currículo completo o garantía de aprobar el examen.

## Actualizar la referencia

1. Obtener y comprobar la edición concreta. Registrar URL, editor, fecha, bytes, SHA-256 y si el cotejo fue directo o mediante transcripción.
2. Guardar la nueva fuente fuera de `data/audit`. Si cambia el programa, crear una edición explícita; no reemplazar el identificador histórico ni mezclar listas distintas.
3. Comprobar ordinales, recuentos, homógrafos, pronunciaciones y acepciones añadidas. No corregir una lectura del producto para hacerla coincidir sin revisar qué se enseña.
4. Ejecutar `node --test tests/test_hsk_selection.mjs` y las pruebas del catálogo, importar la nueva versión a PostgreSQL y reconstruir el HTML. Los reportes previos siguen ligados a la versión que se comentó.
5. Verificar que la selección muestra los recuentos reales y que las fuentes, atribución y licencias acompañan las descargas.

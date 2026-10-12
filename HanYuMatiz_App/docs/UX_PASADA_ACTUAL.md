# HanYuMatiz: introducción, matices, selección HSK y dictado

Se conserva la identidad, el paisaje, la tipografía y la navegación del frontend existente. La entrada **听 · Dictado** usa los mismos colores y componentes. En pantallas pequeñas las cinco entradas caben en la navegación, con etiquetas y símbolos.

## Palabras antes del ejercicio

Una lección nueva abre **Conocer las palabras**. La introducción presenta cada par con hanzi, pinyin, significado, explicación y dos ejemplos traducidos. Anterior/siguiente permite recorrer los pares; **Empezar ejercicios** aparece al terminar. La sesión se crea después de esa introducción.

Una lección pendiente permite **Continuar ejercicios** o **Repasar las palabras**. Revisar la introducción conserva la sesión y sus respuestas. El fragmento de URL mantiene la posición y, cuando corresponde, la sesión a la que se volverá. El contador de lecciones completadas describe respuestas guardadas en esta versión; no certifica dominio del idioma.

La entrega contiene 236 palabras, 20 lecciones y 74 pares. Las lecciones trabajan 277 situaciones distintas una sola vez por sesión. El banco conserva 292 ejercicios porque algunos casos históricos tienen además una actividad de reconocimiento de validez.

## Respuesta y explicación

Las opciones están debajo de la frase. Una respuesta que incumple lo solicitado recibe **Respuesta incorrecta**, X y color rojo. Si la palabra sirve con otra intención o construcción, la explicación lo aclara sin conceder crédito a esa respuesta. Una sustitución fallida no se presenta como prohibición universal de una palabra.

Una respuesta adecuada recibe **Respuesta correcta** y marca verde. Cuando ambas opciones encajan con lo pedido, cualquiera recibe crédito. Las actividades que preguntan expresamente qué opciones pueden funcionar conservan su propia clave y explicación.

La explicación desarrolla cuatro ideas: qué se quería expresar, por qué la respuesta adecuada sirve, qué expresa o exige la alternativa y una regla fácil de recordar. El apoyo adicional ofrece un ejemplo distinto, sin repetir el resumen. Reportar un error sigue disponible al pie.

## Comparar

Un selector compacto y búsqueda por caracteres, pinyin o español permiten elegir un par. Cada situación muestra intención, dos versiones traducidas y conclusión. En escritorio aparecen juntas; en móvil se apilan. Anterior/siguiente recorre casos sin abandonar el par.

Comparar reúne 277 casos: 222 ejemplos bilingües originales y 55 situaciones históricas diferentes. Un caso vinculado a un ejercicio se muestra una sola vez. Los ejemplos originales también se practican en las lecciones. Una versión que necesita otro patrón aparece reformulada y etiquetada; una sustitución que no encaja conserva la advertencia.

## Por HSK

Las pestañas **Lecciones** y **Por HSK** separan el recorrido pedagógico de la referencia de vocabulario. El explorador conserva las 5.400 posiciones de los niveles 1–6 de la transcripción identificada del programa 2025. No se presentan todas como fichas propias o ejercicios preparados.

Se puede buscar por hanzi, pinyin o significados propios disponibles, filtrar entradas con práctica y seleccionar palabras entre niveles. La selección se guarda localmente. El inicio utiliza solo pares con contenido real y limita cada sesión a tres pares; una alternativa de otro nivel mantiene su etiqueta individual. Las referencias sin ficha muestran esa condición y no producen ejercicios inventados.

Las etiquetas se cotejan por hanzi y pronunciación con tonos: una lectura no hereda el nivel de otra. Fuente, edición, evidencia y licencia permanecen accesibles. La transcripción secundaria no se anuncia como cotejo directo del PDF oficial ni curso HSK completo.

## 听写 · Dictado

La preparación ofrece texto, imagen y PDF. En dispositivos compatibles, el selector de imagen puede abrir la cámara. El texto pegado utiliza el mismo editor y segmentación que un documento reconocido.

Imágenes y PDF se procesan en el navegador con recursos del proyecto. Los PDF digitales extraen texto; las páginas escaneadas usan OCR. En documentos mixtos se evalúan las páginas y combinan fragmentos evitando repetir texto digital. Se puede elegir páginas, ver una vista previa, seguir el progreso y cancelar. Los límites controlan tamaño y memoria; las páginas se procesan progresivamente.

El resultado pasa siempre por un editor. **Confirmar texto** es obligatorio antes de generar el dictado. Los avisos y fragmentos de baja confianza ayudan a revisar; no sustituyen la revisión. Las imágenes/PDF permanecen en memoria y no se conservan en la biblioteca.

Después se pueden editar, dividir en el cursor y unir frases. Durante la escritura el original no se inserta en el DOM. Una frase se escucha con una voz real de mandarín, cinco velocidades y controles de repetición, pausa, reanudación y parada según las capacidades nativas. No se sustituye por una voz de otro idioma. Voces remotas o de origen desconocido requieren permiso explícito, desmarcado al entrar.

La comparación alinea caracteres Unicode. Los espacios se ignoran; evaluar puntuación es opcional y queda fijado al empezar. Se distinguen sustituciones, omisiones y adiciones con símbolos, etiquetas y posiciones. Simplificado/tradicional no reciben equivalencia automática; compartir pronunciación tampoco convierte una respuesta en correcta.

El resultado permite volver a las respuestas, repetir todo o repasar únicamente frases incorrectas y sin responder. El historial conserva diferencias observadas y frecuencia. Marcar una diferencia como practicada no certifica dominio. El almacenamiento es versionado, tiene límites y avisa de fallos o datos incompatibles sin prometer persistencia.

Consulta [DICTADO.md](DICTADO.md) para métricas, límites y persistencia; [DICTATION_AUDIO.md](DICTATION_AUDIO.md) describe la voz y sus limitaciones.

## Reportes y entregas

Reportar un error mantiene el contexto y versión de una palabra, comparación o ejercicio. En la web conectada el comentario se envía con CSRF y mismo origen a PostgreSQL. Solo se confirma recepción tras respuesta positiva; la evaluación y notas del propietario son privadas.

En el HTML autónomo el formulario conserva un borrador o exporta JSON y avisa que no se ha enviado. Los textos de usuario usan `textContent` o `value`. Dictado no envía documentos ni respuestas al backend.

Para estudiar usa el ZIP HTML. Para desarrollar o alojar la web conectada utiliza el ZIP Node/PostgreSQL. `npm run build` produce `dist/index.html` para hosting estático; conserva reportes locales, no una bandeja remota. Consulta [DEPLOY.md](DEPLOY.md).

## Selectores para verificar

- Introducción: `#lessonIntroduction`, `#introPosition`, `#introPrevious`, `#introNext`, `#introExit`, `[data-intro-word]`.
- HSK: `#hskToggle`, `#lessonsTab`, `#hskSearch`, `#hskOnlyPractice`, `[data-hsk-select]`, `#hskStartSelection`, `#hskSource`.
- Comparar: `#contrastSearch`, `#contrastSelect`, `#comparisonExampleSelect`, `#comparisonPrevious`, `#comparisonNext`, `#comparisonCase`, `#comparisonTakeaway`.
- Ejercicio: `#choices`, `.choice`, `#primary`, `[data-report][data-report-target]`.
- Dictado: `#dictationText`, `#dictationParse`, `#dictationFile`, `#dictationOcrExtract`, `#dictationConfirmOcr`, `#dictationAnswer`, `#dictationCheckAll`, `#dictationReviewErrors`.
- Reportes: `#reportDialog`, `#reportReason`, `#reportComment`, `#reportContact`, `#reportSubmit`, `#reportExport`, `#reportStatus`.

La verificación de navegador comprueba rutas, recarga, reanudación, teclados con composición china, textos largos y cuatro tamaños de pantalla. Se respeta `prefers-reduced-motion`. Las pruebas de voz distinguen controles probados con dobles del caso real sin voces de mandarín; no afirman audio audible verificado en este entorno.

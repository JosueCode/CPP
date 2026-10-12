# 听写 · Dictado

El módulo amplía el frontend HTML, CSS y JavaScript existente. No requiere Python, cuentas, una API de inteligencia artificial ni un proveedor de voz de pago.

## Recorrido del estudiante

1. Abre **Dictado → Crear dictado** y pega su propio texto, carga una imagen o elige un PDF.
2. Si usa un archivo, inicia la extracción local, revisa el texto reconocido y confirma la versión corregida. El reconocimiento nunca genera automáticamente un dictado sin esa revisión.
3. Revisa las frases y, si hace falta, las edita, divide en la posición del cursor, une con la siguiente o elimina.
4. Elige una voz de mandarín disponible en su dispositivo, velocidad, numeración, reproducción al avanzar y evaluación opcional de puntuación.
5. Escucha y escribe una frase cada vez. Durante esta sesión el original no se inserta en el DOM, ni se oculta solamente con CSS.
6. Comprueba todo el dictado. Cada frase muestra original, respuesta, estado y diferencias individuales con etiquetas y posiciones de caracteres.
7. Repasa únicamente las frases falladas o sin responder, o repite el dictado completo. Puede recuperar una sesión pendiente y consultar sus errores en el mismo navegador.

Las respuestas se guardan al escribir, al cambiar de frase y al salir. Ctrl + Intro o ⌘ + Intro avanza; no avanza mientras el método de entrada está componiendo caracteres chinos. Intro normal sigue permitiendo saltos de línea. Se conservan las respuestas previas al retroceder.

## Archivos y responsabilidades

- `web/dictation.js`: importación, revisión, configuración, biblioteca, ejercicio, resultados e historial. El contenido introducido se inserta mediante `textContent` o `value`, nunca como HTML.
- `web/dictation.css`: estilos limitados al módulo y compatibles con los colores, tipografías y botones del frontend existente; cuatro tamaños de pantalla y movimiento reducido.
- `web/dictationcore.js`: segmentación, validación, edición de frases, alineación Unicode, diferencias y métricas puras.
- `web/dictationaudio.js`: descubrimiento de voces reales de mandarín y adaptador `SpeechSynthesis`, con cancelación, pausa y reanudación cuando el dispositivo las ofrece.
- `web/dictationstore.js`: almacenamiento local versionado, sesiones, resultados, errores observados y preferencias.
- `web/dictationocr.js`: extracción local de imágenes/PDF y carga de las bibliotecas y modelos del mismo origen. Sus límites, recursos y licencias se documentan con ese módulo.

La navegación se integra en `web/main.js`. La ruta es `#dictation`, por lo que no necesita una reescritura especial del servidor para acceder a esta sección.

## Corrección y puntuación

La comparación usa alineación de secuencias con sustituciones, omisiones y adiciones. No desplaza todos los caracteres posteriores al encontrar un carácter de más o de menos. Las posiciones son de caracteres Unicode, contando también los espacios y signos que se hayan ignorado para la nota. Unicode se normaliza a NFC para comparar; se preservan los textos originales para mostrarlos.

Los espacios se ignoran siempre. La puntuación se ignora por defecto, pero puede evaluarse. Los caracteres simplificados y tradicionales se consideran distintos cuando están escritos de forma diferente; tampoco se aceptan por compartir pronunciación. En textos mixtos, también se comparan cifras y letras: no se aceptan automáticamente adiciones de caracteres no chinos.

La exactitud se calcula con:

`caracteres correctos / (caracteres evaluados del original + caracteres añadidos) × 100`

Es equivalente a dividir coincidencias entre coincidencias más sustituciones, omisiones y adiciones. Se redondea a una cifra decimal y no supera el 100 %. Las frases sin responder se cuentan por separado y sus caracteres como omisiones. «Frases con errores» excluye las no respondidas. La configuración de puntuación queda fijada al crear la sesión, para que un cambio posterior de preferencias no altere su resultado.

El resultado utiliza símbolos y etiquetas, además de color: `× Sustitución`, `+ Omisión` y `− Adición`. Una diferencia describe lo escrito y lo esperado; no inventa una causa lingüística. El historial cuenta diferencias observadas, conserva su frecuencia y distingue practicado de corregido en un repaso.

## Voz y privacidad

Solo se ofrecen las voces compatibles que entrega el navegador. Se priorizan las de mandarín `zh-CN`; no se usa una voz castellana para fingir audio chino. Si no existe una voz apropiada, se deshabilitan los controles de escucha y se explica cómo preparar el ejercicio o practicar escritura sin audio.

Una voz local se identifica según los metadatos del navegador. Las voces remotas, o las que no indican su origen, requieren una casilla de consentimiento desmarcada por defecto. Ese permiso no se guarda. La interfaz avisa de que el proveedor del navegador puede recibir el texto. No se puede garantizar voz de calidad, funcionamiento sin conexión, pausa o reanudación en todos los dispositivos.

Las imágenes y PDF solo se mantienen en memoria durante la importación; no se guardan en el historial. Los documentos no se envían a una API de reconocimiento ni se publican. Se conserva únicamente el texto confirmado y los datos de la práctica. Los modelos y recursos OCR se cargan como recursos del proyecto.

Los datos locales admiten hasta 20 ejercicios, 50 sesiones y 500 diferencias distintas, con un presupuesto de 1,5 MiB. La entrada admite 20 000 caracteres, 100 frases y 500 caracteres por frase/respuesta; esto no garantiza que cualquier resultado completo quepa en ese presupuesto, porque la alineación guarda posiciones y diferencias. Para textos extensos usa fragmentos pequeños, por ejemplo de 500 a 2000 caracteres. Si un resultado supera el presupuesto, se rechaza sin borrar las respuestas ya guardadas; crea otro dictado con un fragmento menor. Los fallos de almacenamiento muestran un aviso; la sesión sigue en memoria, sin prometer que sobrevivirá al cierre. La biblioteca permite borrar un ejercicio, sus sesiones y sus registros de errores; las contribuciones de otros dictados se conservan. El historial permite borrar errores; el menú de datos permite borrar todo el módulo, tras confirmación.

## Producción

La versión conectada mantiene el servidor Node.js del proyecto. Los módulos JS, el CSS y los recursos OCR deben servirse en el mismo origen; no utilices rutas del disco del entorno de desarrollo. Ejecuta la importación SQL y `npm start` según el README del proyecto, configura las variables de entorno y termina HTTPS en el hosting o proxy existente. El módulo Dictado no necesita acceso SQL ni envía los textos personales al backend.

El generador del HTML autónomo incorpora los módulos y los recursos que requiera su empaquetador. Para el uso del estudiante basta abrir ese HTML; no necesita instalar Node.js. La disponibilidad de voces sigue dependiendo del navegador y el sistema operativo. La generación y las pruebas de la entrega se documentan en los reportes de la pasada; esta guía no afirma que un hosting externo esté desplegado.

## Selectores para verificar la interfaz real

Importación: `#dictationText`, `#dictationParse`, `[data-import-method]`, `#dictationFile`, `#dictationOcrExtract`, `#dictationOcrCancel`, `#dictationPdfPages`, `#dictationConfirmOcr`.

Preparación: `#dictationPreviewList`, `[data-sentence-index]`, `.dictation-split`, `.dictation-merge`, `#dictationSentenceCount`, `#dictationBegin`.

Práctica: `#dictationAnswer`, `#dictationListen`, `#dictationRepeat`, `#dictationPause`, `#dictationStop`, `#dictationPrevious`, `#dictationNext`, `#dictationCheckAll`, `#dictationSaveExit`.

Resultados: `#dictationAccuracy`, `#dictationResults`, `[data-result-status]`, `#dictationReviewErrors`, `#dictationRepeatAll`, `#dictationEditAnswers`.

Persistencia: `.dictation-resume`, `[data-dictation-tab="history"]`, `#dictationErrorHistory`, `#dictationClearHistory`, `#dictationClearAll`, `#dictationStorageNotice`.

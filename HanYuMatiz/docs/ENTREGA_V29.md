# HanYuMatiz V29 — Informe de entrega

## Alcance de UX y frontend

V29 separa la navegación académica de la resolución de ejercicios. Aprender organiza los 14 contrastes reales: 11 unidades con 15 situaciones y sus 30 preguntas, más 3 comparaciones disponibles solo para consulta. El selector de dificultad y el selector de unidad permiten acceso directo. Cada lección abre sus dos ejercicios originales; regresar conserva la unidad y dificultad en memoria.

Durante una sesión, la navegación general cede su espacio a un encabezado compacto con regreso, actividad y progreso. La frase y opciones forman el contenido principal; comprobar o continuar permanece en una barra inferior independiente. La lista lateral de ocho situaciones se reemplaza por un menú secundario de sesión. Los resultados ofrecen revisión y repetición de respuestas reales.

Portada, diccionario, comparador y contexto comparten sello, papel cálido, tinta, jade, cinabrio y líneas dobles. Cada herramienta conserva una composición apropiada para consultar, comparar o analizar. El comparador presenta las palabras en paralelo sin la matriz administrativa de V28; contexto revela las dos versiones cuando se solicitan.

## Cómo se controla el desplazamiento

La actividad utiliza una retícula de `100dvh`: encabezado, zona central flexible con `min-height: 0` y barra de acciones. El contenido se desplaza dentro de `#practice-scroll` cuando hay poca altura, zoom o explicación extensa. No se recortan respuestas para aparentar que caben. Un aviso señala el desplazamiento disponible y la región admite foco de teclado.

Al responder permanecen las opciones, la clave provisional y la explicación esencial. Las dos versiones y la explicación completa se pueden desplegar. Avanzar reemplaza el ejercicio y reinicia su desplazamiento interno; seleccionar una opción o abrir una ayuda conserva la posición. La visibilidad efectiva en cada resolución se comprueba en navegador mediante geometría real.

## Conservación y límites

El banco y `assets/scheduler.js` permanecen idénticos a V28. Se preservan IDs, respuestas, fonética, `sourceHash`, agenda adaptativa y almacenamiento voluntario local. El progreso muestra situaciones practicadas; no atribuye finalización o dominio que el historial no pueda demostrar.

No existe un currículo HSK validado: el selector refleja dificultad editorial de los ejercicios. Las 3 comparaciones sin lecciones siguen indicadas como consulta. Definiciones, ejemplos y claves continúan pendientes de revisión lingüística y editorial. No se inventa pinyin de frases completas, contenido de nuevos niveles, cuentas ni sincronización.

## Archivos del cambio

- `index.template.html` y `index.html`: nueva navegación, Aprender y estructura de actividad; HTML autónomo generado.
- `assets/app.js`: navegación académica, sesiones dirigidas, región de acciones, ayudas, retroalimentación, foco y resultados.
- `assets/styles.css` y nuevo `assets/tools.css`: identidad compartida, actividad según altura disponible y layouts de consulta.
- `tools/build.py`: inclusión de los estilos de herramientas en la entrega autónoma.
- `tools/test_ui.py`: validación ampliada de navegación académica, sesiones y geometría del viewport.
- `LEEME.md`, `docs/TIPOGRAFIA.md`, `docs/SISTEMA_VISUAL_V29.md`, `docs/AUDITORIA_V29.md`, `docs/REFERENCIAS_V29.md` y este informe: mantenimiento, identidad, evidencia, arquitectura, alcance y límites.
- `docs/VALIDACION_V29.json`: informe independiente de la campaña final, con el hash exacto del HTML probado.

## Validación ejecutada

La comparación de archivos confirmó la conservación byte a byte del banco, línea base, planificador y paisaje de V28. El constructor verifica que el HTML coincide con las fuentes y sus hashes CSP. La validación estructural de datos pasó; no equivale a aprobación lingüística. El planificador pasó sus 10 comprobaciones.

La campaña final en Chromium pasó **15 de 15 comprobaciones**: búsquedas y conexiones, filtros y lecciones, sesión adaptativa y dirigida, selección, comprobación, ayudas, revisión sin duplicar intentos, repetición, regreso, teclado, almacenamiento y movimiento reducido. No registró errores de ejecución ni solicitudes externas. El HTML probado tiene 649028 bytes y SHA-256 `0d13cbe254d0712992bb70d8d0aa7d136b3193aae2df7ac249a3c5822cccaff0`.

Resoluciones probadas: **1440×900, 1366×768, 1280×720, 1024×768, 768×1024, 390×844, 375×812, 360×740 y 320×568**. La campaña cubrió 54 combinaciones de vista y tamaño, 9 selectores de situaciones, 9 menús de sesión y 72 pasos reales de práctica. El banco completo se probó en los tres escritorios: 30 preguntas por tamaño y todas sus opciones. Se midieron rectángulos reales, visibilidad de controles, ausencia de scroll principal y acceso por teclado al scroll interno. El zoom nativo de Chromium al 200 % se verificó con tamaño CSS 720×450 y DPR 2; no se simuló con CSS.

El informe [VALIDACION_V29.json](VALIDACION_V29.json) enumera **97 capturas propias**. Durante la inspección se corrigió una superposición entre progreso y nota de Aprender en móvil, la alineación de función gramatical del comparador, el cierre involuntario del análisis al intercambiar palabras y el exceso de margen superior de práctica móvil. La elección de la respuesta se conserva visible también en los resultados móviles.

Queda pendiente la prueba manual en Safari, Firefox y dispositivos físicos, especialmente con barras móviles del navegador. La revisión lingüística y la clasificación HSK no forman parte de esta entrega de frontend.

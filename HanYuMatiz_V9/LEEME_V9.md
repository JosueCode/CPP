# HanYuMatiz V9 — Práctica de chino

Versión autónoma del prototipo HTML con los tres ejercicios originales. Esta versión cambia toda la dirección visual según las últimas referencias del usuario: pantalla de lección de Duolingo, opciones debajo de la frase como Busuu y tipografía sobria similar a la referencia de Khan Academy.

## Abrir

Descomprime `HanYuMatiz_V9_HTML.zip` y abre `HanYuMatiz_V9.html` en un navegador moderno. El HTML incluye todos los estilos, el código y las fuentes. No necesita conexión, instalación ni archivos adicionales.

## Usar

Lee la intención, elige una opción debajo de la frase y pulsa **Comprobar**. Pinyin y traducción son opcionales. Después de comprobar puedes continuar, ver resultados y revisar las explicaciones. **Situaciones** permite cambiar de pregunta conservando las respuestas de esta sesión. 1 y 2 eligen las opciones; Enter comprueba cuando el foco está en la pregunta o en el botón principal.

El audio necesita una voz china local del navegador o del sistema y se habilita después de comprobar si esa voz existe.

## Diseño

- Pantalla blanca, módulo abierto de 900 px y contenido de lectura de 680 px.
- Progreso único, frase china destacada y opciones siempre debajo.
- Respuestas con bordes redondeados, profundidad discreta y selección visible; la corrección aparece después de comprobar.
- Botón principal en una fila inferior independiente, visible también en 320 × 568 px. Las explicaciones extensas se desplazan dentro de la pregunta.
- Cabecera azul marino, jade para progreso y selección, bermellón en la marca con el carácter 中.
- **Lato 400 y 700** para español y pinyin; **Noto Sans SC variable** para hanzi. Subconjuntos WOFF2 incluidos, con los nombres internos AtelierUI y AtelierHanzi.
- Respuesta al pulsar, progreso animado y aparición breve de la corrección; se desactivan las animaciones con movimiento reducido.

Referencias: https://www.duolingo.com/ · https://www.busuu.com/es · captura de Khan Academy proporcionada por el usuario.

## Fuentes y licencias

Lato y Noto Sans SC se obtuvieron del repositorio oficial Google Fonts. Los subconjuntos conservan sus avisos de copyright y licencia SIL Open Font License 1.1 dentro del HTML. `FONT_SOURCES.json` contiene URL, SHA256, cobertura y datos de los archivos utilizados.

## Validación y capturas

`VALIDACION_V9.json` registra los resultados reales de Chromium para los siete grupos de comprobaciones: contenido, sesiones completas, ayudas, navegación y puntuación, teclado y audio, fuentes y autonomía, movimiento reducido y foco.

Tamaños: 1254 × 607, 1366 × 768, 1280 × 720, 390 × 844 y 320 × 568. El informe identifica el HTML y las capturas mediante SHA256.

Las imágenes de `capturas` son capturas reales de navegador. `06-eleccion` muestra una opción seleccionada antes de comprobar; no marca la respuesta correcta. `04-explicacion-extensa` es una prueba de estrés que repite deliberadamente la explicación; esa repetición no forma parte del contenido entregado.

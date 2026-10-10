# HanYuMatiz · Chinese Atelier V8

Prototipo autónomo basado únicamente en `HanYuMatiz_V7_Chinese_Atelier.html`. Conserva sus tres situaciones y su contenido lingüístico. Todavía no está integrado en la aplicación original.

## Abrir

Descomprime el ZIP y abre `HanYuMatiz_V8_Chinese_Atelier.html` en un navegador moderno. Las imágenes y las fuentes están dentro del HTML: no necesita conexión ni instalación.

Elige una palabra debajo de la frase y pulsa **Comprobar**. Después puedes continuar, ver resultados y revisar las explicaciones. Pinyin y traducción son opcionales. El menú **Situaciones** permite cambiar de ejercicio sin perder las respuestas de la sesión. Los atajos 1 y 2 eligen opciones. Enter comprueba cuando el foco está en la pregunta o en el botón.

El audio requiere una voz china local del navegador o del sistema y se habilita después de comprobar. Si no existe esa voz, el control indica que no está disponible. No se descarga audio externo.

## Dirección visual

El entorno combina tres materiales reales y documentados: un almanaque de Cantón escaneado, el grano de una página conservada por Wellcome Collection y una fotografía de celosía Qing de Chengdu. El almanaque queda en el borde izquierdo; las ramas de madera se reencuadran en el derecho, con una máscara suave. El recorte de papel se repite a su tamaño original de 153 × 132 px con baja opacidad. Los originales no se redibujan ni se sustituyen por imágenes generadas.

El módulo mide 900 px como máximo y queda centrado. Las opciones son fichas delgadas, con numeración editorial, hanzi protagonista y pinyin secundario. El botón principal ocupa una fila propia y permanece visible. En pantallas pequeñas, las explicaciones pueden desplazarse dentro del módulo sin desplazar el botón.

**Tipografía:** Newsreader para los títulos y el matiz del logotipo; Gabarito para la interfaz; LXGW WenKai para hanzi y pinyin. Se incluyen subconjuntos WOFF2, con sus licencias SIL OFL 1.1, y familias de respaldo. Los nombres internos de los subconjuntos son AtelierDisplay, AtelierUI y AtelierHanzi.

**Paleta:** marfil y beige papel como base; tinta y jade para la lectura y la estructura; bermellón apagado para la acción principal y la numeración. Celadón y durazno identifican estados correctos y respuestas que conviene revisar.

El movimiento se limita a desplazamientos de 3 px de las imágenes ambientales, en ciclos lentos. Se desactiva con `prefers-reduced-motion`.

La identidad procede del papel, la impresión y la madera fotografiados, junto con la combinación tipográfica. Esa procedencia reconocible y el encuadre alrededor del ejercicio dan una dirección propia al prototipo. Las capturas muestran el resultado real del navegador.

## Materiales, créditos y adaptaciones

1. **Chinese manuscript Ta-ch'uan t'ung-shu**, Wellcome Collection, imagen L0020845. Autor y fecha no indicados en el catálogo. **CC BY 4.0**. Reencuadre, opacidad, matiz cálido y desplazamiento por CSS.
   Fuente: https://wellcomecollection.org/works/b4968g8k
   Licencia: https://creativecommons.org/licenses/by/4.0/
2. **Chinese manuscript Ju-i chi-hsiang**, Wellcome Collection, imagen L0020844. Autor y fecha no indicados en el catálogo. **CC BY 4.0**. Recorte de papel servido por el IIIF oficial; repetición a escala original y opacidad por CSS.
   Fuente: https://wellcomecollection.org/works/mnx6a7k5
   Recorte: https://iiif.wellcomecollection.org/image/L0020844/305,247,153,132/full/0/default.jpg
   Licencia: https://creativecommons.org/licenses/by/4.0/
3. **Celosía de madera de época Qing**, Museo de la Universidad de Sichuan, Chengdu. Fotografía de **Daderot, 26 de septiembre de 2015**, publicada bajo **CC0 1.0**; objeto histórico en dominio público. Miniatura oficial de Wikimedia; reencuadre, máscara, mezcla y desplazamiento por CSS.
   Fuente: https://commons.wikimedia.org/wiki/File:Wooden_lattice_-_Sichuan_University_Museum_-_Chengdu,_China_-_DSC06157.jpg
   Licencia: https://creativecommons.org/publicdomain/zero/1.0/

El botón **Fuentes visuales** del HTML contiene también los créditos, las licencias, las fuentes y las adaptaciones. `ASSETS.json` registra los archivos, las URL y sus SHA256; `FONT_SOURCES.json` registra las fuentes y las licencias tipográficas.

## Verificación

`VALIDACION_V8.json` registra siete grupos de comprobaciones aprobados, 123 observaciones de geometría y 17 capturas. Documenta las comprobaciones en Chromium de contenido, corrección, sesiones completas, navegación libre, puntuación, teclado, pinyin, traducción, recursos incrustados y movimiento reducido.

Resoluciones: 1254 × 607, 1366 × 768, 1280 × 720, 390 × 844 y 320 × 568. La carpeta `capturas` contiene imágenes reales tomadas en Chromium. Las capturas `04-explicacion-extensa` corresponden a una prueba de estrés que repite deliberadamente la explicación para verificar el desplazamiento; esa repetición no forma parte del HTML entregado. Las demás muestran los ejercicios, los resultados y el menú con su contenido real. El informe identifica el HTML por su SHA256.

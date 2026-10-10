# Sistema visual e interacción · V29

La identidad combina tres recursos: sello cinabrio, folio con reglas dobles y jade para interacción. Es una interpretación gráfica original, no una reproducción histórica. El paisaje aprobado se conserva en Inicio, pero las herramientas y la actividad se reconocen sin depender de esa ilustración. No se incorporan marcas, ilustraciones, estilos ni código de otras plataformas.

## Color y tipografía

| Token | Valor | Uso |
| --- | --- | --- |
| Papel | `#f5f0e6` | Fondo cálido de la aplicación. |
| Superficie | `#fffdf7` | Folios, campos y franjas de acción. |
| Tinta | `#25312d` | Caracteres y texto principal. |
| Secundario | `#617069` | Contexto y metadatos. |
| Cinabrio | `#a82f34` | Sello y acción principal. |
| Jade | `#246856` | Selección, avance, vínculos y coincidencias. |
| Bronce | `#856b35` | Matices para revisar y avisos. |
| Línea | `#d7cebe` | Separadores y límites de folio. |

HanYuSans, subconjunto variable de Source Sans 3, presenta español, controles y pinyin. HanYuSong, subconjunto de Noto Serif CJK SC, presenta chino simplificado. Las licencias y nombres propios de los subconjuntos están documentados en TIPOGRAFIA.md. La dirección tradicional no cambia el sistema de escritura del contenido.

En escritorio, títulos de herramienta de 26–29 px, instrucción de práctica de 24 px, frase principal de 38 px y opciones chinas de 28 px. El teléfono utiliza instrucción de 20–21 px y frase de 28–30 px según altura. La ficha léxica destaca la palabra a 48–52 px. Las lecturas se alinean por carácter mediante `ruby` únicamente cuando existen en el banco.

Tonos: 1 rojo, 2 naranja, 3 verde, 4 azul y neutro gris. En la portada oscura se usan variantes claras de esas familias. Las marcas de tono escritas mantienen la información sin depender del color.

## Composición por finalidad

- **Inicio:** entrada al aprendizaje y a la búsqueda sobre el paisaje propio. Una demostración funcional anticipa el tipo de actividad.
- **Aprender:** índice de unidades y folio de una unidad. Dificultad editorial de selección directa; en móvil el índice se convierte en selector nativo. Las lecciones proceden de situaciones reales, no de un currículo inventado.
- **Diccionario:** índice compacto y ficha con hanzi, sentido y ejemplo próximos. Paginación y vínculos enlazan contenido existente.
- **Comparador:** palabras y significados en paralelo con una misma estructura; registro y cautelas forman una lectura común, sin tabla administrativa.
- **Contexto:** intención y dos alternativas; la frase y su interpretación ocupan el centro. El análisis completo se revela a petición.
- **Práctica:** un paso activo, sin menú comercial ni lista permanente de ocho preguntas. La frase y sus opciones se leen como una actividad integrada.
- **Resultados:** lista revisable de respuestas reales y acciones para repetir o iniciar otra sesión. La elección se muestra también en teléfono.

La anchura de herramientas es de hasta 1180 px. El contenido de ejercicio usa hasta 940 px, con frase centrada y consigna alineada a la lectura. En teléfono el bloque empieza con un margen superior acotado, evitando el gran vacío que producía el centrado vertical. La jerarquía usa separaciones pequeñas dentro de una tarea y mayores entre finalidades.

## Controles y estados

Botones principales de cinabrio con esquinas discretas; secundarios de jade y borde fino. Las opciones contienen un número de teclado y estado de selección, con marca lateral jade. Después de comprobar se conservan las opciones y las etiquetas de clave y respuesta elegida. El feedback declara coincidencia o necesidad de revisión, sin presentar el borrador lingüístico como validación definitiva.

Foco visible, controles semánticos, regiones identificadas y diálogos nativos. La sesión dispone de un menú con mapa, guardado voluntario y borrado. Escape cierra el diálogo y se devuelve el foco al control de entrada. La preferencia de reducir movimiento elimina animaciones; el movimiento ordinario es breve y acompaña cambios de estado y avance.

## Altura de la actividad

`.practice-stage` usa `100dvh` y tres filas: encabezado de 58–64 px, centro flexible `minmax(0,1fr)` y barra inferior de 68–76 px. La región central tiene `min-height: 0`, `overflow: auto` y acceso por teclado. La barra de acción es una fila del layout, no una capa que tape respuestas.

El documento no se recorta con `overflow: hidden`. En escritorio ordinario, pregunta, alternativas y feedback esencial caben en la región. Una explicación completa, zoom o altura excepcional puede requerir scroll interno; se anuncia cuando el contenido supera la región. Cambiar de pregunta sustituye el contenido, reinicia el scroll central y enfoca su título sin mover el documento. El mapa secundario tiene su propia región desplazable y no aumenta la altura de la actividad.

## Evidencia

`VALIDACION_V29.json` identifica el HTML probado, estados, viewports, posiciones reales, almacenamiento y límites de navegador. Las capturas propias se conservan en `screenshots/v29/`.

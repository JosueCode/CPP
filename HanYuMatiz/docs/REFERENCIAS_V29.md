# Referencias de interacción y dirección visual — V29

Revisión del 10 de octubre de 2026. No se crearon cuentas ni se introdujeron datos personales. Las capturas de terceros documentan la investigación; no se incorporan sus marcas, personajes, fotografías, estilos ni código a HanYuMatiz.

Las rutas `references/v29/screens/`, `references/v29/logs/` y el script de captura mencionado aquí identifican evidencia conservada en el workspace de desarrollo. **Esas capturas de terceros y sus archivos de investigación no se distribuyen en el ZIP de fuentes.** El paquete incluye este informe y las capturas propias de HanYuMatiz en `screenshots/v29/`; las rutas de evidencia de referencia no implican que esos archivos estén incluidos en la entrega.

## Alcance comprobado

| Fuente oficial | Resultado observado | Evidencia en `references/v29/` |
| --- | --- | --- |
| [Duolingo: elección de idioma](https://www.duolingo.com/register) | El selector cargó y permitió pulsar «Chinese (Simplified)». El paso siguiente quedó con tres puntos de carga. No se inspeccionó una lección ni un estado de respuesta. | `screens/duolingo-public.png`, `screens/duolingo-chinese-choice.png`, `logs/duolingo-verified.json` |
| [Busuu](https://www.busuu.com/es), [selector](https://busuu.com/es/choose-your-language) y [registro para chino](https://www.busuu.com/es/register?learning=zh) | Se observaron portada, selección de idioma y pantalla de registro. Al elegir chino, cambia la composición: desaparece la navegación comercial y aparecen regreso, una barra de avance compacta y una decisión central. La barra representa el flujo de registro; no constituye progreso de un alumno. Se detuvo la exploración antes de registrarse. No se inspeccionó un ejercicio. | `screens/busuu-public.png`, `screens/busuu-study-entry.png`, `screens/busuu-chinese-entry.png`, `logs/busuu-verified.json` |
| [HelloChinese](https://www.hellochinese.cc/) | El proxy rechazó el dominio con 403 / error de túnel. No se vio su interfaz. | `logs/hellochinese-initial.json` |
| [LibreLingo: repositorio oficial](https://github.com/LibreLingo/LibreLingo) | Se descargaron de nuevo el README y cuatro capturas originales publicadas por el proyecto; se inspeccionaron visualmente. Son imágenes estáticas del repositorio, no pruebas actuales del sitio. El README avisa de que el proyecto está archivado. | `screens/librelingo-official-1.png` a `-4.png`, `logs/librelingo-artifacts.json`, `logs/librelingo-readme.md` |
| [LibreLingo: sitio](https://librelingo.app/) y [MandarinBean](https://mandarinbean.com/) | El proxy rechazó ambos dominios. No se inspeccionaron sus flujos en vivo. | `logs/librelingo-initial.json`, `logs/mandarinbean-initial.json` |

### Método de acceso y límites técnicos

Las peticiones HTTPS de Python a Duolingo y Busuu devolvieron 200 con el certificado validado mediante el almacén de CA del sistema. El acceso directo de Chromium falló con `ERR_CERT_AUTHORITY_INVALID`: su almacén no reconocía el CA del proxy del entorno. Esto está registrado en los JSON `*-initial.json`.

Para representar las páginas accesibles se utilizó un puente de solicitudes de Playwright: cada respuesta se obtuvo mediante `urllib` con validación TLS activa y se entregó a Chromium con `route.fulfill`. No se activó `ignore_https_errors`, no se cambió el contenido de las páginas ni se buscó un origen alternativo para los dominios bloqueados. `capture_verified.py` conserva el procedimiento y los JSON registran las respuestas. Es una representación de contenido oficial mediada por ese puente; no debe describirse como una conexión TLS directa de Chromium. Algunos recursos externos de analítica e imágenes quedaron bloqueados.

Los cuatro PNG de LibreLingo se descargaron desde `raw.githubusercontent.com/LibreLingo/LibreLingo/main/docs/screenshots/`, con HTTPS verificado. El JSON de artefactos contiene URL y SHA-256 de cada archivo. No se verificó un commit nuevo porque la API de GitHub quedó bloqueada; no se presenta la rama `main` como una revisión inmutable.

## Seleccionar y responder requieren composiciones distintas

**Observación:** el selector público de Busuu permite comparar opciones equivalentes. Su siguiente pantalla abandona la navegación comercial y se concentra en una decisión. Las capturas de LibreLingo distinguen selección de unidades (`-4`) de una actividad (`-1`, `-2`, `-3`). En la captura de escucha `-3`, «Submit» está en una franja inferior independiente de la consigna y la respuesta.

**Aplicación propuesta:** la pantalla de aprendizaje puede mostrar unidades y estado disponible; una sesión debe reducirse a progreso, contexto, frase, opciones y acción. El índice de preguntas pertenece a un panel secundario. La ficha de diccionario puede extenderse porque su finalidad es consultar, mientras una pregunta ordinaria debe poder resolverse dentro del viewport.

No se atribuyen a Busuu, Duolingo o HelloChinese patrones concretos de feedback o corrección que no se pudieron observar. Para la práctica de HanYuMatiz, los criterios proceden del encargo y se deben verificar en la implementación: acción visible, opciones al alcance, feedback esencial sin saltos, explicaciones extensas accesibles en una región identificable y ninguna respuesta recortada.

## Dirección cultural propuesta

Se intentó consultar la colección de libros chinos de la [Library of Congress](https://www.loc.gov/collections/chinese-rare-books/about-this-collection/), el [Met](https://www.metmuseum.org/art/collection/search?q=Chinese%20seal) y un artículo de libros chinos del [V&A](https://www.vam.ac.uk/articles/chinese-books). Los tres dominios quedaron bloqueados por el proxy. `logs/cultural-probe.json` recoge el alcance. No se importan imágenes ni se afirma haber inspeccionado objetos de esas colecciones.

La propuesta gráfica es una interpretación original y sobria de sello, folio y encuadernación; no una reproducción histórica. Se limita a tres recursos coordinados:

- **Sello rectangular:** una única marca cinabrio reconoce la aplicación en portada, herramientas y sesión. Su forma no se repite como adorno junto a cada palabra.
- **Folio y doble regla:** papel cálido, margen legible, líneas finas dobles y límites de sección dan estructura a la lectura. Los mismos detalles en encabezados, ficha léxica, comparación y actividad permiten reconocer la familia visual sin hacer que todas las vistas sean tarjetas idénticas. No se coloca textura detrás de los caracteres ni se simula caligrafía para textos de estudio.
- **Jade funcional:** selección y avance usan jade junto con forma, texto o símbolo. Cinabrio identifica la acción principal. Tinta mantiene contraste y jerarquía; el color del feedback acompaña a una explicación explícita.

La geometría de ventanas puede orientar iconos originales o una proporción, pero no es necesario añadir un patrón decorativo adicional en esta iteración. El paisaje aprobado permanece como recurso propio de la portada; la identidad interior debe funcionar incluso sin él.

### Tipografía y contenido

Los hanzi de aprendizaje conservan la fuente Song legible del proyecto y la escritura simplificada. La inspiración tradicional no autoriza convertir el contenido a tradicional ni sustituirlo por una fuente ornamental. Los controles en español comparten una escala compacta y sus etiquetas describen la acción.

La convención solicitada para pinyin es tono 1 rojo, tono 2 naranja, tono 3 verde, tono 4 azul y neutro gris. Los tonos también siguen expresándose mediante las marcas de pinyin, por lo que el color no es la única señal. `ruby` solo debe alinear lecturas presentes en los datos; no se genera pinyin de frases completas si el banco solo proporciona la lectura de la palabra objetivo.

## Reglas de producto que acompañan al diseño

- No presentar niveles HSK implementados, progreso o lecciones que los datos actuales no respalden. Un selector directo puede reservar una arquitectura futura, con su estado pendiente explícito y sin mezclar estándares HSK.
- Progreso compacto basado en respuestas reales; revisión separada de la siguiente pregunta pendiente.
- Ayudas accesibles por control discreto; mapa de sesión secundario y desplazable sin aumentar el documento principal.
- Pregunta y feedback esencial forman un paso. Las opciones permanecen visibles después de responder y la siguiente actividad sustituye el contenido anterior.
- En poca altura o con zoom, una región central identificada puede desplazarse; el encabezado y la acción permanecen disponibles. Esto debe verificarse con rectángulos de renderizado reales.
- Los estados seleccionados, de acierto o de respuesta a revisar incluyen texto o símbolo, foco visible y navegación de teclado. No se comunica una preferencia contextual como error gramatical si el contenido no lo indica.

Este documento registra la investigación y las decisiones propuestas. Las pruebas de V29, cuando se ejecuten, deben recogerse en su propio informe; estas referencias no sustituyen la validación de HanYuMatiz.

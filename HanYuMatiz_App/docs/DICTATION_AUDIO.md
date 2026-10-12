# Voz de Dictado

`web/dictationaudio.js` utiliza `SpeechSynthesis` y `SpeechSynthesisUtterance` reales del navegador. Lee únicamente la frase entregada por Dictado. No contiene grabaciones simuladas, llamadas `fetch`, claves, SDK externos ni dependencias nuevas; su licencia sigue la del proyecto.

## Contrato del proveedor

```js
import { createSpeechPlayer, SPEECH_RATES } from './dictationaudio.js';

const player = createSpeechPlayer({
  onState(state) { /* Actualizar estado del reproductor. */ },
  onVoices(voices) { /* Actualizar selector con etiquetas reales. */ },
});

player.listVoices();
player.getState();
player.refreshVoices();
player.speak(fraseOriginal, { voiceURI, rate: 1, allowRemote: false });
player.pause();
player.resume();
player.stop();
player.dispose();
```

Los callbacks se ejecutan también durante la construcción: no deben utilizar la variable `player` antes de asignarla. `speak`, `pause`, `resume` y `stop` devuelven `{ok: boolean, reason?: string}` sin promesa. `listVoices` y `getState` entregan copias; los textos no aparecen en estados, mensajes o registros.

Cada voz incluye `voiceURI`, `name`, `lang`, `label`, `localService` (`true`, `false` o `null`), `privacy` (`local`, `remote`, `unknown`) y `requiresConsent`. Las etiquetas conservan el idioma anunciado por el navegador, por ejemplo `zh-TW`; no se presentan voces taiwanesas como `zh-CN`. Cuando el navegador no entrega URI o repite una URI, el adaptador asigna una clave estable para su selector y mantiene la referencia nativa correspondiente.

El estado contiene `status`, `supported`, `hasVoices`, `voiceCount`, `isPlaying`, `isPaused`, `isActive`, `voiceURI`, `rate`, `error`, `message` y `capabilities: {pause, resume, stop}`. `status` puede ser `idle`, `loading`, `speaking`, `paused`, `ended`, `stopped`, `unavailable`, `error` o `disposed`. `loading` significa que se solicitó la reproducción, todavía sin confirmación de inicio. `ended` requiere un evento nativo de finalización. Un tiempo agotado comunica un fallo y cancela la reproducción; nunca inventa audio ni una finalización correcta.

Un proveedor posterior puede implementar estos métodos y callbacks usando otro motor. La interfaz de Dictado no necesita conocer las voces nativas ni conservar un `SpeechSynthesisUtterance`. Si el proveedor nuevo envía texto a un servidor, debe mantener el requisito de consentimiento y declarar ese envío en su interfaz.

## Voces, conexión y consentimiento

- Se admiten etiquetas compatibles con mandarín `zh`, `zh-CN`, `zh-TW`, `zh-SG`, `zh-Hans`, `zh-Hant` y `cmn` con sus variantes. Se prioriza `zh-CN`; dentro de una región se prefieren voces declaradas locales.
- Se excluyen nombres que identifican cantonés. `zh-HK` o `zh-MO`, incluso dentro de una etiqueta más larga, solo se admiten si el nombre indica explícitamente mandarín/普通话. No se supone que todo idioma chino sea mandarín.
- El módulo escucha `voiceschanged`, consulta de nuevo cuando se solicita reproducción y hace dos consultas iniciales breves si la lista está vacía. `refreshVoices()` permite repetir esa búsqueda manualmente. No instala voces automáticamente.
- Una voz con `localService === false` puede remitir la frase al servicio de voz del navegador. Una voz sin esa propiedad tiene origen desconocido. En ambos casos `speak` devuelve `remote_consent_required` hasta recibir `allowRemote: true`, que la interfaz debe obtener mediante una elección explícita del estudiante.
- `localService === true` significa que el navegador declara la voz local. No acredita su calidad, su acento, la disponibilidad de recursos en cualquier dispositivo ni una prueba de funcionamiento sin conexión. La calidad y la posible necesidad de descargar recursos dependen del navegador y el sistema.

No se publica ni almacena el texto desde esta capa. La disponibilidad real de voces cambia según dispositivo y navegador. Si no existe una voz adecuada, se muestra `unavailable`: no se elige una voz inglesa ni se finge que se escuchó la frase. La selección y los mensajes deben seguir visibles para que el estudiante pueda instalar una voz china o cambiar de navegador.

## Reproducción y límites

Las velocidades admitidas son `0.75`, `0.9`, `1`, `1.1` y `1.25`. Se pasan directamente al motor; no garantizan una duración matemática idéntica entre voces. La frase puede repetirse. Una nueva reproducción cancela la anterior, invalida sus callbacks y libera sus temporizadores. El adaptador solicita además cancelar la cola nativa antes de comenzar, porque `SpeechSynthesis` comparte una única cola dentro de la página. Otras funciones de la aplicación deben coordinarse con esta cola. Detener o cerrar un reproductor sin una reproducción propia activa no cancela otra lectura de la página.

La reproducción debe iniciarse desde una acción del usuario, especialmente en móviles. Pausa y reanudación solo se anuncian cuando un evento nativo o la propiedad `paused` confirma el cambio; algunos motores no las implementan correctamente. Cancelar una frase pausada no siempre libera la pausa global: el adaptador solicita reanudar antes de repetir. El estudiante siempre puede detener y volver a escuchar.

El máximo por frase es de 2.000 puntos de código Unicode. Una frase mayor se rechaza con una instrucción para dividirla: no se recorta silenciosamente. Los límites de entrada del módulo completo pueden ser menores. Si el motor no inicia en diez segundos, se cancela y se permite intentar de nuevo. El control de finalización utiliza un margen conservador según longitud y velocidad, con un límite de quince minutos; una pausa confirmada suspende ese control.

No requiere una regla CSP para servicios externos ni conexiones iniciadas por JavaScript: solo recursos de la propia aplicación y la API nativa. El sistema de voz del navegador puede utilizar su propia conexión fuera de las solicitudes de la página, motivo por el que existe consentimiento para voces remotas o desconocidas. Funciona con el mismo módulo JavaScript bajo HTTPS o dentro del HTML independiente, cuando el navegador permite esa API en ese contexto.

## Verificación ejecutada

`node --test tests/test_dictation_audio.mjs` comprueba con dobles nativos controlados el filtrado de idiomas, voces reales seleccionadas, las cinco velocidades, consentimiento remoto/desconocido, actualización asíncrona de voces, cancelación, callbacks tardíos, pausa/reanudación, repetición después de pausa, tiempos agotados, errores del motor, textos vacíos/extensos, caracteres suplementarios, limpieza y navegador sin API. Estos dobles no demuestran calidad audible ni disponibilidad de una voz instalada.

También se ejecutó Chromium real, sin sustituir su API, importando el módulo mediante HTTP. Su API de síntesis existía, pero el entorno no tenía voces de mandarín: el adaptador devolvió `no_mandarin_voice` y estado `unavailable`. La página no realizó solicitudes externas. Esta comprobación verifica el caso real sin voces; no verifica una lectura audible en mandarín, pausa audible ni funcionamiento sin conexión. Para esa comprobación hace falta un dispositivo con voz de mandarín instalada y salida de audio; conviene incluir Chromium, Safari/iOS y Firefox/Android dentro de la verificación previa al despliegue que vaya a utilizar cada público.

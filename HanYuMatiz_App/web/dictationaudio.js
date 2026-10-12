/** Native Mandarin speech provider. Text is never logged, stored, or sent by this module.
 * A future audio provider can retain this small player contract without changing Dictado.
 */
export const SPEECH_RATES = Object.freeze([0.75, 0.9, 1, 1.1, 1.25]);
export const MAX_SPEECH_CHARACTERS = 2000;

const MANDARIN_NAME = /mandarin|putonghua|普通[话話]|國語|国语|官[话話]/iu;
const CANTONESE_NAME = /cantonese|\byue\b|粤|粵|廣東|广东|廣州|广州/iu;

/** Language tags are labels supplied by the browser; zh-HK alone is not Mandarin. */
export function isMandarinVoice(voice) {
  if (!voice || typeof voice !== 'object') return false;
  const lang = String(voice.lang || '').replaceAll('_', '-').toLowerCase();
  const name = String(voice.name || '');
  if (CANTONESE_NAME.test(name)) return false;
  if (/^(?:zh|cmn)(?:-|$)/u.test(lang) && /-(?:hk|mo)(?:-|$)/u.test(lang)) return MANDARIN_NAME.test(name);
  return /^(?:zh|cmn)(?:$|-(?:cn|tw|sg|hans|hant)(?:-|$))/u.test(lang);
}

const safeCallback = (callback, value) => {
  if (typeof callback !== 'function') return;
  // A rendering callback must not interrupt native speech cleanup.
  try { callback(value); } catch { /* Caller owns UI error reporting. */ }
};

/**
 * Public methods return {ok, reason?}. Native events, rather than timers, confirm playback.
 * Optional dependency parameters support deterministic unit tests, not synthetic UI audio.
 */
export function createSpeechPlayer({
  onState, onVoices,
  synthesis = globalThis.speechSynthesis,
  Utterance = globalThis.SpeechSynthesisUtterance,
  setTimer = (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimer = timer => globalThis.clearTimeout(timer),
} = {}) {
  const supported = Boolean(synthesis && typeof synthesis.getVoices === 'function'
    && typeof synthesis.speak === 'function' && typeof synthesis.cancel === 'function'
    && typeof Utterance === 'function');
  const capabilities = Object.freeze({
    pause: supported && typeof synthesis.pause === 'function',
    resume: supported && typeof synthesis.resume === 'function',
    stop: supported,
  });
  let voices = [];
  let nativeVoices = new Map();
  let active = null;
  let disposed = false;
  let discoveryTimers = [];
  let removeVoicesListener = () => {};
  let state = {
    status: supported ? 'idle' : 'unavailable', supported, hasVoices: false, voiceCount: 0,
    isPlaying: false, isPaused: false, isActive: false, voiceURI: null, rate: 1,
    error: supported ? null : 'unsupported', capabilities,
    message: supported ? 'Buscando voces de mandarín del navegador…'
      : 'Este navegador no permite síntesis de voz. Prueba un navegador compatible para escuchar el dictado.',
  };

  const snapshot = () => ({ ...state, capabilities: { ...capabilities } });
  const update = (patch = {}) => {
    state = { ...state, ...patch, hasVoices: voices.length > 0, voiceCount: voices.length };
    state.isPlaying = state.status === 'loading' || state.status === 'speaking';
    state.isPaused = state.status === 'paused';
    state.isActive = state.isPlaying || state.isPaused;
    safeCallback(onState, snapshot());
  };

  function clearWatch(record) {
    if (record?.watch !== null && record?.watch !== undefined) clearTimer(record.watch);
    if (record) record.watch = null;
  }

  function cancelActive(force = false) {
    const previous = active;
    active = null; // Invalidates events fired synchronously by cancel().
    clearWatch(previous);
    if (previous) {
      for (const event of ['onstart', 'onend', 'onerror', 'onpause', 'onresume']) previous.utterance[event] = null;
    }
    if (supported && (previous || force)) {
      try { synthesis.cancel(); } catch { /* Cleanup must remain possible. */ }
    }
  }

  function reject(reason, message, status = 'error') {
    cancelActive();
    update({ status, error: reason, message });
    return { ok: false, reason };
  }

  function refreshVoices() {
    if (disposed) return [];
    let source = [];
    if (supported) {
      try { source = Array.from(synthesis.getVoices() || []); } catch { /* A failed lookup is unavailable. */ }
    }
    nativeVoices = new Map();
    const entries = source.filter(isMandarinVoice).map((voice, index) => {
      const name = String(voice.name || 'Voz de mandarín');
      const lang = String(voice.lang || 'zh');
      const localService = typeof voice.localService === 'boolean' ? voice.localService : null;
      const privacy = localService === true ? 'local' : localService === false ? 'remote' : 'unknown';
      let voiceURI = String(voice.voiceURI || `${lang}:${name}`);
      if (nativeVoices.has(voiceURI)) voiceURI = `${voiceURI}#${index}`;
      nativeVoices.set(voiceURI, voice);
      const detail = privacy === 'local' ? 'del dispositivo'
        : privacy === 'remote' ? 'servicio remoto' : 'origen no informado';
      return { voiceURI, name, lang, localService, privacy,
        requiresConsent: privacy !== 'local', label: `${name} · ${lang} · ${detail}` };
    });
    const priority = voice => {
      const lang = voice.lang.replaceAll('_', '-').toLowerCase();
      const locale = /^(?:zh|cmn)-cn(?:-|$)/u.test(lang) ? 0
        : /^(?:zh|cmn)-(?:hans|sg)(?:-|$)/u.test(lang) ? 1
        : /^(?:zh|cmn)(?:$|-tw(?:-|$)|-hant(?:-|$))/u.test(lang) ? 2 : 3;
      return locale * 10 + (voice.localService === true ? 0 : voice.localService === false ? 1 : 2);
    };
    voices = entries.sort((a, b) => priority(a) - priority(b) || a.name.localeCompare(b.name));
    safeCallback(onVoices, voices.map(voice => ({ ...voice })));
    if (!active && supported && ['idle', 'unavailable'].includes(state.status)) {
      update(voices.length ? { status: 'idle', error: null, message: 'Voz de mandarín disponible. Pulsa Escuchar para reproducir la frase.' }
        : { status: 'unavailable', error: 'no_mandarin_voice',
          message: 'No hay una voz de mandarín disponible. Instala una voz china en tu dispositivo o prueba otro navegador; el texto no se reproducirá con una voz de otro idioma.' });
    } else update();
    return voices.map(voice => ({ ...voice }));
  }

  function finish(record, patch) {
    if (disposed || active !== record) return;
    clearWatch(record);
    active = null;
    update(patch);
  }

  function watch(record, delay, reason, message) {
    clearWatch(record);
    record.watch = setTimer(() => {
      if (disposed || active !== record) return;
      reject(reason, message);
    }, delay);
  }

  function watchCompletion(record) {
    // This is a failure watchdog, not a fabricated onend. Pausing suspends it.
    const delay = Math.min(900000, Math.max(20000, record.characters * 1500 / record.rate + 15000));
    watch(record, delay, 'speech_timeout',
      'El motor de voz no confirmó el final de la reproducción. Se detuvo; puedes volver a escuchar la frase.');
  }

  function speak(sentence, { voiceURI, rate = 1, allowRemote = false } = {}) {
    if (disposed) return { ok: false, reason: 'disposed' };
    if (!supported) return reject('unsupported', state.message, 'unavailable');
    if (typeof sentence !== 'string' || !sentence.trim()) return reject('empty_text', 'Esta frase está vacía. Añade texto antes de escuchar.');
    const content = sentence.trim();
    const characters = Array.from(content).length;
    if (characters > MAX_SPEECH_CHARACTERS) return reject('text_too_long',
      `La frase supera ${MAX_SPEECH_CHARACTERS} caracteres. Divídela antes de escuchar para evitar fallos del motor de voz.`);
    if (!SPEECH_RATES.includes(rate)) return reject('invalid_rate', 'Elige una de las velocidades disponibles.');
    refreshVoices();
    if (!voices.length) return reject('no_mandarin_voice',
      'No hay una voz de mandarín disponible. Instala una voz china en el dispositivo o prueba otro navegador.', 'unavailable');
    const selected = voiceURI ? voices.find(voice => voice.voiceURI === voiceURI) : voices[0];
    if (!selected) return reject('voice_unavailable', 'La voz elegida ya no está disponible. Selecciona otra voz de mandarín.');
    if (selected.requiresConsent && allowRemote !== true) return reject('remote_consent_required',
      selected.privacy === 'remote'
        ? 'Esta voz usa un servicio remoto del navegador. Autoriza ese servicio antes de enviarle tu frase, o elige una voz del dispositivo.'
        : 'El navegador no informa si esta voz trabaja en el dispositivo. Autoriza su uso antes de escuchar, o elige una voz identificada como local.');
    cancelActive(true);
    // cancel() does not necessarily clear SpeechSynthesis.paused. A repeated phrase
    // must not remain silently queued behind the previous pause.
    if (synthesis.paused === true) {
      if (!capabilities.resume) return reject('paused_queue', 'El motor de voz sigue en pausa y no permite reanudar. Recarga la página o prueba otro navegador.');
      try { synthesis.resume(); } catch {
        return reject('speech_resume_failed', 'El motor de voz no pudo salir de la pausa. Prueba otra voz o recarga la página.');
      }
    }
    let utterance;
    try { utterance = new Utterance(content); } catch {
      return reject('speech_creation_failed', 'No se pudo preparar la reproducción. Prueba otra voz o vuelve a intentarlo.');
    }
    utterance.voice = nativeVoices.get(selected.voiceURI);
    utterance.lang = selected.lang;
    utterance.rate = rate;
    const record = { utterance, characters, rate, watch: null };
    active = record;
    const isCurrent = () => !disposed && active === record;
    utterance.onstart = () => {
      if (!isCurrent()) return;
      update({ status: 'speaking', error: null, message: 'Reproduciendo la frase.' });
      watchCompletion(record);
    };
    utterance.onend = () => finish(record, { status: 'ended', error: null, message: 'Reproducción terminada. Puedes escuchar la frase otra vez.' });
    utterance.onerror = event => {
      if (!isCurrent()) return;
      const error = String(event?.error || 'speech_error');
      finish(record, { status: 'error', error, message: error === 'not-allowed'
        ? 'El navegador bloqueó la voz. Pulsa Escuchar de nuevo para iniciarla con una acción directa.'
        : error === 'network'
          ? 'La voz necesita conexión y no pudo reproducirse. Comprueba la conexión o elige una voz del dispositivo.'
          : 'El motor de voz no pudo reproducir esta frase. Prueba otra voz o vuelve a pulsar Escuchar.' });
    };
    utterance.onpause = () => {
      if (!isCurrent()) return;
      clearWatch(record);
      update({ status: 'paused', error: null, message: 'Reproducción en pausa.' });
    };
    utterance.onresume = () => {
      if (!isCurrent()) return;
      update({ status: 'speaking', error: null, message: 'Reproduciendo la frase.' });
      watchCompletion(record);
    };
    update({ status: 'loading', voiceURI: selected.voiceURI, rate, error: null, message: 'Preparando la voz…' });
    watch(record, 10000, 'speech_start_timeout',
      'La voz no inició la reproducción. Se canceló; prueba otra voz o vuelve a pulsar Escuchar.');
    try { synthesis.speak(utterance); } catch {
      return reject('speech_failed', 'El motor de voz no pudo iniciar la frase. Prueba otra voz o vuelve a intentarlo.');
    }
    return { ok: true };
  }

  function pause() {
    if (disposed) return { ok: false, reason: 'disposed' };
    if (!active || !capabilities.pause) return { ok: false, reason: 'pause_unavailable' };
    try { synthesis.pause(); } catch { return { ok: false, reason: 'pause_failed' }; }
    if (active && synthesis.paused === true) {
      clearWatch(active);
      update({ status: 'paused', message: 'Reproducción en pausa.' });
    }
    return { ok: true };
  }

  function resume() {
    if (disposed) return { ok: false, reason: 'disposed' };
    if (!active || !capabilities.resume || state.status !== 'paused') return { ok: false, reason: 'resume_unavailable' };
    try { synthesis.resume(); } catch { return { ok: false, reason: 'resume_failed' }; }
    if (active && synthesis.paused === false) {
      update({ status: 'speaking', message: 'Reproduciendo la frase.' });
      watchCompletion(active);
    }
    return { ok: true };
  }

  function stop() {
    if (disposed) return { ok: false, reason: 'disposed' };
    cancelActive();
    update({ status: supported ? 'stopped' : 'unavailable', error: null,
      message: supported ? 'Reproducción detenida.' : state.message });
    return { ok: supported, ...(supported ? {} : { reason: 'unsupported' }) };
  }

  function dispose() {
    if (disposed) return;
    cancelActive();
    for (const timer of discoveryTimers) clearTimer(timer);
    discoveryTimers = [];
    removeVoicesListener();
    disposed = true;
    update({ status: 'disposed', error: null, message: 'Reproductor cerrado.' });
  }

  if (supported) {
    const handler = () => refreshVoices();
    if (typeof synthesis.addEventListener === 'function' && typeof synthesis.removeEventListener === 'function') {
      synthesis.addEventListener('voiceschanged', handler);
      removeVoicesListener = () => synthesis.removeEventListener('voiceschanged', handler);
    } else {
      const previous = synthesis.onvoiceschanged;
      const combined = event => { safeCallback(previous, event); handler(); };
      synthesis.onvoiceschanged = combined;
      removeVoicesListener = () => { if (synthesis.onvoiceschanged === combined) synthesis.onvoiceschanged = previous; };
    }
    refreshVoices();
    // Some browsers populate voices after the first lookup without dispatching an event.
    if (!voices.length) discoveryTimers = [250, 1500].map(delay => setTimer(() => refreshVoices(), delay));
  } else {
    safeCallback(onVoices, []);
    update();
  }
  return Object.freeze({
    listVoices: () => voices.map(voice => ({ ...voice })), getState: snapshot,
    refreshVoices, speak, pause, resume, stop, dispose,
  });
}

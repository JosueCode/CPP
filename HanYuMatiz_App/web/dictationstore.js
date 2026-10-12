/** Local, versioned learner data. No pasted text is transmitted or logged. */
export const DICTATION_STORAGE_KEY = 'hymy.dictation.v1';
export const DICTATION_STORE_LIMITS = Object.freeze({
  maxExercises: 20, maxSessions: 50, maxErrors: 500, maxCharacters: 20000,
  maxSentences: 100, maxSentenceCharacters: 500, maxAnswerCharacters: 500,
  maxBytes: 1572864,
});

const defaults = () => ({ rate: 1, voiceURI: '', autoNext: false, showNumbers: true, evaluatePunctuation: false });
const empty = () => ({ version: 1, exercises: [], sessions: [], errors: [], preferences: defaults() });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = value => JSON.parse(JSON.stringify(value));
const length = value => Array.from(value).length;
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(value)
  && !['__proto__', 'prototype', 'constructor'].includes(value);
const timestamp = value => typeof value === 'string' && value.length <= 32
  && /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value));
const integer = (value, maximum) => Number.isInteger(value) && value >= 0 && value <= maximum;
const boundedString = (value, maximum, nonempty = false) => typeof value === 'string'
  && value.length <= maximum * 2 && length(value) <= maximum && (!nonempty || value.trim().length > 0);
const checkKeys = (value, allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key));
const kinds = ['equal', 'substitution', 'deletion', 'insertion'];
const errorKey = value => JSON.stringify([value.kind, value.expected, value.written]);
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).byteLength;

function settings(value, fallback = defaults()) {
  if (!checkKeys(value, Object.keys(defaults()))) throw new TypeError('Configuración del dictado inválida.');
  const result = { ...fallback, ...value };
  if (![0.75, 0.9, 1, 1.1, 1.25].includes(result.rate) || !boundedString(result.voiceURI, 500)
      || !['autoNext', 'showNumbers', 'evaluatePunctuation'].every(key => typeof result[key] === 'boolean')) {
    throw new TypeError('Configuración del dictado inválida.');
  }
  return result;
}

function content(value) {
  if (!boundedString(value.title, 100, true) || !boundedString(value.text, DICTATION_STORE_LIMITS.maxCharacters, true)
      || !/\p{Script=Han}/u.test(value.text) || !Array.isArray(value.sentences) || value.sentences.length === 0
      || value.sentences.length > DICTATION_STORE_LIMITS.maxSentences
      || !value.sentences.some(sentence => typeof sentence === 'string' && /\p{Script=Han}/u.test(sentence))
      || value.sentences.some(sentence => !boundedString(sentence, DICTATION_STORE_LIMITS.maxSentenceCharacters, true)
        || !boundedString(sentence.normalize('NFC'), DICTATION_STORE_LIMITS.maxSentenceCharacters)
        || !Array.from(sentence).some(character => !/[\s\p{White_Space}\p{P}]/u.test(character)))) {
    throw new RangeError('Usa un título de hasta 100 caracteres y un texto chino de hasta 20 000 caracteres, dividido en 1–100 frases de hasta 500 caracteres.');
  }
}

// Also guards future UI additions: no executable values, prototype keys, excessive
// depth, unbounded strings, or unknown operation kinds enter the persisted state.
function safeTree(value, depth = 0) {
  if (depth > 7) throw new TypeError('Resultado del dictado inválido.');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value === 'string' && boundedString(value, 1000)) return;
  if (Array.isArray(value) && value.length <= 1000) { value.forEach(item => safeTree(item, depth + 1)); return; }
  if (object(value) && Object.keys(value).length <= 40
      && Object.keys(value).every(key => /^[A-Za-z][A-Za-z0-9]*$/.test(key)
        && !['__proto__', 'constructor', 'prototype'].includes(key))) {
    Object.values(value).forEach(item => safeTree(item, depth + 1)); return;
  }
  throw new TypeError('Resultado del dictado inválido.');
}

function comparison(value, original, answer, evaluatePunctuation) {
  safeTree(value);
  if (!object(value) || !['correct', 'incorrect', 'unanswered'].includes(value.status)
      || value.original !== original || value.answer !== answer
      || !boundedString(value.normalizedOriginal, 500) || !boundedString(value.normalizedAnswer, 500)
      || value.normalizedOriginal !== original.normalize('NFC') || value.normalizedAnswer !== answer.normalize('NFC')
      || value.evaluatePunctuation !== evaluatePunctuation
      || !Array.isArray(value.operations) || !Array.isArray(value.differences)) throw new TypeError('Comparación ajena a esta respuesta.');
  const counts = { equal: 0, substitution: 0, deletion: 0, insertion: 0 };
  const evaluatedTokens = text => Array.from(text).map((character, index) => ({ character, position: index + 1 }))
    .filter(token => !/[\s\p{White_Space}]/u.test(token.character)
      && (evaluatePunctuation || !/\p{P}/u.test(token.character)));
  const expectedTokens = evaluatedTokens(value.normalizedOriginal), writtenTokens = evaluatedTokens(value.normalizedAnswer);
  let expectedIndex = 0, writtenIndex = 0;
  for (const operation of value.operations) {
    if (!object(operation) || !kinds.includes(operation.kind)
        || !boundedString(operation.expected, 1) || !boundedString(operation.written, 1)
        || !['originalPosition', 'answerPosition', 'originalAnchorPosition', 'answerAnchorPosition'].every(key =>
          operation[key] === null || integer(operation[key], 501))) throw new TypeError('Diferencia de escritura inválida.');
    if (operation.kind === 'equal' && (!operation.expected || operation.expected !== operation.written)
        || operation.kind === 'substitution' && (!operation.expected || !operation.written || operation.expected === operation.written)
        || operation.kind === 'deletion' && (!operation.expected || operation.written !== '')
        || operation.kind === 'insertion' && (operation.expected !== '' || !operation.written)) throw new TypeError('Diferencia de escritura inválida.');
    const expected = operation.expected ? expectedTokens[expectedIndex] : null;
    const written = operation.written ? writtenTokens[writtenIndex] : null;
    if (operation.originalPosition !== (expected?.position ?? null) || operation.answerPosition !== (written?.position ?? null)
        || operation.expected !== (expected?.character ?? '') || operation.written !== (written?.character ?? '')
        || operation.originalAnchorPosition !== (expected?.position ?? expectedTokens[expectedIndex]?.position ?? length(value.normalizedOriginal) + 1)
        || operation.answerAnchorPosition !== (written?.position ?? writtenTokens[writtenIndex]?.position ?? length(value.normalizedAnswer) + 1)) {
      throw new TypeError('Posición de la diferencia incoherente.');
    }
    if (expected) expectedIndex += 1;
    if (written) writtenIndex += 1;
    counts[operation.kind] += 1;
  }
  const evaluated = text => evaluatedTokens(text).map(token => token.character).join('');
  if (value.operations.map(item => item.expected).join('') !== evaluated(value.normalizedOriginal)
      || value.operations.map(item => item.written).join('') !== evaluated(value.normalizedAnswer)
      || JSON.stringify(value.differences) !== JSON.stringify(value.operations.filter(item => item.kind !== 'equal'))
      || value.matches !== counts.equal || value.substitutions !== counts.substitution
      || value.deletions !== counts.deletion || value.insertions !== counts.insertion
      || value.errorCount !== counts.substitution + counts.deletion + counts.insertion
      || value.originalCharacters !== counts.equal + counts.substitution + counts.deletion
      || value.answerCharacters !== counts.equal + counts.substitution + counts.insertion) throw new TypeError('Métricas del dictado incoherentes.');
  const total = value.matches + value.errorCount;
  const expectedAccuracy = total ? Math.round(value.matches * 1000 / total) / 10 : 0;
  if (value.accuracy !== expectedAccuracy || value.status === 'correct' && value.errorCount !== 0
      || value.status === 'incorrect' && value.errorCount === 0
      || value.status === 'unanswered' && value.answerCharacters > 0) throw new TypeError('Estado de corrección incoherente.');
  return clone(value);
}

function summaryFor(comparisons) {
  const summary = { sentencesTotal: comparisons.length, correctSentences: 0, incorrectSentences: 0,
    unansweredSentences: 0, evaluatedCharacters: 0, correctCharacters: 0,
    substitutions: 0, deletions: 0, insertions: 0, errorCount: 0, accuracy: 0 };
  for (const item of comparisons) {
    summary[`${item.status === 'correct' ? 'correct' : item.status === 'incorrect' ? 'incorrect' : 'unanswered'}Sentences`] += 1;
    summary.evaluatedCharacters += item.originalCharacters;
    summary.correctCharacters += item.matches;
    for (const key of ['substitutions', 'deletions', 'insertions', 'errorCount']) summary[key] += item[key];
  }
  const total = summary.correctCharacters + summary.errorCount;
  summary.accuracy = total ? Math.round(summary.correctCharacters * 1000 / total) / 10 : 0;
  return summary;
}

function results(value, exercise, session) {
  if (!checkKeys(value, ['comparisons', 'summary']) || !Array.isArray(value.comparisons)
      || value.comparisons.length !== session.indices.length) throw new TypeError('Resultado incompleto.');
  const comparisons = value.comparisons.map((item, index) => comparison(item,
    exercise.sentences[session.indices[index]], session.answers[index], session.settings.evaluatePunctuation));
  const summary = summaryFor(comparisons);
  if (!object(value.summary) || Object.keys(value.summary).length !== Object.keys(summary).length
      || Object.entries(summary).some(([key, expected]) => value.summary[key] !== expected)) throw new TypeError('Resumen de resultados incoherente.');
  return { comparisons, summary };
}

function restore(raw) {
  if (!checkKeys(raw, ['version', 'exercises', 'sessions', 'errors', 'preferences']) || raw.version !== 1
      || !Array.isArray(raw.exercises) || raw.exercises.length > DICTATION_STORE_LIMITS.maxExercises
      || !Array.isArray(raw.sessions) || raw.sessions.length > DICTATION_STORE_LIMITS.maxSessions
      || !Array.isArray(raw.errors) || raw.errors.length > DICTATION_STORE_LIMITS.maxErrors) throw new TypeError('Datos locales del dictado inválidos.');
  const state = empty();
  state.preferences = settings(raw.preferences);
  const exerciseIds = new Set(), sessionIds = new Set(), errorIds = new Set(), errorKeys = new Set();
  for (const value of raw.exercises) {
    if (!checkKeys(value, ['id', 'title', 'text', 'sentences', 'settings', 'createdAt', 'updatedAt'])
        || !safeId(value.id) || exerciseIds.has(value.id) || !timestamp(value.createdAt) || !timestamp(value.updatedAt)) throw new TypeError('Ejercicio local inválido.');
    content(value); exerciseIds.add(value.id);
    state.exercises.push({ ...clone(value), settings: settings(value.settings) });
  }
  for (const value of raw.sessions) {
    const exercise = state.exercises.find(item => item.id === value.exerciseId);
    if (!checkKeys(value, ['id', 'exerciseId', 'indices', 'answers', 'currentIndex', 'status', 'reviewOf',
      'createdAt', 'updatedAt', 'completedAt', 'results', 'settings']) || !safeId(value.id) || sessionIds.has(value.id) || !exercise
      || !Array.isArray(value.indices) || value.indices.length === 0 || value.indices.length > exercise.sentences.length
      || new Set(value.indices).size !== value.indices.length || value.indices.some(index => !integer(index, exercise.sentences.length - 1))
      || !Array.isArray(value.answers) || value.answers.length !== value.indices.length
      || value.answers.some(answer => !boundedString(answer, DICTATION_STORE_LIMITS.maxAnswerCharacters))
      || !integer(value.currentIndex, value.indices.length - 1) || !['pending', 'completed'].includes(value.status)
      || !(value.reviewOf === null || safeId(value.reviewOf)) || !timestamp(value.createdAt) || !timestamp(value.updatedAt)
      || value.status === 'pending' && (value.results !== null || value.completedAt !== null)
      || value.status === 'completed' && (!timestamp(value.completedAt) || value.results === null)) throw new TypeError('Sesión local inválida.');
    sessionIds.add(value.id);
    const prepared = { ...clone(value), settings: settings(value.settings) };
    state.sessions.push({ ...prepared, results: value.results === null ? null : results(value.results, exercise, prepared) });
  }
  for (const session of state.sessions) {
    if (session.reviewOf !== null) {
      const prior = state.sessions.find(item => item.id === session.reviewOf);
      if (!prior || prior.id === session.id || prior.status !== 'completed' || prior.exerciseId !== session.exerciseId
          || session.indices.some(index => !prior.indices.includes(index))) throw new TypeError('Referencia de repaso inválida.');
      const visited = new Set([session.id]);
      let cursor = prior;
      while (cursor) {
        if (visited.has(cursor.id)) throw new TypeError('Cadena de repaso inválida.');
        visited.add(cursor.id);
        cursor = cursor.reviewOf === null ? null : state.sessions.find(item => item.id === cursor.reviewOf);
      }
    }
  }
  const observedBySession = new Map(state.sessions.filter(session => session.status === 'completed').map(session => {
    const frequencies = new Map();
    for (const difference of session.results.comparisons.flatMap(item => item.differences)) {
      const key = errorKey(difference); frequencies.set(key, (frequencies.get(key) ?? 0) + 1);
    }
    return [session.id, frequencies];
  }));
  for (const value of raw.errors) {
    if (!checkKeys(value, ['id', 'kind', 'expected', 'written', 'count', 'sources', 'lastSeen', 'lastPractice', 'practiced', 'corrected'])
        || !safeId(value.id) || errorIds.has(value.id) || !kinds.slice(1).includes(value.kind)
        || !boundedString(value.expected, 1) || !boundedString(value.written, 1)
        || !Number.isInteger(value.count) || value.count < 1 || value.count > 50000
        || !Array.isArray(value.sources) || value.sources.length < 1 || value.sources.length > DICTATION_STORE_LIMITS.maxSessions
        || new Set(value.sources.map(item => item.sessionId)).size !== value.sources.length
        || !timestamp(value.lastSeen) || !(value.lastPractice === null || timestamp(value.lastPractice))
        || typeof value.practiced !== 'boolean' || typeof value.corrected !== 'boolean') throw new TypeError('Historial local inválido.');
    const key = errorKey(value);
    if (errorKeys.has(key)) throw new TypeError('Historial local duplicado.');
    let sum = 0;
    for (const source of value.sources) {
      const session = state.sessions.find(item => item.id === source.sessionId);
      if (!checkKeys(source, ['sessionId', 'count']) || !session || session.status !== 'completed'
          || !integer(source.count, 50000) || source.count === 0
          || observedBySession.get(session.id)?.get(key) !== source.count) throw new TypeError('Origen del historial inválido.');
      sum += source.count;
    }
    if (sum !== value.count) throw new TypeError('Frecuencia del historial inválida.');
    errorIds.add(value.id); errorKeys.add(key); state.errors.push(clone(value));
  }
  if (bytes(state) > DICTATION_STORE_LIMITS.maxBytes) throw new RangeError('Datos locales demasiado extensos.');
  return state;
}

/**
 * Storage corruption/newer schemas are preserved until clearAll explicitly runs.
 * Failed writes retain the newest valid state in memory and clearly report that
 * closing the page will lose those changes; existing disk data is never deleted.
 */
export function createDictationStore(options = {}) {
  if (!object(options)) throw new TypeError('Opciones de almacenamiento inválidas.');
  const now = options.now ?? (() => new Date());
  const notify = typeof options.onStatus === 'function' ? options.onStatus : () => {};
  let backing = null, protectedData = false, state = empty();
  let status = { persistent: false, code: 'storage_unavailable', message: 'El dictado se conserva solo mientras esta página esté abierta. El almacenamiento local no está disponible.' };
  function report(code, message, persistent = false) {
    status = { persistent, code, message };
    try { notify({ ...status }); } catch { /* A status listener cannot break saving. */ }
  }
  function time() {
    const value = now();
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new TypeError('Fecha local inválida.');
    return value.toISOString();
  }
  let sequence = 0;
  function id(prefix) {
    let random;
    try { random = globalThis.crypto?.randomUUID?.(); } catch { /* Non-secure contexts can lack crypto. */ }
    random ||= `${Date.now().toString(36)}-${(++sequence).toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    return `${prefix}_${random}`;
  }
  try {
    backing = Object.prototype.hasOwnProperty.call(options, 'storage') ? options.storage : globalThis.localStorage;
    if (backing && typeof backing.getItem === 'function' && typeof backing.setItem === 'function') {
      const serialized = backing.getItem(DICTATION_STORAGE_KEY);
      if (serialized !== null && serialized !== undefined && serialized !== '') {
        if (typeof serialized !== 'string' || new TextEncoder().encode(serialized).byteLength > DICTATION_STORE_LIMITS.maxBytes) throw new TypeError('Datos demasiado extensos.');
        const parsed = JSON.parse(serialized);
        if (object(parsed) && typeof parsed.version === 'number' && parsed.version > 1) {
          protectedData = true;
          report('future_version', 'Este navegador guarda dictados de una versión más nueva. Se mantienen intactos; esta sesión funciona en memoria. Borra los datos de dictado solo si quieres empezar de nuevo.');
        } else {
          state = restore(parsed);
          report('ready', 'Los dictados y el progreso se guardan en este navegador.', true);
        }
      } else report('ready', 'Los dictados y el progreso se guardan en este navegador.', true);
    } else report(status.code, status.message);
  } catch {
    if (backing && typeof backing.getItem === 'function' && typeof backing.setItem === 'function') {
      protectedData = true;
      report('unreadable_data', 'No se pudieron recuperar los dictados guardados. Se conservan intactos; esta sesión funciona en memoria. Puedes borrar los datos de dictado para empezar de nuevo.');
    } else report(status.code, status.message);
  }

  function commit(candidate) {
    if (bytes(candidate) > DICTATION_STORE_LIMITS.maxBytes) throw new RangeError('Se alcanzó el límite de 1,5 MiB para los dictados. Borra datos antiguos o, si estás corrigiendo un texto largo, crea otro dictado con un fragmento más corto. Tus respuestas guardadas se conservan.');
    state = candidate;
    if (protectedData) return;
    if (!backing || typeof backing.setItem !== 'function') { report('storage_unavailable', 'Los cambios se conservan solo mientras esta página esté abierta. El almacenamiento local no está disponible.'); return; }
    try {
      backing.setItem(DICTATION_STORAGE_KEY, JSON.stringify(state));
      report('ready', 'Los dictados y el progreso se guardan en este navegador.', true);
    } catch {
      report('write_failed', 'No se pudo guardar en este navegador, posiblemente por falta de espacio. Tus cambios siguen en esta página, pero se perderán al cerrarla.');
    }
  }
  function requiredExercise(exerciseId) {
    const exercise = safeId(exerciseId) && state.exercises.find(item => item.id === exerciseId);
    if (!exercise) throw new TypeError('No se encontró este dictado.');
    return exercise;
  }
  function requiredSession(sessionId) {
    const session = safeId(sessionId) && state.sessions.find(item => item.id === sessionId);
    if (!session) throw new TypeError('No se encontró esta sesión de dictado.');
    return session;
  }
  function createExercise(input) {
    if (!checkKeys(input, ['title', 'text', 'sentences', 'settings'])
        || input.title !== undefined && typeof input.title !== 'string') throw new TypeError('Ejercicio de dictado inválido.');
    const prepared = { title: typeof input.title === 'string' && input.title.trim() ? input.title.trim() : 'Dictado personal',
      text: input.text, sentences: input.sentences, settings: settings(input.settings ?? {}, state.preferences) };
    content(prepared);
    if (state.exercises.length >= DICTATION_STORE_LIMITS.maxExercises) throw new RangeError('Puedes guardar hasta 20 dictados. Borra uno antes de crear otro.');
    const moment = time(), exercise = { id: id('dt'), ...clone(prepared), createdAt: moment, updatedAt: moment };
    const candidate = clone(state); candidate.exercises.push(exercise); commit(candidate); return clone(exercise);
  }
  function updateExercise(exerciseId, patch) {
    const exercise = requiredExercise(exerciseId);
    if (!checkKeys(patch, ['title', 'text', 'sentences', 'settings'])) throw new TypeError('Cambio del dictado inválido.');
    const changed = { ...clone(exercise), ...clone(patch), settings: settings(patch.settings ?? {}, exercise.settings), updatedAt: time() };
    content(changed);
    if (state.sessions.some(item => item.exerciseId === exerciseId)
        && (changed.text !== exercise.text || JSON.stringify(changed.sentences) !== JSON.stringify(exercise.sentences))) throw new TypeError('Este dictado ya tiene sesiones. Crea otro dictado para cambiar su texto o sus frases.');
    const candidate = clone(state); candidate.exercises[candidate.exercises.findIndex(item => item.id === exerciseId)] = changed;
    commit(candidate); return clone(changed);
  }
  function deleteExercise(exerciseId) {
    requiredExercise(exerciseId);
    const candidate = clone(state), deleted = new Set(candidate.sessions.filter(item => item.exerciseId === exerciseId).map(item => item.id));
    candidate.exercises = candidate.exercises.filter(item => item.id !== exerciseId);
    candidate.sessions = candidate.sessions.filter(item => !deleted.has(item.id));
    candidate.errors = candidate.errors.filter(item => {
      item.sources = item.sources.filter(source => !deleted.has(source.sessionId));
      item.count = item.sources.reduce((total, source) => total + source.count, 0);
      if (item.count) item.lastSeen = item.sources.map(source => candidate.sessions.find(session => session.id === source.sessionId).completedAt).sort().at(-1);
      return item.count > 0;
    });
    commit(candidate); return true;
  }
  function startSession(exerciseId, options = {}) {
    const exercise = requiredExercise(exerciseId);
    if (!checkKeys(options, ['indices', 'reviewOf'])) throw new TypeError('Preparación de sesión inválida.');
    const indices = options.indices ?? exercise.sentences.map((_, index) => index);
    if (!Array.isArray(indices) || indices.length === 0 || indices.length > exercise.sentences.length
        || new Set(indices).size !== indices.length || indices.some(index => !integer(index, exercise.sentences.length - 1))) throw new TypeError('Selecciona frases existentes una sola vez.');
    const reviewOf = options.reviewOf ?? null;
    if (reviewOf !== null) {
      const prior = requiredSession(reviewOf);
      if (prior.exerciseId !== exerciseId || prior.status !== 'completed' || indices.some(index => !prior.indices.includes(index))) throw new TypeError('Sesión de repaso inválida.');
    }
    if (state.sessions.length >= DICTATION_STORE_LIMITS.maxSessions) throw new RangeError('Puedes guardar hasta 50 sesiones de dictado. Borra un ejercicio con sus sesiones antes de crear otra.');
    const moment = time(), session = { id: id('ds'), exerciseId, indices: [...indices], answers: indices.map(() => ''),
      currentIndex: 0, status: 'pending', reviewOf, results: null, createdAt: moment, updatedAt: moment, completedAt: null };
    session.settings = clone(reviewOf === null ? exercise.settings : requiredSession(reviewOf).settings);
    const candidate = clone(state); candidate.sessions.push(session); commit(candidate); return clone(session);
  }
  function saveSession(sessionId, patch) {
    const session = requiredSession(sessionId);
    if (!checkKeys(patch, ['answers', 'currentIndex'])) throw new TypeError('Cambio de sesión inválido.');
    if (session.status !== 'pending') throw new TypeError('Esta sesión ya terminó. Inicia otra para volver a escribir sus respuestas.');
    const changed = { ...clone(session), ...clone(patch), updatedAt: time() };
    if (!Array.isArray(changed.answers) || changed.answers.length !== session.indices.length
        || changed.answers.some(answer => !boundedString(answer, DICTATION_STORE_LIMITS.maxAnswerCharacters))
        || !integer(changed.currentIndex, session.indices.length - 1)) throw new RangeError('Respuesta o posición inválida: cada frase admite hasta 500 caracteres.');
    const candidate = clone(state); candidate.sessions[candidate.sessions.findIndex(item => item.id === sessionId)] = changed;
    commit(candidate); return clone(changed);
  }
  function finishSession(sessionId, comparisons, summary) {
    const session = requiredSession(sessionId);
    if (session.status === 'completed') return clone(session);
    const checked = results({ comparisons, summary }, requiredExercise(session.exerciseId), session);
    const moment = time(), completed = { ...clone(session), status: 'completed', results: checked,
      completedAt: moment, updatedAt: moment };
    const candidate = clone(state); candidate.sessions[candidate.sessions.findIndex(item => item.id === sessionId)] = completed;
    const observed = new Map();
    for (const difference of checked.comparisons.flatMap(item => item.differences)) {
      const key = errorKey(difference), entry = observed.get(key);
      if (entry) entry.count += 1;
      else observed.set(key, { kind: difference.kind, expected: difference.expected, written: difference.written, count: 1 });
    }
    for (const [key, value] of observed) {
      let entry = candidate.errors.find(item => errorKey(item) === key);
      if (!entry) {
        if (candidate.errors.length >= DICTATION_STORE_LIMITS.maxErrors) throw new RangeError('El historial alcanzó 500 diferencias distintas. Borra el historial antes de comprobar nuevas respuestas; tu sesión pendiente se conserva.');
        entry = { id: id('de'), kind: value.kind, expected: value.expected, written: value.written, count: 0,
          sources: [], lastSeen: moment, lastPractice: null, practiced: false, corrected: false };
        candidate.errors.push(entry);
      }
      entry.count += value.count; entry.sources.push({ sessionId, count: value.count });
      entry.lastSeen = moment; entry.corrected = false;
    }
    if (session.reviewOf !== null) {
      const previous = requiredSession(session.reviewOf);
      session.indices.forEach((originalIndex, currentIndex) => {
        const priorIndex = previous.indices.indexOf(originalIndex);
        for (const difference of previous.results.comparisons[priorIndex].differences) {
          const entry = candidate.errors.find(item => errorKey(item) === errorKey(difference));
          if (entry) { entry.practiced = true; entry.lastPractice = moment; entry.corrected = checked.comparisons[currentIndex].status === 'correct'; }
        }
      });
    }
    commit(candidate); return clone(completed);
  }
  function startReview(sessionId, { includeUnanswered = true } = {}) {
    if (typeof includeUnanswered !== 'boolean') throw new TypeError('Opción de repaso inválida.');
    const session = requiredSession(sessionId);
    if (session.status !== 'completed') throw new TypeError('Comprueba las respuestas antes de iniciar el repaso.');
    const indices = session.indices.filter((_, index) => session.results.comparisons[index].status === 'incorrect'
      || includeUnanswered && session.results.comparisons[index].status === 'unanswered');
    if (!indices.length) return null;
    return startSession(session.exerciseId, { indices, reviewOf: sessionId });
  }
  return Object.freeze({
    get persistent() { return status.persistent; }, get status() { return { ...status }; },
    getState: () => clone(state),
    getExercise: exerciseId => safeId(exerciseId) ? clone(state.exercises.find(item => item.id === exerciseId) ?? null) : null,
    getSession: sessionId => safeId(sessionId) ? clone(state.sessions.find(item => item.id === sessionId) ?? null) : null,
    createExercise, updateExercise, deleteExercise, startSession, saveSession, finishSession, startReview,
    setPreferences(patch) { const candidate = clone(state); candidate.preferences = settings(patch, candidate.preferences); commit(candidate); return clone(candidate.preferences); },
    markErrorPracticed(errorId, practiced = true) {
      const entry = safeId(errorId) && state.errors.find(item => item.id === errorId);
      if (!entry || typeof practiced !== 'boolean') throw new TypeError('Error del historial inválido.');
      const candidate = clone(state), changed = candidate.errors.find(item => item.id === errorId);
      changed.practiced = practiced; changed.lastPractice = practiced ? time() : null;
      if (!practiced) changed.corrected = false;
      commit(candidate); return clone(changed);
    },
    clearHistory() { const candidate = clone(state); candidate.errors = []; commit(candidate); return true; },
    clearAll() {
      state = empty(); protectedData = false;
      try {
        if (!backing || typeof backing.removeItem !== 'function') throw new TypeError('Sin almacenamiento.');
        backing.removeItem(DICTATION_STORAGE_KEY);
        report('ready', 'Se borraron los dictados, las sesiones y el historial de este navegador.', true);
      } catch {
        report('clear_failed', 'Se borraron los datos de esta página, pero el navegador no permitió eliminar los datos guardados. Borra el almacenamiento del sitio desde tu navegador.');
        protectedData = true;
      }
      return true;
    },
  });
}

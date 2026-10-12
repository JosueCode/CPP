import { scheduler } from './scheduler.js';

export const STORAGE_KEY = 'hymy.progress.v1';
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,179}$/;
const OPTION = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,39}$/;
const DATA_VERSION = /^[a-f0-9]{64}$/;
const isId = value => typeof value === 'string' && ID.test(value)
  && !['__proto__', 'constructor', 'prototype'].includes(value);
const isOption = value => typeof value === 'string' && OPTION.test(value);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const clone = value => JSON.parse(JSON.stringify(value));
const dateTime = value => typeof value === 'string' && value.length <= 32
  && /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value));
const ids = value => Array.isArray(value) && value.length > 0 && value.length <= 256
  && value.every(isId) && new Set(value).size === value.length;
const dictionary = value => object(value) && Object.keys(value).every(isId);

function empty() {
  return { version: 1, selectedLevel: 1, sessions: {}, answers: {}, completedLessons: {}, reviews: {} };
}

function cleanSession(value) {
  if (!object(value) || !isId(value.id) || !(value.lessonId === null || isId(value.lessonId))
      || !ids(value.exerciseIds) || !Number.isInteger(value.currentIndex) || value.currentIndex < 0
      || value.currentIndex >= value.exerciseIds.length
      || !['showPinyin', 'showTranslation', 'ended'].every(key => typeof value[key] === 'boolean')
      || (value.dataVersion !== undefined && (typeof value.dataVersion !== 'string' || !DATA_VERSION.test(value.dataVersion)))) return null;
  const selections = value.selections ?? {};
  if (!object(selections) || Object.entries(selections).some(([key, item]) => !value.exerciseIds.includes(key) || !isOption(item))) return null;
  return {
    id: value.id, lessonId: value.lessonId, exerciseIds: [...value.exerciseIds],
    currentIndex: value.currentIndex, showPinyin: value.showPinyin,
    showTranslation: value.showTranslation, ended: value.ended, selections: { ...selections },
    ...(value.dataVersion === undefined ? {} : { dataVersion: value.dataVersion }),
  };
}

function cleanAnswer(value) {
  if (!object(value) || !isId(value.exerciseId) || !isId(value.scenarioId)
      || !isOption(value.selected) || typeof value.correct !== 'boolean' || !dateTime(value.answeredAt)) return null;
  return {
    exerciseId: value.exerciseId, scenarioId: value.scenarioId,
    selected: value.selected, correct: value.correct, answeredAt: value.answeredAt,
  };
}

function restore(raw) {
  if (!object(raw) || raw.version !== 1 || !Number.isInteger(raw.selectedLevel)
      || raw.selectedLevel < 1 || raw.selectedLevel > 6
      || !['sessions', 'answers', 'completedLessons', 'reviews'].every(key => dictionary(raw[key]))
      || Object.keys(raw.sessions).length > 256 || Object.keys(raw.answers).length > 256
      || Object.keys(raw.completedLessons).length > 256 || Object.keys(raw.reviews).length > 1024) return null;
  const result = empty();
  result.selectedLevel = raw.selectedLevel;
  for (const [id, value] of Object.entries(raw.sessions)) {
    const session = cleanSession(value);
    if (!session || session.id !== id) return null;
    result.sessions[id] = session;
  }
  let answerCount = 0;
  for (const [id, entries] of Object.entries(raw.answers)) {
    const session = result.sessions[id];
    if (!session || !dictionary(entries)) return null;
    result.answers[id] = {};
    for (const [exerciseId, value] of Object.entries(entries)) {
      const answer = cleanAnswer(value);
      if (!answer || answer.exerciseId !== exerciseId || !session.exerciseIds.includes(exerciseId) || ++answerCount > 2048) return null;
      result.answers[id][exerciseId] = answer;
    }
  }
  for (const [id, value] of Object.entries(raw.completedLessons)) {
    if (!object(value) || !dateTime(value.completedAt) || !ids(value.exerciseIds)
        || (value.dataVersion !== undefined && (typeof value.dataVersion !== 'string' || !DATA_VERSION.test(value.dataVersion)))
        || !Object.values(result.sessions).some(session => session.lessonId === id
          && session.dataVersion === value.dataVersion
          && session.exerciseIds.length === value.exerciseIds.length
          && value.exerciseIds.every(exerciseId => result.answers[session.id]?.[exerciseId]))) return null;
    result.completedLessons[id] = { completedAt: value.completedAt, exerciseIds: [...value.exerciseIds],
      ...(value.dataVersion === undefined ? {} : { dataVersion: value.dataVersion }) };
  }
  for (const [id, value] of Object.entries(raw.reviews)) {
    if (!scheduler.validateEntry(value, '9999-12-31') || value.attempts === 0) return null;
    result.reviews[id] = { ...value };
  }
  return result;
}

/** Learner state only. This module never reads or writes editorial approval. */
export function createProgress(storage, { now = () => new Date() } = {}) {
  let backing = storage, persistent = false, state = empty();
  if (arguments.length === 0) {
    try { backing = globalThis.localStorage; } catch { backing = null; }
  }
  try {
    if (backing && typeof backing.getItem === 'function') {
      const serialized = backing.getItem(STORAGE_KEY);
      if (serialized && serialized.length <= 1500000) state = restore(JSON.parse(serialized)) || empty();
      persistent = true;
    }
  } catch { persistent = false; }

  function commit() {
    try {
      if (!backing || typeof backing.setItem !== 'function') { persistent = false; return; }
      backing.setItem(STORAGE_KEY, JSON.stringify(state));
      persistent = true;
    } catch { persistent = false; }
  }

  function saveSession(value) {
    const session = cleanSession(value);
    if (!session) throw new TypeError('Sesión de práctica inválida.');
    const previous = state.sessions[session.id];
    if (previous && (previous.lessonId !== session.lessonId || previous.dataVersion !== session.dataVersion
        || previous.exerciseIds.join('\0') !== session.exerciseIds.join('\0'))) {
      throw new TypeError('Usa una sesión nueva cuando cambie el contenido o la lista de ejercicios.');
    }
    if (!previous && Object.keys(state.sessions).length >= 256) throw new RangeError('Se alcanzó el límite de sesiones locales.');
    // Answers already checked cannot be changed through an unsubmitted selection.
    for (const [exerciseId, answer] of Object.entries(state.answers[session.id] || {})) session.selections[exerciseId] = answer.selected;
    if (session.ended && session.exerciseIds.some(id => !state.answers[session.id]?.[id])) session.ended = false;
    state.sessions[session.id] = session;
    state.answers[session.id] ||= {};
    commit();
    return clone(session);
  }

  function recordAnswer({ sessionId, lessonId = null, exerciseId, scenarioId, selected, correct }) {
    const session = state.sessions[sessionId];
    if (!isId(sessionId) || !session || session.lessonId !== lessonId || !session.exerciseIds.includes(exerciseId)
        || !isId(scenarioId) || !isOption(selected) || typeof correct !== 'boolean') throw new TypeError('Respuesta fuera de la sesión o inválida.');
    const previous = state.answers[sessionId]?.[exerciseId];
    if (previous) return clone(previous);
    if (stats().answered >= 2048) throw new RangeError('Se alcanzó el límite de respuestas locales.');
    const moment = now();
    if (!(moment instanceof Date) || Number.isNaN(moment.getTime())) throw new TypeError('Fecha inválida.');
    const answer = { exerciseId, scenarioId, selected, correct, answeredAt: moment.toISOString() };
    state.answers[sessionId][exerciseId] = answer;
    session.selections[exerciseId] = selected;
    const today = scheduler.isoToday(moment);
    const history = state.reviews[scenarioId];
    const day = history?.last_day > today ? history.last_day : today;
    state.reviews[scenarioId] = scheduler.update(history, correct, day);
    commit();
    return clone(answer);
  }

  function completeLesson(id, expectedExerciseIds, dataVersion) {
    if (!isId(id) || !ids(expectedExerciseIds)
        || (dataVersion !== undefined && (typeof dataVersion !== 'string' || !DATA_VERSION.test(dataVersion)))) return false;
    const completedSession = Object.values(state.sessions).find(session => session.lessonId === id
      && session.dataVersion === dataVersion
      && session.exerciseIds.length === expectedExerciseIds.length
      && expectedExerciseIds.every(exerciseId => session.exerciseIds.includes(exerciseId) && state.answers[session.id]?.[exerciseId]));
    if (!completedSession) return false;
    const previous = state.completedLessons[id];
    if (!previous || previous.dataVersion !== dataVersion || previous.exerciseIds.join('\0') !== expectedExerciseIds.join('\0')) {
      state.completedLessons[id] = { completedAt: now().toISOString(), exerciseIds: [...expectedExerciseIds],
        ...(dataVersion === undefined ? {} : { dataVersion }) };
      commit();
    }
    return true;
  }

  function versionView(dataVersion) {
    if (dataVersion === undefined) return state;
    if (typeof dataVersion !== 'string' || !DATA_VERSION.test(dataVersion)) throw new TypeError('Versión del contenido inválida.');
    const view = empty();
    view.selectedLevel = state.selectedLevel;
    for (const [id, session] of Object.entries(state.sessions)) {
      if (session.dataVersion !== dataVersion) continue;
      view.sessions[id] = session;
      view.answers[id] = state.answers[id] || {};
    }
    for (const [id, lesson] of Object.entries(state.completedLessons)) {
      if (lesson.dataVersion === dataVersion) view.completedLessons[id] = lesson;
    }
    // Keep the stored historical state intact. The current revision's review
    // queue is derived only from answers actually checked against that revision.
    const answers = Object.values(view.answers).flatMap(entries => Object.values(entries))
      .sort((a, b) => a.answeredAt.localeCompare(b.answeredAt));
    for (const answer of answers) {
      const day = scheduler.isoToday(new Date(answer.answeredAt));
      view.reviews[answer.scenarioId] = scheduler.update(view.reviews[answer.scenarioId], answer.correct, day);
    }
    return view;
  }

  function stats(dataVersion) {
    const view = versionView(dataVersion);
    const answers = Object.values(view.answers).flatMap(entries => Object.values(entries));
    return { answered: answers.length, correct: answers.filter(answer => answer.correct).length,
      completedLessons: Object.keys(view.completedLessons).length };
  }

  return Object.freeze({
    get persistent() { return persistent; },
    getState: dataVersion => clone(versionView(dataVersion)),
    selectLevel(level) {
      if (!Number.isInteger(level) || level < 1 || level > 6) throw new RangeError('Nivel HSK entre 1 y 6.');
      state.selectedLevel = level; commit(); return level;
    },
    saveSession,
    getSession: id => isId(id) && state.sessions[id] ? clone(state.sessions[id]) : null,
    recordAnswer,
    completeLesson,
    pendingExercises: id => isId(id) ? state.sessions[id]?.exerciseIds.filter(exerciseId => !state.answers[id]?.[exerciseId]) || [] : [],
    stats,
    clear() {
      state = empty();
      try { backing?.removeItem(STORAGE_KEY); } catch { persistent = false; }
    },
  });
}

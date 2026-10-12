import test from 'node:test';
import assert from 'node:assert/strict';
import { createDictationStore, DICTATION_STORAGE_KEY, DICTATION_STORE_LIMITS } from '../web/dictationstore.js';
import { compareSentence, aggregateResults } from '../web/dictationcore.js';

const moment = () => new Date('2026-10-12T10:00:00.000Z');
function memory(initial = null) {
  let value = initial;
  return { getItem: () => value, setItem: (_key, next) => { value = next; },
    removeItem: () => { value = null; }, value: () => value };
}
function fixture(storage = memory(), overrides = {}) {
  const store = createDictationStore({ storage, now: moment, ...overrides });
  const exercise = store.createExercise({ title: 'Mi texto', text: '我去学校。今天很好。你好吗？',
    sentences: ['我去学校。', '今天很好。', '你好吗？'], settings: { rate: 0.9 } });
  return { store, exercise, storage };
}
function submit(store, sessionId, answers) {
  const session = store.saveSession(sessionId, { answers });
  const exercise = store.getExercise(session.exerciseId);
  const comparisons = session.indices.map((originalIndex, index) => compareSentence(exercise.sentences[originalIndex], answers[index],
    { evaluatePunctuation: session.settings.evaluatePunctuation }));
  return store.finishSession(sessionId, comparisons, aggregateResults(comparisons));
}

test('created dictados, pending answers, preferences and completed results recover exactly', () => {
  const { store, exercise, storage } = fixture();
  store.setPreferences({ rate: 1.25, autoNext: true, voiceURI: 'local-zh-CN' });
  let session = store.startSession(exercise.id);
  session = store.saveSession(session.id, { answers: ['我去学效。', '今天很好。', ''], currentIndex: 2 });
  let recovered = createDictationStore({ storage, now: moment });
  assert.deepEqual(recovered.getSession(session.id), session);
  assert.equal(recovered.getState().preferences.rate, 1.25);
  const finished = submit(recovered, session.id, session.answers);
  assert.equal(finished.results.summary.correctSentences, 1);
  assert.equal(finished.results.summary.incorrectSentences, 1);
  assert.equal(finished.results.summary.unansweredSentences, 1);
  recovered = createDictationStore({ storage, now: moment });
  assert.equal(recovered.persistent, true);
  assert.deepEqual(recovered.getSession(session.id), finished);
  assert.equal(recovered.getState().errors.find(item => item.expected === '校').written, '效');
});

test('final checking is idempotent, immutable, and does not count an error twice', () => {
  const { store, exercise } = fixture();
  const session = store.startSession(exercise.id, { indices: [0] });
  const completed = submit(store, session.id, ['我去学效。']);
  assert.deepEqual(store.finishSession(session.id, [], {}), completed);
  assert.equal(store.getState().errors[0].count, 1);
  assert.throws(() => store.saveSession(session.id, { answers: ['我去学校。'] }), /ya terminó/);
  store.clearHistory();
  store.finishSession(session.id, [], {});
  assert.equal(store.getState().errors.length, 0, 'checking an old result must not resurrect deleted history');
});

test('review includes only mistakes and unanswered phrases and tracks observed correction', () => {
  const { store, exercise, storage } = fixture();
  const completed = submit(store, store.startSession(exercise.id).id, ['我去学效。', '今天很好。', '']);
  const review = store.startReview(completed.id);
  assert.deepEqual(review.indices, [0, 2]);
  assert.deepEqual(review.answers, ['', '']);
  assert.equal(review.reviewOf, completed.id);
  const corrected = submit(store, review.id, ['我去学校。', '你好吗？']);
  assert.equal(corrected.results.summary.accuracy, 100);
  for (const error of store.getState().errors) {
    assert.equal(error.practiced, true);
    assert.equal(error.corrected, true);
    assert.equal(error.lastPractice, moment().toISOString());
    assert.equal(error.count, 1, 'correcting an error preserves its original frequency');
  }
  assert.equal(store.startReview(corrected.id), null);
  assert.deepEqual(createDictationStore({ storage }).getState(), store.getState());
});

test('review can deliberately omit unanswered phrases and an unsuccessful attempt increases frequency', () => {
  const { store, exercise } = fixture();
  const completed = submit(store, store.startSession(exercise.id).id, ['我去学效。', '今天很好。', '']);
  const review = store.startReview(completed.id, { includeUnanswered: false });
  assert.deepEqual(review.indices, [0]);
  submit(store, review.id, ['我去学效。']);
  const error = store.getState().errors.find(item => item.expected === '校');
  assert.equal(error.count, 2);
  assert.equal(error.practiced, true);
  assert.equal(error.corrected, false);
  store.markErrorPracticed(error.id, false);
  assert.equal(store.getState().errors.find(item => item.id === error.id).lastPractice, null);
  store.markErrorPracticed(error.id);
  assert.equal(store.getState().errors.find(item => item.id === error.id).corrected, false,
    'a manual practiced marker does not claim a verified correction');
});

test('deleting an exercise removes its sessions and contributions while preserving other exercises', () => {
  const { store, exercise, storage } = fixture();
  const second = store.createExercise({ title: 'Otro', text: '学校很大。', sentences: ['学校很大。'] });
  submit(store, store.startSession(exercise.id, { indices: [0] }).id, ['我去学效。']);
  const kept = submit(store, store.startSession(second.id).id, ['学效很大。']);
  assert.equal(store.getState().errors[0].count, 2);
  store.deleteExercise(exercise.id);
  const state = store.getState();
  assert.deepEqual(state.exercises.map(item => item.id), [second.id]);
  assert.deepEqual(state.sessions.map(item => item.id), [kept.id]);
  assert.equal(state.errors[0].count, 1);
  assert.deepEqual(createDictationStore({ storage }).getState(), state);
  store.clearHistory();
  assert.equal(store.getState().errors.length, 0);
  assert.equal(store.getSession(kept.id).status, 'completed');
  store.clearAll();
  assert.equal(storage.value(), null);
  assert.equal(store.getState().exercises.length, 0);
});

test('punctuation setting is snapshotted and remains stable after exercise preferences change', () => {
  const { store, exercise, storage } = fixture();
  const original = store.startSession(exercise.id, { indices: [0] });
  store.updateExercise(exercise.id, { settings: { evaluatePunctuation: true }, title: 'Renombrado' });
  const completed = submit(store, original.id, ['我去学校']);
  assert.equal(completed.results.summary.accuracy, 100);
  const strict = submit(store, store.startSession(exercise.id, { indices: [0] }).id, ['我去学校']);
  assert.equal(strict.results.comparisons[0].deletions, 1);
  assert.equal(strict.results.comparisons[0].differences[0].expected, '。');
  const review = store.startReview(strict.id);
  assert.equal(review.settings.evaluatePunctuation, true);
  assert.deepEqual(createDictationStore({ storage }).getState(), store.getState());
});

test('indices, references, answers and metrics are validated before a mutation', () => {
  const { store, exercise } = fixture();
  const before = store.getState();
  for (const indices of [[-1], [3], [0, 0], [], ['0'], [0, null]]) {
    assert.throws(() => store.startSession(exercise.id, { indices }), /frases/);
    assert.deepEqual(store.getState(), before);
  }
  const session = store.startSession(exercise.id, { indices: [0] });
  for (const patch of [{ currentIndex: 1 }, { answers: [] }, { answers: ['我'.repeat(501)] }, { answers: ['我'], exerciseId: 'other' }]) {
    assert.throws(() => store.saveSession(session.id, patch));
    assert.deepEqual(store.getSession(session.id), session);
  }
  assert.throws(() => store.updateExercise(exercise.id, { sentences: ['我改变了。'] }), /已经|ya tiene/);
  assert.throws(() => store.startSession(exercise.id, { reviewOf: session.id }), /repaso/);
  store.saveSession(session.id, { answers: ['我去学效。'] });
  const compared = compareSentence('我去学校。', '我去学效。');
  assert.throws(() => store.finishSession(session.id, [compared], { ...aggregateResults([compared]), accuracy: 100 }), /incoherente/);
  assert.equal(store.getSession(session.id).status, 'pending');
  const wrongSentence = compareSentence('学校很大。', '我去学效。');
  assert.throws(() => store.finishSession(session.id, [wrongSentence], aggregateResults([wrongSentence])), /ajena/);
  assert.equal(store.getState().errors.length, 0);
});

test('no-storage and denied global localStorage fall back to memory without crashing', () => {
  const seen = [];
  const { store, exercise } = fixture(null, { onStatus: value => seen.push(value) });
  submit(store, store.startSession(exercise.id, { indices: [0] }).id, ['我去学校。']);
  assert.equal(store.persistent, false);
  assert.match(store.status.message, /página|almacenamiento/);
  assert.ok(seen.length);
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
    const guarded = createDictationStore();
    assert.equal(guarded.persistent, false);
    assert.equal(guarded.getState().version, 1);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  }
});

test('quota failure preserves pending answers in memory and the last persisted snapshot', () => {
  const storage = memory();
  const { store, exercise } = fixture(storage);
  const session = store.startSession(exercise.id, { indices: [0] });
  const persisted = storage.value();
  storage.setItem = () => { throw new Error('QuotaExceededError'); };
  store.saveSession(session.id, { answers: ['我去学效。'] });
  assert.equal(store.persistent, false);
  assert.equal(store.status.code, 'write_failed');
  assert.equal(store.getSession(session.id).answers[0], '我去学效。');
  assert.equal(storage.value(), persisted);
  assert.equal(createDictationStore({ storage }).getSession(session.id).answers[0], '');
});

test('malformed, unsafe and future-version stored data stay intact until explicit reset', () => {
  const corruptions = ['{', JSON.stringify({ version: 2, privateText: '我保留这个。' }),
    JSON.stringify({ version: 1, exercises: [], sessions: [], errors: [], preferences: { constructor: 'bad' } }),
    ' '.repeat(DICTATION_STORE_LIMITS.maxBytes + 1)];
  for (const corrupted of corruptions) {
    const storage = memory(corrupted), store = createDictationStore({ storage, now: moment });
    assert.equal(store.persistent, false);
    assert.equal(store.getState().exercises.length, 0);
    store.createExercise({ text: '我学习。', sentences: ['我学习。'] });
    assert.equal(storage.value(), corrupted, 'ordinary writes must not destroy unreadable/newer data');
    store.clearAll();
    assert.equal(storage.value(), null);
    assert.equal(store.persistent, true);
    store.createExercise({ text: '我学习。', sentences: ['我学习。'] });
    assert.notEqual(storage.value(), null);
  }
});

test('tampered saved results and histories are protected rather than trusted or partially restored', () => {
  const { store, exercise, storage } = fixture();
  const done = submit(store, store.startSession(exercise.id, { indices: [0] }).id, ['我去学效。']);
  const original = JSON.parse(storage.value());
  const alterations = [
    value => { value.sessions[0].results.summary.accuracy = 100; },
    value => { value.sessions[0].indices = [99]; },
    value => { value.errors[0].count = 999; },
    value => { value.errors[0].sources[0].sessionId = 'absent'; },
    value => { value.sessions[0].reviewOf = done.id; },
    value => { value.sessions[0].results.comparisons[0].operations[0].kind = 'imaginary'; },
  ];
  for (const alter of alterations) {
    const corrupted = structuredClone(original); alter(corrupted);
    const text = JSON.stringify(corrupted), backing = memory(text);
    const guarded = createDictationStore({ storage: backing });
    assert.equal(guarded.persistent, false);
    assert.equal(guarded.status.code, 'unreadable_data');
    guarded.setPreferences({ rate: 0.75 });
    assert.equal(backing.value(), text);
  }
});

test('count and text limits reject new work without evicting existing dictados', () => {
  const store = createDictationStore({ storage: memory(), now: moment });
  for (let index = 0; index < DICTATION_STORE_LIMITS.maxExercises; index++) {
    store.createExercise({ title: `Dictado ${index}`, text: '我学习。', sentences: ['我学习。'] });
  }
  const before = store.getState();
  assert.throws(() => store.createExercise({ text: '我学习。', sentences: ['我学习。'] }), /20 dictados/);
  assert.deepEqual(store.getState(), before);
  assert.throws(() => store.updateExercise(before.exercises[0].id, { text: '我'.repeat(20001) }));
  assert.deepEqual(store.getState(), before);
  const id = before.exercises[0].id;
  for (let index = 0; index < DICTATION_STORE_LIMITS.maxSessions; index++) store.startSession(id);
  const full = store.getState();
  assert.throws(() => store.startSession(id), /50 sesiones/);
  assert.deepEqual(store.getState(), full);
});

test('total-byte limit rejects a result without losing its pending session or other exercises', () => {
  const store = createDictationStore({ storage: memory(), now: moment });
  const sentences = Array.from({ length: 40 }, () => '我'.repeat(500));
  const exercise = store.createExercise({ title: 'Largo', text: sentences.join(''), sentences });
  const session = store.startSession(exercise.id);
  const pending = store.saveSession(session.id, { answers: sentences });
  const compared = sentences.map(sentence => compareSentence(sentence, sentence));
  assert.throws(() => store.finishSession(session.id, compared, aggregateResults(compared)), /1,5 MiB/);
  assert.deepEqual(store.getSession(session.id), pending);
  assert.equal(store.getState().errors.length, 0);
});

test('history limit rejects a 501st distinct difference without dropping prior results or pending answers', () => {
  const store = createDictationStore({ storage: memory(), now: moment });
  const original = Array.from({ length: 500 }, (_, index) => String.fromCodePoint(0x4e00 + index)).join('');
  const exercise = store.createExercise({ text: original, sentences: [original] });
  submit(store, store.startSession(exercise.id).id, ['替'.repeat(500)]);
  assert.equal(store.getState().errors.length, 500);
  const second = store.createExercise({ text: '龍', sentences: ['龍'] });
  const pending = store.saveSession(store.startSession(second.id).id, { answers: ['龙'] });
  const compared = compareSentence('龍', '龙');
  assert.throws(() => store.finishSession(pending.id, [compared], aggregateResults([compared])), /500 diferencias/);
  assert.equal(store.getState().errors.length, 500);
  assert.deepEqual(store.getSession(pending.id), pending);
  store.clearHistory();
  store.finishSession(pending.id, [compared], aggregateResults([compared]));
  assert.equal(store.getState().errors.length, 1);
});

test('one repeated observed difference records its true frequency within a single sentence', () => {
  const store = createDictationStore({ storage: memory(), now: moment });
  const exercise = store.createExercise({ text: '校校校。', sentences: ['校校校。'] });
  const completed = submit(store, store.startSession(exercise.id).id, ['效效效。']);
  const error = store.getState().errors[0];
  assert.equal(error.count, 3);
  assert.equal(error.sources[0].count, 3);
  store.finishSession(completed.id, [], {});
  assert.equal(store.getState().errors[0].count, 3);
});

test('insertion/deletion alignment, ignored punctuation, NFC and astral Chinese survive persistence', () => {
  const storage = memory(), store = createDictationStore({ storage, now: moment });
  const sentences = ['我今天去学校。', '我今天去学校。', '我说：你好！', '𠀀去学校。', '我爱café。'];
  const exercise = store.createExercise({ text: sentences.join(''), sentences });
  const completed = submit(store, store.startSession(exercise.id).id,
    ['我今天真的去学校。', '我去学校。', '我 说，你好', '𠀀去学效。', '我爱cafe\u0301。']);
  assert.ok(completed.results.comparisons[0].insertions > 0);
  assert.ok(completed.results.comparisons[1].deletions > 0);
  assert.equal(completed.results.comparisons[2].status, 'correct');
  assert.equal(completed.results.comparisons[3].differences[0].originalPosition, 4);
  assert.equal(completed.results.comparisons[4].status, 'correct');
  const restored = createDictationStore({ storage });
  assert.equal(restored.persistent, true);
  assert.deepEqual(restored.getSession(completed.id), completed);
});

test('returned snapshots cannot mutate saved state and text remains data even when it resembles HTML', () => {
  const { store } = fixture();
  const exercise = store.createExercise({ title: '<img onerror=alert(1)>', text: '我说<script>你好</script>。', sentences: ['我说<script>你好</script>。'] });
  const result = store.getExercise(exercise.id);
  result.sentences[0] = '被改了';
  store.getState().exercises.length = 0;
  assert.equal(store.getExercise(exercise.id).sentences[0], '我说<script>你好</script>。');
  const session = store.startSession(exercise.id);
  session.answers[0] = '被改了';
  assert.equal(store.getSession(session.id).answers[0], '');
});

test('failed deletion explicitly warns that saved browser data could remain', () => {
  const storage = memory();
  const { store } = fixture(storage);
  const original = storage.value();
  storage.removeItem = () => { throw new Error('SecurityError'); };
  store.clearAll();
  assert.equal(store.persistent, false);
  assert.equal(store.status.code, 'clear_failed');
  assert.match(store.status.message, /navegador no permitió/);
  assert.equal(storage.value(), original);
  assert.equal(store.getState().exercises.length, 0);
});

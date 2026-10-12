import { createProgress } from './progress.js';
import { mountPractice } from './practice.js';
import { scheduler } from './scheduler.js';
import { mountReports } from './reports.js';
import { mountDictation } from './dictation.js';

const el = (tag, className = '', text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const zh = (text, className = 'zh') => {
  const node = el('span', className, text);
  node.lang = 'zh-Hans';
  return node;
};
const button = (text, action, className = 'secondary-button') => {
  const node = el('button', className, text);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
};
const norm = value => String(value || '').toLowerCase().normalize('NFD')
  .replace(/u\u0308/g, 'v').replace(/[\u0300-\u036f]/g, '')
  .replace(/ü/g, 'v').replace(/u:/g, 'v').replace(/[\s1-5]/g, '');
const reading = word => (word?.readings || []).map(item => item.pinyin).filter(Boolean).join(' / ');
const gloss = sense => sense.gloss || sense.gloss_es || (sense.glosses || []).join('; ');
const partOfSpeech = value => ({ verb: 'Verbo', noun: 'Sustantivo', adjective: 'Adjetivo',
  adverb: 'Adverbio', pronoun: 'Pronombre', particle: 'Partícula', interjection: 'Interjección',
  phrase: 'Expresión', conjunction: 'Conjunción', numeral: 'Numeral' }[value] || value || 'Categoría pendiente');
const textValue = value => typeof value === 'string' ? value : Array.isArray(value)
  ? value.map(textValue).filter(Boolean).join(' · ') : value && typeof value === 'object'
    ? value.note || value.description || value.zh || '' : '';

const content = document.querySelector('#content');
const announcer = document.querySelector('#announcer');
const progress = createProgress();
let bootstrap;
let view = 'learn';
let selectedUnit = null;
let selectedLesson = null;
let selectedOriginalLesson = null;
let selectedWord = null;
let selectedContrast = null;
let comparisonQuery = '';
let selectedComparisonExample = null;
let cleanupPractice = null;
let wordIndex = [];
let currentSession = null;
let reports = null;
let showHsk = false;
let hskQuery = '';
let hskOnlyPractice = true;
let hskPage = 0;
const hskSelectedEntries = new Set();
const hskCustomLessons = new Map();
const hskStorageKey = 'hanyumatiz.hsk.2025.selection.v1';
const ownerPolicy = () => bootstrap?.editorial?.reviewPolicy === 'owner_reports';

function page(title, description, symbol) {
  const fragment = document.createDocumentFragment();
  const intro = el('header', 'page-intro');
  const copy = el('div');
  const heading = el('h1', '', title);
  heading.tabIndex = -1;
  copy.append(heading, el('p', '', description));
  intro.append(copy, zh(symbol, 'page-icon'));
  fragment.append(intro);
  if (bootstrap.mode === 'private' && !ownerPolicy()) {
    const note = el('div', 'draft-note');
    note.append(el('span', 'draft-dot'), el('span', '', 'Prueba privada · Los textos y actividades están pendientes de revisión de chino.'));
    fragment.append(note);
  }
  return fragment;
}

function finishPage(fragment) {
  content.replaceChildren(fragment);
  content.classList.remove('view-enter');
  void content.offsetWidth;
  content.classList.add('view-enter');
}

function leaveCurrentView() {
  if (cleanupPractice?.() === false) {
    // Keep the editor and its draft when the local store rejects a save.
    history.replaceState(null, '', view === 'practice' ? `#practice/${currentSession}` : `#${view}`);
    return false;
  }
  cleanupPractice = null;
  return true;
}

function showView(next, { updateHash = true, focus = false } = {}) {
  if (!bootstrap || !['learn', 'dictionary', 'compare', 'review', 'dictation'].includes(next)) return;
  if (!leaveCurrentView()) return;
  document.body.classList.remove('practice-mode', 'lesson-intro-mode', 'dictation-mode');
  currentSession = null;
  view = next;
  document.querySelectorAll('[data-view]').forEach(link => {
    if (link.dataset.view === next) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  ({ learn: renderLearn, dictionary: renderDictionary, compare: renderCompare, review: renderReview,
    dictation: () => { cleanupPractice = mountDictation(content, { onExit: () => showView('learn', { focus: true }), announce: message => { announcer.textContent = message; } }); } })[next]();
  if (updateHash) history.replaceState(null, '', `#${next}`);
  if (focus) content.querySelector('h1')?.focus({ preventScroll: true });
  document.title = `HanYuMatiz · ${ { learn: 'Aprender', dictionary: 'Diccionario', compare: 'Comparar', review: 'Repasar', dictation: 'Dictado' }[next] }`;
}

function openContrast(contrastId) {
  selectedContrast = contrastId; comparisonQuery = ''; selectedComparisonExample = null;
  showView('compare', { focus: true });
}

function renderLearn() {
  const originalLessons = (bootstrap.lessons || []).filter(lesson => lesson.status === 'published'
    && lesson.exerciseIds?.some(id => bootstrap.exercises.some(exercise => exercise.id === id)));
  const fragment = page('Tus lecciones', originalLessons.length
    ? 'Practica con situaciones de la vida diaria.'
    : 'Trabaja las palabras en contexto y entiende qué cambia al usarlas.', '学');
  const tabs = el('div', 'learn-tabs'); tabs.setAttribute('aria-label', 'Elegir cómo estudiar');
  for (const [label, isHsk] of [['Lecciones', false], ['Por HSK', true]]) {
    const tab = button(label, () => { showHsk = isHsk; renderLearn();
      content.querySelector(isHsk ? '#hskToggle' : '#lessonsTab')?.focus({ preventScroll: true }); }, 'learn-tab');
    tab.id = isHsk ? 'hskToggle' : 'lessonsTab'; tab.setAttribute('aria-pressed', String(showHsk === isHsk));
    tabs.append(tab);
  }
  fragment.append(tabs);
  if (showHsk || !originalLessons.length) renderHsk(fragment);
  else renderOriginalLessons(fragment, originalLessons);
  finishPage(fragment);
}

function renderOriginalLessons(fragment, lessons) {
  const state = progress.getState(bootstrap.dataVersion);
  const completed = lessons.filter(lesson => state.completedLessons[lesson.id]);
  if (!lessons.some(lesson => lesson.id === selectedOriginalLesson)) {
    selectedOriginalLesson = lessons.find(lesson => !state.completedLessons[lesson.id])?.id || lessons[0].id;
  }
  const course = el('section', 'lesson-course'); course.setAttribute('aria-label', 'Lecciones de chino');
  const chooser = el('div', 'lesson-chooser');
  const chooserMeta = el('div', 'lesson-chooser-meta');
  const chooserLabel = el('label', '', 'Elegir una lección'); chooserLabel.htmlFor = 'originalLessonSelect';
  const label = el('span', '', `${completed.length} de ${lessons.length} completadas`); label.id = 'lessonProgress';
  chooserMeta.append(chooserLabel, label);
  const select = el('select', 'lesson-select'); select.id = 'originalLessonSelect';
  lessons.forEach((lesson, index) => {
    const option = el('option', '', `${String(index + 1).padStart(2, '0')} · ${lesson.title}${state.completedLessons[lesson.id] ? ' · Completada' : ''}`);
    option.value = lesson.id; option.dataset.originalLesson = lesson.id;
    option.selected = lesson.id === selectedOriginalLesson; select.append(option);
  });
  select.addEventListener('change', () => {
    selectedOriginalLesson = select.value; renderLearn();
    content.querySelector('#originalLessonSelect')?.focus({ preventScroll: true });
    announcer.textContent = `Lección seleccionada: ${lessons.find(lesson => lesson.id === selectedOriginalLesson)?.title}.`;
  });
  chooser.append(chooserMeta, select); course.append(chooser);
  const lesson = lessons.find(item => item.id === selectedOriginalLesson);
  const exercises = lesson.exerciseIds.map(id => bootstrap.exercises.find(exercise => exercise.id === id)).filter(Boolean);
  const pending = Object.values(state.sessions).find(session => session.lessonId === lesson.id && !session.ended
    && session.exerciseIds.length === exercises.length && session.exerciseIds.every(id => lesson.exerciseIds.includes(id)));
  const detail = el('div', 'lesson-preview');
  detail.append(el('p', 'lesson-position', `Lección ${lessons.indexOf(lesson) + 1} · ${exercises.length} situaciones`));
  const title = el('h2', '', lesson.title); title.id = 'originalLessonTitle'; title.tabIndex = -1;
  detail.append(title, el('p', 'lesson-summary', lesson.description || lesson.objective));
  const actions = el('div', 'lesson-start');
  const start = button(pending ? 'Continuar ejercicios' : 'Conocer las palabras',
    () => pending ? startPractice(exercises, lesson.id, pending.id) : startLessonIntroduction(lesson), 'primary-button');
  start.dataset.start = 'lesson'; start.dataset.lessonId = lesson.id; actions.append(start);
  if (pending) actions.append(el('p', 'lesson-resume', `${Object.keys(state.answers[pending.id] || {}).length} de ${exercises.length} respuestas guardadas`));
  else actions.append(el('p', 'lesson-resume', `Primero, ${lesson.contrastIds.length} pares explicados. Después, ${exercises.length} situaciones.`));
  if (pending) actions.append(button('Repasar las palabras', () => startLessonIntroduction(lesson, 0, pending.id), 'text-button'));
  detail.append(actions);
  const cases = el('details', 'lesson-cases'); cases.id = 'lessonCases';
  cases.append(el('summary', '', `Ver las ${exercises.length} situaciones de esta lección`));
  const caseList = el('ol', 'lesson-case-list');
  for (const exercise of exercises) {
    const scenario = bootstrap.scenarios.find(scenario=>scenario.id===exercise.scenario_id);
    const item = el('li'); item.append(el('span', '', exercise.title || scenario?.label || 'Practicar una situación'));
    const pair = bootstrap.contrasts.find(pair=>pair.id===scenario?.contrast_id);
    if (pair) item.append(zh(`${pair.a} / ${pair.b}`, 'lesson-case-pair'));
    caseList.append(item);
  }
  cases.append(caseList); detail.append(cases);
  const notes = el('details', 'lesson-notes'); notes.id = 'lessonNotes';
  notes.append(el('summary', '', 'Ver las palabras y la diferencia'));
  const notesContent = el('div', 'lesson-notes-content');
  const words = (lesson.wordIds || []).map(id => bootstrap.words.find(word => word.id === id)).filter(Boolean);
  const terms = el('div', 'lesson-word-links'); terms.setAttribute('aria-label', 'Consultar las palabras de esta lección');
  for (const word of words) {
    const term = button('', () => { selectedWord = word.id; showView('dictionary', { focus: true }); }, 'lesson-word-link');
    term.append(zh(word.zh), el('span', 'pinyin', reading(word))); terms.append(term);
  }
  notesContent.append(terms);
  const contrasts = (lesson.contrastIds || []).map(id => bootstrap.contrasts.find(pair => pair.id === id)).filter(Boolean);
  for (const contrast of contrasts) {
    const explanation = el('section', 'lesson-explanation');
    const heading = el('h3'); heading.append(zh(contrast.a), document.createTextNode(' / '), zh(contrast.b)); explanation.append(heading);
    if (contrast.explanation) explanation.append(el('p', 'contrast-explanation', contrast.explanation));
    explanation.append(button('Ver ejemplos', () => {
      openContrast(contrast.id);
    }, 'text-button'));
    notesContent.append(explanation);
  }
  if (!contrasts.length) {
    for (const word of words) {
      const usage = word.usage || word.usage_note || word.senses?.[0]?.usage;
      if (usage) { const line = el('p', 'lesson-usage'); line.append(zh(word.zh), document.createTextNode(` · ${typeof usage === 'string' ? usage : usage.note || ''}`)); notesContent.append(line); }
    }
  }
  notes.append(notesContent); detail.append(notes); course.append(detail); fragment.append(course);
}

function startLessonIntroduction(lesson, initialStep = 0, resumeId = null) {
  const pairs = lesson.contrastIds.map(id => bootstrap.contrasts.find(pair => pair.id === id)).filter(Boolean);
  if (!pairs.length) return;
  if (!leaveCurrentView()) return;
  view = 'introduction'; currentSession = null; selectedOriginalLesson = lesson.id;
  document.body.classList.add('practice-mode', 'lesson-intro-mode');
  window.scrollTo({ top: 0, behavior: 'instant' });
  document.title = `HanYuMatiz · ${lesson.title} · Las palabras`;
  let step = Math.max(0, Math.min(pairs.length - 1, Number(initialStep) || 0));
  const shell = el('section', 'intro-page'); shell.id = 'lessonIntroduction';
  shell.setAttribute('aria-label', 'Introducción a las palabras de la lección');
  const top = el('header', 'intro-header');
  const exit = button('×', () => showView('learn', { focus: true }), 'icon-button');
  exit.id = 'introExit'; exit.setAttribute('aria-label', 'Volver a las lecciones');
  const position = el('span', 'intro-position'); position.id = 'introPosition';
  const lessonName = el('span', 'intro-lesson-name', lesson.title);
  top.append(exit, lessonName, position);
  const body = el('div', 'intro-scroll'); body.tabIndex = 0;
  body.setAttribute('aria-label', 'Palabras, diferencias y ejemplos');
  const footer = el('footer', 'intro-footer');
  const back = button('Anterior', () => { if (step > 0) { step--; draw(); } }, 'secondary-button'); back.id = 'introPrevious';
  const next = button('', () => {
    if (step + 1 < pairs.length) { step++; draw(); return; }
    document.body.classList.remove('lesson-intro-mode');
    const byId = new Map(bootstrap.exercises.map(item => [item.id, item]));
    startPractice(lesson.exerciseIds.map(id => byId.get(id)).filter(Boolean), lesson.id, resumeId);
  }, 'primary-button'); next.id = 'introNext';
  footer.append(back, next); shell.append(top, body, footer); content.replaceChildren(shell);
  function draw() {
    const pair = pairs[step], teaching = pair.teaching || {};
    history.replaceState(null, '', `#introduction/${lesson.id}/${step}${resumeId ? `/${resumeId}` : ''}`);
    position.textContent = `${step + 1} de ${pairs.length}`;
    back.disabled = step === 0;
    next.textContent = step + 1 < pairs.length ? 'Siguiente par' : resumeId ? 'Continuar ejercicios' : 'Empezar ejercicios';
    const section = el('section', 'intro-content');
    section.append(el('p', 'intro-eyebrow', 'Antes de practicar'));
    const heading = el('h1', 'intro-title'); heading.id = 'introTitle'; heading.tabIndex = -1;
    heading.append(zh(pair.a), document.createTextNode(' y '), zh(pair.b)); section.append(heading);
    section.append(el('p', 'intro-description', teaching.introduction || pair.summary || pair.explanation));
    const cards = el('div', 'intro-word-grid');
    for (const key of ['a', 'b']) {
      const word = bootstrap.words.find(word => word.id === pair[`word_id_${key}`]);
      const card = el('article', 'intro-word'); card.dataset.introWord = word?.id || pair[key];
      const wordTitle = el('h2'); wordTitle.append(zh(pair[key]));
      card.append(wordTitle, el('p', 'intro-pinyin', reading(word)), el('p', 'intro-gloss', gloss(word?.senses?.[0] || {})));
      if (word?.hsk_level) card.append(el('p', 'intro-hsk-level', `HSK ${word.hsk_level} · Programa 2025`));
      const sample = teaching[`example_${key}`] || pair.examples?.[1]?.variants?.[key]
        || bootstrap.examples.find(example => example.lexeme_id === word?.id);
      if (sample) {
        const chinese = el('p', 'intro-example'); chinese.lang = 'zh-Hans'; chinese.textContent = sample.sentence_zh;
        card.append(chinese, el('p', 'intro-translation', sample.translation_es));
      }
      cards.append(card);
    }
    section.append(cards);
    const tip = el('aside', 'intro-tip'); tip.append(el('h2', '', 'Qué conviene recordar'),
      el('p', '', teaching.tip || pair.explanation)); section.append(tip);
    section.append(el('p', 'intro-bridge', 'En los ejercicios, fíjate en la situación y en lo que pide la pregunta. A veces las dos palabras sirven; otras cambia el significado o la forma de construir la frase.'));
    body.replaceChildren(section); body.scrollTop = 0;
    requestAnimationFrame(() => heading.focus({ preventScroll: true }));
    announcer.textContent = `Antes de practicar: ${pair.a} y ${pair.b}. Par ${step + 1} de ${pairs.length}.`;
  }
  draw();
}

function hskLessonForPairs(contrastIds) {
  const contrasts = contrastIds.map(id => bootstrap.contrasts.find(pair => pair.id === id)).filter(Boolean);
  const wordIds = [...new Set(contrasts.flatMap(pair => [pair.word_id_a, pair.word_id_b]))];
  const scenarioIds = contrasts.flatMap(pair => bootstrap.scenarios.filter(scene => scene.contrast_id === pair.id).map(scene => scene.id));
  const exerciseIds = scenarioIds.map(id => bootstrap.exercises.find(exercise => exercise.scenario_id === id)?.id).filter(Boolean);
  return { id: 'hsk_selected_' + contrasts.map(pair => bootstrap.contrasts.indexOf(pair)).join('_'),
    title: 'Mi selección HSK', description: 'Practica las palabras que elegiste y aprende a distinguirlas de sus alternativas.',
    contrastIds: contrasts.map(pair => pair.id), wordIds, exerciseIds, scope: 'hsk_word_selection' };
}

function saveHskSelection() {
  try { localStorage.setItem(hskStorageKey, JSON.stringify({
    entryIds: [...hskSelectedEntries], lessons: [...hskCustomLessons.values()].slice(-30).map(lesson => lesson.contrastIds),
  })); } catch { /* The selection remains usable in memory if storage is unavailable. */ }
}

function restoreHskSelection() {
  try {
    const saved = JSON.parse(localStorage.getItem(hskStorageKey) || '{}');
    const entries = new Set((bootstrap.hskCatalog?.entries || []).map(entry => entry.id));
    for (const id of saved.entryIds || []) if (entries.has(id)) hskSelectedEntries.add(id);
    for (const ids of (saved.lessons || []).slice(-30)) {
      if (!Array.isArray(ids) || ids.length > 3 || !ids.every(id => bootstrap.contrasts.some(pair => pair.id === id))) continue;
      const lesson = hskLessonForPairs(ids); hskCustomLessons.set(lesson.id, lesson);
    }
  } catch { /* Ignore malformed local data without affecting the catalogue. */ }
}

function selectedHskPairs() {
  const wordIds = new Set((bootstrap.hskCatalog?.entries || []).filter(entry => hskSelectedEntries.has(entry.id)).flatMap(entry => entry.wordIds));
  const pairs = bootstrap.contrasts.filter(pair => wordIds.has(pair.word_id_a) || wordIds.has(pair.word_id_b));
  const state = progress.getState(bootstrap.dataVersion);
  const answered = new Set(Object.values(state.answers).flatMap(session => Object.values(session)).map(answer => answer.scenarioId || answer.scenario_id));
  return pairs.sort((a, b) => {
    const done = pair => bootstrap.scenarios.filter(scene => scene.contrast_id === pair.id).every(scene => answered.has(scene.id));
    return Number(done(a)) - Number(done(b));
  });
}

function renderHsk(fragment) {
  const reference = bootstrap.hskCatalog, selection = bootstrap.hskSelection;
  if (!reference || !selection) { fragment.append(empty('No se pudo cargar la selección HSK.', 'Puedes estudiar las lecciones originales.')); return; }
  const section = el('section', 'hsk-selection'); section.id = 'hskContent';
  section.append(el('h2', '', 'Elige tus palabras'), el('p', 'hsk-description',
    'Marca lo que quieres estudiar. Practicarás cada palabra junto a otra parecida, aunque esa alternativa pertenezca a otro nivel.'));
  const selector = el('div', 'level-selector'); selector.setAttribute('role', 'group'); selector.setAttribute('aria-label', 'Elegir nivel HSK');
  const levelNumber = progress.getState().selectedLevel;
  for (const level of selection.levels) {
    const control = button(`HSK ${level.level}`, () => {
      progress.selectLevel(level.level); hskPage = 0; renderLearn();
      content.querySelector(`[data-level="${level.level}"]`)?.focus({ preventScroll: true });
      announcer.textContent = `HSK ${level.level}. ${level.availablePracticeWordCount} palabras con ejercicios disponibles.`;
    }, 'level-button');
    control.dataset.level = String(level.level); control.setAttribute('aria-pressed', String(level.level === levelNumber)); selector.append(control);
  }
  section.append(selector);
  const level = selection.levels.find(level => level.level === levelNumber);
  const counts = el('p', 'hsk-level-counts'); counts.id = 'hskLevelCounts';
  counts.textContent = `${level.entryCount} entradas del programa · ${level.availableWordCount} palabras con ficha · ${level.availablePracticeWordCount} con ejercicios`;
  section.append(counts);
  const tools = el('div', 'hsk-tools');
  const searchLabel = el('label', 'search-field'); searchLabel.append(el('span', '', 'Buscar en este nivel'));
  const search = el('input'); search.id = 'hskSearch'; search.type = 'search'; search.value = hskQuery; search.placeholder = 'Caracteres, pinyin o significado'; searchLabel.append(search);
  const filter = el('label', 'hsk-check'); const only = el('input'); only.type = 'checkbox'; only.id = 'hskOnlyPractice'; only.checked = hskOnlyPractice;
  filter.append(only, el('span', '', 'Solo palabras con ejercicios')); tools.append(searchLabel, filter); section.append(tools);
  const summary = el('p', 'results-summary'); summary.id = 'hskResultsSummary';
  const list = el('div', 'hsk-word-list'); list.id = 'hskWordList';
  const paging = el('div', 'hsk-paging');
  const previous = button('Anterior', () => { hskPage--; drawRows(); }, 'secondary-button'); previous.id = 'hskPreviousPage';
  const pageText = el('span'); pageText.id = 'hskPageText';
  const following = button('Siguiente', () => { hskPage++; drawRows(); }, 'secondary-button'); following.id = 'hskNextPage';
  paging.append(previous, pageText, following); section.append(summary, list, paging);
  const plan = el('footer', 'hsk-plan');
  const status = el('p'); status.id = 'hskSelectionStatus';
  const actions = el('div', 'button-row');
  const start = button('Conocer mi selección', () => {
    const pairs = selectedHskPairs().slice(0, 3); if (!pairs.length) return;
    const lesson = hskLessonForPairs(pairs.map(pair => pair.id));
    hskCustomLessons.set(lesson.id, lesson); saveHskSelection(); startLessonIntroduction(lesson);
  }, 'primary-button'); start.id = 'hskStartSelection';
  const clear = button('Vaciar selección', () => { hskSelectedEntries.clear(); saveHskSelection(); drawRows(); }, 'text-button'); clear.id = 'hskClearSelection';
  actions.append(start, clear); plan.append(status, actions); section.append(plan);
  const source = el('details', 'hsk-source'); source.id = 'hskSource'; source.append(el('summary', '', 'Programa y fuente del vocabulario'));
  source.append(el('p', '', `Programa de noviembre de 2025, con julio de 2026 como fecha de aplicación declarada. La referencia contiene ${reference.entries.length} posiciones de vocabulario hasta HSK 6; una posición puede corresponder a una lectura distinta de la misma escritura.`),
    el('p', '', 'Los niveles proceden de la transcripción de Mani (krmanik), conservada con una versión identificada. El PDF oficial no pudo cotejarse directamente desde este entorno. Las explicaciones y ejercicios de HanYuMatiz son originales; disponer de fichas no significa haber completado el programa HSK.'));
  const attribution = el('p');
  const sourceLink = el('a', '', 'HSK 3.0 Words lists · Mani (krmanik)'); sourceLink.href = reference.secondaryReadmeUrl;
  const licenseLink = el('a', '', 'CC BY-SA 4.0'); licenseLink.href = reference.licenseUrl;
  attribution.append(sourceLink, document.createTextNode(' · '), licenseLink, document.createTextNode('. Tablas normalizadas; se conserva su atribución.'));
  source.append(attribution); section.append(source); fragment.append(section);
  const practiceWords = new Set(selection.levels.flatMap(level => level.practiceWordIds));
  const entries = reference.entries.filter(entry => entry.level === levelNumber);
  const words = new Map(bootstrap.words.map(word => [word.id, word]));
  const hasPractice = entry => entry.wordIds.some(id => practiceWords.has(id));
  function updatePlan() {
    const pairs = selectedHskPairs(); const count = hskSelectedEntries.size;
    status.textContent = count ? `${count} entradas seleccionadas · ${pairs.length} pares disponibles. Primera sesión: hasta 3 pares; las siguientes priorizan lo que te queda por practicar.` : 'Selecciona alguna palabra para preparar tu práctica. Puedes añadir palabras de varios niveles.';
    start.disabled = !pairs.length; clear.disabled = !count;
  }
  function drawRows() {
    const query = norm(hskQuery);
    const matches = entries.filter(entry => (!hskOnlyPractice || hasPractice(entry))
      && (!query || [entry.zh, entry.pinyin, ...entry.wordIds.flatMap(id => (words.get(id)?.senses || []).map(gloss))].some(value => norm(value).includes(query))));
    const size = 30, pages = Math.max(1, Math.ceil(matches.length / size)); hskPage = Math.min(pages - 1, Math.max(0, hskPage));
    summary.textContent = `${matches.length} resultados en HSK ${levelNumber}`;
    list.replaceChildren();
    for (const entry of matches.slice(hskPage * size, (hskPage + 1) * size)) {
      const row = el('label', 'hsk-word-row'); row.dataset.hskEntry = entry.id;
      const check = el('input'); check.type = 'checkbox'; check.checked = hskSelectedEntries.has(entry.id); check.dataset.hskSelect = entry.id;
      check.setAttribute('aria-label', `Seleccionar ${entry.zh}, ${entry.pinyin}, HSK ${entry.level}`);
      check.addEventListener('change', () => { if (check.checked) hskSelectedEntries.add(entry.id); else hskSelectedEntries.delete(entry.id);
        row.classList.toggle('selected', check.checked); saveHskSelection(); updatePlan(); });
      row.classList.toggle('selected', check.checked);
      const copy = el('span', 'hsk-word-copy'); const term = el('span', 'hsk-term'); term.append(zh(entry.zh), el('span', 'pinyin', entry.pinyin));
      const meanings = [...new Set(entry.wordIds.flatMap(id => (words.get(id)?.senses || []).map(gloss)))];
      copy.append(term, el('span', 'hsk-word-meaning', meanings.join(' · ') || 'Ficha en preparación'));
      const availability = el('span', 'hsk-availability', hasPractice(entry) ? 'Con ejercicios' : entry.hasCard ? 'Con ficha' : 'Por preparar');
      row.append(check, copy, availability); list.append(row);
    }
    if (!matches.length) list.append(empty('No hay coincidencias con estos filtros.', hskOnlyPractice ? 'Desmarca «Solo palabras con ejercicios» para explorar todas las entradas de este nivel.' : 'Prueba otra escritura o pronunciación.'));
    paging.hidden = pages <= 1; previous.disabled = hskPage === 0; following.disabled = hskPage + 1 >= pages; pageText.textContent = `${hskPage + 1} de ${pages}`;
    updatePlan();
  }
  search.addEventListener('input', () => { hskQuery = search.value; hskPage = 0; drawRows(); });
  only.addEventListener('change', () => { hskOnlyPractice = only.checked; hskPage = 0; drawRows(); });
  drawRows();
}

function empty(title, description) {
  const node = el('div', 'empty-state');
  node.append(el('strong', '', title), el('span', '', description));
  return node;
}

function renderDictionary() {
  const fragment = page('Diccionario', 'Busca por caracteres, pinyin o significado. Abre una palabra para consultar sus acepciones y ejemplos.', '词');
  const label = el('label', 'search-field');
  const input = el('input'); input.id = 'search'; input.type = 'search'; input.autocomplete = 'off'; input.spellcheck = false;
  input.placeholder = 'Por ejemplo: 觉得, juéde o impresión';
  label.append(el('span', '', 'Buscar una palabra'), input); fragment.append(label);
  const layout = el('div', 'tools-grid');
  const left = el('section');
  const summary = el('div', 'results-summary'); summary.setAttribute('role', 'status');
  const results = el('div', 'result-list'); results.id = 'wordResults';
  results.setAttribute('aria-label', 'Palabras encontradas');
  const detail = el('section', 'detail-panel'); detail.id = 'wordDetail'; detail.setAttribute('aria-label', 'Ficha de la palabra');
  left.append(summary, results); layout.append(left, detail); fragment.append(layout); finishPage(fragment);
  function updateResults() {
    const query = norm(input.value);
    const matches = wordIndex.filter(item => !query || item.terms.some(term => term.includes(query)));
    summary.textContent = `${matches.length} de ${wordIndex.length} palabras${bootstrap.mode === 'private' && !ownerPolicy() ? ' · Borradores' : ''}`;
    results.replaceChildren();
    if (!matches.length) {
      results.append(empty('No hay resultados.', bootstrap.words.length ? 'Prueba otra palabra, su pinyin o una traducción.' : 'Aún no hay entradas aprobadas para la versión pública.'));
      detail.replaceChildren(empty('Cada palabra tiene su ficha.', 'Busca una entrada para ver acepciones, ejemplos y palabras relacionadas.'));
      return;
    }
    if (!matches.some(item => item.word.id === selectedWord)) selectedWord = matches[0].word.id;
    for (const { word } of matches) {
      const row = button('', () => { selectedWord = word.id; updateResults();
        detail.querySelector('h2')?.focus({ preventScroll: true }); }, 'word-result');
      row.dataset.word = word.id;
      row.setAttribute('aria-pressed', String(word.id === selectedWord));
      if (word.id === selectedWord) row.classList.add('selected');
      const copy = el('div'); copy.append(zh(word.zh), el('small', '', gloss(word.senses?.[0] || {})));
      row.append(copy, el('span', 'pinyin', reading(word))); results.append(row);
    }
    renderWordDetail(detail, bootstrap.words.find(word => word.id === selectedWord));
  }
  input.addEventListener('input', updateResults); updateResults();
}

function renderWordDetail(panel, word) {
  panel.replaceChildren();
  if (!word) return;
  const heading = el('div', 'word-heading');
  const title = el('h2', 'zh', word.zh); title.lang = 'zh-Hans'; title.tabIndex = -1;
  heading.append(title, el('span', 'status-label', ownerPolicy() ? 'Edición original' : bootstrap.mode === 'private' ? 'Borrador' : 'Revisado'));
  panel.append(heading, el('p', 'word-pinyin', reading(word)));
  for (const [index, sense] of (word.senses || []).entries()) {
    const row = el('div', 'sense-row');
    const copy = el('div'); copy.append(el('div', 'sense-pos', partOfSpeech(sense.pos)), el('p', '', gloss(sense)));
    const pronId = sense.pronunciation_id;
    if ((word.readings || []).length > 1 && pronId) {
      const pronunciation = word.readings.find(item => item.id === pronId);
      if (pronunciation) copy.append(el('small', 'small-meta', `Lectura de esta acepción: ${pronunciation.pinyin}`));
    }
    row.append(el('span', 'sense-number', String(index + 1).padStart(2, '0')), copy); panel.append(row);
    if (sense.usage) copy.append(el('p', 'usage-note', textValue(sense.usage)));
  }
  if (word.usage || word.usage_note) {
    const section = el('section', 'detail-section'); section.append(el('h3', '', 'Cómo se usa'),
      el('p', 'usage-note', textValue(word.usage || word.usage_note))); panel.append(section);
  }
  if (word.register) panel.append(el('p', 'register-note', `Registro: ${textValue(word.register)}`));
  if (word.collocations?.length) {
    const section = el('section', 'detail-section'); section.append(el('h3', '', 'Combinaciones habituales'));
    const list = el('div', 'collocation-list');
    for (const collocation of word.collocations) {
      const item = el('div', 'collocation'); item.append(zh(typeof collocation === 'string' ? collocation : collocation.zh || collocation.phrase || ''));
      if (typeof collocation === 'object' && (collocation.translation || collocation.translation_es)) item.append(el('span', '', collocation.translation_es || collocation.translation));
      list.append(item);
    }
    section.append(list); panel.append(section);
  }
  const senseIds = (word.senses || []).map(sense => sense.id);
  const examples = (bootstrap.examples || []).filter(example => senseIds.includes(example.target_sense_id) || example.lexeme_id === word.id);
  examples.push(...(word.examples || []));
  const section = el('section', 'detail-section'); section.append(el('h3', '', 'Ejemplos en contexto'));
  if (!examples.length) section.append(el('p', 'small-meta', 'Todavía no hay ejemplos vinculados a esta entrada.'));
  const uniqueExamples = [...new Map(examples.map(example => [example.id || example.sentence_zh || example.zh, example])).values()];
  for (const example of uniqueExamples) {
    const row = el('div', 'example-line'); row.append(zh(example.sentence_zh || example.zh), el('p', '', example.translation_es || example.translation));
    if (example.pinyin || example.sentence_pinyin) row.insertBefore(el('p', 'example-pinyin', example.pinyin || example.sentence_pinyin), row.lastElementChild);
    if (example.note || example.context) row.append(el('p', 'example-note', example.note || example.context));
    section.append(row);
  }
  panel.append(section);
  const contrasts = bootstrap.contrasts.filter(pair => pair.word_id_a === word.id || pair.word_id_b === word.id);
  if (contrasts.length) {
    const relations = el('section', 'detail-section'); relations.append(el('h3', '', 'Palabras para comparar'));
    for (const contrast of contrasts) {
      relations.append(button(`${contrast.a} / ${contrast.b} · ${contrast.topic}`, () => {
        openContrast(contrast.id);
      }, 'relation-link'));
    }
    panel.append(relations);
  }
  const traditional = word.hanzi_traditional || word.traditional || word.model?.hanzi_traditional;
  const hskReadings = (word.hsk_classification?.reading_assignments || []).map(item => `${item.pinyin}: ${item.level ? 'HSK ' + item.level : 'sin coincidencia'}`).join(' · ');
  panel.append(el('p', 'field-status', `Tradicional: ${traditional || 'sin verificar'} · ${hskReadings || 'HSK: sin clasificar'} · Programa 2025`));
  if (bootstrap.mode === 'private' && !ownerPolicy()) panel.append(el('p', 'small-meta', `ID: ${word.id}. Pronunciación, acepciones y ejemplos pendientes de aprobación. Los campos ausentes no se han completado automáticamente.`));
  panel.append(reports.button({ targetType: 'word', targetId: word.id, title: `${word.zh} · ${reading(word)}`,
    preview: (word.senses || []).map(gloss).join('; ') }));
}

function renderCompare() {
  const fragment = page('Comparar palabras', 'Dos palabras parecidas. Mira cuándo usar cada una.', '辨');
  fragment.querySelector('.page-intro')?.classList.add('comparison-intro');
  if (!bootstrap.contrasts.length) {
    fragment.append(empty('Las primeras comparaciones están en preparación.', 'Aquí aparecerán las diferencias de uso con sus situaciones y ejemplos.'));
    finishPage(fragment); return;
  }
  const workbench = el('section', 'comparison-workbench');
  workbench.setAttribute('aria-label', 'Explorar diferencias entre palabras');
  const picker = el('div', 'comparison-picker');
  const restoredSearch = Boolean(comparisonQuery);
  if (restoredSearch) picker.classList.add('search-open');
  const searchLabel = el('label', 'comparison-search-label'); searchLabel.htmlFor = 'contrastSearch'; searchLabel.id = 'comparisonSearchField';
  searchLabel.append(el('span', '', 'Buscar un par'));
  const search = el('input'); search.id = 'contrastSearch'; search.type = 'search';
  search.autocomplete = 'off'; search.spellcheck = false; search.value = comparisonQuery;
  search.placeholder = 'Caracteres, pinyin o español'; searchLabel.append(search);
  const chooseLabel = el('div', 'comparison-select-label');
  const chooseTitle = el('label', '', 'Comparación'); chooseTitle.htmlFor = 'contrastSelect';
  const chooseMeta = el('span', 'comparison-select-meta');
  const resultCount = el('span', 'comparison-result-count'); resultCount.id = 'comparisonResultCount';
  resultCount.setAttribute('role', 'status');
  const searchToggle = button(restoredSearch ? 'Cerrar búsqueda' : 'Buscar', () => {
    const open = picker.classList.toggle('search-open');
    searchToggle.textContent = open ? 'Cerrar búsqueda' : 'Buscar';
    searchToggle.setAttribute('aria-expanded', String(open));
    if (open) search.focus({ preventScroll: true });
    else { search.value = ''; updatePairs(); searchToggle.focus({ preventScroll: true }); }
  }, 'comparison-search-toggle');
  searchToggle.id = 'comparisonSearchToggle'; searchToggle.setAttribute('aria-expanded', String(restoredSearch));
  searchToggle.setAttribute('aria-controls', 'comparisonSearchField');
  const chooseTools = el('span', 'comparison-select-tools'); chooseTools.append(resultCount, searchToggle);
  chooseMeta.append(chooseTitle, chooseTools);
  const select = el('select'); select.id = 'contrastSelect'; chooseLabel.append(chooseMeta, select);
  picker.append(searchLabel, chooseLabel);
  const detail = el('section', 'comparison-detail'); detail.id = 'contrastDetail';
  workbench.append(picker, detail); fragment.append(workbench); finishPage(fragment);

  const pairTerms = contrast => [contrast.a, contrast.b, contrast.topic, contrast.sense_a,
    contrast.sense_b, contrast.summary, ...['a', 'b'].map(key => reading(bootstrap.words.find(word => word.id === contrast[`word_id_${key}`] || word.zh === contrast[key])))].filter(Boolean).map(norm);
  function updatePairs() {
    comparisonQuery = search.value;
    const query = norm(comparisonQuery);
    const matches = bootstrap.contrasts.filter(contrast => !query || pairTerms(contrast).some(term => term.includes(query)));
    select.replaceChildren(); select.disabled = !matches.length;
    resultCount.textContent = `${matches.length} ${matches.length === 1 ? 'par' : 'pares'}`;
    if (!matches.length) {
      select.append(el('option', '', 'Sin resultados'));
      detail.replaceChildren(empty('No encontramos ese par.', 'Prueba el pinyin, los caracteres o una palabra en español.'));
      return;
    }
    if (!matches.some(contrast => contrast.id === selectedContrast)) {
      selectedContrast = matches[0].id; selectedComparisonExample = null;
    }
    for (const contrast of matches) {
      const option = el('option', '', `${contrast.a} / ${contrast.b} · ${contrast.topic}`);
      option.value = contrast.id; option.selected = contrast.id === selectedContrast; select.append(option);
    }
    showPair();
  }
  function showPair() {
    const contrast = bootstrap.contrasts.find(item => item.id === selectedContrast);
    detail.replaceChildren();
    if (!contrast) return;
    const heading = el('header', 'comparison-head');
    const title = el('h2', 'comparison-title'); title.id = 'contrastTitle'; title.tabIndex = -1;
    for (const key of ['a', 'b']) {
      if (key === 'b') { const divider = el('span', 'comparison-divider', '/'); divider.setAttribute('aria-hidden', 'true'); title.append(divider); }
      const term = el('span', 'comparison-term');
      const word = bootstrap.words.find(item => item.id === contrast[`word_id_${key}`] || item.zh === contrast[key]);
      term.append(zh(contrast[key]), el('span', 'pinyin', reading(word))); title.append(term);
    }
    heading.append(title);
    const summary = contrast.summary || contrast.explanation;
    if (summary) heading.append(el('p', 'comparison-summary', summary));
    detail.append(heading);
    const scenarios = bootstrap.scenarios.filter(item => item.contrast_id === contrast.id);
    const examples = [ ...(contrast.examples || []).map(example => ({ ...example, source: 'original' })),
      ...scenarios.filter(scenario=>!scenario.comparison_example_id).map(scenario => ({ id: scenario.id, label: scenario.label, intent: scenario.intent,
        takeaway: scenario.comparison, source: 'scenario', variants: Object.fromEntries(['a', 'b'].map(key => [key, {
          sentence_zh: scenario.sentence.replace('〔词〕', scenario[key]), translation_es: scenario.translation,
          note: scenario[`note_${key}`], fit: scenario[`fit_${key}`],
          needsCorrection: ['requires_reformulation', 'not_in_context'].includes(scenario[`fit_${key}`]),
        }])) })) ];
    if (examples.length) {
      if (!examples.some(example => example.id === selectedComparisonExample)) selectedComparisonExample = examples[0].id;
      const examplesSection = el('section', 'comparison-examples'); examplesSection.id = 'comparisonExamples';
      examplesSection.setAttribute('aria-label', 'Ejemplos de la diferencia');
      const navigation = el('div', 'comparison-example-navigation');
      const label = el('label', 'comparison-example-label'); label.htmlFor = 'comparisonExampleSelect';
      const position = el('span', 'comparison-example-position'); position.id = 'comparisonExamplePosition';
      const labelLine = el('span', 'comparison-example-meta'); labelLine.append(el('span', '', 'Ejemplos en contexto'), position);
      const caseSelect = el('select'); caseSelect.id = 'comparisonExampleSelect';
      examples.forEach((example, index) => {
        const option = el('option', '', `${index + 1}. ${example.label}`); option.value = example.id;
        option.selected = example.id === selectedComparisonExample; caseSelect.append(option);
      });
      label.append(labelLine, caseSelect);
      const arrows = el('div', 'comparison-example-arrows');
      const previous = button('←', () => stepExample(-1), 'comparison-step'); previous.id = 'comparisonPrevious'; previous.setAttribute('aria-label', 'Ejemplo anterior');
      const next = button('→', () => stepExample(1), 'comparison-step'); next.id = 'comparisonNext'; next.setAttribute('aria-label', 'Ejemplo siguiente');
      arrows.append(previous, next); navigation.append(label, arrows);
      const caseContent = el('div', 'comparison-case'); caseContent.id = 'comparisonCase';
      examplesSection.append(navigation, caseContent); detail.append(examplesSection);
      function stepExample(direction) {
        const index = examples.findIndex(example => example.id === selectedComparisonExample);
        const target = examples[index + direction];
        if (!target) return;
        selectedComparisonExample = target.id; caseSelect.value = target.id; showExample();
        const current = direction < 0 ? previous : next;
        if (current.disabled) (direction < 0 ? next : previous).focus({ preventScroll: true });
        announcer.textContent = `Ejemplo ${index + direction + 1} de ${examples.length}: ${target.label}.`;
      }
      function showExample() {
        const index = examples.findIndex(example => example.id === selectedComparisonExample);
        const example = examples[index];
        position.textContent = `${index + 1} de ${examples.length}`;
        previous.disabled = index === 0; next.disabled = index === examples.length - 1;
        caseContent.replaceChildren(); caseContent.dataset.example = example.id;
        caseContent.append(el('p', 'comparison-intent', example.intent));
        const versions = el('div', 'comparison-versions');
        const noted = new Set([norm(example.takeaway)]);
        for (const key of ['a', 'b']) {
          const variant = example.variants[key];
          const version = el('article', `comparison-version${variant.needsCorrection ? ' comparison-needs-correction' : ''}`);
          version.dataset.variant = key;
          const versionHeading = el('div', 'comparison-version-heading');
          versionHeading.append(zh(contrast[key], 'comparison-word'));
          const fit = variant.needsCorrection ? 'Hay que cambiar la frase' : {
            preferred_in_context: 'Uso habitual', possible_with_nuance: 'También funciona',
            requires_reformulation: 'Con otra construcción', not_in_context: 'No encaja aquí',
          }[variant.fit];
          if (fit) versionHeading.append(el('span', 'comparison-fit', fit));
          version.append(versionHeading);
          if (variant.needsCorrection) {
            version.append(el('p', 'comparison-correction', 'Aquí no basta con sustituir una palabra por la otra.'),
              el('p', 'comparison-version-note', variant.note || 'La estructura necesita una reformulación.'));
          } else {
            const sentence = el('p', 'comparison-sentence'); sentence.lang = 'zh-Hans';
            const value = variant.sentence_zh || '';
            const start = value.indexOf(contrast[key]);
            if (start < 0) sentence.textContent = value;
            else sentence.append(document.createTextNode(value.slice(0, start)), el('strong', 'comparison-target', contrast[key]), document.createTextNode(value.slice(start + contrast[key].length)));
            version.append(sentence, el('p', 'comparison-translation', variant.translation_es || ''));
            const note = norm(variant.note);
            if (variant.note && ![...noted].some(seen => seen && (seen === note || seen.includes(note) || note.includes(seen)))) {
              version.append(el('p', 'comparison-version-note', variant.note)); noted.add(note);
            }
          }
          versions.append(version);
        }
        caseContent.append(versions);
        if (example.takeaway) {
          const takeaway = el('div', 'comparison-takeaway'); takeaway.id = 'comparisonTakeaway';
          takeaway.append(el('span', '', 'Qué cambia'), el('p', '', example.takeaway)); caseContent.append(takeaway);
        }
      }
      caseSelect.addEventListener('change', () => {
        selectedComparisonExample = caseSelect.value; showExample();
        announcer.textContent = `Situación: ${examples.find(example => example.id === caseSelect.value).label}.`;
      });
      showExample();
    } else detail.append(empty('Estamos preparando los ejemplos de este par.', 'Puedes consultar las palabras en el diccionario.'));
    const actions = el('footer', 'comparison-actions');
    const exercises = scenarios.map(scenario=>bootstrap.exercises.find(item=>item.scenario_id===scenario.id)).filter(Boolean);
    if (exercises.length) {
      const practice = button(`Practicar ${exercises.length} situaciones`, () => startPractice(exercises, `lab_${contrast.id}`), 'primary-button');
      practice.dataset.start = 'contrast'; actions.append(practice);
    }
    actions.append(reports.button({ targetType: 'contrast', targetId: contrast.id,
      title: `${contrast.a} / ${contrast.b} · ${contrast.topic}`, preview: summary || contrast.topic })); detail.append(actions);
    if (bootstrap.mode === 'private' && !ownerPolicy()) detail.append(el('p', 'small-meta', 'Comparación editorial pendiente de revisión.'));
  }
  search.addEventListener('input', updatePairs);
  select.addEventListener('change', () => {
    selectedContrast = select.value; selectedComparisonExample = null; showPair();
    announcer.textContent = `Comparación: ${select.selectedOptions[0].textContent}.`;
  });
  updatePairs();
}

function startPractice(exercises, lessonId = null, sessionId = null) {
  if (!exercises.length) return;
  const originalLesson = bootstrap.lessons.find(lesson => lesson.id === lessonId);
  const returnView = view === 'compare' ? 'compare' : view === 'review' ? 'review' : originalLesson || view === 'introduction' ? 'learn' : 'review';
  if (originalLesson) selectedOriginalLesson = lessonId;
  if (!leaveCurrentView()) return;
  const id = sessionId || `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  view = 'practice'; currentSession = id;
  document.body.classList.add('practice-mode');
  window.scrollTo({ top: 0, behavior: 'instant' });
  history.replaceState(null, '', `#practice/${id}`);
  document.title = 'HanYuMatiz · Práctica de matices';
  cleanupPractice = mountPractice(content, { exercises, bootstrap, progress, lessonId, sessionId: id,
    onExploreContrast: openContrast,
    createReportButton: question => reports.button({ targetType: 'exercise', targetId: question.id,
      title: question.title, preview: `${question.context} ${question.sentence.replace('〔词〕', '____')} ${question.explanation}` }),
    onExit: () => showView(returnView, { focus: true }),
    onComplete: () => { announcer.textContent = 'Práctica terminada. Tus respuestas se han guardado en este navegador.'; },
  });
}

function startBank() {
  const ids = new Set(bootstrap.exercises.map(exercise => exercise.scenario_id));
  const history = Object.fromEntries(Object.entries(progress.getState(bootstrap.dataVersion).reviews).filter(([id]) => ids.has(id)));
  const plan = scheduler.schedule(bootstrap.exercises, history, scheduler.isoToday(), { limit: 8, early: true });
  const byId = new Map(bootstrap.exercises.map(exercise => [exercise.id, exercise]));
  const exercises = plan.exercises.map(item => byId.get(item.exercise_id)).filter(Boolean);
  startPractice(exercises, 'lab_bank');
}

function renderReview() {
  const fragment = page('Tu repaso', 'Vuelve a las intenciones que necesitan práctica. El progreso se conserva en este navegador.', '习');
  const state = progress.getState(bootstrap.dataVersion);
  const answers = Object.values(state.answers).flatMap(session => Object.values(session));
  const due = Object.entries(state.reviews).filter(([, entry]) => entry.due_day <= scheduler.isoToday());
  const counts = el('div', 'review-counts');
  const completedLessons = (bootstrap.lessons || []).filter(lesson => state.completedLessons[lesson.id]).length;
  for (const [value, label] of [[answers.length, 'Respuestas guardadas'], [bootstrap.lessons.length ? completedLessons : Object.keys(state.completedLessons).length, bootstrap.lessons.length ? 'Lecciones completadas' : 'Prácticas completadas'], [due.length, 'Intenciones para repasar']]) {
    const item = el('div'); item.append(el('strong', '', String(value)), el('span', '', label)); counts.append(item);
  }
  fragment.append(counts);
  const pending = Object.values(state.sessions).filter(session => !session.ended && session.exerciseIds.some(id => !state.answers[session.id]?.[id]));
  const all = new Map([...bootstrap.fixtures, ...bootstrap.exercises].map(exercise => [exercise.id, exercise]));
  if (pending.length) {
    fragment.append(el('h2', '', 'Continúa donde lo dejaste'));
    const list = el('div', 'review-list');
    for (const session of pending) {
      const exercises = session.exerciseIds.map(id => all.get(id)).filter(Boolean);
      if (exercises.length !== session.exerciseIds.length) continue;
      const row = el('div', 'review-row');
      const copy = el('div'); copy.append(el('strong', '', sessionName(session)),
        el('small', '', `${Object.keys(state.answers[session.id] || {}).length} de ${session.exerciseIds.length} preguntas respondidas`));
      row.append(copy, button('Continuar', () => startPractice(exercises, session.lessonId, session.id)));
      list.append(row);
    }
    fragment.append(list);
  } else fragment.append(empty('Tu siguiente práctica empieza aquí.', 'Después de responder, las intenciones trabajadas aparecerán en el repaso. Completar una actividad no acredita dominio del idioma.'));
  if (bootstrap.exercises.length) {
    const actions = el('div', 'button-row');
    const dueIds = new Set(due.map(([id]) => id));
    const fixtureDescriptors = bootstrap.fixtures.map(fixture => ({ id: fixture.id, scenario_id: fixture.scenario_id,
      kind: 'choice_preference', difficulty: 'intermedio', word_a: fixture.choices[0].zh, word_b: fixture.choices[1].zh }));
    const plan = scheduler.schedule([...bootstrap.exercises, ...fixtureDescriptors], state.reviews, scheduler.isoToday(), { limit: 8 });
    const exercises = plan.exercises.filter(item => dueIds.has(item.scenario_id)).map(item => all.get(item.exercise_id)).filter(Boolean);
    if (exercises.length) actions.append(button('Repasar estas intenciones', () => startPractice(exercises, null), 'primary-button'));
    const bank = button('Practicar otras situaciones', startBank); bank.dataset.start = 'bank'; actions.append(bank); fragment.append(actions);
  }
  const finished = Object.values(state.sessions).filter(session => session.ended).slice(-3).reverse();
  if (finished.length) {
    const completed = el('section', 'completed-practices'); completed.append(el('h2', '', 'Prácticas terminadas'));
    for (const session of finished) {
      const exercises = session.exerciseIds.map(id => all.get(id)).filter(Boolean);
      if (exercises.length !== session.exerciseIds.length) continue;
      const row = el('div', 'review-row'); const copy = el('div');
      copy.append(el('strong', '', sessionName(session)),
        el('small', '', `${session.exerciseIds.length} respuestas guardadas · Vuelve a sus explicaciones`));
      row.append(copy, button('Ver respuestas', () => startPractice(exercises, session.lessonId, session.id)));
      completed.append(row);
    }
    fragment.append(completed);
  }
  const privacy = el('section', 'privacy-note');
  privacy.append(el('p', '', progress.persistent ? 'Guardado local activo. Sin cuentas ni seguimiento externo. El repaso usa intervalos de práctica; todavía no es un sistema de dominio validado.' : 'Este navegador no permite guardar el progreso. Puedes seguir practicando durante esta sesión.'));
  const clear = button('Borrar mi progreso de este navegador', () => {
    if (window.confirm('Se borrarán tus respuestas, sesiones y repasos guardados en este navegador.')) {
      progress.clear(); renderReview(); announcer.textContent = 'Progreso borrado.';
    }
  }, 'text-button'); privacy.append(clear); fragment.append(privacy); finishPage(fragment);
}

function route() {
  const hash = location.hash.slice(1);
  if (hash.startsWith('introduction/')) {
    const [, lessonId, step, resumeId] = hash.split('/');
    const lesson = bootstrap.lessons.find(lesson => lesson.id === lessonId) || hskCustomLessons.get(lessonId);
    if (lesson) { startLessonIntroduction(lesson, step, resumeId || null); return; }
  }
  if (hash.startsWith('practice/')) {
    const session = progress.getSession(hash.slice(9));
    if (session) {
      const all = new Map([...bootstrap.fixtures, ...bootstrap.exercises].map(exercise => [exercise.id, exercise]));
      const exercises = session.exerciseIds.map(id => all.get(id)).filter(Boolean);
      if (exercises.length === session.exerciseIds.length) { startPractice(exercises, session.lessonId, session.id); return; }
    }
  }
  showView(['learn', 'dictionary', 'compare', 'review', 'dictation'].includes(hash) ? hash : 'learn');
}

function sessionName(session) {
  return bootstrap.lessons.find(lesson => lesson.id === session.lessonId)?.title
    || hskCustomLessons.get(session.lessonId)?.title
    || (session.lessonId === 'lab_v9' ? 'Tres situaciones, tres matices' : 'Práctica de matices');
}

document.querySelectorAll('[data-view]').forEach(link => link.addEventListener('click', event => {
  event.preventDefault(); if (bootstrap) showView(link.dataset.view, { focus: true });
}));
document.querySelector('.brand').addEventListener('click', event => { event.preventDefault(); if (bootstrap) showView('learn', { focus: true }); });
window.addEventListener('hashchange', () => { if (bootstrap) route(); });
const about = document.querySelector('#about');
document.querySelector('#aboutButton').addEventListener('click', () => about.showModal());
document.querySelector('#closeAbout').addEventListener('click', () => about.close());

try {
  const response = await fetch('/api/bootstrap', { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) throw new Error('No se pudo cargar el banco autorizado.');
  bootstrap = await response.json();
  bootstrap.fixtures ||= []; bootstrap.examples ||= []; bootstrap.relations ||= []; bootstrap.lessons ||= [];
  bootstrap.words ||= []; bootstrap.contrasts ||= []; bootstrap.scenarios ||= []; bootstrap.exercises ||= []; bootstrap.levels ||= [];
  restoreHskSelection();
  reports = mountReports({ bootstrap });
  wordIndex = bootstrap.words.map(word => ({ word, terms: [word.zh, word.hanzi_traditional,
    ...(word.readings || []).map(item => item.pinyin), ...(word.senses || []).map(gloss)].filter(Boolean).map(norm) }));
  document.querySelector('#environment').textContent = bootstrap.delivery === 'standalone' ? 'Vista local' : bootstrap.mode === 'private' ? 'Edición de prueba' : 'Versión pública';
  document.querySelector('#aboutStatus').textContent = ownerPolicy()
    ? 'Las nuevas lecciones y ejemplos son originales, preparados para enseñar diferencias de uso. La revisión externa es opcional. Puedes reportar un error de matiz; el propietario evalúa los comentarios en privado y corrige el contenido.' : bootstrap.mode === 'private' ?
    'Este entorno tiene acceso restringido. El banco conserva los expedientes auditados P1–P12; los borradores siguen pendientes de revisión humana.' :
    'Esta versión muestra únicamente contenido habilitado por los controles editoriales. Las lecciones pendientes no están disponibles todavía.';
  route();
} catch (error) {
  content.replaceChildren(empty('No pudimos abrir HanYuMatiz.', 'Comprueba que has iniciado el servidor y que tu acceso al entorno privado está autorizado.'));
  document.querySelector('#environment').textContent = 'Sin conexión con el servidor';
}

Object.defineProperty(window, 'HanYuPlatform', { value: Object.freeze({ inspect: () => ({
  view, selectedLevel: progress.getState().selectedLevel, selectedUnit, selectedLesson, selectedOriginalLesson,
  progress: progress.getState(), mode: bootstrap?.mode, sessionId: currentSession,
}) }) });

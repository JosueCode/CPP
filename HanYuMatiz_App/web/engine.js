/** Normalize existing editorial exercises without changing their answer keys.
 * A mismatch is about the requested intention, not a blanket grammar verdict.
 */
export const EXERCISE_KINDS = Object.freeze([
  'choice_preference', 'choice_structure', 'both_acceptable', 'recognize_validity',
]);

const text = value => typeof value === 'string' ? value : '';
const plain = value => text(value).replace(/<[^>]*>/g, '').trim();
const list = value => Array.isArray(value) ? value : [];

function readingFor(word, words) {
  const entry = words.find(item => item.zh === word || item.simplified === word);
  return text(entry?.readings?.[0]?.pinyin || entry?.pinyin);
}

function tokens(value) {
  if (!Array.isArray(value)) return undefined;
  return value.filter(item => Array.isArray(item) && typeof item[0] === 'string')
    .map(item => [item[0], text(item[1])]);
}

function teachingNotes(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = Object.fromEntries(['goal', 'answer', 'alternative', 'rule_of_thumb']
    .map(key => [key, plain(value[key])]).filter(([, content]) => content));
  if (value.example && typeof value.example === 'object') {
    const sentence = plain(value.example.sentence_zh);
    const translation = plain(value.example.translation_es);
    if (sentence && translation) result.example = { sentence_zh: sentence, translation_es: translation };
  }
  return Object.keys(result).length ? result : null;
}

export function normalizeExercise(raw, bootstrap = {}) {
  if (!raw || typeof raw !== 'object' || !text(raw.id)) return null;
  const words = list(bootstrap.words);
  const fixture = Array.isArray(raw.choices) && Number.isInteger(raw.correct);
  const kind = fixture ? 'choice_preference' : (raw.kind || 'choice_preference');
  if (!EXERCISE_KINDS.includes(kind)) return null;
  const scenarioId = text(raw.scenarioId || raw.scenario_id || raw.id);
  const scenario = list(bootstrap.scenarios).find(item => item.id === scenarioId);
  const sentence = fixture ? `${text(raw.before)}〔词〕${text(raw.after)}`
    : text(raw.sentence || raw.template_zh || scenario?.sentence);
  // A fixture keeps its own progress ID. Borrow only the documented fit from
  // its explicit source link when both the intention and phrase still match.
  // Translation and explanation remain the fixture's original V9 text.
  const related = fixture && text(raw.related_scenario_id || raw.sourceScenarioId)
    ? list(bootstrap.scenarios).find(item => item.id === (raw.related_scenario_id || raw.sourceScenarioId)) : null;
  const fitScenario = scenario || (related && sentence === related.sentence
    && plain(raw.context) === plain(related.intent) ? related : null);
  const optionSource = fixture ? raw.choices : list(raw.options);
  const options = optionSource.map((option, index) => {
    const key = text(option.key) || (index === 0 ? 'a' : index === 1 ? 'b' : `option_${index}`);
    const word = option.word !== undefined ? option.word
      : fixture ? option.zh
      : key === 'a' ? raw.word_a || scenario?.a
      : key === 'b' ? raw.word_b || scenario?.b
      : null;
    const sourceFit = fitScenario && word === fitScenario.a ? fitScenario.fit_a
      : fitScenario && word === fitScenario.b ? fitScenario.fit_b : '';
    const fit = text(option.fit || sourceFit);
    return {
      key,
      label: text(option.label || option.zh),
      word: typeof word === 'string' ? word : null,
      pinyin: text(option.pinyin || option.py) || readingFor(word, words),
      fit,
      note: plain(option.note || (fitScenario && word === fitScenario.a ? fitScenario.note_a
        : fitScenario && word === fitScenario.b ? fitScenario.note_b : '')),
      validity: fit === 'preferred_in_context' || fit === 'possible_with_nuance'
        ? 'valid_in_context' : fit === 'requires_reformulation' ? 'requires_reformulation' : 'unreviewed',
    };
  });
  const answerKey = fixture ? options[raw.correct]?.key : text(raw.answerKey || raw.answer_key);
  if (options.length < 2 || options.length > 8 || options.some(option => !option.label)
      || new Set(options.map(option => option.key)).size !== options.length
      || !options.some(option => option.key === answerKey) || !sentence.includes('〔词〕')) return null;
  const prompt = text(raw.prompt || raw.prompt_es) || 'Elige la palabra que expresa esta intención.';
  const contrast = list(bootstrap.contrasts).find(item => item.id === fitScenario?.contrast_id)
    || list(bootstrap.contrasts).find(item => item.a === options[0]?.word && item.b === options[1]?.word);
  const currentSentences = options.filter(option=>option.word).map(option=>sentence.replace('〔词〕',option.word));
  const relatedExample = list(contrast?.examples).find(example => example.variants?.a && example.variants?.b
    && example.id !== scenario?.comparison_example_id
    && !['a','b'].some(key=>currentSentences.includes(example.variants[key].sentence_zh))) || null;
  return {
    id: raw.id,
    scenarioId,
    title: text(raw.title || scenario?.label) || 'Una situación, dos matices',
    prompt,
    objective: text(raw.objective) || prompt,
    context: plain(raw.context || raw.intent_es || scenario?.intent),
    sentence,
    translation: text(raw.translation || scenario?.translation),
    options,
    answerKey,
    explanation: text(raw.explanation || raw.explanation_es || raw.explain),
    teachingNotes: teachingNotes(raw.teaching_notes) || teachingNotes(raw.feedback_lesson)
      || teachingNotes(scenario?.teaching_notes) || teachingNotes(scenario?.feedback_lesson),
    comparison: plain(raw.comparison || scenario?.comparison),
    contrastId: contrast?.id || null,
    relatedExample,
    kind,
    status: raw.status === 'approved' ? 'approved' : 'draft',
    beforeTokens: tokens(raw.beforeTokens || raw.annotated?.before),
    afterTokens: tokens(raw.afterTokens || raw.annotated?.after),
  };
}

export function feedbackFor(exercise, selected) {
  const option = exercise.options.find(item => item.key === selected);
  if (!option) return null;
  // A word that completes an open sentence correctly earns credit. The older
  // recognise-validity tasks still ask learners to identify every valid option.
  const acceptedWord = exercise.kind === 'both_acceptable' && exercise.answerKey === 'both'
    && option.validity === 'valid_in_context';
  const correct = selected === exercise.answerKey || acceptedWord;
  const validityScope = !correct && exercise.answerKey === 'both' && option.validity === 'valid_in_context';
  const nuance = !correct && option.fit === 'possible_with_nuance';
  const wordOptions = exercise.options.filter(item => item.word);
  const target = exercise.options.find(item => item.key === exercise.answerKey);
  const targetLabel = exercise.answerKey === 'both'
    ? wordOptions.map(item => item.word).join(' y ') : target?.word || target?.label;
  const selectedLabel = option.word || option.label;
  const other = wordOptions.find(item => item.key !== option.key);
  const notes = exercise.teachingNotes;
  const goal = notes?.goal || exercise.context || exercise.objective;
  // The verdict answers this exercise. A grammatical phrase can still fail a
  // question about a specific intention; explain that distinction after making
  // the grading explicit, never by presenting the failed answer as an achievement.
  const lead = correct
    ? exercise.answerKey === 'both'
      ? `${option.word ? `${selectedLabel} es una respuesta correcta.` : 'Tu respuesta es correcta.'} En esta frase puedes usar ${targetLabel}.`
      : `Elegiste ${selectedLabel}: es la respuesta que pide este ejercicio.`
    : validityScope
      ? `Elegiste ${selectedLabel}. La pregunta pide reconocer todas las opciones que funcionan: ${targetLabel}.`
      : `Elegiste ${selectedLabel}. En este ejercicio, la respuesta es ${targetLabel}.`;
  const scope = correct ? '' : validityScope
    ? 'Responder con una sola palabra no contesta la pregunta completa: aquí se piden las dos opciones que encajan.'
    : option.fit === 'requires_reformulation'
      ? 'La respuesta debe completar la frase tal como está escrita. La palabra que elegiste necesitaría otra construcción.'
      : nuance
        ? `La pregunta pide una intención o preferencia concreta. ${selectedLabel} no es la respuesta a esa petición; eso no significa que la palabra sea incorrecta en cualquier frase.`
        : 'La opción que elegiste no responde a lo que pide esta pregunta.';
  const answer = notes?.answer || target?.note || exercise.comparison || plain(exercise.explanation);
  const alternative = notes?.alternative || (exercise.answerKey === 'both'
    ? other?.note : wordOptions.find(item => item.key !== exercise.answerKey)?.note);
  const paragraphs = [];
  const seen = new Set();
  const add = (label, content) => {
    if (!content || seen.has(content)) return;
    seen.add(content); paragraphs.push({ label, text: content });
  };
  if (!correct) add('Por qué esta respuesta', notes?.answer && !validityScope
    ? notes.answer : [scope, answer].filter(Boolean).join(' '));
  add('Lo que pide la frase', goal);
  if (correct) add('Por qué esta respuesta', answer);
  add('La otra palabra', alternative);
  add('Para recordarlo', notes?.rule_of_thumb);
  const example = notes?.example || (target?.word && exercise.translation ? {
    sentence_zh: exercise.sentence.replace('〔词〕', target.word),
    translation_es: exercise.translation,
  } : exercise.answerKey === 'both' && option.word && exercise.translation ? {
    sentence_zh: exercise.sentence.replace('〔词〕', option.word),
    translation_es: exercise.translation,
  } : null);
  return {
    correct,
    type: correct ? 'target' : validityScope ? 'validity_scope' : nuance ? 'different_nuance' : 'review',
    tone: correct ? 'correct' : 'wrong',
    icon: correct ? '✓' : '×',
    title: correct ? 'Respuesta correcta' : 'Respuesta incorrecta',
    lead,
    paragraphs,
    example,
    explanation: exercise.explanation,
  };
}

export function makeSession(exercises, previous = {}) {
  const exerciseIds = list(exercises).map(exercise => typeof exercise === 'string' ? exercise : exercise.id);
  if (!exerciseIds.length || exerciseIds.some(id => !text(id)) || new Set(exerciseIds).size !== exerciseIds.length) {
    throw new TypeError('Una sesión necesita ejercicios con identificadores únicos.');
  }
  if (previous.dataVersion !== undefined && !/^[a-f0-9]{64}$/.test(previous.dataVersion)) {
    throw new TypeError('La versión del contenido debe ser un SHA256 canónico.');
  }
  const id = text(previous.id) || `session_${globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
  return {
    id,
    lessonId: text(previous.lessonId) || null,
    exerciseIds,
    currentIndex: Number.isInteger(previous.currentIndex) && previous.currentIndex >= 0
      && previous.currentIndex < exerciseIds.length ? previous.currentIndex : 0,
    showPinyin: previous.showPinyin === true,
    showTranslation: previous.showTranslation === true,
    ended: previous.ended === true,
    ...(previous.dataVersion === undefined ? {} : { dataVersion: previous.dataVersion }),
    selections: previous.selections && typeof previous.selections === 'object' && !Array.isArray(previous.selections)
      ? Object.fromEntries(Object.entries(previous.selections).filter(([key, value]) => exerciseIds.includes(key) && typeof value === 'string')) : {},
  };
}

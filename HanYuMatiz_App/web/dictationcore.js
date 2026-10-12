/** Pure dictation processing. All positions are one-based Unicode code-point
 * positions in the NFC text, including any spaces/punctuation ignored in grading.
 * Returned text is data, never HTML. Original user strings remain available.
 */
export const DICTATION_LIMITS = Object.freeze({
  maxCharacters: 20_000,
  maxSentences: 100,
  maxSentenceCharacters: 500,
});

const han = /\p{Script=Han}/u;
const whitespace = /\s|\p{White_Space}/u;
const punctuation = /\p{P}/u;
const terminal = /[。！？!?…]/u;
const closing = new Set(Array.from('”’"\'』」）》】〕〉»)]}'));
const codePoints = text => Array.from(text);

function requireText(value, name) {
  if (typeof value !== 'string') throw new TypeError(`${name} debe ser un texto.`);
  return value;
}

/** Chinese full stops, questions/exclamations, ellipses and line breaks end
 * phrases. Commas and decimal points do not. Closing quotes stay with a phrase.
 * We preserve internal spaces and punctuation rather than rewrite the source.
 */
export function segmentText(text) {
  const characters = codePoints(requireText(text, 'El contenido'));
  const sentences = [];
  let current = [];
  let boundary = false;
  const flush = () => {
    const sentence = current.join('').trim();
    if (sentence) sentences.push(sentence);
    current = [];
    boundary = false;
  };
  for (let index = 0; index < characters.length; index++) {
    const character = characters[index];
    if (character === '\n' || character === '\r' || character === '\u2028' || character === '\u2029') {
      flush();
      continue;
    }
    const asciiEllipsis = character === '.' && characters[index + 1] === '.' && characters[index + 2] === '.';
    const ellipsisContinuation = boundary && character === '.' && current.at(-1) === '.';
    if (boundary && !terminal.test(character) && !closing.has(character)
        && !whitespace.test(character) && !ellipsisContinuation && !asciiEllipsis) flush();
    current.push(character);
    if (terminal.test(character) || asciiEllipsis) boundary = true;
  }
  flush();
  return sentences;
}

function validateSentenceList(sentences, characterCount) {
  const errors = [];
  const chineseCharacterCount = sentences.reduce((sum, sentence) =>
    sum + codePoints(sentence).filter(character => han.test(character)).length, 0);
  if (!sentences.length) errors.push('Pega un texto en chino antes de preparar el dictado.');
  else if (!chineseCharacterCount) errors.push('El texto debe contener al menos un carácter chino.');
  if (characterCount > DICTATION_LIMITS.maxCharacters) {
    errors.push(`El texto supera el límite de ${DICTATION_LIMITS.maxCharacters.toLocaleString('es')} caracteres.`);
  }
  if (sentences.length > DICTATION_LIMITS.maxSentences) {
    errors.push(`El dictado admite como máximo ${DICTATION_LIMITS.maxSentences} frases. Une algunas frases o acorta el texto.`);
  }
  sentences.forEach((sentence, index) => {
    if (codePoints(sentence).length > DICTATION_LIMITS.maxSentenceCharacters
        || codePoints(sentence.normalize('NFC')).length > DICTATION_LIMITS.maxSentenceCharacters) {
      errors.push(`La frase ${index + 1} supera los ${DICTATION_LIMITS.maxSentenceCharacters} caracteres. Divídela antes de empezar.`);
    }
    if (!codePoints(sentence).some(character => !whitespace.test(character) && !punctuation.test(character))) {
      errors.push(`La frase ${index + 1} contiene solamente puntuación. Únela con otra frase o elimínala.`);
    }
  });
  return { ok: !errors.length, errors, characterCount, chineseCharacterCount,
    sentences, sentenceCount: sentences.length };
}

/** Validation of an imported text. Large input is rejected before segmentation. */
export function validateInput(text) {
  if (typeof text !== 'string') return { ok: false, errors: ['El contenido debe ser un texto.'],
    characterCount: 0, chineseCharacterCount: 0, sentences: [], sentenceCount: 0 };
  const characters = codePoints(text);
  if (characters.length > DICTATION_LIMITS.maxCharacters) return {
    ok: false, errors: [`El texto supera el límite de ${DICTATION_LIMITS.maxCharacters.toLocaleString('es')} caracteres.`],
    characterCount: characters.length,
    chineseCharacterCount: characters.filter(character => han.test(character)).length,
    sentences: [], sentenceCount: 0,
  };
  return validateSentenceList(segmentText(text), characters.length);
}

/** Validates the exact manually edited phrases without segmenting them again. */
export function validateSentences(sentences) {
  if (!Array.isArray(sentences) || sentences.some(sentence => typeof sentence !== 'string')) {
    return { ok: false, errors: ['Las frases deben ser una lista de textos.'], characterCount: 0,
      chineseCharacterCount: 0, sentences: [], sentenceCount: 0 };
  }
  const prepared = sentences.map(sentence => sentence.trim());
  return validateSentenceList(prepared, prepared.reduce((sum, sentence) => sum + codePoints(sentence).length, 0));
}

export function splitSentence(sentences, index, codePointOffset) {
  if (!Array.isArray(sentences) || !Number.isInteger(index) || index < 0 || index >= sentences.length) {
    throw new RangeError('Selecciona una frase para dividirla.');
  }
  const characters = codePoints(requireText(sentences[index], 'La frase'));
  if (!Number.isInteger(codePointOffset) || codePointOffset <= 0 || codePointOffset >= characters.length) {
    throw new RangeError('Coloca el cursor dentro de la frase para dividirla.');
  }
  const before = characters.slice(0, codePointOffset).join('').trim();
  const after = characters.slice(codePointOffset).join('').trim();
  if (!before || !after) throw new RangeError('Las dos partes deben contener texto.');
  const result = [...sentences.slice(0, index), before, after, ...sentences.slice(index + 1)];
  if (result.length > DICTATION_LIMITS.maxSentences) throw new RangeError(`El límite es de ${DICTATION_LIMITS.maxSentences} frases.`);
  return result;
}

export function mergeSentences(sentences, index) {
  if (!Array.isArray(sentences) || !Number.isInteger(index) || index < 0 || index + 1 >= sentences.length) {
    throw new RangeError('Selecciona una frase que tenga otra después para unirlas.');
  }
  const merged = requireText(sentences[index], 'La frase').trim()
    + requireText(sentences[index + 1], 'La frase siguiente').trim();
  if (codePoints(merged).length > DICTATION_LIMITS.maxSentenceCharacters
      || codePoints(merged.normalize('NFC')).length > DICTATION_LIMITS.maxSentenceCharacters) {
    throw new RangeError(`Una frase no puede superar ${DICTATION_LIMITS.maxSentenceCharacters} caracteres.`);
  }
  return [...sentences.slice(0, index), merged, ...sentences.slice(index + 2)];
}

function evaluatedTokens(text, evaluatePunctuation) {
  return codePoints(text).map((character, index) => ({ character, position: index + 1 }))
    .filter(token => !whitespace.test(token.character) && (evaluatePunctuation || !punctuation.test(token.character)));
}

function visualRuns(text, operations, side) {
  const positionField = side === 'original' ? 'originalPosition' : 'answerPosition';
  const kinds = new Map(operations.filter(operation => operation[positionField] !== null)
    .map(operation => [operation[positionField], operation.kind]));
  const runs = [];
  codePoints(text).forEach((character, index) => {
    const position = index + 1;
    const kind = kinds.get(position) || 'ignored';
    const previous = runs.at(-1);
    if (previous?.kind === kind) { previous.text += character; previous.endPosition = position; }
    else runs.push({ kind, text: character, startPosition: position, endPosition: position });
  });
  return runs;
}

const percentage = (matches, errors) => matches + errors ? Math.round(matches * 1000 / (matches + errors)) / 10 : 0;

/** Levenshtein alignment with an additional maximum-matches tie break. It
 * recognises omitted/extra characters without shifting the following text.
 * A insertion or omission is one error; a substitution is one error as well.
 * The score is matches / (matches + substitutions + deletions + insertions).
 */
export function compareSentence(original, answer, { evaluatePunctuation = false } = {}) {
  requireText(original, 'La frase original');
  requireText(answer, 'La respuesta');
  if (codePoints(original).length > DICTATION_LIMITS.maxSentenceCharacters
      || codePoints(answer).length > DICTATION_LIMITS.maxSentenceCharacters) {
    throw new RangeError(`Cada frase y respuesta admite hasta ${DICTATION_LIMITS.maxSentenceCharacters} caracteres.`);
  }
  const normalizedOriginal = original.normalize('NFC');
  const normalizedAnswer = answer.normalize('NFC');
  evaluatePunctuation = evaluatePunctuation === true;
  const originalLength = codePoints(normalizedOriginal).length;
  const answerLength = codePoints(normalizedAnswer).length;
  if (originalLength > DICTATION_LIMITS.maxSentenceCharacters || answerLength > DICTATION_LIMITS.maxSentenceCharacters) {
    throw new RangeError(`Cada frase y respuesta admite hasta ${DICTATION_LIMITS.maxSentenceCharacters} caracteres tras normalizar Unicode.`);
  }
  const expected = evaluatedTokens(normalizedOriginal, evaluatePunctuation);
  const written = evaluatedTokens(normalizedAnswer, evaluatePunctuation);
  const width = written.length + 1;
  const size = (expected.length + 1) * width;
  const costs = new Uint16Array(size);
  const matchesAt = new Uint16Array(size);
  const paths = new Uint8Array(size); // 1 equal/substitute; 2 delete; 3 insert.
  for (let row = 1; row <= expected.length; row++) {
    costs[row * width] = row; paths[row * width] = 2;
  }
  for (let column = 1; column <= written.length; column++) {
    costs[column] = column; paths[column] = 3;
  }
  for (let row = 1; row <= expected.length; row++) {
    for (let column = 1; column <= written.length; column++) {
      const cell = row * width + column;
      const diagonal = cell - width - 1;
      const equal = expected[row - 1].character === written[column - 1].character;
      let cost = costs[diagonal] + (equal ? 0 : 1);
      let matches = matchesAt[diagonal] + (equal ? 1 : 0);
      let path = 1;
      const deletionCost = costs[cell - width] + 1;
      const deletionMatches = matchesAt[cell - width];
      if (deletionCost < cost || deletionCost === cost && deletionMatches > matches) {
        cost = deletionCost; matches = deletionMatches; path = 2;
      }
      const insertionCost = costs[cell - 1] + 1;
      const insertionMatches = matchesAt[cell - 1];
      if (insertionCost < cost || insertionCost === cost && insertionMatches > matches) {
        cost = insertionCost; matches = insertionMatches; path = 3;
      }
      costs[cell] = cost; matchesAt[cell] = matches; paths[cell] = path;
    }
  }
  const operations = [];
  let row = expected.length;
  let column = written.length;
  while (row || column) {
    const path = paths[row * width + column];
    const a = path !== 3 ? expected[row - 1] : null;
    const b = path !== 2 ? written[column - 1] : null;
    const kind = path === 2 ? 'deletion' : path === 3 ? 'insertion'
      : a.character === b.character ? 'equal' : 'substitution';
    operations.push({ kind, expected: a?.character || '', written: b?.character || '',
      originalPosition: a?.position || null, answerPosition: b?.position || null,
      originalAnchorPosition: a?.position || expected[row]?.position || originalLength + 1,
      answerAnchorPosition: b?.position || written[column]?.position || answerLength + 1 });
    if (path !== 3) row--;
    if (path !== 2) column--;
  }
  operations.reverse();
  const count = kind => operations.filter(operation => operation.kind === kind).length;
  const matches = count('equal');
  const substitutions = count('substitution');
  const deletions = count('deletion');
  const insertions = count('insertion');
  const errorCount = substitutions + deletions + insertions;
  const status = !written.length ? 'unanswered' : errorCount ? 'incorrect' : 'correct';
  return { status, accuracy: percentage(matches, errorCount), original, answer,
    normalizedOriginal, normalizedAnswer, evaluatePunctuation: evaluatePunctuation === true,
    originalCharacters: expected.length, answerCharacters: written.length,
    matches, substitutions, deletions, insertions, errorCount, operations,
    differences: operations.filter(operation => operation.kind !== 'equal'),
    originalRuns: visualRuns(normalizedOriginal, operations, 'original'),
    answerRuns: visualRuns(normalizedAnswer, operations, 'answer') };
}

/** Aggregate character counts, not a mean of percentages for unequal phrases.
 * Unanswered phrases are separate from incorrect phrases but their omitted
 * original characters contribute to the final score and error counts.
 */
export function aggregateResults(comparisons) {
  if (!Array.isArray(comparisons)) throw new TypeError('Los resultados deben ser una lista.');
  const summary = { sentencesTotal: comparisons.length, correctSentences: 0, incorrectSentences: 0,
    unansweredSentences: 0, evaluatedCharacters: 0, correctCharacters: 0,
    substitutions: 0, deletions: 0, insertions: 0, errorCount: 0, accuracy: 0 };
  for (const comparison of comparisons) {
    if (!comparison || !['correct', 'incorrect', 'unanswered'].includes(comparison.status)
        || ['originalCharacters', 'matches', 'substitutions', 'deletions', 'insertions'].some(key =>
          !Number.isSafeInteger(comparison[key]) || comparison[key] < 0)
        || comparison.originalCharacters !== comparison.matches + comparison.substitutions + comparison.deletions) {
      throw new TypeError('Un resultado de dictado no contiene métricas válidas.');
    }
    if (comparison.status === 'correct') summary.correctSentences++;
    else if (comparison.status === 'incorrect') summary.incorrectSentences++;
    else summary.unansweredSentences++;
    summary.evaluatedCharacters += comparison.originalCharacters;
    summary.correctCharacters += comparison.matches;
    summary.substitutions += comparison.substitutions;
    summary.deletions += comparison.deletions;
    summary.insertions += comparison.insertions;
  }
  summary.errorCount = summary.substitutions + summary.deletions + summary.insertions;
  summary.accuracy = percentage(summary.correctCharacters, summary.errorCount);
  return summary;
}

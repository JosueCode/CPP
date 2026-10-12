/** Versioned HSK vocabulary selection. No levels inferred from frequency.
 * This is a named secondary transcription of the 2025-11 syllabus, not a
 * direct verification of the official PDF or a claim of full course coverage.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HSK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/hsk');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const readJSON = name => JSON.parse(fs.readFileSync(path.join(HSK_ROOT, name), 'utf8'));

export function normalizeHSKPinyin(pinyin) {
  // Keep all tones and ü; removing tone marks would conflate distinct readings.
  return String(pinyin).normalize('NFC').toLowerCase().replace(/[\s'’·]/gu, '');
}

export function buildHSKReference() {
  const metadata = readJSON('reference.json');
  const entriesByNumber = new Map();
  for (const source of metadata.sources) {
    const bytes = fs.readFileSync(path.join(HSK_ROOT, source.file));
    if (sha256(bytes) !== source.sha256 || bytes.length !== source.bytes)
      throw Error('Ha cambiado la fuente HSK conservada: ' + source.file);
    const lines = bytes.toString('utf8').split(/\r?\n/u);
    for (const [offset, line] of lines.entries()) {
      if (!/^\d+\t/u.test(line)) continue;
      const [numberText, notation, spelling, pinyin, pos = ''] = line.split('\t');
      const number = Number(numberText), level = Number(notation[0]);
      if (!Number.isInteger(number) || !Number.isInteger(level) || level < 1 || level > 6
        || !spelling || !pinyin) throw Error('Fila HSK inválida: ' + source.file + ':' + (offset + 1));
      const additionalSenseLevels = [...notation.matchAll(/（(\d+)）/gu)]
        .map(match => Number(match[1])).filter(value => value >= 1 && value <= 6);
      const entry = {
        id: 'hsk2025_' + number, number, level,
        zh: spelling.replace(/\d+$/u, ''), sourceSpelling: spelling, pinyin,
        pos, levelNotation: notation, additionalSenseLevels,
        sourceId: source.id, sourceLine: offset + 1,
      };
      const previous = entriesByNumber.get(number);
      if (previous) {
        for (const key of ['level', 'sourceSpelling', 'pinyin', 'pos', 'levelNotation'])
          if (previous[key] !== entry[key]) throw Error('Transcripciones HSK discrepantes: ' + number);
      } else entriesByNumber.set(number, entry);
    }
  }
  if (entriesByNumber.size !== metadata.expectedTotalEntries)
    throw Error('Recuento HSK incompleto: ' + entriesByNumber.size);
  const entries = [...entriesByNumber.values()].sort((a, b) => a.number - b.number);
  for (let number = 1; number <= metadata.expectedTotalEntries; number++)
    if (!entriesByNumber.has(number)) throw Error('Falta la entrada HSK: ' + number);
  const levels = Array.from({ length: 6 }, (_, offset) => {
    const level = offset + 1, matching = entries.filter(entry => entry.level === level);
    if (matching.length !== metadata.expectedEntriesByLevel[String(level)])
      throw Error('Recuento HSK incorrecto para nivel ' + level);
    return { level, entryCount: matching.length,
      cumulativeEntryCount: metadata.expectedCumulativeEntriesByLevel[String(level)],
      entryIds: matching.map(entry => entry.id) };
  });
  return { ...metadata, entries, levels,
    uniqueSpellings: new Set(entries.map(entry => entry.zh)).size };
}

function entryEvidence(reference, entry) {
  const source = reference.sources.find(source => source.id === entry.sourceId);
  return {
    standard_id: reference.standardKey, source_id: source.id,
    source_uri: source.upstreamUrl + '#L' + entry.sourceLine,
    source_sha256: source.sha256, source_line: entry.sourceLine,
    entry_id: entry.id, entry_number: entry.number,
    pinyin: entry.pinyin, level: entry.level,
    additional_sense_levels: [...entry.additionalSenseLevels],
    evidence_type: 'versioned_secondary_transcription',
    official_direct_verified: false,
  };
}

export function enrichCatalogHSK(catalog) {
  if (!Array.isArray(catalog.words) || !Array.isArray(catalog.contrasts)
    || !Array.isArray(catalog.exercises)) throw Error('Catálogo HSK inválido');
  const reference = buildHSKReference();
  if (catalog.standard?.id && catalog.standard.id !== reference.standardKey)
    throw Error('La selección HSK no coincide con la edición del catálogo');
  const byHanzi = new Map();
  for (const entry of reference.entries) {
    if (!byHanzi.has(entry.zh)) byHanzi.set(entry.zh, []);
    byHanzi.get(entry.zh).push(entry);
  }
  const entryBindings = new Map(reference.entries.map(entry => [entry.id, []]));
  const wordById = new Map(catalog.words.map(word => [word.id, word]));
  for (const word of catalog.words) {
    const candidates = byHanzi.get(word.zh) || [];
    const assignments = [];
    for (const reading of word.readings || []) {
      const normalized = normalizeHSKPinyin(reading.pinyin_marked || reading.pinyin);
      const matches = candidates.filter(entry => entry.pinyin.split('/')
        .some(variant => normalizeHSKPinyin(variant) === normalized));
      const evidence = matches.map(entry => entryEvidence(reference, entry));
      const levels = [...new Set(matches.map(entry => entry.level))].sort((a, b) => a - b);
      const assignment = {
        pronunciation_id: reading.id, pinyin: reading.pinyin_marked || reading.pinyin,
        level: levels[0] ?? null, levels, entry_ids: matches.map(entry => entry.id),
        status: matches.length ? 'matched_secondary_reference'
          : candidates.length ? 'reading_mismatch' : 'no_match', evidence,
      };
      assignments.push(assignment);
      for (const entry of matches) entryBindings.get(entry.id).push({
        word_id: word.id, pronunciation_id: reading.id,
      });
    }
    const matched = assignments.filter(assignment => assignment.level !== null);
    const levels = [...new Set(matched.flatMap(assignment => assignment.levels))].sort((a, b) => a - b);
    word.hsk_level = levels[0] ?? null;
    word.hsk_classification = {
      level: word.hsk_level, levels,
      standard_id: reference.standardKey, edition: reference.edition,
      status: matched.length ? 'matched_secondary_reference'
        : candidates.length ? 'reading_mismatch' : 'no_match',
      official_direct_verified: false,
      reading_assignments: assignments,
      evidence: matched.flatMap(assignment => assignment.evidence),
      unmatched_candidates: matched.length ? [] : candidates.map(entry => ({
        entry_id: entry.id, pinyin: entry.pinyin, level: entry.level,
        evidence: entryEvidence(reference, entry),
      })),
    };
  }
  const scenarioById = new Map((catalog.scenarios || []).map(scene => [scene.id, scene]));
  const levels = reference.levels.map(levelData => {
    const bindings = levelData.entryIds.flatMap(id => entryBindings.get(id));
    const wordIds = [...new Set(bindings.map(binding => binding.word_id))];
    const pronunciationIds = [...new Set(bindings.map(binding => binding.pronunciation_id))];
    const wordSet = new Set(wordIds);
    // A pair can teach one selected HSK word alongside an explicitly different
    // level or unclassified partner. This does not relabel the entire lesson.
    const contrasts = catalog.contrasts.filter(pair => wordSet.has(pair.word_id_a) || wordSet.has(pair.word_id_b));
    const contrastSet = new Set(contrasts.map(pair => pair.id));
    const exerciseIds = catalog.exercises.filter(exercise =>
      contrastSet.has(scenarioById.get(exercise.scenario_id)?.contrast_id)).map(exercise => exercise.id);
    const entryIdsWithCards = levelData.entryIds.filter(id => entryBindings.get(id).length);
    const practiceWordIds = wordIds.filter(id => contrasts.some(pair => pair.word_id_a === id || pair.word_id_b === id));
    return {
      ...levelData, availableEntryCount: entryIdsWithCards.length,
      availableWordCount: wordIds.length, availablePracticeWordCount: practiceWordIds.length,
      availableEntryIds: entryIdsWithCards, wordIds, pronunciationIds, practiceWordIds,
      contrastIds: contrasts.map(pair => pair.id), exerciseIds,
      lessonIds: (catalog.lessons || []).filter(lesson => lesson.wordIds.some(id => wordSet.has(id))).map(lesson => lesson.id),
    };
  });
  const entries = reference.entries.map(entry => ({
    ...entry,
    wordIds: [...new Set(entryBindings.get(entry.id).map(binding => binding.word_id))],
    pronunciationIds: [...new Set(entryBindings.get(entry.id).map(binding => binding.pronunciation_id))],
    hasCard: entryBindings.get(entry.id).length > 0,
  }));
  const wordsWithEvidence = catalog.words.filter(word => word.hsk_level !== null);
  catalog.hskCatalog = { ...reference, entries };
  catalog.hskSelection = {
    standardKey: reference.standardKey, edition: reference.edition,
    officialDirectVerified: false, referenceEntryCount: entries.length,
    availableEntryCount: entries.filter(entry => entry.hasCard).length,
    availableWordCount: wordsWithEvidence.length,
    unclassifiedWordIds: catalog.words.filter(word => word.hsk_level === null).map(word => word.id),
    readingMismatchWordIds: catalog.words.filter(word => word.hsk_classification.status === 'reading_mismatch').map(word => word.id),
    levels,
    practiceRule: 'selected_word_and_partner',
    countSemantics: reference.countSemantics,
  };
  if (catalog.standard) Object.assign(catalog.standard, {
    label: 'HSK · programa de noviembre de 2025',
    status: 'versioned_secondary_reference',
    official_direct_verified: false,
  });
  for (const level of catalog.levels || []) {
    const selection = levels.find(row => row.level === level.id);
    if (selection) Object.assign(level, {
      status: selection.availableWordCount ? 'available_selection' : 'pending_content',
      selection: { entryCount: selection.entryCount, wordCount: selection.availableWordCount,
        practiceWordCount: selection.availablePracticeWordCount },
    });
  }
  // No orphan bindings, and no tone-independent fallback for unlisted words.
  for (const entry of entries)
    if (entry.wordIds.some(id => !wordById.has(id))) throw Error('Referencia HSK huérfana: ' + entry.id);
  return catalog;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildHSKReference, enrichCatalogHSK, normalizeHSKPinyin } from '../tools/hsk.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reference = buildHSKReference();
const word = (id, zh, pinyin) => ({ id, zh, readings: pinyin.map((py, index) => ({
  id: id + '_reading_' + index, pinyin: py, pinyin_marked: py,
})) });
function fixture() {
  return {
    standard: { id: 'HSK_SYLLABUS_2025_11_2026_07', ingest_official_hsk_syllabus: false },
    levels: Array.from({ length: 6 }, (_, offset) => ({ id: offset + 1, units: [] })),
    words: [word('return', '还', ['huán']), word('still', '还', ['hái']),
      word('xing', '行', ['xíng', 'háng']), word('know', '知道', ['zhīdào']),
      word('leave', '留下', ['liúxià']), word('answerphone', '接到', ['jiēdào'])],
    contrasts: [{ id: 'pair_return_leave', word_id_a: 'return', word_id_b: 'leave' }],
    scenarios: [{ id: 'scene_return', contrast_id: 'pair_return_leave' }],
    exercises: [{ id: 'exercise_return', scenario_id: 'scene_return' }],
    lessons: [{ id: 'lesson_return', wordIds: ['return', 'leave'] }],
  };
}

test('programa 2025 conserva 5400 posiciones consecutivas y los recuentos por nivel', () => {
  assert.equal(reference.standardKey, 'HSK_SYLLABUS_2025_11_2026_07');
  assert.equal(reference.edition, '2025-11');
  assert.equal(reference.officialDirectVerified, false);
  assert.equal(reference.entries.length, 5400);
  assert.deepEqual(reference.entries.map(entry => entry.number), Array.from({ length: 5400 }, (_, offset) => offset + 1));
  assert.equal(new Set(reference.entries.map(entry => entry.id)).size, 5400);
  assert.deepEqual(reference.levels.map(level => level.entryCount), [300, 200, 500, 1000, 1600, 1800]);
  assert.deepEqual(reference.levels.map(level => level.cumulativeEntryCount), [300, 500, 1000, 2000, 3600, 5400]);
  assert.equal(reference.uniqueSpellings, 5334);
  // Rows repeated for additional parts of speech retain their original ordinal.
  const multipleSense = reference.entries.find(entry => entry.sourceSpelling === '好');
  assert.equal(multipleSense.level, 1);
  assert.deepEqual(multipleSense.additionalSenseLevels, [2, 4]);
});

test('fuentes, commit, bytes, hashes y atribución hacen reproducible la clasificación', () => {
  assert.match(reference.commit, /^[a-f0-9]{40}$/u);
  assert.equal(reference.sources.length, 6);
  for (const source of reference.sources) {
    const bytes = fs.readFileSync(path.join(ROOT, 'data/hsk', source.file));
    assert.equal(bytes.length, source.bytes);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), source.sha256);
    assert.ok(source.upstreamUrl.includes('/' + reference.commit + '/'));
    assert.ok(source.rawUrl.startsWith('https://raw.githubusercontent.com/'));
  }
  assert.equal(reference.license, 'CC-BY-SA-4.0');
  assert.match(fs.readFileSync(path.join(ROOT, 'data/hsk/ATTRIBUTION.md'), 'utf8'), /Mani \(krmanik\), CC BY-SA 4\.0/u);
  assert.match(fs.readFileSync(path.join(ROOT, 'data/hsk/CC-BY-SA-4.0.txt'), 'utf8'), /Attribution-ShareAlike 4\.0 International/u);
});

test('还 huán y hái, y 行 xíng y háng, reciben evidencia para su propia lectura', () => {
  const catalog = enrichCatalogHSK(fixture());
  assert.equal(catalog.words.find(word => word.id === 'return').hsk_level, 3);
  assert.equal(catalog.words.find(word => word.id === 'still').hsk_level, 1);
  const xing = catalog.words.find(word => word.id === 'xing').hsk_classification;
  assert.deepEqual(xing.reading_assignments.map(reading => [reading.pinyin, reading.level]), [['xíng', 3], ['háng', 5]]);
  for (const word of catalog.words.filter(word => word.hsk_level !== null))
    for (const assignment of word.hsk_classification.reading_assignments)
      for (const evidence of assignment.evidence) {
        assert.equal(evidence.evidence_type, 'versioned_secondary_transcription');
        assert.equal(evidence.official_direct_verified, false);
        assert.match(evidence.source_uri, /#L\d+$/u);
      }
  const level1 = catalog.hskSelection.levels.find(level => level.level === 1);
  const level3 = catalog.hskSelection.levels.find(level => level.level === 3);
  assert.ok(level1.wordIds.includes('still'));
  assert.ok(!level1.wordIds.includes('return'));
  assert.ok(level3.wordIds.includes('return'));
});

test('no se extrapola un nivel a derivados o pronunciaciones distintas', () => {
  const catalog = enrichCatalogHSK(fixture());
  const leave = catalog.words.find(word => word.id === 'leave');
  const answerPhone = catalog.words.find(word => word.id === 'answerphone');
  assert.equal(leave.hsk_level, null);
  assert.equal(leave.hsk_classification.status, 'reading_mismatch');
  assert.equal(leave.hsk_classification.unmatched_candidates[0].pinyin, 'liúxia');
  assert.equal(answerPhone.hsk_level, null);
  assert.equal(answerPhone.hsk_classification.status, 'no_match');
  assert.equal(catalog.standard.ingest_official_hsk_syllabus, false);
  assert.equal(normalizeHSKPinyin('Zhōng Wén'), normalizeHSKPinyin('zhōngwén'));
  assert.notEqual(normalizeHSKPinyin('huán'), normalizeHSKPinyin('hái'));
  assert.notEqual(normalizeHSKPinyin('liúxià'), normalizeHSKPinyin('liúxia'));
  assert.notEqual(normalizeHSKPinyin('lǜ'), normalizeHSKPinyin('lù'));
});

test('selección enlaza fichas y práctica sin clasificar al compañero ni la lección', () => {
  const catalog = enrichCatalogHSK(fixture());
  const level3 = catalog.hskSelection.levels.find(level => level.level === 3);
  assert.deepEqual(level3.contrastIds, ['pair_return_leave']);
  assert.deepEqual(level3.exerciseIds, ['exercise_return']);
  assert.deepEqual(level3.lessonIds, ['lesson_return']);
  assert.ok(level3.practiceWordIds.includes('return'));
  assert.ok(!level3.practiceWordIds.includes('leave'));
  assert.equal(catalog.lessons[0].hsk_level, undefined);
  for (const level of catalog.hskSelection.levels)
    assert.equal(level.availableEntryCount, catalog.hskCatalog.entries.filter(entry => entry.level === level.level && entry.hasCard).length);
  assert.equal(catalog.hskSelection.availableWordCount, 4);
  assert.equal(catalog.hskSelection.availableEntryCount, 5);
  assert.equal(catalog.hskCatalog.entries.filter(entry => entry.hasCard).length, 5);
});

test('una edición distinta se rechaza en lugar de mezclarla silenciosamente', () => {
  const catalog = fixture();
  catalog.standard.id = 'HSK_2021_DIFFERENT';
  assert.throws(() => enrichCatalogHSK(catalog), /no coincide con la edición/u);
});

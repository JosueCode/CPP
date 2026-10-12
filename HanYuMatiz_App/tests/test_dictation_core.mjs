import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DICTATION_LIMITS, segmentText, validateInput, validateSentences,
  splitSentence, mergeSentences, compareSentence, aggregateResults,
} from '../web/dictationcore.js';

test('segments the supplied text into four phrases and retains punctuation and order', () => {
  const text = '今天早上我七点起床。我吃了早饭，然后去学校学习中文。今天的天气很好，但是有一点热。下午我和朋友一起去了图书馆。';
  assert.deepEqual(segmentText(text), [
    '今天早上我七点起床。', '我吃了早饭，然后去学校学习中文。',
    '今天的天气很好，但是有一点热。', '下午我和朋友一起去了图书馆。',
  ]);
  assert.equal(validateInput(text).ok, true);
  assert.equal(validateInput(text).sentenceCount, 4);
});

test('Chinese commas, semicolons, decimal points and internal spaces do not split phrases', () => {
  assert.deepEqual(segmentText('价格是3.5元， 很便宜；我买了两个。'), ['价格是3.5元， 很便宜；我买了两个。']);
  assert.deepEqual(segmentText('你好！真的吗？可以!现在走?最后一个片段'),
    ['你好！', '真的吗？', '可以!', '现在走?', '最后一个片段']);
});

test('line breaks, CRLF, Unicode line separators and trailing fragments are handled', () => {
  assert.deepEqual(segmentText('第一行\r\n\r\n第二行\n第三行\u2028第四行\u2029第五行'),
    ['第一行', '第二行', '第三行', '第四行', '第五行']);
  assert.deepEqual(segmentText('  今天很好。\n  明天也好  '), ['今天很好。', '明天也好']);
});

test('closing quotes and brackets attach to their phrase; consecutive punctuation stays together', () => {
  assert.deepEqual(segmentText('他说：“你好！！”我说：「真的吗？！」她点头。'),
    ['他说：“你好！！”', '我说：「真的吗？！」', '她点头。']);
  assert.deepEqual(segmentText('他说：“你好！你好吗？”（我点头。）再见。'),
    ['他说：“你好！', '你好吗？”', '（我点头。）', '再见。']);
  assert.deepEqual(segmentText('想一想……然后告诉我...最后？！？'), ['想一想……', '然后告诉我...', '最后？！？']);
});

test('input validation rejects empty, non-Chinese and punctuation-only edited sentences', () => {
  for (const empty of ['', '\n  \u3000']) assert.equal(validateInput(empty).ok, false);
  assert.equal(validateInput('hello world').ok, false);
  assert.equal(validateInput(null).ok, false);
  assert.match(validateSentences(['今天很好。', '？！']).errors.join(' '), /solamente puntuación/u);
  assert.equal(validateSentences(['']).ok, false);
  assert.equal(validateSentences({}).ok, false);
  assert.equal(validateSentences(['今天。明天。']).sentenceCount, 1, 'manual phrases must not be segmented again');
});

test('dozens of phrases and explicit Unicode-sized limits protect alignment work', () => {
  const fifty = '今天我学习中文。'.repeat(50);
  assert.equal(validateInput(fifty).sentenceCount, 50);
  assert.equal(validateInput(fifty).ok, true);
  assert.equal(validateInput('我。'.repeat(100)).ok, true);
  assert.match(validateInput('我。'.repeat(101)).errors.join(' '), /máximo 100/u);
  assert.equal(validateInput('𠀀'.repeat(500)).ok, true, 'astral Han code points are single characters');
  assert.match(validateInput('𠀀'.repeat(501)).errors.join(' '), /frase 1.*500/u);
  const excessive = validateInput('中'.repeat(20_001));
  assert.equal(excessive.ok, false);
  assert.equal(excessive.characterCount, 20_001);
  assert.equal(excessive.sentences.length, 0, 'large text rejected before processing phrases');
  assert.equal(DICTATION_LIMITS.maxCharacters, 20_000);
  assert.equal(validateInput(`${'中'.repeat(499)}\u0344`).ok, false,
    'an uncommon NFC expansion must not pass validation then fail correction');
});

test('manual split and merge are immutable and use code points rather than UTF-16 offsets', () => {
  const original = ['𠀀你好。', '再见。'];
  const split = splitSentence(original, 0, 1);
  assert.deepEqual(split, ['𠀀', '你好。', '再见。']);
  assert.deepEqual(original, ['𠀀你好。', '再见。']);
  assert.deepEqual(mergeSentences(split, 0), original);
  assert.throws(() => splitSentence(original, 0, 0), RangeError);
  assert.throws(() => splitSentence(original, 0, 100), RangeError);
  assert.throws(() => mergeSentences(original, 1), RangeError);
  assert.throws(() => mergeSentences(['中'.repeat(300), '文'.repeat(201)], 0), RangeError);
  assert.throws(() => splitSentence(Array(100).fill('中文'), 0, 1), RangeError);
});

test('correct characters ignore irrelevant whitespace and optionally punctuation', () => {
  const result = compareSentence('我，今天。', '我 \u3000今\u0085天');
  assert.equal(result.status, 'correct');
  assert.equal(result.accuracy, 100);
  assert.equal(result.originalCharacters, 3);
  assert.equal(result.matches, 3);
  assert.deepEqual(result.operations.map(operation => operation.originalPosition), [1, 3, 4]);
  assert.deepEqual(result.operations.map(operation => operation.answerPosition), [1, 4, 6]);
  assert.equal(result.originalRuns.map(run => run.text).join(''), '我，今天。');
  assert.equal(result.originalRuns.filter(run => run.kind === 'ignored').map(run => run.text).join(''), '，。');
  const punctuation = compareSentence('我，今天。', '我今天', { evaluatePunctuation: true });
  assert.equal(punctuation.status, 'incorrect');
  assert.equal(punctuation.deletions, 2);
  assert.equal(punctuation.accuracy, 60);
});

test('the supplied 校/效 example identifies one substitution without shifting later characters', () => {
  const result = compareSentence('我今天去学校学习中文。', '我今天去学效学习中文。');
  assert.equal(result.status, 'incorrect');
  assert.equal(result.substitutions, 1);
  assert.equal(result.insertions, 0);
  assert.equal(result.deletions, 0);
  assert.equal(result.matches, 9);
  assert.equal(result.accuracy, 90);
  assert.equal(result.differences.length, 1);
  assert.deepEqual(result.differences[0], { kind: 'substitution', expected: '校', written: '效',
    originalPosition: 6, answerPosition: 6, originalAnchorPosition: 6, answerAnchorPosition: 6 });
  assert.equal(result.operations.at(-1).expected, '文');
  assert.equal(result.operations.at(-1).kind, 'equal');
});

test('omissions and insertions preserve alignment and expose the missing side explicitly', () => {
  const omitted = compareSentence('我今天去学校', '我天去学校');
  assert.equal(omitted.deletions, 1);
  assert.equal(omitted.matches, 5);
  assert.deepEqual(omitted.differences[0], { kind: 'deletion', expected: '今', written: '',
    originalPosition: 2, answerPosition: null, originalAnchorPosition: 2, answerAnchorPosition: 2 });
  assert.equal(omitted.operations.at(-1).kind, 'equal');
  const inserted = compareSentence('我去学校', '我明去学校');
  assert.equal(inserted.insertions, 1);
  assert.equal(inserted.matches, 4);
  assert.deepEqual(inserted.differences[0], { kind: 'insertion', expected: '', written: '明',
    originalPosition: null, answerPosition: 2, originalAnchorPosition: 2, answerAnchorPosition: 2 });
  assert.equal(inserted.accuracy, 80);
});

test('multiple distinct errors and repeated characters produce coherent minimum-edit alignment', () => {
  const result = compareSentence('甲乙丙丁戊己', '甲错丙戊己多');
  assert.equal(result.substitutions, 1);
  assert.equal(result.deletions, 1);
  assert.equal(result.insertions, 1);
  assert.equal(result.matches, 4);
  assert.equal(result.errorCount, 3);
  assert.equal(result.accuracy, 57.1);
  const shifted = compareSentence('甲乙丙', '乙丙甲');
  assert.equal(shifted.deletions, 1);
  assert.equal(shifted.insertions, 1);
  assert.equal(shifted.matches, 2);
  assert.equal(shifted.accuracy, 50);
  const repeated = compareSentence('我我学习', '我学习');
  assert.equal(repeated.matches, 3);
  assert.equal(repeated.deletions, 1);
  assert.equal(repeated.substitutions, 0);
});

test('Unicode code points, NFC, traditional characters, Latin text and numbers have explicit semantics', () => {
  const astral = compareSentence('𠀀今天', '𠀁今天');
  assert.equal(astral.originalCharacters, 3);
  assert.equal(astral.substitutions, 1);
  assert.equal(astral.differences[0].expected, '𠀀');
  assert.equal(astral.differences[0].originalPosition, 1);
  const nfc = compareSentence('我喜欢cafe\u0301', '我喜欢café');
  assert.equal(nfc.status, 'correct');
  assert.equal(nfc.original, '我喜欢cafe\u0301', 'preserve original user text');
  assert.equal(nfc.normalizedOriginal, '我喜欢café');
  assert.equal(compareSentence('学校', '學校').substitutions, 1);
  assert.equal(compareSentence('在', '再').substitutions, 1, 'shared pronunciation does not make characters equivalent');
  const mixed = compareSentence('我买了2个USB', '我买了3个usb');
  assert.equal(mixed.substitutions, 4);
  assert.equal(mixed.originalCharacters, 8);
});

test('unanswered phrases are explicit and missing characters affect the aggregate score', () => {
  const blank = compareSentence('中国人。', ' \u3000');
  assert.equal(blank.status, 'unanswered');
  assert.equal(blank.accuracy, 0);
  assert.equal(blank.deletions, 3);
  assert.equal(compareSentence('中国人。', '。？！').status, 'unanswered');
  assert.equal(compareSentence('', '').status, 'unanswered');
  const results = aggregateResults([compareSentence('你好', '你好'), blank]);
  assert.deepEqual(results, { sentencesTotal: 2, correctSentences: 1, incorrectSentences: 0,
    unansweredSentences: 1, evaluatedCharacters: 5, correctCharacters: 2,
    substitutions: 0, deletions: 3, insertions: 0, errorCount: 3, accuracy: 40 });
});

test('accuracy includes inserted characters and aggregates counts rather than averaging percentages', () => {
  const first = compareSentence('你好', '你好呀');
  assert.equal(first.accuracy, 66.7);
  const results = aggregateResults([first, compareSentence('我', '我')]);
  assert.equal(results.accuracy, 75);
  assert.equal(results.evaluatedCharacters, 3);
  assert.equal(results.correctCharacters, 3);
  assert.equal(results.insertions, 1);
  assert.equal(results.incorrectSentences, 1);
  assert.equal(aggregateResults([]).accuracy, 0);
  assert.throws(() => aggregateResults({}), TypeError);
  assert.throws(() => aggregateResults([{ status: 'correct', originalCharacters: 1, matches: -1 }]), TypeError);
});

test('all returned runs remain literal text, never interpolated HTML, and reconstruct the full input', () => {
  const original = '中文。<script>alert(1)</script>';
  const answer = '中文。<img src=x onerror=alert(1)>';
  const result = compareSentence(original, answer);
  assert.equal(result.original, original);
  assert.equal(result.answer, answer);
  assert.equal(result.originalRuns.map(run => run.text).join(''), original);
  assert.equal(result.answerRuns.map(run => run.text).join(''), answer);
  assert.equal(typeof result.originalRuns[0].text, 'string');
  assert.ok(result.errorCount > 0);
});

test('maximum-size comparison stays bounded and refuses over-limit answers', () => {
  const expected = '中文'.repeat(250);
  const written = `${'中文'.repeat(249)}中错`;
  const result = compareSentence(expected, written);
  assert.equal(result.originalCharacters, 500);
  assert.equal(result.matches, 499);
  assert.equal(result.substitutions, 1);
  assert.equal(result.accuracy, 99.8);
  assert.throws(() => compareSentence('中'.repeat(501), '中'), RangeError);
  assert.throws(() => compareSentence('中', '中'.repeat(501)), RangeError);
  assert.throws(() => compareSentence(`${'中'.repeat(499)}\u0344`, '中'), RangeError);
  assert.throws(() => compareSentence(null, '中'), TypeError);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSpeechPlayer, isMandarinVoice, SPEECH_RATES, MAX_SPEECH_CHARACTERS } from '../web/dictationaudio.js';

const localCN = { voiceURI: 'native-cn', name: 'Mandarín local', lang: 'zh-CN', localService: true };
const localTW = { voiceURI: 'native-tw', name: 'Mandarin Taiwan', lang: 'zh-TW', localService: true };
const remoteCN = { voiceURI: 'remote-cn', name: 'Chinese Mandarin', lang: 'zh-CN', localService: false };
const unknownCN = { voiceURI: 'unknown-cn', name: 'Chinese', lang: 'zh-CN' };

function fixture(initial = [localTW, localCN]) {
  const states = [], lists = [], timers = new Map(), listeners = new Map();
  let timerId = 0;
  class Utterance { constructor(text) { this.text = text; } }
  const synthesis = {
    voices: initial, spoken: [], cancels: 0, paused: false,
    getVoices() { return this.voices; },
    speak(utterance) { this.spoken.push(utterance); },
    cancel() { this.cancels += 1; },
    pause() { this.paused = true; },
    resume() { this.paused = false; },
    addEventListener(event, callback) { listeners.set(event, callback); },
    removeEventListener(event, callback) { if (listeners.get(event) === callback) listeners.delete(event); },
  };
  const player = createSpeechPlayer({ synthesis, Utterance,
    onState: state => states.push(state), onVoices: voices => lists.push(voices),
    setTimer(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimer(id) { timers.delete(id); },
  });
  const fireDelay = delay => {
    const selected = [...timers].find(([, timer]) => timer.delay === delay);
    assert.ok(selected, `Expected timer ${delay}`);
    timers.delete(selected[0]); selected[1].callback();
  };
  return { player, synthesis, states, lists, timers, listeners, fireDelay };
}

test('only Mandarin-compatible voices are offered; zh-HK alone and Cantonese labels are excluded', () => {
  for (const lang of ['zh-CN', 'zh_CN', 'zh-TW', 'zh-SG', 'zh', 'zh-Hans-CN', 'zh-Hant-TW', 'cmn-CN']) {
    assert.equal(isMandarinVoice({ lang, name: 'Chinese' }), true, lang);
  }
  for (const lang of ['zh-HK', 'zh-Hant-HK', 'zh-MO', 'en-US', 'yue-HK', 'wuu-CN', '', 'zh-Latn']) {
    assert.equal(isMandarinVoice({ lang, name: 'Chinese' }), false, lang);
  }
  assert.equal(isMandarinVoice({ lang: 'zh-HK', name: 'Mandarin Hong Kong' }), true);
  assert.equal(isMandarinVoice({ lang: 'zh-HK', name: '香港普通話' }), true);
  assert.equal(isMandarinVoice({ lang: 'zh-CN', name: 'Cantonese voice' }), false);
  assert.equal(isMandarinVoice({ lang: 'zh-TW', name: '粵語' }), false);
});

test('native zh-CN is preferred, language/locality remain truthful, and lists cannot mutate player state', () => {
  const { player, lists } = fixture([localTW, remoteCN, unknownCN, localCN]);
  const voices = player.listVoices();
  assert.equal(voices[0].voiceURI, localCN.voiceURI);
  assert.equal(voices[1].privacy, 'remote');
  assert.equal(voices[2].privacy, 'unknown');
  assert.equal(voices[3].lang, 'zh-TW');
  assert.match(voices[0].label, /zh-CN.*del dispositivo/u);
  voices[0].voiceURI = 'modified'; lists[0][0].name = 'modified';
  assert.equal(player.listVoices()[0].voiceURI, localCN.voiceURI);
  assert.equal(player.listVoices()[0].name, localCN.name);
  assert.equal(player.getState().hasVoices, true);
  player.dispose();
});

test('speech reads the exact submitted sentence with the selected native voice and allowed rate', () => {
  const { player, synthesis } = fixture();
  for (const rate of SPEECH_RATES) {
    assert.deepEqual(player.speak('今天早上我七点起床。', { voiceURI: localTW.voiceURI, rate }), { ok: true });
    const utterance = synthesis.spoken.at(-1);
    assert.equal(utterance.text, '今天早上我七点起床。');
    assert.equal(utterance.voice, localTW);
    assert.equal(utterance.lang, 'zh-TW');
    assert.equal(utterance.rate, rate);
  }
  assert.equal(player.speak('你好。', { rate: 0.3 }).reason, 'invalid_rate');
  player.dispose();
});

test('remote and unknown-location voices cannot receive personal text before explicit consent', () => {
  const { player, synthesis } = fixture([remoteCN, unknownCN]);
  assert.equal(player.listVoices().every(voice => voice.requiresConsent), true);
  for (const voiceURI of [remoteCN.voiceURI, unknownCN.voiceURI]) {
    assert.equal(player.speak('这是私人文字。', { voiceURI }).reason, 'remote_consent_required');
    assert.equal(player.speak('这是私人文字。', { voiceURI, allowRemote: 'true' }).reason, 'remote_consent_required');
  }
  assert.equal(synthesis.spoken.length, 0);
  assert.equal(player.speak('这是私人文字。', { voiceURI: remoteCN.voiceURI, allowRemote: true }).ok, true);
  assert.equal(synthesis.spoken.length, 1);
  player.dispose();
});

test('voiceschanged and delayed lookup enable genuinely available voices without a fake fallback', () => {
  const { player, synthesis, listeners, fireDelay } = fixture([]);
  assert.equal(player.getState().status, 'unavailable');
  assert.equal(player.speak('你好。').reason, 'no_mandarin_voice');
  assert.equal(synthesis.spoken.length, 0);
  synthesis.voices = [{ voiceURI: 'en', lang: 'en-US', name: 'English', localService: true }];
  listeners.get('voiceschanged')();
  assert.equal(player.getState().hasVoices, false);
  synthesis.voices = [localCN]; fireDelay(250);
  assert.equal(player.getState().status, 'idle');
  assert.equal(player.getState().hasVoices, true);
  assert.equal(player.speak('你好。').ok, true);
  player.dispose();
});

test('repeating cancels the previous utterance and ignores every stale native event', () => {
  const { player, synthesis } = fixture();
  player.speak('第一句。');
  const first = synthesis.spoken.at(-1);
  const stale = { start: first.onstart, end: first.onend, error: first.onerror, pause: first.onpause, resume: first.onresume };
  first.onstart();
  player.speak('第二句。');
  const second = synthesis.spoken.at(-1);
  assert.equal(synthesis.cancels, 2);
  for (const callback of Object.values(stale)) callback({ error: 'interrupted' });
  assert.equal(player.getState().status, 'loading');
  assert.equal(player.getState().isPlaying, true);
  second.onstart(); assert.equal(player.getState().status, 'speaking');
  second.onend(); assert.equal(player.getState().status, 'ended');
  assert.equal(player.getState().isActive, false);
  player.dispose();
});

test('pause suspends the failure watchdog; resume and stop use real native controls', () => {
  const { player, synthesis, timers } = fixture();
  player.speak('你好。'); synthesis.spoken.at(-1).onstart();
  assert.equal(timers.size, 1);
  assert.deepEqual(player.pause(), { ok: true });
  assert.equal(synthesis.paused, true);
  assert.equal(player.getState().isPaused, true);
  assert.equal(timers.size, 0);
  assert.deepEqual(player.resume(), { ok: true });
  assert.equal(synthesis.paused, false);
  assert.equal(player.getState().status, 'speaking');
  assert.equal(timers.size, 1);
  player.stop();
  assert.equal(player.getState().status, 'stopped');
  assert.equal(timers.size, 0);
  assert.equal(player.resume().reason, 'resume_unavailable');
  player.dispose();
});

test('a browser that does not confirm pause does not produce a fabricated paused state', () => {
  const { player, synthesis } = fixture();
  synthesis.pause = () => {};
  player.speak('你好。'); synthesis.spoken.at(-1).onstart();
  assert.equal(player.pause().ok, true);
  assert.equal(player.getState().status, 'speaking');
  synthesis.spoken.at(-1).onpause();
  assert.equal(player.getState().status, 'paused');
  player.dispose();
});

test('repeating after a pause clears the native paused queue before speaking the new sentence', () => {
  const { player, synthesis } = fixture();
  player.speak('第一句。'); synthesis.spoken.at(-1).onstart(); player.pause();
  assert.equal(synthesis.paused, true);
  assert.equal(player.speak('第二句。').ok, true);
  assert.equal(synthesis.paused, false);
  assert.equal(synthesis.spoken.at(-1).text, '第二句。');
  assert.equal(player.getState().status, 'loading');
  player.dispose();
});

test('start/completion timeouts report failure and cancel rather than simulate successful audio', () => {
  const start = fixture();
  start.player.speak('你好。'); start.fireDelay(10000);
  assert.equal(start.player.getState().error, 'speech_start_timeout');
  assert.equal(start.player.getState().status, 'error');
  assert.equal(start.player.getState().isPlaying, false);
  const end = fixture();
  end.player.speak('你好。'); end.synthesis.spoken.at(-1).onstart(); end.fireDelay(20000);
  assert.equal(end.player.getState().error, 'speech_timeout');
  assert.notEqual(end.player.getState().status, 'ended');
  start.player.dispose(); end.player.dispose();
});

test('native network and permission errors have actionable messages without exposing submitted text', () => {
  const { player, synthesis, states } = fixture();
  for (const error of ['network', 'not-allowed', 'synthesis-failed']) {
    player.speak('我的秘密文本。'); synthesis.spoken.at(-1).onerror({ error });
    assert.equal(player.getState().status, 'error');
    assert.equal(player.getState().error, error);
    assert.ok(player.getState().message.length > 30);
  }
  assert.equal(JSON.stringify(states).includes('我的秘密文本'), false);
  player.dispose();
});

test('invalid/oversized text and vanished chosen voices do not silently truncate or choose another voice', () => {
  const { player, synthesis } = fixture();
  assert.equal(player.speak('  ').reason, 'empty_text');
  assert.equal(player.speak('𠮷'.repeat(MAX_SPEECH_CHARACTERS + 1)).reason, 'text_too_long');
  assert.equal(player.speak('你好。', { voiceURI: 'deleted-voice' }).reason, 'voice_unavailable');
  assert.equal(synthesis.spoken.length, 0);
  assert.equal(player.speak('𠮷'.repeat(MAX_SPEECH_CHARACTERS)).ok, true);
  player.dispose();
});

test('dispose removes listeners, timers, and late callbacks and remains idempotent', () => {
  const { player, synthesis, listeners, timers } = fixture([]);
  synthesis.voices = [localCN]; player.refreshVoices(); player.speak('你好。');
  const delayedEnd = synthesis.spoken.at(-1).onend;
  player.dispose(); const count = synthesis.cancels; delayedEnd(); player.dispose();
  assert.equal(synthesis.cancels, count);
  assert.equal(listeners.size, 0);
  assert.equal(timers.size, 0);
  assert.equal(player.getState().status, 'disposed');
  assert.equal(player.speak('你好。').reason, 'disposed');
});

test('legacy voiceschanged handlers are retained and restored; a broken UI callback cannot break native cleanup', () => {
  let previousCalled = 0;
  const synthesis = {
    getVoices: () => [localCN], speak() {}, cancel() {}, onvoiceschanged: () => { previousCalled++; },
  };
  const previous = synthesis.onvoiceschanged;
  class Utterance { constructor(text) { this.text = text; } }
  const player = createSpeechPlayer({ synthesis, Utterance,
    onState() { throw new Error('UI error'); }, onVoices() { throw new Error('UI error'); } });
  synthesis.onvoiceschanged({}); assert.equal(previousCalled, 1);
  assert.equal(player.speak('你好。').ok, true);
  player.dispose(); assert.equal(synthesis.onvoiceschanged, previous);
});

test('unsupported browsers expose an explicit unavailable state and never attempt alternate-language playback', () => {
  const player = createSpeechPlayer({ synthesis: null, Utterance: null });
  assert.equal(player.getState().supported, false);
  assert.equal(player.getState().hasVoices, false);
  assert.deepEqual(player.listVoices(), []);
  assert.equal(player.speak('你好。').reason, 'unsupported');
  assert.equal(player.pause().ok, false);
  assert.equal(player.resume().ok, false);
  player.dispose();
});

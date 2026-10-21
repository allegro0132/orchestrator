import { test } from 'node:test';
import assert from 'node:assert/strict';
import { english, initialLanguage, translate } from './translations.js';
import { STRINGS, PATTERNS } from './pitch.js';
test('defaults to English and honors a saved Chinese preference', () => {
  for (const value of [null, undefined, '', 'fr', 'en']) assert.equal(initialLanguage(value), 'en');
  assert.equal(initialLanguage('zh'), 'zh');
});
test('translations include dynamic music labels and preserve notation', () => {
  for (const key of [...STRINGS.map((s) => s.label), ...PATTERNS.flatMap((p) => [p.name, p.sub])]) {
    assert.ok(english[key]);
    assert.equal(translate('zh', key), key);
    assert.doesNotMatch(translate('en', key), /[\u4e00-\u9fff]/);
  }
  assert.equal(translate('en', 'A₄ = 440 Hz'), 'A₄ = 440 Hz');
});
test('all English translations contain English text', () => {
  for (const [key, value] of Object.entries(english)) {
    assert.ok(value.length, key);
    assert.doesNotMatch(value, /[\u4e00-\u9fff]/, key);
  }
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractInlineStyles } = require('../src/transform');

/** @param {string} html @returns {ReturnType<typeof extractInlineStyles>} */
const run = (html) => extractInlineStyles(html);

test('reuses an existing class shared by every matching element', () => {
  const result = run('<div class="card" style="color:red">A</div><section class="card" style="color:red">B</section>');
  assert.equal(result.classes, 0);
  assert.equal(result.reusedClasses, 1);
  assert.match(result.html, /\.card \{\s*color:red;/);
  assert.equal((result.html.match(/class="card"/g) || []).length, 2);
  assert.doesNotMatch(result.html, /style=/);
});

test('shared class extracts common property and unique classes hold remaining differences', () => {
  const input = '<div class="card" style="color:red; margin:0">A</div><div class="card" style="color:red; padding:8px">B</div>';
  const result = run(input);
  assert.equal(result.reusedClasses, 1);
  assert.equal(result.classes, 2);
  assert.match(result.html, /\.card \{\s*color:red;/);
  assert.match(result.html, /\.extracted-inline-1 \{\s*margin:0;/);
  assert.match(result.html, /\.extracted-inline-2 \{\s*padding:8px;/);
  assert.equal(result.converted, 2);
});

test('class with a differently styled or unstyled user is not overwritten', () => {
  const input = '<span class="note" style="color:red">A</span><span class="note">B</span>';
  const result = run(input);
  assert.equal(result.reusedClasses, 0);
  assert.equal(result.classes, 1);
  assert.match(result.html, /<span class="note">B<\/span>/);
  assert.doesNotMatch(result.html, /\.note \{/);
});

test('tag rules require all occurrences to agree and at least two instances', () => {
  const input = '<p style="margin:0;color:blue">A</p><p style="margin:0;color:red">B</p>';
  const result = run(input);
  assert.equal(result.tagRules, 1);
  assert.match(result.html, /p \{\s*margin:0;/);
  assert.doesNotMatch(result.html, /p \{\s*color:/);
  assert.equal(result.classes, 2);
});

test('one unstylized instance blocks broad tag extraction', () => {
  const result = run('<p style="color:red">A</p><p style="color:red">B</p><p>C</p>');
  assert.equal(result.tagRules, 0);
  assert.equal(result.classes, 1);
  assert.match(result.html, /\.extracted-inline-1 \{\s*color:red;/);
  assert.match(result.html, /<p>C<\/p>/);
});

test('shared class precedes tag selector when both would apply', () => {
  const result = run('<p class="x" style="color:red">A</p><p class="x" style="color:red">B</p>');
  assert.equal(result.reusedClasses, 1);
  assert.equal(result.tagRules, 0);
  assert.equal(result.classes, 0);
});

test('repeated properties on unrelated elements share a generated class', () => {
  const result = run('<b style="color:red; padding:2px">A</b><i style="padding:2px;color:red">B</i>');
  assert.equal(result.classes, 1);
  assert.equal((result.html.match(/class="extracted-inline-1"/g) || []).length, 2);
  assert.match(result.html, /color:red;/);
  assert.match(result.html, /padding:2px;/);
});

test('unique ID takes priority over a unique existing class', () => {
  const result = run('<div class="special" id="some-id" style="color:red">A</div>');
  assert.equal(result.classes, 0);
  assert.equal(result.idRules, 1);
  assert.match(result.html, /#some-id \{\s*color:red;/);
  assert.match(result.html, /class="special" id="some-id">/);
});

test('unique id is reused if no safe class exists', () => {
  const result = run('<div id="hero" style="color:red">A</div>');
  assert.equal(result.classes, 0);
  assert.equal(result.idRules, 1);
  assert.match(result.html, /#hero \{\s*color:red;/);
  assert.match(result.html, /<div id="hero">/);
});

test('duplicate ids cannot be used to hoist incompatible values', () => {
  const result = run('<div id="hero" style="color:red">A</div><div id="hero" style="color:blue">B</div>');
  assert.equal(result.idRules, 0);
  assert.equal(result.classes, 2);
});

test('a singleton without a safe selector still gets a generated class', () => {
  const result = run('<span style="width:2rem">A</span>');
  assert.equal(result.classes, 1);
  assert.equal(result.converted, 1);
});

test('do not generate a rule from broken declarations', () => {
  const input = '<p style="color:red; invalid!">A</p><span style="color:blue">B</span>';
  const result = run(input);
  assert.equal(result.skipped, 1);
  assert.equal(result.converted, 1);
  assert.match(result.html, /style="color:red; invalid!"/);
});

test('CSS semicolons in string, url and comments do not split declarations', () => {
  const result = run(`<span style='content:"a;b"; background:url("data:image/svg+xml;xx"); color:blue'>A</span>`);
  assert.equal(result.converted, 1);
  assert.match(result.html, /content:"a;b";/);
  assert.match(result.html, /background:url\("data:image\/svg\+xml;xx"\);/);
  assert.match(result.html, /color:blue;/);
});

test('duplicate property fallbacks stay together', () => {
  const result = run('<span style="display:-webkit-box;display:flex;color:red">A</span>');
  assert.equal(result.converted, 1);
  assert.match(result.html, /display:-webkit-box; display:flex;/);
});

test('dynamic styles block unsafe shared tag inference', () => {
  const result = run('<div style="color:red">A</div><div style="{{ dynamic }}">B</div>');
  assert.equal(result.converted, 1);
  assert.equal(result.tagRules, 0);
  assert.match(result.html, /style="\{\{ dynamic \}\}"/);
});

test('handles an existing style element and can safely run again', () => {
  const input = '<head><style>.special { font-size:10px; }</style></head><div class="special" style="margin:0">Hi</div>';
  const result = extractInlineStyles(input, { destination: 'head' });
  assert.equal((result.html.match(/<style>/g) || []).length, 1);
  assert.match(result.html, /font-size:10px/);
  assert.match(result.html, /\.special \{\s*margin:0;/);
  const second = run(result.html);
  assert.equal(second.converted, 0);
  assert.equal(second.html, result.html);
});

test('smart mode is default while the original simple mode remains available', () => {
  const html = '<p class="notice" style="color:red">A</p>';
  assert.equal(run(html).classes, 0);
  assert.equal(extractInlineStyles(html, {mode: 'simple'}).classes, 1);
});

test('returns unchanged HTML when there are no inline styles', () => {
  const input = '<div class="card">A</div>';
  assert.equal(run(input).html, input);
  assert.equal(run(input).converted, 0);
});

test('does not reuse a class when an unconvertible user has it', () => {
  const result = run('<div class="x" style="color:red">A</div><div class="x" style="{{ color }}">B</div>');
  assert.equal(result.reusedClasses, 0);
  assert.equal(result.classes, 1);
  assert.equal(result.skipped, 1);
});

test('normalizes CSS spacing for property equivalence', () => {
  const result = run('<b class="t" style="color: red">A</b><i class="t" style="color:red">B</i>');
  assert.equal(result.reusedClasses, 1);
  assert.equal(result.classes, 0);
});

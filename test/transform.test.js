'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractInlineStylesSimple: extractInlineStyles, decodeHtmlAttribute } = require('../src/transform');

/** @param {string} html @returns {string} */
const convert = (html) => extractInlineStyles(html, { destination: 'head' }).html;

test('single style attribute becomes class and a head style element', () => {
  const result = extractInlineStyles('<!doctype html>\n<html><head><title>Test</title></head><body><p style="color: red; padding: 10px">Hi</p></body></html>', { destination: 'head' });
  assert.equal(result.converted, 1);
  assert.equal(result.classes, 1);
  assert.match(result.html, /<style>\s*\.extracted-inline-1 \{\s*color: red; padding: 10px;\s*\}\s*<\/style>/);
  assert.match(result.html, /<p class="extracted-inline-1">Hi<\/p>/);
  assert.ok(result.html.indexOf('<style>') < result.html.indexOf('</head>'));
});

test('preserves existing classes, IDs and attributes', () => {
  const input = '<div id="x" class="a b" data-value="one > two" style="color:red" title="okay">!</div>';
  const html = convert(input);
  assert.match(html, /class="a b extracted-inline-1"/);
  assert.doesNotMatch(html, /style="color:red"/);
  assert.match(html, /id="x"/);
  assert.match(html, /data-value="one > two"/);
  assert.match(html, /title="okay"/);
});

test('reuses classes for repeated identical CSS', () => {
  const result = extractInlineStyles('<b style="color:red">1</b><i style="color:red;">2</i>');
  assert.equal(result.converted, 2);
  assert.equal(result.classes, 1);
  assert.equal((result.html.match(/class="extracted-inline-1"/g) || []).length, 2);
  assert.equal((result.html.match(/\.extracted-inline-1 \{/g) || []).length, 1);
});

test('appends to existing head style element without replacing content', () => {
  const html = convert('<head><style>body { margin: 0; }</style></head><div style="color:red">x</div>');
  assert.equal((html.match(/<style>/g) || []).length, 1);
  assert.match(html, /body \{ margin: 0; \}/);
  assert.match(html, /\.extracted-inline-1 \{\s*color:red;/);
});

test('does not append to print-only or non-CSS style elements', () => {
  const html = convert('<head><style media="print">.print {display:none;}</style></head><div style="color:red">x</div>');
  assert.equal((html.match(/<style/g) || []).length, 2);
  assert.match(html, /<style>\s*\.extracted-inline-1/);
});

test('falls back to the top when destination is head but no head exists', () => {
  const html = convert('<!doctype html><html><body><div style="color:red"></div></body></html>');
  assert.match(html, /^<!doctype html>\s*<style>/);
  assert.doesNotMatch(html, /<head>/);
});

test('inserts style at start of HTML fragment', () => {
  const html = convert('<div style="color:red">A</div>');
  assert.ok(html.startsWith('<style>'));
  assert.match(html, /<\/style>\s*<div class="extracted-inline-1">/);
});

test('does not corrupt script or HTML comments', () => {
  const html = convert('<!-- <p style="bad:1"> -->\n<script>let x = `<p style="not:css">`;</script><div style="color: blue">X</div>');
  assert.match(html, /<!-- <p style="bad:1"> -->/);
  assert.match(html, /<script>let x = `<p style="not:css">`;<\/script>/);
  assert.equal((html.match(/\.extracted-inline-/g) || []).length, 1);
});

test('does not interpret angle brackets inside attributes as HTML tags', () => {
  const html = convert('<div title="<span style=\'bad:1\'>" style="color:red">x</div>');
  assert.match(html, /title="<span style='bad:1'>"/);
  assert.match(html, /class="extracted-inline-1"/);
});

test('respects single quote attributes, complex CSS strings and URLs', () => {
  const input = `<a style='content:"a;b"; background:url("data:image/svg+xml;base64,AAA;BBB"); color:blue' href="#">x</a>`;
  const result = convert(input);
  assert.match(result, /content:"a;b"; background:url\("data:image\/svg\+xml;base64,AAA;BBB"\); color:blue;/);
  assert.match(result, /<a class="extracted-inline-1" href="#">/);
});

test('decodes HTML character references in CSS', () => {
  const html = convert('<div style="font-family:&quot;A &amp; B&quot;; content:&#39;hi&#39;">x</div>');
  assert.match(html, /font-family:"A & B"; content:'hi';/);
  assert.equal(decodeHtmlAttribute('&#x1F600; &copy; &amp;'), '😀 © &');
});

test('preserves unquoted class attributes by quoting them on modification', () => {
  const html = convert('<div class=note style=color:red>Hi</div>');
  assert.match(html, /class="note extracted-inline-1"/);
  assert.doesNotMatch(html, / style=/);
});

test('supports CRLF line endings', () => {
  const result = convert('<head>\r\n</head>\r\n<div style="color:red">x</div>');
  assert.match(result, /<style>\r\n\.extracted-inline-1/);
});

test('avoids collisions with pre-existing names in the file', () => {
  const html = convert('<p class="extracted-inline-1" style="a:b">x</p>');
  assert.match(html, /class="extracted-inline-1 extracted-inline-2"/);
  assert.match(html, /\.extracted-inline-2 \{/);
});

test('second run is idempotent', () => {
  const first = convert('<div style="color:red">x</div>');
  const second = extractInlineStyles(first);
  assert.equal(second.converted, 0);
  assert.equal(second.html, first);
});

test('skips empty or template-expression styles safely', () => {
  const input = '<div style="">A</div><p style="{{ dynamic }}">B</p><i style="color:red">C</i>';
  const result = extractInlineStyles(input);
  assert.equal(result.skipped, 2);
  assert.equal(result.converted, 1);
  assert.match(result.html, /style="\{\{ dynamic \}\}"/);
});

test('skips raw text elements and works on other elements', () => {
  const result = extractInlineStyles('<textarea><i style="bad:1"></i></textarea><title><div style="bad:2"></div></title><svg><path style="fill:red"/></svg>');
  assert.equal(result.converted, 1);
  assert.match(result.html, /<path class="extracted-inline-1"\/>/);
});

test('returns the original text unchanged if nothing is convertible', () => {
  const input = '<!doctype html><head><style>.x{color:red}</style></head><body><p>Text</p></body>';
  const result = extractInlineStyles(input);
  assert.deepEqual(result, { html: input, css: '', converted: 0, classes: 0, skipped: 0 });
});

test('does not include CSS style-end marker that would close injected style prematurely', () => {
  const input = '<p style="content:&#60;/style&#62;">text</p>';
  const result = extractInlineStyles(input);
  assert.equal(result.converted, 0);
  assert.equal(result.skipped, 1);
});

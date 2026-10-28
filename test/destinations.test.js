'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractInlineStyles, extractInlineStylesSimple } = require('../src/transform');

const page = '<!doctype html>\n<html><head><title>x</title></head><body><p style="color:red">Hi</p></body></html>';

for (const run of [extractInlineStyles, extractInlineStylesSimple]) {
  const kind = run === extractInlineStyles ? 'smart' : 'simple';
  test(`${kind}: default inserts new style inside existing head`, () => {
    const result = run(page);
    assert.match(result.html, /^<!doctype html>\n<html><head>\n<style>/);
    assert.ok(result.html.indexOf('</style>') < result.html.indexOf('<title>'));
    assert.ok(result.html.indexOf('</style>') < result.html.indexOf('</head>'));
    assert.match(result.css, /color:red;/);
    assert.doesNotMatch(result.html, /style="color:red"/);
  });
  test(`${kind}: top creates a new style instead of reusing an existing head style`, () => {
    const input = page.replace('<title>x</title>', '<style>.existing{margin:0}</style><title>x</title>');
    const result = run(input, { destination: 'top' });
    assert.equal((result.html.match(/<style>/g) || []).length, 2);
    assert.ok(result.html.indexOf('<style>') > result.html.indexOf('<head>'));
    assert.ok(result.html.indexOf('</style>') < result.html.indexOf('.existing{margin:0}'));
  });
  test(`${kind}: top with head attributes inserts at the start of head`, () => {
    const input = '<!doctype html><HTML><HEAD data-x="y"><meta charset="utf-8"></HEAD><body><p style="color:red">X</p></body></HTML>';
    const result = run(input);
    assert.match(result.html, /<HEAD data-x="y">\n<style>/);
    assert.ok(result.html.indexOf('</style>') < result.html.indexOf('<meta charset'));
  });
  test(`${kind}: default top falls back to after DOCTYPE when no head exists`, () => {
    const result = run('<!doctype html>\n<p style="color:red">Hi</p>');
    assert.match(result.html, /^<!doctype html>\n<style>/);
    assert.doesNotMatch(result.html, /<head>/);
  });
  test(`${kind}: head inserts inside existing head`, () => {
    const result = run(page, { destination: 'head' });
    assert.ok(result.html.indexOf('<head>') < result.html.indexOf('<style>'));
    assert.ok(result.html.indexOf('</style>') < result.html.indexOf('</head>'));
  });
  test(`${kind}: head reuses an existing unrestricted head style`, () => {
    const input = page.replace('<title>x</title>', '<style>.existing{margin:0}</style>');
    const result = run(input, { destination: 'head' });
    assert.equal((result.html.match(/<style>/g) || []).length, 1);
    assert.match(result.html, /\.existing\{margin:0\}/);
  });
  test(`${kind}: head falls back to top without creating a head`, () => {
    const result = run('<div style="color:red"></div>', { destination: 'head' });
    assert.ok(result.html.startsWith('<style>'));
    assert.doesNotMatch(result.html, /<head>/);
  });
  test(`${kind}: external inserts link in head and provides standalone CSS`, () => {
    const result = run(page, { destination: 'external', stylesheetHref: 'site.extracted.css' });
    assert.match(result.html, /<head>[\s\S]*<link rel="stylesheet" href="site.extracted.css">[\s\S]*<\/head>/);
    assert.doesNotMatch(result.html, /<style[ >]/);
    assert.match(result.css, /color:red;/);
  });
  test(`${kind}: external without head puts link at top after DOCTYPE`, () => {
    const result = run('<!doctype html><p style="color:red">A</p>', {
      destination: 'external', stylesheetHref: 'page.extracted.css'
    });
    assert.match(result.html, /^<!doctype html>\s*<link rel="stylesheet" href="page.extracted.css">/);
  });
  test(`${kind}: clipboard provides plain CSS and HTML without inserted CSS`, () => {
    const result = run(page, { destination: 'clipboard' });
    assert.doesNotMatch(result.html, /<style[ >]|<link rel=/);
    assert.doesNotMatch(result.html, /style="color:red"/);
    assert.match(result.css, /color:red;/);
  });
  test(`${kind}: clipboard-style exposes CSS for wrapping by extension`, () => {
    const result = run(page, { destination: 'clipboard-style' });
    assert.doesNotMatch(result.html, /<style[ >]|<link rel=/);
    assert.match(`<style>\n${result.css}\n</style>`, /<style>[\s\S]*color:red;[\s\S]*<\/style>/);
  });
  test(`${kind}: rejects dangerous href and unknown output mode`, () => {
    assert.throws(() => run(page, { destination: 'external', stylesheetHref: 'a" onload="x' }));
    assert.throws(() => run(page, { destination: 'external' }));
    assert.throws(() => run(page, { destination: 'invalid' }));
  });
}

test('top without head inserts after doctype and retains CRLF', () => {
  const result = extractInlineStyles('<!doctype html>\r\n<div style="color:red"></div>');
  assert.match(result.html, /^<!doctype html>\r\n<style>\r\n/);
});

test('existing CSS and attributes survive external extraction', () => {
  const html = '<head><style>.base {x:y}</style></head><main id="m" style="color:red">X</main>';
  const result = extractInlineStyles(html, { destination: 'external', stylesheetHref: 'm.extracted.css' });
  assert.match(result.html, /<style>\.base \{x:y\}<\/style>/);
  assert.match(result.html, /<main id="m">X<\/main>/);
  assert.match(result.css, /#m \{[\s\S]*color:red;/);
});

test('no-inline-style result never inserts a link or creates CSS', () => {
  const result = extractInlineStyles('<head></head><p>x</p>', { destination: 'external', stylesheetHref: 'x.css' });
  assert.equal(result.converted, 0);
  assert.equal(result.css, '');
  assert.equal(result.html, '<head></head><p>x</p>');
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractInlineStyles } = require('../src/transform');

const extract = (html) => extractInlineStyles(html);
const css = (html) => extract(html).html.split('</style>')[0];

test('1: existing class outranks tag with exactly matching coverage', () => {
  const result = extract('<span class="chip" style="color:red">a</span><span class="chip" style="color:red">b</span>');
  assert.match(result.html, /\.chip\s*\{\s*color:red;/);
  assert.doesNotMatch(css(result.html), /\bspan\s*\{/);
  assert.equal(result.classes, 0);
});

test('1: globally shared tag property outranks a class shared by a subset', () => {
  const result = extract('<span class="chip" style="color:red">a</span><span class="chip" style="color:red">b</span><span style="color:red">c</span>');
  assert.match(result.html, /\bspan\s*\{\s*color:red;/);
  assert.doesNotMatch(result.html, /\.chip\s*\{/);
});

test('2: ID takes precedence over class when both are uniquely applicable', () => {
  const result = extract('<div id="banner" class="banner" style="color:red">Hello</div>');
  assert.match(result.html, /#banner\s*\{\s*color:red;/);
  assert.doesNotMatch(result.html, /\.banner\s*\{/);
  assert.equal(result.idRules, 1);
});

test('2: shared properties can go to existing class while residual go to IDs', () => {
  const result = extract('<span class="chip" id="one" style="color:red;margin:0">A</span><span class="chip" id="two" style="color:red;margin:2px">B</span>');
  assert.match(result.html, /\.chip\s*\{\s*color:red;/);
  assert.match(result.html, /#one\s*\{\s*margin:0;/);
  assert.match(result.html, /#two\s*\{\s*margin:2px;/);
  assert.equal(result.classes, 0);
});

test('3: a property shared beyond a class is extracted at tag level', () => {
  const result = extract('<p class="x" id="a" style="margin:0;color:red;padding:1px">1</p><p class="x" id="b" style="margin:0;color:red;padding:2px">2</p><p class="y" id="c" style="margin:0;color:blue;padding:3px">3</p>');
  assert.match(result.html, /p\s*\{\s*margin:0;/);
  assert.match(result.html, /\.x\s*\{\s*color:red;/);
  assert.match(result.html, /#a\s*\{\s*padding:1px;/);
  assert.equal(result.classes, 0);
});

test('4: generated rules appear after tag and before ID rules', () => {
  const result = extract('<p id="a" style="color:blue;margin:0">A</p><p class="other" style="color:red;margin:0">B</p><p style="color:red;margin:0">C</p>');
  const style = result.html.slice(0, result.html.indexOf('</style>'));
  assert.ok(style.indexOf('p {') >= 0, style);
  assert.ok(style.indexOf('p {') < style.indexOf('.extracted-inline-'), style);
  assert.ok(style.indexOf('.extracted-inline-') < style.indexOf('#a {'), style);
});

test('4: class selectors appear before ID selectors regardless of document order', () => {
  const result = extract('<div id="x" style="width:1px"></div><div class="a" style="color:red"></div>');
  const style = result.html.slice(0, result.html.indexOf('</style>'));
  assert.ok(style.indexOf('.a {') < style.indexOf('#x {'), style);
});

test('5: repeated child tags inside parent class infer a contextual selector', () => {
  const result = extract('<div class="box"><span style="color:red">A</span><span style="color:red">B</span></div><div><span>No style</span></div>');
  assert.match(result.html, /\.box > span\s*\{\s*color:red;/);
  assert.equal(result.classes, 0);
  assert.equal(result.structuralRules, 1);
});

test('5: parent ID outranks the parent class for equal child coverage', () => {
  const result = extract('<div id="parent" class="box"><span style="color:red">A</span><span style="color:red">B</span></div><div><span>No style</span></div>');
  assert.match(result.html, /#parent > span\s*\{\s*color:red;/);
  assert.doesNotMatch(result.html, /\.box span\s*\{/);
});

test('5: div nested at second level can distinguish a group of span children', () => {
  const result = extract('<div><div><span style="color:red">A</span><span style="color:red">B</span></div><span>No</span></div>');
  assert.match(result.html, /div > div > span\s*\{\s*color:red;/);
  assert.equal(result.classes, 0);
});

test('5: tag and direct-child selectors are rejected when they hit unstyled siblings', () => {
  const result = extract('<div class="x"><span style="color:red">A</span><span style="color:red">B</span><span>C</span></div>');
  assert.doesNotMatch(result.html, /\.x span\s*\{/);
  assert.equal(result.classes, 1);
});

test('5: descendant selector accounts for nested wrappers', () => {
  const result = extract('<section id="feature"><div><span style="color:teal">A</span></div><div><span style="color:teal">B</span></div></section><section><span>No</span></section>');
  assert.match(result.html, /#feature span\s*\{\s*color:teal;/);
  assert.equal(result.classes, 0);
});

test('5: contextual selector on class ancestor beats a pure tag structural selector', () => {
  const result = extract('<div class="feature"><span style="color:red">A</span><span style="color:red">B</span></div><article><span>No</span></article>');
  assert.match(result.html, /\.feature > span\s*\{/);
  assert.doesNotMatch(result.html, /div > span\s*\{/);
});

test('5: do not accidentally treat consecutive paragraphs as descendants', () => {
  const result = extract('<div><p style="color:red">A<p style="color:red">B</div>');
  assert.match(result.html, /\bp\s*\{\s*color:red;/);
  assert.doesNotMatch(result.html, /p > p\s*\{/);
});

test('5: void elements do not become parents', () => {
  const result = extract('<div><img><span style="color:blue">A</span><span style="color:blue">B</span></div><span>No</span>');
  assert.match(result.html, /div > span\s*\{\s*color:blue;/);
});

test('duplicate ancestor IDs are not used in generated selectors', () => {
  const result = extract('<div id="same"><span style="color:red">A</span></div><div id="same"><span style="color:red">B</span></div><span>No</span>');
  assert.doesNotMatch(result.html, /#same span\s*\{/);
});

test('repeated exact residual style is still one generated class', () => {
  const result = extract('<p style="margin:0">A</p><span style="margin:0">B</span>');
  assert.equal(result.classes, 1);
  assert.equal((result.html.match(/class="extracted-inline-1"/g) || []).length, 2);
});

test('re-running smart extraction is idempotent', () => {
  const input = '<div id="box"><span style="color:red">A</span><span style="color:red">B</span></div>';
  const once = extract(input);
  const twice = extract(once.html);
  assert.equal(twice.converted, 0);
  assert.equal(once.html, twice.html);
});

test('reuse an existing class with a tag qualifier when plain class is unsafe', () => {
  const result = extract('<span class="common" style="color:red">A</span><div class="common">B</div>');
  assert.match(result.html, /span\.common\s*\{\s*color:red;/);
  assert.equal(result.classes, 0);
});

test('shared qualified class selector does not affect unrelated elements using the class', () => {
  const result = extract('<span class="common" style="color:red">A</span><span class="common" style="color:red">B</span><div class="common">C</div>');
  assert.match(result.html, /span\.common\s*\{\s*color:red;/);
  assert.equal(result.classes, 0);
});

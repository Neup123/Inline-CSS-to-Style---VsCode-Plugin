'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('extension metadata credits Neup123 as author and publisher', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.author.name, 'Neup123');
  assert.equal(pkg.author.url, 'https://github.com/Neup123');
  assert.equal(pkg.publisher, 'Neup123');
  assert.equal(pkg.license, 'MIT');
});

test('MIT license and README retain the author attribution', () => {
  assert.match(fs.readFileSync(path.join(root, 'LICENSE'), 'utf8'), /Copyright \(c\) 2026 Neup123/);
  assert.match(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), /Created by \*\*\[Neup123\]/);
});

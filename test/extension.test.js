'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

/**
 * Replace the VS Code host in tests, without requiring a running GUI.
 * @param {string} destination
 * @param {object} options
 * @returns {object}
 */
function setup(destination, options = {}) {
  const actions = { edits: [], copied: [], notifications: [], handler: null };
  const input = options.input || '<!doctype html><html><head></head><body><p style="color:red">X</p></body></html>';
  const document = {
    languageId: 'html', isUntitled: Boolean(options.untitled),
    uri: { path: '/folder/index.html' },
    getText: () => input, positionAt: (offset) => ({ offset })
  };
  class WorkspaceEdit {
    constructor() { this.actions = []; actions.edits.push(this.actions); }
    replace(...args) { this.actions.push({ type: 'replace', args }); }
    createFile(...args) { this.actions.push({ type: 'create', args }); }
    insert(...args) { this.actions.push({ type: 'insert', args }); }
  }
  const vscode = {
    commands: { registerCommand: (_, handler) => { actions.handler = handler; return { dispose() {} }; } },
    window: {
      activeTextEditor: { document },
      showInformationMessage: (message) => actions.notifications.push(message),
      showWarningMessage: (message) => actions.notifications.push(message),
      showErrorMessage: (message) => actions.notifications.push(message)
    },
    env: { clipboard: { writeText: async (value) => actions.copied.push(value) } },
    workspace: {
      getConfiguration: () => ({ get: (key, fallback) => key === 'destination' ? destination : fallback }),
      fs: { stat: async (uri) => {
        if (options.existingNames?.includes(uri.path.split('/').at(-1))) return {};
        const error = new Error('Not found'); error.code = 'FileNotFound'; throw error;
      } },
      applyEdit: async () => options.applyError ? false : true
    },
    WorkspaceEdit,
    Uri: { joinPath: (uri, _up, filename) => ({ path: `/folder/${filename}` }) },
    Range: class { constructor(start, end) { this.start = start; this.end = end; } },
    Position: class { constructor(line, character) { this.line = line; this.character = character; } }
  };
  const oldLoad = Module._load;
  Module._load = function (name, ...rest) {
    if (name === 'vscode') return vscode;
    return oldLoad.call(this, name, ...rest);
  };
  try {
    delete require.cache[require.resolve('../src/extension')];
    require('../src/extension').activate({ subscriptions: [] });
  } finally {
    Module._load = oldLoad;
  }
  return actions;
}

test('external creates adjacent CSS and adds link atomically in WorkspaceEdit', async () => {
  const actions = setup('external');
  await actions.handler();
  const edits = actions.edits[0];
  assert.equal(edits.length, 3);
  assert.deepEqual(edits.map(e => e.type), ['create', 'insert', 'replace']);
  assert.equal(edits[0].args[0].path, '/folder/index.extracted.css');
  assert.match(edits[1].args[2], /color:red;/);
  assert.match(edits[2].args[2], /href="index.extracted.css"/);
  assert.equal(actions.copied.length, 0);
});

test('external chooses noncolliding filename and never overwrites', async () => {
  const actions = setup('external', { existingNames: ['index.extracted.css', 'index.extracted-2.css'] });
  await actions.handler();
  assert.equal(actions.edits[0][0].args[0].path, '/folder/index.extracted-3.css');
  assert.deepEqual(actions.edits[0][0].args[1], {overwrite: false, ignoreIfExists: false});
});

test('external aborts with helpful message for an unsaved document', async () => {
  const actions = setup('external', { untitled: true });
  await actions.handler();
  assert.equal(actions.edits.length, 0);
  assert.match(actions.notifications.join(' '), /Save the HTML file/);
});

for (const destination of ['clipboard', 'clipboard-style']) {
  test(`${destination} copies expected CSS and updates HTML without insertion`, async () => {
    const actions = setup(destination);
    await actions.handler();
    assert.equal(actions.copied.length, 1);
    assert.equal(actions.copied[0].startsWith('<style>'), destination === 'clipboard-style');
    assert.match(actions.copied[0], /color:red;/);
    const html = actions.edits[0][0].args[2];
    assert.doesNotMatch(html, /<style[ >]|<link rel=/);
    assert.doesNotMatch(html, /style="color:red"/);
  });
}

test('top is default if settings are absent', async () => {
  const actions = setup(undefined);
  await actions.handler();
  assert.match(actions.edits[0][0].args[2], /^<!doctype html>\n<style>/);
});

'use strict';

// Created by Neup123 (https://github.com/Neup123). MIT licensed.


const vscode = require('vscode');
const { extractInlineStyles } = require('./transform');

/**
 * Pick a new CSS file in the same directory without overwriting any existing
 * file. Checking again during WorkspaceEdit.createFile avoids silent clobbers.
 * @param {import('vscode').TextDocument} document
 * @returns {Promise<{uri:import('vscode').Uri,href:string}>}
 */
async function chooseStylesheet(document) {
  if (document.isUntitled) {
    throw new Error('Save the HTML file before extracting CSS into a separate file.');
  }
  const basename = document.uri.path.split('/').at(-1).replace(/\.[^.]+$/, '') || 'styles';
  for (let n = 1; n <= 1000; n++) {
    const filename = `${basename}.extracted${n === 1 ? '' : '-' + n}.css`;
    const uri = vscode.Uri.joinPath(document.uri, '..', filename);
    try {
      await vscode.workspace.fs.stat(uri);
    } catch (error) {
      if (error.code === 'FileNotFound') {
        return { uri, href: encodeURIComponent(filename) };
      }
      throw error;
    }
  }
  throw new Error('Could not find an unused stylesheet filename.');
}

/**
 * Activate the extension only when the command is invoked.
 * @param {import('vscode').ExtensionContext} context
 * @returns {void}
 */
function activate(context) {
  context.subscriptions.push(vscode.commands.registerCommand('inlineCssToStyle.extract', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showInformationMessage('Open an HTML file first.');
      return;
    }
    if (editor.document.languageId !== 'html') {
      vscode.window.showWarningMessage('Inline CSS to Style currently supports HTML files only.');
      return;
    }
    try {
      const document = editor.document;
      const before = document.getText();
      const config = vscode.workspace.getConfiguration('inlineCssToStyle');
      const mode = config.get('mode', 'smart');
      const destination = config.get('destination', 'top');
      const stylesheet = destination === 'external' ? await chooseStylesheet(document) : null;
      const result = extractInlineStyles(before, {
        mode, destination, stylesheetHref: stylesheet?.href
      });
      if (result.converted === 0) {
        vscode.window.showInformationMessage(result.skipped
          ? `No styles converted (${result.skipped} unsupported/empty attributes skipped).`
          : 'No inline style attributes found.');
        return;
      }
      const clipboard = destination === 'clipboard' || destination === 'clipboard-style';
      if (clipboard) {
        const newline = before.includes('\r\n') ? '\r\n' : '\n';
        const contents = destination === 'clipboard-style'
          ? `<style>${newline}${result.css}${newline}</style>` : result.css;
        // Copy first: if the clipboard is unavailable, keep the source intact.
        await vscode.env.clipboard.writeText(contents);
      }
      const edit = new vscode.WorkspaceEdit();
      if (stylesheet) {
        edit.createFile(stylesheet.uri, { overwrite: false, ignoreIfExists: false });
        edit.insert(stylesheet.uri, new vscode.Position(0, 0), result.css + '\n');
      }
      edit.replace(document.uri,
        new vscode.Range(document.positionAt(0), document.positionAt(before.length)), result.html);
      const success = await vscode.workspace.applyEdit(edit);
      if (!success) {
        vscode.window.showErrorMessage('Could not update the HTML document and CSS destination.');
        return;
      }
      const summary = `Extracted ${result.converted} inline style(s): ${result.classes} new class(es)` +
        (result.reusedClasses ? `, ${result.reusedClasses} existing class rule(s)` : '') +
        (result.tagRules ? `, ${result.tagRules} tag rule(s)` : '') +
        (result.idRules ? `, ${result.idRules} ID rule(s)` : '') +
        (result.structuralRules ? `, ${result.structuralRules} parent/child rule(s)` : '') +
        (result.skipped ? `; skipped ${result.skipped}.` : '.');
      vscode.window.showInformationMessage(summary + (clipboard
        ? ' CSS copied to clipboard — paste it into a stylesheet to restore the extracted styling.'
        : stylesheet ? ` Created ${stylesheet.uri.path.split('/').at(-1)}.` : ''));
    } catch (error) {
      vscode.window.showErrorMessage(`Inline CSS extraction failed: ${error.message}`);
    }
  }));
}

/** @returns {void} */
function deactivate() {}

module.exports = { activate, deactivate };

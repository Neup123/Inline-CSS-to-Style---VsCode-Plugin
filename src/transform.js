'use strict';

// Created by Neup123 (https://github.com/Neup123). MIT licensed.


/**
 * Dependency-free HTML inline-style extractor. It intentionally does not parse
 * existing CSS: malformed stylesheets cannot make extraction itself fail.
 *
 * @module transform
 */

const NAMED_ENTITIES = require('./html-entities.json');

/** @param {string} char @returns {boolean} */
function isWhitespace(char) {
  return char === ' ' || char === '\n' || char === '\r' || char === '\t' || char === '\f';
}

/** @param {string} char @returns {boolean} */
function isTagNameStart(char) {
  return Boolean(char && /[A-Za-z]/.test(char));
}

/**
 * Decode HTML entities as parsed in an HTML attribute value. Many CSS values
 * contain &quot; / &amp; and numeric references; these must not remain encoded
 * after moving their contents out of an attribute into a style element.
 *
 * @param {string} value HTML attribute value
 * @returns {string}
 */
function decodeHtmlAttribute(value) {
  return value.replace(/&/g, '\u0000').split('\u0000').map((piece, i) => {
    if (i === 0) return piece;
    if (piece[0] === '#') {
      const match = /^#(?:[xX]([0-9A-Fa-f]+)|([0-9]+));?/.exec(piece);
      if (match) {
        const number = Number.parseInt(match[1] || match[2], match[1] ? 16 : 10);
        // HTML5's special handling for legacy C1 numeric references.
        const replacements = {
          0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e,
          0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6,
          0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152,
          0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c,
          0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
          0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a,
          0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178
        };
        const cp = replacements[number] || number;
        const valid = cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff);
        return (valid ? String.fromCodePoint(cp) : '\ufffd') + piece.slice(match[0].length);
      }
    }
    // HTML5 resolves the longest known named entity. Some named references
    // legally omit their trailing semicolon in attribute context.
    const match = /^[A-Za-z][A-Za-z0-9]{0,32};?/.exec(piece);
    if (match) {
      const candidate = match[0];
      for (let length = candidate.length; length >= 1; length--) {
        const name = candidate.slice(0, length);
        const replacement = NAMED_ENTITIES[name];
        if (replacement !== undefined) {
          if (!name.endsWith(';') && /[A-Za-z0-9=]/.test(piece[length] || '')) {
            continue;
          }
          return replacement + piece.slice(length);
        }
      }
    }
    return '&' + piece;
  }).join('');
}

/**
 * Scan a start tag, respecting quotes inside attribute values. This is more
 * reliable than searching for style attributes with a regular expression.
 *
 * @param {string} html
 * @param {number} start Index of '<'
 * @returns {{name:string,start:number,end:number,attributes:Array<object>}|null}
 */
function readStartTag(html, start) {
  let i = start + 1;
  if (!isTagNameStart(html[i])) return null;
  const nameStart = i;
  while (i < html.length && /[\w:-]/.test(html[i])) i++;
  const name = html.slice(nameStart, i).toLowerCase();
  const attributes = [];

  while (i < html.length) {
    while (isWhitespace(html[i])) i++;
    if (html[i] === '>') return { name, start, end: i + 1, attributes };
    if (html[i] === '/' && html[i + 1] === '>') {
      return { name, start, end: i + 2, attributes };
    }
    if (i >= html.length) break;
    // Stray '/' is not an attribute (may be a malformed self-closing tag).
    if (html[i] === '/') { i++; continue; }
    const attributeStart = i;
    while (i < html.length && !isWhitespace(html[i]) && !/[=/>]/.test(html[i])) i++;
    if (i === attributeStart) { i++; continue; }
    const attributeName = html.slice(attributeStart, i).toLowerCase();
    while (isWhitespace(html[i])) i++;
    let value = null;
    let valueStart = null;
    let valueEnd = null;
    let quote = null;
    if (html[i] === '=') {
      i++;
      while (isWhitespace(html[i])) i++;
      if (html[i] === '"' || html[i] === "'") {
        quote = html[i++];
        valueStart = i;
        const closingQuote = html.indexOf(quote, i);
        if (closingQuote === -1) return null; // Never corrupt incomplete HTML.
        valueEnd = closingQuote;
        value = html.slice(i, closingQuote);
        i = closingQuote + 1;
      } else {
        valueStart = i;
        while (i < html.length && !isWhitespace(html[i]) && html[i] !== '>') i++;
        valueEnd = i;
        value = html.slice(valueStart, valueEnd);
      }
    }
    attributes.push({ name: attributeName, start: attributeStart, end: i, value, valueStart, valueEnd, quote });
  }
  return null;
}

/**
 * Find an end tag for a raw-text element such as <script>, without processing
 * angle brackets inside its contents.
 * @param {string} html
 * @param {string} name
 * @param {number} from
 * @returns {{start:number,end:number}|null}
 */
function findRawClose(html, name, from) {
  const regex = new RegExp(`<\\/${name}(?=[\\s>])[^>]*>`, 'gi');
  regex.lastIndex = from;
  const match = regex.exec(html);
  return match ? { start: match.index, end: regex.lastIndex } : null;
}

/**
 * Enumerate real HTML tags and head/style insertion points. Content within
 * script, style, textarea and comments is deliberately left alone.
 * @param {string} html
 * @returns {object}
 */
function scanHtml(html) {
  /** @type {Array<object>} */
  const tags = [];
  /** @type {Array<object>} */
  const eligibleStyles = [];
  let headOpen = null;
  let headClose = null;
  let htmlOpen = null;
  let bodyOpen = null;
  let doctypeEnd = null;
  let inHead = false;
  /** @type {Array<object>} Open ancestors for structural selector analysis. */
  const stack = [];
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img',
    'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  let i = 0;

  while (i < html.length) {
    const start = html.indexOf('<', i);
    if (start === -1) break;
    if (html.startsWith('<!--', start)) {
      const end = html.indexOf('-->', start + 4);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith('<![CDATA[', start)) {
      const end = html.indexOf(']]>', start + 9);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    if (/^<!doctype\b/i.test(html.slice(start, start + 12))) {
      const end = html.indexOf('>', start + 2);
      if (end === -1) break;
      if (doctypeEnd === null) doctypeEnd = end + 1;
      i = end + 1;
      continue;
    }
    if (html.startsWith('<!', start)) {
      const end = html.indexOf('>', start + 2);
      i = end === -1 ? html.length : end + 1;
      continue;
    }
    if (html.startsWith('<?', start)) {
      const end = html.indexOf('?>', start + 2);
      i = end === -1 ? html.length : end + 2;
      continue;
    }
    if (html.startsWith('</', start)) {
      const closing = /^<\/\s*([A-Za-z][\w:-]*)[^>]*>/.exec(html.slice(start));
      if (closing) {
        const name = closing[1].toLowerCase();
        if (name === 'head') {
          headClose = { start, end: start + closing[0].length };
          inHead = false;
        }
        const match = stack.findLastIndex((open) => open.name === name);
        if (match !== -1) stack.length = match;
        i = start + closing[0].length;
        continue;
      }
    }
    const tag = readStartTag(html, start);
    if (!tag) { i = start + 1; continue; }
    // Account for common HTML optional closing tags, so sibling <p>/<li>
    // elements do not erroneously become one another's descendants.
    const implicitClose = new Set(['p', 'li', 'dt', 'dd', 'option', 'tr', 'td', 'th']);
    if (implicitClose.has(tag.name)) {
      const previous = stack.findLastIndex((open) => open.name === tag.name);
      if (previous !== -1) stack.length = previous;
    }
    if (tag.name === 'body') {
      const headIndex = stack.findLastIndex((open) => open.name === 'head');
      if (headIndex !== -1) stack.length = headIndex;
    }
    tag.parent = stack.length ? stack[stack.length - 1] : null;
    tags.push(tag);
    if (tag.name === 'html' && !htmlOpen) htmlOpen = tag;
    if (tag.name === 'head') { headOpen = tag; inHead = true; }
    if (tag.name === 'body' && !bodyOpen) { bodyOpen = tag; inHead = false; }

    if (['style', 'script', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes'].includes(tag.name)) {
      const close = findRawClose(html, tag.name, tag.end);
      if (tag.name === 'style' && inHead && close) {
        const type = tag.attributes.find((attr) => attr.name === 'type')?.value?.toLowerCase().trim();
        const media = tag.attributes.find((attr) => attr.name === 'media')?.value?.toLowerCase().trim();
        const restricted = tag.attributes.some((attr) => ['disabled', 'scoped'].includes(attr.name));
        if ((!type || type === 'text/css') && (!media || media === 'all') && !restricted) {
          eligibleStyles.push(close);
        }
      }
      i = close ? close.end : html.length;
      continue;
    }
    if (!voidTags.has(tag.name) && !html.slice(tag.start, tag.end).endsWith('/>')) {
      stack.push(tag);
    }
    i = tag.end;
  }
  return { tags, eligibleStyles, headOpen, headClose, htmlOpen, bodyOpen, doctypeEnd };
}

/**
 * Insert the extracted rules at the selected destination. 'top' creates a
 * new <style> as the first element in an existing <head>; 'head' reuses an
 * eligible <style> in <head> or appends one. Both fall back to the start of
 * the HTML document if no explicit <head> exists, without inventing one.
 *
 * @param {string} source Original HTML
 * @param {Array<{start:number,end:number,text:string}>} edits Attribute edits
 * @param {ReturnType<typeof scanHtml>} parsed HTML structure
 * @param {string} css Newly generated stylesheet
 * @param {object} options
 * @returns {{html:string,css:string}}
 */
function renderOutput(source, edits, parsed, css, options = {}) {
  const destination = options.destination || 'top';
  if (!['top', 'head', 'external', 'clipboard', 'clipboard-style'].includes(destination)) {
    throw new Error(`Invalid CSS destination: ${destination}`);
  }
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const styleBlock = `<style>${newline}${css}${newline}</style>`;
  let insert = '';
  let position = null;
  if (destination === 'external') {
    const href = options.stylesheetHref;
    if (typeof href !== 'string' || !href || /[\r\n"<>]/.test(href)) {
      throw new Error('A safe stylesheetHref is required for external extraction.');
    }
    insert = `<link rel="stylesheet" href="${href.replace(/&/g, '&amp;')}">`;
    position = parsed.headClose ? parsed.headClose.start : parsed.headOpen ? parsed.headOpen.end : null;
  } else if (destination === 'head' && parsed.headOpen) {
    const existing = parsed.eligibleStyles.at(-1);
    if (existing) {
      edits.push({ start: existing.start, end: existing.start, text: `${newline}${newline}${css}${newline}` });
      return { html: applyEdits(source, edits), css };
    }
    insert = styleBlock;
    position = parsed.headClose ? parsed.headClose.start : parsed.headOpen.end;
  } else if (destination === 'top' && parsed.headOpen) {
    // A document with an explicit <head> must never receive <style> outside it.
    // Unlike 'head', 'top' always creates a new block at the start of <head>.
    insert = styleBlock;
    position = parsed.headOpen.end;
  } else if (destination === 'top' || destination === 'head') {
    // HTML fragments without a <head>: fall back to the start of the file.
    insert = styleBlock;
  }
  // The HTML document is changed even for clipboard modes: the clipboard
  // contains the CSS that must be pasted to complete the visual refactor.
  if (insert) {
    if (position !== null) {
      const before = position === parsed.headOpen?.end ? newline : '';
      edits.push({ start: position, end: position, text: `${before}${insert}${newline}` });
    } else if (parsed.doctypeEnd !== null) {
      // Never precede DOCTYPE, because it would trigger quirks mode.
      edits.push({ start: parsed.doctypeEnd, end: parsed.doctypeEnd, text: `${newline}${insert}${newline}` });
    } else {
      edits.push({ start: 0, end: 0, text: `${insert}${newline}` });
    }
  }
  return { html: applyEdits(source, edits), css };
}

/**
 * Apply non-overlapping replacements from the back toward the front.
 * @param {string} source
 * @param {Array<{start:number,end:number,text:string}>} edits
 * @returns {string}
 */
function applyEdits(source, edits) {
  let result = source;
  for (const edit of edits.sort((a, b) => b.start - a.start || b.end - a.end)) {
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  }
  return result;
}

/**
 * Pull a style attribute into a generated class and a <style> element.
 *
 * @param {string} source An HTML document or HTML fragment
 * @param {{prefix?:string,destination?:string,stylesheetHref?:string}} [options]
 * @returns {{html:string, converted:number, classes:number, skipped:number}}
 */
function extractInlineStylesSimple(source, options = {}) {
  if (typeof source !== 'string') throw new TypeError('HTML must be a string.');
  const prefix = /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(options.prefix || '')
    ? options.prefix : 'extracted-inline';
  const parsed = scanHtml(source);
  const edits = [];
  const rules = [];
  const known = new Map();
  let counter = 1;
  let converted = 0;
  let skipped = 0;
  const newline = source.includes('\r\n') ? '\r\n' : '\n';

  for (const tag of parsed.tags) {
    const styleAttributes = tag.attributes.filter((attr) => attr.name === 'style');
    if (styleAttributes.length === 0) continue;
    const classAttributes = tag.attributes.filter((attr) => attr.name === 'class');
    const style = styleAttributes[0];
    if (styleAttributes.length !== 1 || classAttributes.length > 1 || typeof style.value !== 'string') {
      skipped++;
      continue;
    }
    const css = decodeHtmlAttribute(style.value).trim();
    if (!css) { skipped++; continue; }
    // Avoid converting template variables or an HTML style-end sequence into
    // syntactically broken CSS. Such attributes remain untouched.
    if (/<\/style\s*>/i.test(css) || /\{[{%]|[%}]\}/.test(css)) {
      skipped++;
      continue;
    }
    if (classAttributes[0] && classAttributes[0].value === null) {
      skipped++;
      continue;
    }
    if (classAttributes[0] && /\{[{%]|[%}]\}/.test(classAttributes[0].value)) {
      skipped++;
      continue;
    }
    let name = known.get(css.replace(/;+\s*$/, ''));
    if (!name) {
      do { name = `${prefix}-${counter++}`; } while (source.includes(name));
      known.set(css.replace(/;+\s*$/, ''), name);
      rules.push({ name, css });
    }
    if (classAttributes.length === 0) {
      // Replace the attribute in place, leaving the rest of the tag untouched.
      edits.push({ start: style.start, end: style.end, text: `class="${name}"` });
    } else {
      const oldClass = classAttributes[0];
      // The new class is ASCII-safe. Do not decode/re-encode existing class names.
      if (oldClass.quote) {
        edits.push({ start: oldClass.valueStart, end: oldClass.valueEnd,
          text: `${oldClass.value}${oldClass.value ? ' ' : ''}${name}` });
      } else {
        edits.push({ start: oldClass.start, end: oldClass.end,
          text: `class="${oldClass.value.replace(/"/g, '&quot;')} ${name}"` });
      }
      let removeStart = style.start;
      while (removeStart > tag.start && isWhitespace(source[removeStart - 1])) removeStart--;
      edits.push({ start: removeStart, end: style.end, text: '' });
    }
    converted++;
  }

  if (rules.length === 0) return { html: source, css: '', converted, classes: 0, skipped };

  const ruleText = rules.map(({ name, css }) => {
    const declarations = css.replace(/;\s*$/, '').replace(/\r?\n/g, newline + '  ');
    return `.${name} {${newline}  ${declarations};${newline}}`;
  }).join(newline + newline);

  return { ...renderOutput(source, edits, parsed, ruleText, options), converted, classes: rules.length, skipped };
}

/**
 * Split a declaration list only on semicolons outside quotes, comments,
 * functions, brackets, and custom-property blocks. Reject uncertain input.
 * Group duplicate properties together (e.g. prefixed fallback values).
 *
 * @param {string} css
 * @returns {Map<string,{key:string,css:string}>|null}
 */
function parseDeclarations(css) {
  const chunks = [];
  let start = 0;
  let quote = null;
  let escaped = false;
  let comment = false;
  let depth = 0;
  let braces = 0;
  let brackets = 0;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    const next = css[i + 1];
    if (comment) {
      if (ch === '*' && next === '/') { comment = false; i++; }
      continue;
    }
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (quote) { if (ch === quote) quote = null; continue; }
    if (ch === '/' && next === '*') { comment = true; i++; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') { if (--depth < 0) return null; }
    else if (ch === '[') brackets++;
    else if (ch === ']') { if (--brackets < 0) return null; }
    else if (ch === '{') braces++;
    else if (ch === '}') { if (--braces < 0) return null; }
    else if (ch === ';' && depth === 0 && braces === 0 && brackets === 0) {
      chunks.push(css.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (quote || escaped || comment || depth || braces || brackets) return null;
  chunks.push(css.slice(start).trim());
  const result = new Map();
  for (const chunk of chunks.filter(Boolean)) {
    let colon = -1;
    let q = null;
    let e = false;
    let d = 0;
    let c = false;
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i];
      if (c) { if (ch === '*' && chunk[i + 1] === '/') { c = false; i++; } continue; }
      if (e) { e = false; continue; }
      if (ch === '\\') { e = true; continue; }
      if (q) { if (ch === q) q = null; continue; }
      if (ch === '/' && chunk[i + 1] === '*') { c = true; i++; continue; }
      if (ch === "'" || ch === '"') { q = ch; continue; }
      if (ch === '(' || ch === '[' || ch === '{') { d++; continue; }
      if (ch === ')' || ch === ']' || ch === '}') { d--; continue; }
      if (ch === ':' && d === 0) { colon = i; break; }
    }
    if (colon < 0) return null;
    const property = chunk.slice(0, colon).trim();
    const value = chunk.slice(colon + 1).trim();
    // Deliberately conservative: uncertain syntax stays inline.
    if (!/^--[\w-]+$|^-?[_a-zA-Z][_a-zA-Z0-9-]*$/.test(property) || !value) return null;
    const normalizedProperty = property.startsWith('--') ? property : property.toLowerCase();
    const key = `${normalizedProperty}:${value}`;
    const prev = result.get(normalizedProperty);
    if (prev) {
      prev.key += `;${key}`;
      prev.css += `; ${chunk}`;
    } else {
      result.set(normalizedProperty, { key, css: chunk });
    }
  }
  return result.size ? result : null;
}

/** @param {string} value @returns {boolean} */
function containsTemplate(value) {
  return /\{[{%]|[%}]\}|<\/style\s*>/i.test(value);
}

/**
 * Build a CSS rule from properties in insertion order.
 * @param {Map<string, {key:string,css:string}>} properties
 * @param {string} newline
 * @returns {string}
 */
function renderDeclarations(properties, newline) {
  return [...properties.values()].map((item) => item.css.replace(/\r?\n/g, newline + '  ') + ';').join(newline + '  ');
}

/**
 * Infer reusable selectors from the complete static HTML tree, evaluating CSS
 * declarations one property at a time. A selector may take a declaration only
 * when EVERY element currently matched by that selector has it inline with the
 * same value. Thus we never infer from a few styled siblings while ignoring
 * an unstyled or differently styled sibling.
 *
 * Selection is by widest valid coverage first. Ties use CSS selector strength
 * ID > class > tag, then prefer short/simple selectors. This makes a shared
 * class beat a shared tag when they cover precisely the same elements, while
 * letting a genuinely broader tag extract properties also shared by classes.
 *
 * @param {string} source
 * @param {{prefix?:string,mode?:'smart'|'simple',destination?:string,stylesheetHref?:string}} [options]
 * @returns {{html:string,converted:number,classes:number,skipped:number,reusedClasses:number,tagRules:number,idRules:number,structuralRules:number}}
 */
function extractInlineStyles(source, options = {}) {
  if (options.mode === 'simple') return extractInlineStylesSimple(source, options);
  if (typeof source !== 'string') throw new TypeError('HTML must be a string.');
  const parsed = scanHtml(source);
  const prefix = /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(options.prefix || '')
    ? options.prefix : 'extracted-inline';
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const edits = [];
  const records = [];
  const all = [];
  let skipped = 0;

  const validIdentifier = (name) => /^[A-Za-z_][A-Za-z0-9_-]*$/.test(name);
  const tagToItem = new Map();
  const idCounts = new Map();

  for (const tag of parsed.tags) {
    const styleAttrs = tag.attributes.filter((a) => a.name === 'style');
    const classAttrs = tag.attributes.filter((a) => a.name === 'class');
    const idAttrs = tag.attributes.filter((a) => a.name === 'id');
    const classValue = classAttrs.length === 1 && classAttrs[0].value !== null
      ? decodeHtmlAttribute(classAttrs[0].value) : '';
    const classes = classValue && !containsTemplate(classValue)
      ? [...new Set(classValue.split(/\s+/).filter(validIdentifier))] : [];
    const idValue = idAttrs.length === 1 && idAttrs[0].value !== null
      ? decodeHtmlAttribute(idAttrs[0].value) : '';
    const id = validIdentifier(idValue) ? idValue : null;
    if (id) idCounts.set(id, (idCounts.get(id) || 0) + 1);
    const item = {
      tag, classes, id, remaining: null, properties: null,
      classAttribute: classAttrs[0] || null, styleAttribute: styleAttrs[0] || null,
      generated: null
    };
    all.push(item);
    tagToItem.set(tag, item);
    if (!styleAttrs.length) continue;
    if (styleAttrs.length !== 1 || classAttrs.length > 1 || idAttrs.length > 1 ||
      classAttrs.some((a) => a.value === null || containsTemplate(a.value)) ||
      !styleAttrs[0].value) { skipped++; continue; }
    const css = decodeHtmlAttribute(styleAttrs[0].value).trim();
    if (!css || containsTemplate(css)) { skipped++; continue; }
    const properties = parseDeclarations(css);
    if (!properties) { skipped++; continue; }
    item.properties = properties;
    item.remaining = new Map(properties);
    records.push(item);
  }
  const emptyResult = { html: source, css: '', converted: 0, classes: 0, skipped,
    reusedClasses: 0, tagRules: 0, idRules: 0, structuralRules: 0 };
  if (!records.length) return emptyResult;

  // Candidate parts are simple tag, class or ID tokens joined with either a
  // descendant space or a direct-child > combinator. Matching is done using
  // the scanned parent references, never by running untrusted CSS/JS.
  const token = (kind, value) => ({ kind, value });
  const tokensFor = (item) => {
    const result = [token('tag', item.tag.name)];
    for (const name of item.classes.slice(0, 8)) {
      result.push(token('class', name));
      result.push(token('tagClass', `${item.tag.name}.${name}`));
    }
    if (item.id && idCounts.get(item.id) === 1) result.push(token('id', item.id));
    return result;
  };
  const tokenText = (part) => part.kind === 'tag' || part.kind === 'tagClass'
    ? part.value : (part.kind === 'id' ? '#' : '.') + part.value;
  const candidates = new Map();
  const add = (parts, connectors, record) => {
    const selector = parts.map((part, index) =>
      (index ? (connectors[index - 1] === '>' ? ' > ' : ' ') : '') + tokenText(part)).join('');
    let candidate = candidates.get(selector);
    if (!candidate) {
      const tier = parts.some((p) => p.kind === 'id') ? 2
        : parts.some((p) => p.kind === 'class' || p.kind === 'tagClass') ? 1 : 0;
      candidate = { selector, parts, connectors, tier, origins: new Set(),
        structural: parts.length > 1, matches: null, shared: null };
      candidates.set(selector, candidate);
    }
    candidate.origins.add(record);
  };
  for (const record of records) {
    const ownTokens = tokensFor(record);
    for (const own of ownTokens) add([own], [], record);
    const ancestors = [];
    let parent = record.tag.parent;
    while (parent && ancestors.length < 4) {
      ancestors.push(tagToItem.get(parent));
      parent = parent.parent;
    }
    for (let distance = 1; distance <= ancestors.length; distance++) {
      const anchor = ancestors[distance - 1];
      const anchorTokens = tokensFor(anchor);
      for (const anc of anchorTokens) {
        for (const own of ownTokens) {
          add([anc, own], [' '], record);
          if (distance === 1) add([anc, own], ['>'], record);
          if (distance >= 2) {
            // Exact parent/child chain: div > div > span, .shell > div > span.
            const intermediate = ancestors.slice(0, distance - 1).reverse();
            const base = intermediate.map((node) => token('tag', node.tag.name));
            const chain = [anc, ...base, own];
            const connectors = Array(chain.length - 1).fill('>');
            add(chain, connectors, record);
            // Recognize a shared class or ID on an intermediate parent.
            for (let i = 0; i < intermediate.length; i++) {
              for (const variant of tokensFor(intermediate[i]).slice(1)) {
                const upgraded = [...chain];
                upgraded[i + 1] = variant;
                add(upgraded, connectors, record);
              }
            }
          }
        }
      }
    }
  }
  const matchesPart = (part, item) => {
    if (part.kind === 'tag') return item.tag.name === part.value;
    if (part.kind === 'class') return item.classes.includes(part.value);
    if (part.kind === 'tagClass') {
      const index = part.value.indexOf('.');
      return item.tag.name === part.value.slice(0, index) &&
        item.classes.includes(part.value.slice(index + 1));
    }
    return item.id === part.value;
  };
  const matchesSelector = (candidate, target) => {
    let current = target;
    const { parts, connectors } = candidate;
    if (!matchesPart(parts[parts.length - 1], current)) return false;
    for (let pos = parts.length - 2; pos >= 0; pos--) {
      current = current.tag.parent ? tagToItem.get(current.tag.parent) : null;
      if (connectors[pos] === '>') {
        if (!current || !matchesPart(parts[pos], current)) return false;
      } else {
        while (current && !matchesPart(parts[pos], current)) {
          current = current.tag.parent ? tagToItem.get(current.tag.parent) : null;
        }
        if (!current) return false;
      }
    }
    return true;
  };
  const same = (a, b) => a && b && a.key === b.key;
  const commonProperties = (members) => {
    if (members.some((r) => !r.properties)) return new Map();
    const shared = new Map();
    for (const [property, item] of members[0].properties) {
      if (members.every((r) => same(r.properties.get(property), item))) shared.set(property, item);
    }
    return shared;
  };
  const excludeTags = new Set(['html', 'head', 'style', 'script', 'link', 'meta', 'title', 'template']);
  const usable = [];
  for (const candidate of candidates.values()) {
    // Only a standalone class/ID is allowed to target a single element. A
    // single example cannot safely establish a structural or tag-wide rule.
    const standalone = !candidate.structural && candidate.tier > 0;
    if (!standalone && candidate.origins.size < 2) continue;
    if (!candidate.structural && candidate.tier === 0 && excludeTags.has(candidate.parts[0].value)) continue;
    // This matcher is deliberately independent from styling: even an unstyled
    // element invalidates a property inferred for a broad selector.
    const members = all.filter((item) => matchesSelector(candidate, item));
    if (members.length < (standalone ? 1 : 2)) continue;
    const shared = commonProperties(members);
    if (!shared.size) continue;
    candidate.matches = members;
    candidate.shared = shared;
    usable.push(candidate);
  }

  /** @type {Map<string,{selector:string,props:Map,kind:string,tier:number,structural:boolean}>} */
  const ruleMap = new Map();
  const putRule = (selector, props, tier, kind, structural = false) => {
    if (!ruleMap.has(selector)) ruleMap.set(selector, {
      selector, props: new Map(), tier, kind, structural
    });
    const entry = ruleMap.get(selector);
    for (const [property, value] of props) entry.props.set(property, value);
  };
  // Cover each CSS property independently: a property shared by all spans
  // belongs to span, while a second property shared only by .notice belongs
  // to .notice. Score largest valid groups before applying ID > class > tag.
  const properties = new Set(records.flatMap((record) => [...record.properties.keys()]));
  for (const property of properties) {
    while (true) {
      let best = null;
      let bestUncovered = 1;
      for (const candidate of usable) {
        if (!candidate.shared.has(property)) continue;
        const uncovered = candidate.matches.filter((item) => item.remaining?.has(property)).length;
        if (uncovered < 2) continue;
        const compare = (left, right) => {
          if (left.matches.length !== right.matches.length) return left.matches.length - right.matches.length;
          if (left.tier !== right.tier) return left.tier - right.tier;
          if (left.structural !== right.structural) return Number(right.structural) - Number(left.structural);
          if (left.parts.length !== right.parts.length) return right.parts.length - left.parts.length;
          // With the same matching set, a direct-child relation has a narrower
          // effect on future DOM than an unrestricted descendant relation.
          const direct = (item) => item.connectors.filter((x) => x === '>').length;
          if (direct(left) !== direct(right)) return direct(left) - direct(right);
          if (left.selector.length !== right.selector.length) return right.selector.length - left.selector.length;
          return -left.selector.localeCompare(right.selector);
        };
        const isBetter = uncovered > bestUncovered ||
          (uncovered === bestUncovered && best !== null && compare(candidate, best) > 0);
        if (isBetter) { best = candidate; bestUncovered = uncovered; }
      }
      if (!best) break;
      putRule(best.selector, new Map([[property, best.shared.get(property)]]),
        best.tier, best.structural ? 'structural' : (best.tier === 2 ? 'id' : best.tier === 1 ? 'existingClass' : 'tag'),
        best.structural);
      for (const item of best.matches) if (item.remaining) item.remaining.delete(property);
    }
  }

  // Remaining matching declaration SETS are grouped into one generated class.
  // We do this after all safe existing/structural selectors are considered.
  const byRemainder = new Map();
  const signature = (props) => [...props].map(([name, v]) => `${name}=${v.key}`)
    .sort().join('\u0001');
  for (const record of records) {
    if (!record.remaining.size) continue;
    const key = signature(record.remaining);
    if (!byRemainder.has(key)) byRemainder.set(key, []);
    byRemainder.get(key).push(record);
  }
  let suffix = 1;
  const allocateClass = () => {
    let name;
    do { name = `${prefix}-${suffix++}`; } while (source.includes(name));
    return name;
  };
  for (const members of byRemainder.values()) {
    if (members.length < 2) continue;
    const name = allocateClass();
    putRule(`.${name}`, members[0].remaining, 1, 'generated');
    for (const member of members) {
      member.generated = name;
      member.remaining.clear();
    }
  }
  // For unique remainders, ID beats a unique class. A reused class would
  // leak an individual style to other elements, so it is not eligible.
  const byClass = new Map();
  for (const item of all) for (const name of item.classes) {
    byClass.set(name, (byClass.get(name) || 0) + 1);
  }
  for (const record of records) {
    if (!record.remaining.size) continue;
    if (record.id && idCounts.get(record.id) === 1) {
      putRule(`#${record.id}`, record.remaining, 2, 'id');
    } else {
      const uniqueClass = record.classes.find((name) => byClass.get(name) === 1);
      // A class may be used on other tags with different styling; reusing
      // `span.foo` is still safe if it uniquely matches this span.
      const matchingCompound = !uniqueClass && usable.find((candidate) =>
        !candidate.structural && candidate.parts[0].kind === 'tagClass' &&
        candidate.matches.length === 1 && candidate.matches[0] === record);
      if (uniqueClass) {
        putRule(`.${uniqueClass}`, record.remaining, 1, 'existingClass');
      } else if (matchingCompound) {
        putRule(matchingCompound.selector, record.remaining, 1, 'existingClass');
      } else {
        const name = allocateClass();
        record.generated = name;
        putRule(`.${name}`, record.remaining, 1, 'generated');
      }
    }
    record.remaining.clear();
  }

  for (const record of records) {
    const tag = record.tag;
    const style = record.styleAttribute;
    const oldClass = record.classAttribute;
    if (record.generated) {
      const name = record.generated;
      if (!oldClass) {
        edits.push({ start: style.start, end: style.end, text: `class="${name}"` });
      } else if (oldClass.quote) {
        edits.push({ start: oldClass.valueStart, end: oldClass.valueEnd,
          text: `${oldClass.value}${oldClass.value ? ' ' : ''}${name}` });
      } else {
        edits.push({ start: oldClass.start, end: oldClass.end,
          text: `class="${oldClass.value.replace(/"/g, '&quot;')} ${name}"` });
      }
    }
    if (!record.generated || oldClass) {
      let start = style.start;
      while (start > tag.start && isWhitespace(source[start - 1])) start--;
      edits.push({ start, end: style.end, text: '' });
    }
  }
  const rules = [...ruleMap.values()];
  if (!rules.length) return emptyResult;
  // CSS source order: element rules, then class rules, then ID rules. Within a
  // tier, simpler selectors first. Native CSS specificity still applies.
  rules.sort((a, b) => a.tier - b.tier ||
    Number(a.structural) - Number(b.structural) ||
    a.selector.split(/\s+|>/).length - b.selector.split(/\s+|>/).length ||
    a.selector.localeCompare(b.selector));
  const ruleText = rules.map(({ selector, props }) =>
    `${selector} {${newline}  ${renderDeclarations(props, newline)}${newline}}`).join(newline + newline);
  return { ...renderOutput(source, edits, parsed, ruleText, options), converted: records.length,
    classes: rules.filter((r) => r.kind === 'generated').length, skipped,
    reusedClasses: rules.filter((r) => r.kind === 'existingClass').length,
    tagRules: rules.filter((r) => r.kind === 'tag').length,
    idRules: rules.filter((r) => r.kind === 'id').length,
    structuralRules: rules.filter((r) => r.structural).length };
}

module.exports = { extractInlineStyles, extractInlineStylesSimple, decodeHtmlAttribute, scanHtml };

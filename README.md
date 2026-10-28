# Inline CSS to Style Tag — VS Code extension

Move ordinary HTML inline `style="..."` declarations into an existing `<style>` tag in the **same HTML file**. Version **0.4.1** includes context-aware selector inference and configurable CSS destinations. No remote service, telemetry, or runtime dependency.

Created by **[Neup123](https://github.com/Neup123)**. Copyright © 2026 Neup123. Released under the MIT License.

## Install and use

Install the `.vsix` in VS Code via **Extensions → … → Install from VSIX…**. Open a file in HTML language mode and run **HTML: Extract Inline CSS to `<style>`** (`Ctrl+Shift+P`). Review the changes, and use `Ctrl+Z` to undo if necessary. **By default, the new `<style>` is placed at the beginning of an existing `<head>`, or at the top of the file if there is no `<head>`.**

## Choose where to extract the CSS

In VS Code Settings, search for **Inline CSS to Style: Destination**, or edit `settings.json`:

```json
"inlineCssToStyle.destination": "top"
```

| Value | Behavior |
| --- | --- |
| `top` **(default)** | Create a **new** `<style>` as the first element inside an existing `<head>`. Without a `<head>`, insert it at the beginning of the document, just after DOCTYPE if present. |
| `head` | Reuse an unrestricted `<style>` inside an existing `<head>`, or create one in the head. **If there is no `<head>`, fall back to `top`** rather than inventing a head. |
| `external` | Create an adjacent, collision-free `filename.extracted.css` (or `-2`, `-3`…), and add `<link rel="stylesheet" href="...">` inside `<head>` when one exists, otherwise at the top after DOCTYPE. Existing files are never overwritten. This option requires the HTML document to be saved first. |
| `clipboard` | Copy **plain CSS** to the clipboard. The HTML is still rewritten to remove inline attributes and use CSS selectors; paste the stylesheet into the document/project to restore the extracted visual styles. |
| `clipboard-style` | Copy CSS surrounded by `<style>...</style>` to the clipboard. Like `clipboard`, rewrites the HTML without inserting the CSS into the document. |

CSS extraction strategies (`smart` and `simple`) work with all five destinations. The extension modifies the current HTML, plus creates a new CSS file for `external`. It does not automatically save the editor buffers to disk.

**HTML validity:** when an explicit `<head>` exists, both `top` and `head` keep the CSS inside it. When no `<head>` exists, the fallback inserts CSS near the beginning of the file (after DOCTYPE, if present), without creating a head element. For a complete HTML document with no `<head>`, consider adding one for standard-compliant markup.

## Smart mode (default)

The transformation analyzes all static HTML elements **before** assigning selectors. It treats each CSS property independently, so common declarations and item-specific declarations can go in different rules:

1. **Broad coverage first:** `p { ... }` is chosen when *all* `<p>` elements have the same inline declaration, even if some share classes or IDs. A selector is never assumed safe when it also matches an unstyled or conflicting element.
2. **Tie-breaking:** if the same set of elements can be styled with a tag, an existing class, or an ID, choose **ID > class > tag**. Thus `.notice` beats `p` when both cover exactly the same paragraphs, and `#hero` beats `.notice` on a unique element.
3. **Parent/child context:** look for selectors such as `.section span`, `#panel > span`, or `div > div > span`. It can also narrow a reused class by tag, e.g. `span.label` when `.label` alone would style unrelated elements. A class or ID on an ancestor takes precedence over an equivalent tag-only structural selector. The analyzer examines up to **four ancestor levels**; direct-child `>` chains and descendant spaces are supported.
4. **Partial commonality:** declarations shared by a group go on the broadest safe selector, even if other declarations must go on more specific selectors.
5. **Generated classes:** only create `.extracted-inline-N` when the remaining declarations cannot be safely assigned to existing selectors. Elements with identical remaining declarations share one generated class. Unique residuals prefer an existing **ID**, then a unique existing class, then a generated class.
6. **Rule order:** within the newly generated CSS, render tag-only selectors first, class-containing selectors next, and ID-containing selectors last. Existing styles in the `<style>` tag are preserved in their original positions.

### Example

Input:

```html
<div class="section" id="section-a">
  <span class="label" style="color: red; margin: 0">First</span>
  <span class="label" style="color: red; margin: 4px">Second</span>
</div>
<section><span>Unstyled</span></section>
```

Output (simplified):

```html
<style>
.label { color: red; }
.extracted-inline-1 { margin: 0; }
.extracted-inline-2 { margin: 4px; }
</style>
<div class="section" id="section-a">
  <span class="label extracted-inline-1">First</span>
  <span class="label extracted-inline-2">Second</span>
</div>
<section><span>Unstyled</span></section>
```

For declarations shared by only a group of descendants but not all `<span>` elements, it may produce `#section-a span { ... }` instead.

## Simple mode

To always create new classes for the complete inline style as in v0.1, set VS Code configuration `inlineCssToStyle.mode` to `simple` (default: `smart`).

## Safety and limitations

- **Inspect the rendered result.** This is static source refactoring, **not** a browser-level proof of equal computed styles. Moving `style="..."` out of inline attributes lowers selector specificity. Existing CSS (`!important`, selector specificity, stylesheets, media queries), dynamic content, custom properties and shorthand/longhand ordering can affect the result.
- Shared selectors can affect HTML elements later inserted by JavaScript, even when all *current* elements match. That is a consequence of applying global/contextual CSS rules.
- Supports regular HTML files, not Vue, JSX, TSX, PHP templates or CSS generated by scripts. Unrecognized templates, empty or invalid inline styles remain unchanged.
- Does not merge declarations directly into pre-existing CSS rules or reorder pre-existing stylesheet declarations; the `head` destination appends to an unrestricted `<style>` within `<head>` or creates one.
- Infers only simple CSS identifiers for classes/IDs and direct-child/descendant relationships. Does not infer `:nth-child()`, attribute selectors, sibling combinators, pseudo-classes, or selectors deeper than four ancestor levels.
- HTML tree scanning covers common valid tags, void elements and common implicit end-tags. On badly malformed or highly dynamic HTML, review manually.
- The grouped CSS rules need not be *globally optimal* (smallest possible rule count); inference prioritizes safe static coverage and predictable specificity.

## Development and repository

Requires Node.js 18+. Run `npm test` for unit tests. To package using the official VS Code extension packager, run `npm run package` (downloads `@vscode/vsce` if it is not already available).

Files:
- `src/transform.js`: dependency-free selector inference, HTML/CSS scanning and replacements.
- `src/extension.js`: VS Code command integration.
- `test/*.test.js`: regression tests for inference, the five destinations and VS Code integration.
- `src/html-entities.json`: HTML entity mappings.

**Author and copyright holder:** [Neup123](https://github.com/Neup123), © 2026.

**License:** MIT (see [LICENSE](LICENSE)). Attribution and copyright notice remain in redistributed copies in accordance with the MIT License.

Source repository: https://github.com/Neup123/Inline-CSS-to-Style---VsCode-Plugin

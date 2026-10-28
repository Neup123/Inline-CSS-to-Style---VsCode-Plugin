# Changelog

## 0.4.1

- Corrected default `top`: create `<style>` inside an existing `<head>`; only fall back to the start of the file when `<head>` is missing.
- Retained the difference between destinations: `top` creates a new block at the beginning of `<head>`, while `head` can reuse an eligible existing block.
- Added creator attribution and MIT copyright for [Neup123](https://github.com/Neup123) in extension metadata, source code, LICENSE, and README.

## 0.4.0

- Added the `inlineCssToStyle.destination` setting: `top` (default), `head`, `external`, `clipboard`, `clipboard-style`.
- External CSS is created in the same directory as the HTML source and linked automatically; filename collisions never overwrite existing files.
- Clipboard modes copy only CSS or a complete `<style>` element while refactoring the current document.
- `head` falls back to `top` when the HTML has no `<head>`.
- Both smart and simple inference share the same output routing.
- Added destination-specific and extension-integration regression tests.

## 0.3.0

- Broader shared-property detection using existing ID, class and tag selectors.
- Parent/child selector inference to four ancestor levels.
- Render inferred rules in tag, class, ID order.

## 0.2.0

- Added smart extraction mode and reuse of existing classes and tags.

## 0.1.0

- Initial inline style extraction into CSS classes.

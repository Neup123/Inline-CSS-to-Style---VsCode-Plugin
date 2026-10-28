# Changelog

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

# Third-party notices

Scope has no runtime dependencies. Three third-party assets are vendored as plain text files so the app works offline.

## Feather icons

- Used in: `js/core/icons.js` (a subset of the SVG path data, inlined).
- Source: https://feathericons.com · https://github.com/feathericons/feather
- Licence: MIT. Copyright (c) 2013-2023 Cole Bemis.

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Simple SVG World Map

- Used in: `data/world-map.js` (country outlines keyed by ISO 3166-1 alpha-2 code; coordinates rounded to one decimal and multi-part countries merged).
- Source: https://github.com/flekschas/simple-world-map by Fritz Lekschas.
- Licence: Creative Commons Attribution-ShareAlike 3.0 Unported (CC BY-SA 3.0), https://creativecommons.org/licenses/by-sa/3.0/
- The adapted geometry in `data/world-map.js` is shared under the same licence.

## Corporate typeface (not included in the public repository)

- `css/fonts.css` can hold a corporate web font embedded as base64. The typeface is proprietary and is **not** redistributed in the public repository, where `css/fonts.css` is an empty placeholder.
- Without it the interface falls back to Helvetica Neue, Arial or the system sans-serif. To use a licensed font, paste its `@font-face` rules into `css/fonts.css` and keep the family name first in `--font` in `css/scope.css`.

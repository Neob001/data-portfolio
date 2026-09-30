# Fingerprint data: source and license

`fingerprints/technologies.json.gz` is derived from the technology fingerprints (`technologies/*.json`)
and `categories.json` of the **`wappalyzer` npm package, version 6.10.54**, the last release published
under the MIT license.

| | |
|---|---|
| Package | `wappalyzer@6.10.54` (npm), published 2023-01-15 |
| Tarball | https://registry.npmjs.org/wappalyzer/-/wappalyzer-6.10.54.tgz |
| SHA-1 | `de8e0f0386f66bc6ce858408de9faa477f304c5e` (checked by `scripts_local/build_fingerprints.mjs`) |
| Integrity | `sha512-P9VSYXSL6hiExangdWwipDlmMEdpdPqeHuv4QqsUTVxhuj4ua1YrE4xL7ENxs9b2wk9JeIzFR+ZqTmrlSYSEgw==` |
| `license` field in that version's `package.json` | `"MIT"` |
| Repository LICENSE at the time | https://github.com/wappalyzer/wappalyzer/blob/master/LICENSE, archived 2022-12-19: https://web.archive.org/web/20221219185733/https://github.com/wappalyzer/wappalyzer/blob/master/LICENSE (MIT, "Copyright 2008 Wappalyzer") |

## License verification (2026-09-30)

- The npm registry metadata (`https://registry.npmjs.org/wappalyzer`) shows the `license` field as
  `GPLv3`/`GPL-3.0` up to 5.9.32, **`MIT` from 5.9.33 (2020-04-19) through 6.10.54**, `GPL-3.0` again
  from **6.10.55** (2023-02-09), and no license and no fingerprint data in 7.x (the project went
  closed-source in August 2023). 6.10.54 is therefore the newest MIT-licensed snapshot.
- The 6.10.54 tarball ships no separate LICENSE file; its `package.json` declares `"license": "MIT"` and
  the repository's LICENSE file (archived above, one month before this release) is the MIT license
  reproduced below.
- Not used: any GPL-licensed release or fork (e.g. `wappalyzer` >= 6.10.55, `webappanalyzer`, which is
  GPL-3.0) and Wappalyzer's current proprietary data.

## Modifications

The build script keeps only the fields a static (no-browser) detector can use (`cats`, `headers`,
`cookies`, `meta`, `scriptSrc`, `scripts`, `html`, `text`, `url`, `dns`, `dom`, `implies`, `excludes`,
`requires`, `requiresCategory`), drops regexes that do not compile or are slow on adversarial input
and CSS selectors the DOM engine cannot parse (listed in `fingerprints/manifest.json`), and applies a
few documented precision overrides (see `OVERRIDES` in `scripts_local/build_fingerprints.mjs`).
Descriptions, icons, pricing and website links are not included. The detection engine in `src/detect.js`
is an independent implementation.

This Actor is not affiliated with or endorsed by Wappalyzer.

## MIT License (as required, the copyright and permission notice are retained)

```
Copyright 2008 Wappalyzer

Permission is hereby granted, free of charge, to any person obtaining a
copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be included
in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

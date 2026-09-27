# 3D Print Stage 1, Subfeature D: Print Wizard Page, JS, Viewer and CNC Touches Implementation Plan

> **Paths updated 2026-09-13:** the print path moved into the top-level `print/`
> package after this document was written. File paths and imports below were
> rewritten to match; the design and the task order are unchanged. See
> [3D_PRINTING.md](https://github.com/6238/PenguinCAM/blob/main/docs/3D_PRINTING.md) for the current layout.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The student picks "3D Printing" on the CNC Setup screen, lands on the print wizard, walks Setup, Parts, Layout and Preview, watches the slice through the event stream, sees the part on the printer bed in 3D, and downloads or sends the `.gcode.3mf`.

**Architecture:** `print/templates/print_wizard.html` copies the CNC wizard's header, step bar and footer markup (copied, not shared, so the pages can diverge). `print/static/print_wizard.js` owns step navigation, summary chips, the three data calls (`/print/part`, `POST /print-job`, the events stream with a JSON polling fallback), the Layout canvas and the save split button. `print/static/print_viewer.js` parses STL and shows a mesh on a bed with Three.js orbit controls. Pure helpers in both files are exported for node when `module` exists, so they get unit tests without a browser. The CNC wizard gets one radio and one navigation branch.

**Tech Stack:** Jinja2 template, vanilla ES5-style JavaScript matching `wizard.js`, Three.js r128 + OrbitControls from the same CDN URLs as the CNC page, `node --test` (node 24 is present in the container and on the CI runner) driven from a Python unittest, Flask test client for template checks.

**Spec:** `docs/superpowers/specs/2026-09-13-3d-print-slicing-design.md`, sections 3 (user flow), 4 (changes to existing files), 7 (frontend), 8 (error handling), 11 (acceptance).

## Global Constraints

- Route contract from subfeature C: `GET /print?source=&theme=&return=` renders `print_wizard.html` with `source` (`upload`|`onshape`), `theme` (`dark`|`light`), `return_url`, and the CNC template context (`drive_enabled`, `using_default_config`, `config_team_number`, `config_team_name`, `config_url`, `config_refresh_result`). `GET /print/part` → JSON `{part: {name, file, size_mm: {x,y,z}, triangles}, printer: {name, bed_mm: {x,y}, height_mm}, filament: {name}, process: {name, layer_height_mm}}`; `?stl=1` → STL bytes. `POST /print-job` → 202 `{job_id}` | 503 `{error}` | 429 | 401 `{error, need_verification}`. `GET /print-job/<id>` → `{id, state, elapsed_s, token, summary, part, error}` | 404 `{error}`. `GET /print-job/<id>/events` → SSE events `state` (data `{state, elapsed_s, ...}`), then `done` or `failed` (full record). `summary` = `{print_time_s, filament_m, filament_g, layer_count, warnings}`; any numeric field may be `null`.
- Download `/download/<token>` and Drive `/drive/status`, `/auth/login`, `/drive/upload/<token>` exactly as the CNC page uses them. The delivered file name is `sample_part.gcode.3mf`.
- Two layouts: `source=onshape` one step at a time with summary chips; `source=upload` all four steps in a 2x2 grid (`#wizard.grid`), chips hidden by the existing CSS, 2.5D radio hidden and disabled.
- Mode radios: `2d`, `2.5d`, `tubing`, `print` (checked on the print page). Choosing any non-print mode on the print page navigates to `return_url`. Choosing `print` on the CNC page navigates to `/print?source=<source>&theme=<theme>&return=<current path and query, URL-encoded>`.
- Student-facing strings, verbatim: status `Queued` / `Slicing`, with `, N s` appended from `elapsed_s`; 429 → `Too many slices in a minute, try again shortly.`; 404 on poll → `This slice has expired, go back and slice again.`; other errors show the server's `error` string; part too big → `Part is larger than the bed: <x> x <y> x <z> mm on <bx> x <by> x <h> mm.`
- Summary line format: `Print time <Hh Mm Ss> · Filament <g> g (<m> m) · <N> layers`, omitting any `null` field. Chips (panel only): printer, filament, process from Parts onward; `1 part` from Layout onward; print time and `<g> g` on Preview once done.
- No new CSS file: reuse `wizard.css` classes and ids (`#wizard`, `#wiz-header`, `#stepbar`, `#wiz-summary`, `.step`, `.field`, `.radio`, `.hint`, `#layout-info`, `#layout-canvas`, `.errors`, `.notes`, `#wiz-nav`, `.split-btn`, `#viewer-container`, `.empty-state`, `.part-item`). Small print-only rules may be appended to `wizard.css` under a `/* ---- 3D print wizard ---- */` comment (at most a dozen lines).
- Three.js from `https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js` and `https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js`.
- No change to `frc_cam_postprocessor.py`, `/process*` routes, `gcode_viewer.js`, or the CNC step logic in `wizard.js` beyond the one radio branch.
- JS style: one IIFE per file, `'use strict'`, `var`, no arrow functions, no template literals (matches `wizard.js`). Export pure helpers at the end of the IIFE with `if (typeof module !== 'undefined' && module.exports) module.exports = {...}`; guard DOM access with `typeof document !== 'undefined'` so node can require the file.
- Commit each task on branch `feature/3d-print-stage1` with a message starting `print(d): `. Never touch `main`, never push. Never commit `tools/` or `.superpowers/`.
- Run `uv run python -m unittest discover -s tests --buffer && uv run python -m unittest discover -s print/tests -t . --buffer && uv run python gcode_test.py --quiet` before each commit; `make test` at the end of Task 4.

---

### Task 1: The print wizard page and step logic (Setup, Parts, Layout)

**Files:**
- Replace: `print/templates/print_wizard.html` (the placeholder from subfeature C)
- Create: `print/static/print_wizard.js`
- Modify: `static/wizard.css` (append print rules)
- Create: `print/tests/js/print_wizard.test.js`, `print/tests/test_js_units.py`, `print/tests/test_wizard_page.py`

**Interfaces:**
- Consumes: route contract above.
- Produces: `print/static/print_wizard.js` exporting for node `formatDuration(seconds) -> string`, `fitsBed(size_mm, bed_mm, height_mm) -> bool`, `summaryLine(summary) -> string`, `printPageUrl(source, theme, returnPath) -> string`, `statusText(record) -> string`, `tooBigMessage(size_mm, bed_mm, height_mm) -> string`. Task 2 adds the Preview flow into the same file, using `state`, `gotoStep`, `$`, `updateSummary` defined here. Task 3's viewer is constructed here as `viewer = new PrintViewer({...})` inside `bindPreview()` (Task 2 fills it in). Element ids listed in the template are the contract for Tasks 2 and 3.

- [ ] **Step 1: Write the failing node tests and their Python runner**

`print/tests/js/print_wizard.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const w = require(path.join(__dirname, '..', '..', 'static', 'print_wizard.js'));

test('formatDuration renders h m s and drops empty leading units', () => {
  assert.equal(w.formatDuration(790), '13m 10s');
  assert.equal(w.formatDuration(3725), '1h 2m 5s');
  assert.equal(w.formatDuration(59), '59s');
  assert.equal(w.formatDuration(3600), '1h 0m 0s');
  assert.equal(w.formatDuration(0), '0s');
});

test('fitsBed compares every axis', () => {
  const bed = { x: 256, y: 256 };
  assert.equal(w.fitsBed({ x: 40, y: 30, z: 12 }, bed, 250), true);
  assert.equal(w.fitsBed({ x: 300, y: 30, z: 12 }, bed, 250), false);
  assert.equal(w.fitsBed({ x: 40, y: 257, z: 12 }, bed, 250), false);
  assert.equal(w.fitsBed({ x: 40, y: 30, z: 251 }, bed, 250), false);
  assert.equal(w.fitsBed({ x: 256, y: 256, z: 250 }, bed, 250), true);
});

test('summaryLine omits null fields', () => {
  assert.equal(w.summaryLine({ print_time_s: 790, filament_g: 3.31, filament_m: 1.09, layer_count: 60 }),
    'Print time 13m 10s · Filament 3.31 g (1.09 m) · 60 layers');
  assert.equal(w.summaryLine({ print_time_s: null, filament_g: 3.31, filament_m: null, layer_count: 60 }),
    'Filament 3.31 g · 60 layers');
  assert.equal(w.summaryLine({ print_time_s: null, filament_g: null, filament_m: null, layer_count: null }), '');
  assert.equal(w.summaryLine({ print_time_s: 60, filament_g: 0.5, filament_m: 0.2, layer_count: 1 }),
    'Print time 1m 0s · Filament 0.5 g (0.2 m) · 1 layer');
});

test('printPageUrl carries source, theme and an encoded return path', () => {
  assert.equal(w.printPageUrl('upload', 'dark', '/app?config=x&y=1'),
    '/print?source=upload&theme=dark&return=%2Fapp%3Fconfig%3Dx%26y%3D1');
  assert.equal(w.printPageUrl('onshape', 'light', '/onshape-panel?d=1'),
    '/print?source=onshape&theme=light&return=%2Fonshape-panel%3Fd%3D1');
});

test('statusText maps states and appends elapsed seconds', () => {
  assert.equal(w.statusText({ state: 'queued', elapsed_s: 0.4 }), 'Queued, 0 s');
  assert.equal(w.statusText({ state: 'running', elapsed_s: 12.6 }), 'Slicing, 13 s');
  assert.equal(w.statusText({ state: 'running' }), 'Slicing');
});

test('tooBigMessage names both sizes', () => {
  assert.equal(w.tooBigMessage({ x: 300, y: 30, z: 12 }, { x: 256, y: 256 }, 250),
    'Part is larger than the bed: 300 x 30 x 12 mm on 256 x 256 x 250 mm.');
});
```

`print/tests/test_js_units.py`:

```python
"""Runs the node unit tests for the print wizard's pure JavaScript helpers."""
import shutil
import subprocess
import unittest
from pathlib import Path

JS_TESTS = Path(__file__).resolve().parent / "js"


class NodeUnitTests(unittest.TestCase):
    def test_node_suite_passes(self):
        node = shutil.which("node")
        if node is None:
            self.skipTest("node is not installed; the JS helper tests need it (CI and the dev machines have it)")
        result = subprocess.run([node, "--test", str(JS_TESTS)], capture_output=True, text=True, timeout=120)
        self.assertEqual(result.returncode, 0, result.stdout[-3000:] + result.stderr[-3000:])


if __name__ == "__main__":
    unittest.main()
```

`print/tests/test_wizard_page.py`:

```python
"""The rendered print wizard page carries the elements the JS and the acceptance steps rely on."""
import re
import sys
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]        # the repository root
sys.path.insert(0, str(REPO))

from frc_cam_gui_app import app, limiter  # noqa: E402


class PrintWizardPageTest(unittest.TestCase):
    def setUp(self):
        app.config["TESTING"] = True
        self.client = app.test_client()
        with self.client.session_transaction() as sess:
            sess["app_verified"] = True
        limiter.reset()
        limiter.enabled = False

    def tearDown(self):
        limiter.enabled = True

    def test_page_has_header_stepbar_radios_fields_and_no_machine_dropdown(self):
        html = self.client.get("/print?source=upload&theme=dark&return=/app").get_data(as_text=True)
        self.assertIn('id="wiz-header"', html)
        self.assertIn('id="stepbar"', html)
        for step in ("setup", "parts", "layout", "preview"):
            self.assertIn(f'data-step="{step}"', html)
        for value in ("2d", "2.5d", "tubing", "print"):
            self.assertIn(f'name="mode" value="{value}"', html)
        self.assertRegex(html, r'value="print"[^>]*checked')
        for el in ("p-printer", "p-filament", "p-process", "parts-list", "layout-info", "layout-canvas",
                   "layout-errors", "gen-status", "preview-stats", "print-canvas", "preview-errors",
                   "preview-notes", "btn-do", "btn-do-caret", "do-menu", "btn-reset-view"):
            self.assertIn(f'id="{el}"', html, el)
        self.assertNotIn('id="f-machine"', html)
        self.assertIn("print_viewer.js", html)
        self.assertIn("print_wizard.js", html)
        self.assertIn("three.js/r128/three.min.js", html)
        self.assertIn("OrbitControls.js", html)
        self.assertNotIn("gcode_viewer.js", html)
        self.assertIn("returnUrl: \"/app\"", html)
        self.assertIn("driveEnabled:", html)

    def test_theme_and_source_reach_the_document(self):
        html = self.client.get("/print?source=onshape&theme=light").get_data(as_text=True)
        self.assertIn('data-theme="light"', html)
        self.assertIn('data-source="onshape"', html)
        self.assertIn('source: "onshape"', html)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd /repos/popcornpenguins/PenguinCAM && uv run python -m unittest tests.test_js_units tests.test_print_wizard_page -v`
Expected: the node suite fails (`Cannot find module .../print/static/print_wizard.js`); the page test fails on missing ids.

- [ ] **Step 3: Write the template**

Replace `print/templates/print_wizard.html` with:

```html
<!DOCTYPE html>
<html lang="en" data-theme="{{ theme|default('dark') }}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>PenguinCAM — 3D Printing</title>
    <link rel="stylesheet" href="{{ url_for('static', filename='wizard.css') }}">
</head>
<body data-source="{{ source }}" data-return="{{ return_url }}">
    <div id="wizard">
        <!-- Header and step bar copied from wizard.html (not shared) so the two pages can diverge. -->
        <header id="wiz-header">
            <div class="brand">PenguinCAM</div>
            <div class="config-info">
                {% if not using_default_config and config_team_number %}
                <p class="config-status">Config:
                    {% if config_url %}
                    <a href="{{ config_url }}" target="_blank" rel="noopener">{{ config_team_number }} ({{ config_team_name or 'Unknown' }})</a>
                    {% else %}
                    {{ config_team_number }} ({{ config_team_name or 'Unknown' }})
                    {% endif %}
                </p>
                {% else %}
                <p class="config-status config-status-default">Using default configuration</p>
                {% endif %}
            </div>
            <ol id="stepbar" aria-label="Steps">
                <li data-step="setup" data-num="1" class="active" role="button" tabindex="0">Setup</li>
                <li data-step="parts" data-num="2" role="button" tabindex="0">Parts</li>
                <li data-step="layout" data-num="3" role="button" tabindex="0">Layout</li>
                <li data-step="preview" data-num="4" role="button" tabindex="0">Preview</li>
            </ol>
        </header>

        <main id="wiz-body">
            <div id="wiz-summary" hidden aria-label="Job summary"></div>

            <!-- ===== SETUP ===== -->
            <section class="step" data-step="setup">
                <h2>Setup</h2>
                <fieldset class="field">
                    <legend>Mode</legend>
                    <label class="radio"><input type="radio" name="mode" value="2d"> 2D — flat plate (one or more parts)</label>
                    <label class="radio" id="opt-mode-25d"><input type="radio" name="mode" value="2.5d"> 2.5D — derive thickness from CAD (single part)</label>
                    <label class="radio"><input type="radio" name="mode" value="tubing"> Tubing — machine both faces of a tube</label>
                    <label class="radio"><input type="radio" name="mode" value="print" checked> 3D Printing — slice a part for the Bambu Lab printer</label>
                </fieldset>
                <!-- Stage 1: one fixed printer, filament and process. Read-only; later stages
                     take these from the team configuration. -->
                <div class="field"><span>Printer</span><output id="p-printer" class="print-value">…</output></div>
                <div class="field"><span>Filament</span><output id="p-filament" class="print-value">…</output></div>
                <div class="field"><span>Process</span><output id="p-process" class="print-value">…</output></div>
                <p class="hint">These come from the team's fixed Bambu Lab profile set in this release.</p>
            </section>

            <!-- ===== PARTS ===== -->
            <section class="step" data-step="parts" hidden>
                <h2>Parts</h2>
                <p class="hint">This release prints the built-in sample part. Exporting from Onshape comes next.</p>
                <ul id="parts-list" aria-live="polite"></ul>
            </section>

            <!-- ===== LAYOUT ===== -->
            <section class="step" data-step="layout" hidden>
                <h2>Layout</h2>
                <p class="hint">The part is centred on the bed. Moving and rotating parts comes in a later release.</p>
                <div id="layout-info">
                    <span><strong id="info-printer-name"></strong></span>
                    <span>Bed: <span id="info-bed-size"></span></span>
                </div>
                <canvas id="layout-canvas" width="600" height="400"></canvas>
                <div id="layout-errors" class="errors" aria-live="polite"></div>
            </section>

            <!-- ===== PREVIEW ===== -->
            <section class="step" data-step="preview" hidden>
                <h2>Preview &amp; Save</h2>
                <div id="gen-status" class="hint" aria-live="polite"></div>
                <div id="preview-result" hidden>
                    <div id="preview-stats"></div>
                    <div id="viewer-container">
                        <div class="empty-state" id="viewer-empty">The sliced part will appear here</div>
                        <canvas id="print-canvas"></canvas>
                    </div>
                    <div class="playback-controls">
                        <button type="button" class="btn small" id="btn-reset-view">Reset view</button>
                    </div>
                    <p class="hint">Drag to orbit, scroll to zoom.</p>
                </div>
                <div id="preview-errors" class="errors" aria-live="polite"></div>
                <div id="preview-notes" class="notes" aria-live="polite" hidden></div>
            </section>
        </main>

        <footer id="wiz-nav">
            <button type="button" id="btn-back" class="btn" disabled>Back</button>
            <button type="button" id="btn-next" class="btn primary">Next</button>
            <div id="final-action" class="split-btn" hidden>
                <button type="button" id="btn-do" class="btn primary" disabled>Download Program</button>
                <button type="button" id="btn-do-caret" class="btn primary split-caret" aria-label="Choose action" hidden>&#9662;</button>
                <ul id="do-menu" class="do-menu" role="menu" hidden>
                    <li role="menuitem" data-action="download">Download Program</li>
                    <li role="menuitem" data-action="drive">Send to Google Drive</li>
                </ul>
            </div>
        </footer>
    </div>

    <script>
      window.PenguinCAM = {
        source: {{ source|tojson }},
        theme: {{ theme|tojson }},
        returnUrl: {{ return_url|tojson }},
        driveEnabled: {{ (drive_enabled if drive_enabled is defined else False)|tojson }},
      };
    </script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js"></script>
    <script src="{{ url_for('static', filename='print_viewer.js') }}"></script>
    <script src="{{ url_for('static', filename='print_wizard.js') }}"></script>
</body>
</html>
```

Append to `static/wizard.css`:

```css
/* ---- 3D print wizard (print/templates/print_wizard.html) ---- */
.print-value { display: block; color: var(--ink); font-size: 14px; }
#print-canvas { display: block; width: 100%; height: 100%; }
```

- [ ] **Step 4: Write `print/static/print_wizard.js` (Setup, Parts, Layout, navigation, chips)**

```js
/* PenguinCAM 3D print wizard (print/templates/print_wizard.html).
 * Separate from the CNC wizard on purpose: same look, own code. Talks to the
 * print blueprint (/print/part, /print-job, /print-job/<id>/events) and reuses
 * the download and Google Drive routes. Pure helpers are exported for node tests.
 */
(function () {
  'use strict';

  var HAS_DOM = typeof document !== 'undefined';
  var CFG = (typeof window !== 'undefined' && window.PenguinCAM) ||
            { source: 'upload', theme: 'dark', driveEnabled: false, returnUrl: '/app' };
  var STEPS = ['setup', 'parts', 'layout', 'preview'];
  var EXPIRED_MESSAGE = 'This slice has expired, go back and slice again.';
  var RATE_MESSAGE = 'Too many slices in a minute, try again shortly.';

  var state = {
    source: CFG.source,
    step: 'setup',
    info: null,          // /print/part response
    fits: true,          // part fits the bed
    jobId: null,
    record: null,        // last job record seen
    token: null,         // download token once done
    events: null,        // EventSource
    poll: null,          // polling timer (fallback)
    saveAction: 'download',
  };
  var viewer = null;

  function $(sel) { return document.querySelector(sel); }
  function $all(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  /* ----------------------------------------------------------- pure helpers */
  function formatDuration(seconds) {
    var s = Math.max(0, Math.round(seconds || 0));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (h > 0) return h + 'h ' + m + 'm ' + sec + 's';
    if (m > 0) return m + 'm ' + sec + 's';
    return sec + 's';
  }

  function fitsBed(size, bed, height) {
    return size.x <= bed.x && size.y <= bed.y && size.z <= height;
  }

  function summaryLine(summary) {
    var parts = [];
    if (summary.print_time_s != null) parts.push('Print time ' + formatDuration(summary.print_time_s));
    if (summary.filament_g != null) {
      var f = 'Filament ' + summary.filament_g + ' g';
      if (summary.filament_m != null) f += ' (' + summary.filament_m + ' m)';
      parts.push(f);
    }
    if (summary.layer_count != null) parts.push(summary.layer_count + (summary.layer_count === 1 ? ' layer' : ' layers'));
    return parts.join(' · ');
  }

  function printPageUrl(source, theme, returnPath) {
    return '/print?source=' + encodeURIComponent(source) + '&theme=' + encodeURIComponent(theme) +
           '&return=' + encodeURIComponent(returnPath);
  }

  function statusText(record) {
    var label = record.state === 'queued' ? 'Queued' : 'Slicing';
    if (record.elapsed_s == null) return label;
    return label + ', ' + Math.round(record.elapsed_s) + ' s';
  }

  function tooBigMessage(size, bed, height) {
    return 'Part is larger than the bed: ' + size.x + ' x ' + size.y + ' x ' + size.z + ' mm on ' +
           bed.x + ' x ' + bed.y + ' x ' + height + ' mm.';
  }

  /* ----------------------------------------------------------------- setup */
  function fillSetup() {
    var i = state.info;
    $('#p-printer').textContent = i.printer.name;
    $('#p-filament').textContent = i.filament.name;
    $('#p-process').textContent = i.process.name;
  }

  function bindSetup() {
    $all('input[name="mode"]').forEach(function (r) {
      r.addEventListener('change', function () {
        // Any CNC mode goes back to the page the student came from, which reloads
        // with its default mode selected.
        if (this.value !== 'print') location.href = CFG.returnUrl;
      });
    });
  }

  /* ----------------------------------------------------------------- parts */
  function fillParts() {
    var i = state.info, list = $('#parts-list');
    list.innerHTML = '';
    var li = document.createElement('li');
    li.className = 'part-item';
    var meta = document.createElement('div');
    meta.className = 'meta';
    var name = document.createElement('div');
    name.className = 'name';
    name.textContent = i.part.name;
    var dims = document.createElement('div');
    dims.className = 'dims';
    dims.textContent = i.part.size_mm.x + ' x ' + i.part.size_mm.y + ' x ' + i.part.size_mm.z + ' mm';
    meta.appendChild(name);
    meta.appendChild(dims);
    li.appendChild(meta);
    list.appendChild(li);
  }

  /* ---------------------------------------------------------------- layout */
  function fillLayoutInfo() {
    var i = state.info;
    $('#info-printer-name').textContent = i.printer.name;
    $('#info-bed-size').textContent = i.printer.bed_mm.x + ' x ' + i.printer.bed_mm.y + ' mm, ' + i.printer.height_mm + ' mm tall';
    state.fits = fitsBed(i.part.size_mm, i.printer.bed_mm, i.printer.height_mm);
    $('#layout-errors').textContent = state.fits ? '' : tooBigMessage(i.part.size_mm, i.printer.bed_mm, i.printer.height_mm);
  }

  // Top-down drawing: the bed as a rectangle, the part's footprint centred on it.
  function drawLayout() {
    var canvas = $('#layout-canvas'), ctx = canvas.getContext('2d');
    var i = state.info;
    var W = canvas.width, H = canvas.height, pad = 30;
    var css = getComputedStyle(document.documentElement);
    ctx.fillStyle = css.getPropertyValue('--canvas-bg').trim() || '#11161d';
    ctx.fillRect(0, 0, W, H);
    if (!i) return;
    var bed = i.printer.bed_mm, size = i.part.size_mm;
    var scale = Math.min((W - 2 * pad) / bed.x, (H - 2 * pad) / bed.y);
    var bw = bed.x * scale, bh = bed.y * scale;
    var bx = (W - bw) / 2, by = (H - bh) / 2;
    ctx.strokeStyle = css.getPropertyValue('--canvas-grid').trim() || '#30363d';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx, by, bw, bh);
    var g = 50 * scale;   // 50 mm grid
    ctx.beginPath();
    for (var x = bx + g; x < bx + bw - 0.5; x += g) { ctx.moveTo(x, by); ctx.lineTo(x, by + bh); }
    for (var y = by + g; y < by + bh - 0.5; y += g) { ctx.moveTo(bx, y); ctx.lineTo(bx + bw, y); }
    ctx.stroke();
    var pw = size.x * scale, ph = size.y * scale;
    ctx.fillStyle = state.fits ? 'rgba(47, 129, 247, 0.35)' : 'rgba(248, 81, 73, 0.35)';
    ctx.strokeStyle = state.fits ? '#2f81f7' : '#f85149';
    ctx.lineWidth = 2;
    ctx.fillRect((W - pw) / 2, (H - ph) / 2, pw, ph);
    ctx.strokeRect((W - pw) / 2, (H - ph) / 2, pw, ph);
    ctx.fillStyle = css.getPropertyValue('--ink').trim() || '#e6edf3';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(i.part.name + ' ' + size.x + ' x ' + size.y + ' mm', W / 2, (H + ph) / 2 + 16);
    ctx.textAlign = 'left';
    ctx.fillText(bed.x + ' x ' + bed.y + ' mm bed', bx + 4, by - 6);
  }

  /* ---------------------------------------------------------- summary chips */
  function updateSummary() {
    var box = $('#wiz-summary'), i = state.info, chips = [];
    var idx = STEPS.indexOf(state.step);
    if (i && idx >= STEPS.indexOf('parts')) chips.push(i.printer.name, i.filament.name, i.process.name);
    if (i && idx >= STEPS.indexOf('layout')) chips.push('1 part');
    if (idx >= STEPS.indexOf('preview') && state.record && state.record.summary) {
      var s = state.record.summary;
      if (s.print_time_s != null) chips.push(formatDuration(s.print_time_s));
      if (s.filament_g != null) chips.push(s.filament_g + ' g');
    }
    box.hidden = chips.length === 0;
    box.innerHTML = '';
    chips.forEach(function (c) {
      var span = document.createElement('span');
      span.className = 'chip';
      span.textContent = c;
      box.appendChild(span);
    });
  }

  /* -------------------------------------------------------------- step nav */
  function gotoStep(name) {
    var leaving = state.step;
    state.step = name;
    var gridMode = $('#wizard').classList.contains('grid');
    $all('.step').forEach(function (s) {
      var isCurrent = s.getAttribute('data-step') === name;
      if (gridMode) { s.hidden = false; s.classList.toggle('current', isCurrent); }
      else { s.hidden = !isCurrent; s.classList.remove('current'); }
    });
    $all('#stepbar li').forEach(function (li) {
      var s = li.getAttribute('data-step');
      li.classList.toggle('active', s === name);
      li.classList.toggle('done', STEPS.indexOf(s) < STEPS.indexOf(name));
    });
    var idx = STEPS.indexOf(name);
    $('#btn-back').disabled = idx === 0;
    var isPreview = name === 'preview';
    $('#btn-next').hidden = isPreview;
    $('#final-action').hidden = !isPreview;
    if (leaving === 'preview' && !isPreview) stopFollowing();
    if (name === 'layout') {
      if (state.info) { fillLayoutInfo(); drawLayout(); }
      $('#btn-next').disabled = !state.fits;
    } else {
      $('#btn-next').disabled = false;
    }
    if (isPreview) enterPreview();
    updateSummary();
  }

  function canLeave(name) {
    if (name === 'layout' && !state.fits) return false;
    return true;
  }

  function navigateTo(name) {
    var target = STEPS.indexOf(name), cur = STEPS.indexOf(state.step);
    if (target < 0 || target === cur) return;
    if (target > cur) {
      for (var i = cur; i < target; i++) { if (!canLeave(STEPS[i])) return; }
    }
    gotoStep(name);
  }

  function bindNav() {
    $('#btn-next').addEventListener('click', function () {
      var i = STEPS.indexOf(state.step);
      if (i < STEPS.length - 1 && canLeave(state.step)) gotoStep(STEPS[i + 1]);
    });
    $('#btn-back').addEventListener('click', function () {
      var i = STEPS.indexOf(state.step);
      if (i > 0) gotoStep(STEPS[i - 1]);
    });
    $all('#stepbar li').forEach(function (li) {
      var go = function () { navigateTo(li.getAttribute('data-step')); };
      li.addEventListener('click', go);
      li.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });
  }

  /* ----------------------------------------------------------- data: part */
  function loadPart() {
    return fetch('/print/part', { credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error('part info ' + r.status); return r.json(); })
      .then(function (info) {
        state.info = info;
        fillSetup();
        fillParts();
        fillLayoutInfo();
        if (state.step === 'layout' || $('#wizard').classList.contains('grid')) drawLayout();
        updateSummary();
      })
      .catch(function (e) {
        $('#layout-errors').textContent = 'Could not load the part: ' + e.message;
      });
  }

  /* --------------------------------------------------------------- preview */
  // Filled in by the Preview flow (Task 2): enterPreview, stopFollowing, bindPreview,
  // bindFinalAction. Task 1 ships these minimal versions so the page runs.
  function enterPreview() {}
  function stopFollowing() {}
  function bindPreview() {}
  function bindFinalAction() {}

  /* ------------------------------------------------------------------ init */
  function init() {
    bindSetup();
    bindNav();
    bindPreview();
    bindFinalAction();
    if (state.source === 'upload') {
      $('#wizard').classList.add('grid');
      var opt25 = $('#opt-mode-25d'); if (opt25) opt25.hidden = true;
      var r25 = $('input[name="mode"][value="2.5d"]'); if (r25) r25.disabled = true;
    }
    gotoStep('setup');
    loadPart();
  }

  if (HAS_DOM) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { formatDuration: formatDuration, fitsBed: fitsBed, summaryLine: summaryLine,
                       printPageUrl: printPageUrl, statusText: statusText, tooBigMessage: tooBigMessage };
  }
})();
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd /repos/popcornpenguins/PenguinCAM && uv run python -m unittest tests.test_js_units tests.test_print_wizard_page -v`
Expected: both `OK`. `print_viewer.js` is only referenced in the HTML at this point; the page test checks the script tag, not the file. Create `print/static/print_viewer.js` as an empty IIFE placeholder now (`(function () { 'use strict'; })();`) so the page does not 404 its script; Task 3 replaces it.

- [ ] **Step 6: Run the quick suite and commit**

Run: `cd /repos/popcornpenguins/PenguinCAM && uv run python -m unittest discover -s tests --buffer && uv run python -m unittest discover -s print/tests -t . --buffer && uv run python gcode_test.py --quiet`
Expected: all pass (the subfeature C route tests still pass with the new template). Commit with message `print(d): print wizard page, setup, parts and layout steps`.

---

### Task 2: Preview flow: submit, event stream, polling fallback, save button

**Files:**
- Modify: `print/static/print_wizard.js` (replace the four stub functions; add helpers)
- Modify: `print/tests/js/print_wizard.test.js` (add tests for `errorForStatus`)

**Interfaces:**
- Consumes: `state`, `$`, `gotoStep`, `updateSummary`, `summaryLine`, `statusText`, `EXPIRED_MESSAGE`, `RATE_MESSAGE` from Task 1; `PrintViewer` from Task 3 (constructed lazily: if `window.PrintViewer` is undefined the viewer step is skipped with the empty-state text left in place, so Task 2 works before Task 3 lands).
- Produces: `errorForStatus(status, body) -> string` exported for node; `window.PenguinCAM.getJobState()` for the acceptance run (returns `state.record && state.record.state`).

- [ ] **Step 1: Add the failing node test**

Append to `print/tests/js/print_wizard.test.js`:

```js
test('errorForStatus picks the student message', () => {
  assert.equal(w.errorForStatus(429, {}), 'Too many slices in a minute, try again shortly.');
  assert.equal(w.errorForStatus(503, { error: 'The slicer is busy, try again in a minute.' }),
    'The slicer is busy, try again in a minute.');
  assert.equal(w.errorForStatus(404, {}), 'This slice has expired, go back and slice again.');
  assert.equal(w.errorForStatus(401, { error: 'Session verification required.' }), 'Session verification required.');
  assert.equal(w.errorForStatus(500, {}), 'Slicing failed (HTTP 500).');
});
```

Run: `cd /repos/popcornpenguins/PenguinCAM && node --test print/tests/js`
Expected: the new test fails (`errorForStatus is not a function`).

- [ ] **Step 2: Implement the Preview flow**

In `print/static/print_wizard.js`, replace the four stubs with the following (and add `errorForStatus` to the exports):

```js
  /* --------------------------------------------------------------- preview */
  function errorForStatus(status, body) {
    if (status === 429) return RATE_MESSAGE;
    if (status === 404) return EXPIRED_MESSAGE;
    if (body && body.error) return body.error;
    return 'Slicing failed (HTTP ' + status + ').';
  }

  function resetPreview() {
    $('#gen-status').textContent = '';
    $('#preview-errors').textContent = '';
    $('#preview-notes').textContent = '';
    $('#preview-notes').hidden = true;
    $('#preview-stats').textContent = '';
    $('#preview-result').hidden = true;
    $('#btn-do').disabled = true;
    state.token = null;
    state.record = null;
  }

  // Entering Preview submits a new slice. A previous job's stream is closed first.
  function enterPreview() {
    stopFollowing();
    state.saveAction = preferredAction();
    setupFinalAction();
    resetPreview();
    $('#gen-status').textContent = 'Queued';
    fetch('/print-job', { method: 'POST', credentials: 'same-origin' })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, j: j }; });
      })
      .then(function (res) {
        if (res.status !== 202) { showError(errorForStatus(res.status, res.j)); return; }
        state.jobId = res.j.job_id;
        followEvents();
      })
      .catch(function (e) { showError('Could not reach the server: ' + e.message); });
  }

  function followEvents() {
    var es = new EventSource('/print-job/' + encodeURIComponent(state.jobId) + '/events');
    state.events = es;
    es.addEventListener('state', function (e) { showState(JSON.parse(e.data)); });
    es.addEventListener('done', function (e) { stopFollowing(); showDone(JSON.parse(e.data)); });
    es.addEventListener('failed', function (e) { stopFollowing(); showFailed(JSON.parse(e.data)); });
    // A proxy that cannot stream errors out before the terminal event: fall back to
    // polling the JSON record every two seconds so the job still finishes.
    es.onerror = function () {
      if (state.events !== es) return;    // already closed on purpose
      stopFollowing();
      startPolling();
    };
  }

  function startPolling() {
    state.poll = setInterval(function () {
      fetch('/print-job/' + encodeURIComponent(state.jobId), { credentials: 'same-origin' })
        .then(function (r) {
          if (r.status === 404) { stopFollowing(); showError(EXPIRED_MESSAGE); return null; }
          if (!r.ok) { stopFollowing(); showError(errorForStatus(r.status, {})); return null; }
          return r.json();
        })
        .then(function (rec) {
          if (!rec) return;
          if (rec.state === 'done') { stopFollowing(); showDone(rec); }
          else if (rec.state === 'failed') { stopFollowing(); showFailed(rec); }
          else showState(rec);
        })
        .catch(function () { /* transient; try again next tick */ });
    }, 2000);
  }

  function stopFollowing() {
    if (state.events) { var es = state.events; state.events = null; es.close(); }
    if (state.poll) { clearInterval(state.poll); state.poll = null; }
  }

  function showState(rec) {
    state.record = rec;
    $('#gen-status').textContent = statusText(rec);
  }

  function showError(message) {
    $('#gen-status').textContent = '';
    $('#preview-errors').textContent = message;
    $('#btn-do').disabled = true;
  }

  function showFailed(rec) {
    state.record = rec;
    showError(rec.error || 'Slicing failed.');
  }

  function showDone(rec) {
    state.record = rec;
    state.token = rec.token;
    var s = rec.summary || {};
    $('#gen-status').textContent = 'Sliced.';
    $('#preview-stats').textContent = summaryLine(s);
    $('#preview-result').hidden = false;
    if (s.warnings && s.warnings.length) {
      $('#preview-notes').textContent = s.warnings.map(function (w) { return '⚠ ' + w; }).join('\n');
      $('#preview-notes').hidden = false;
    }
    $('#btn-do').disabled = false;
    updateSummary();
    showMesh();
  }

  function showMesh() {
    if (typeof PrintViewer === 'undefined' || !state.info) return;
    if (!viewer) {
      viewer = new PrintViewer({ canvas: $('#print-canvas'), container: $('#viewer-container'),
                                 resetButton: $('#btn-reset-view'), emptyState: $('#viewer-empty') });
    }
    fetch('/print/part?stl=1', { credentials: 'same-origin' })
      .then(function (r) { return r.arrayBuffer(); })
      .then(function (buf) { viewer.load(buf, state.info.printer); })
      .catch(function (e) { $('#preview-notes').textContent = 'Could not load the 3D view: ' + e.message; $('#preview-notes').hidden = false; });
  }

  function bindPreview() {
    if (typeof window !== 'undefined') {
      window.PenguinCAM.getJobState = function () { return state.record ? state.record.state : null; };
    }
  }

  /* ------------------------------------------------- final action (save) */
  // Same behaviour as the CNC wizard's split button (remembered choice, Drive only
  // when configured), but the code lives here on purpose.
  var SAVE_PREF_KEY = 'penguincam_save_action';
  function readSavePref() { try { return localStorage.getItem(SAVE_PREF_KEY); } catch (e) { return null; } }
  function writeSavePref(a) { try { localStorage.setItem(SAVE_PREF_KEY, a); } catch (e) {} }
  function actionLabel(a) { return a === 'drive' ? 'Send to Google Drive' : 'Download Program'; }

  function preferredAction() {
    var pref = readSavePref();
    return (pref === 'drive' && CFG.driveEnabled) ? 'drive' : 'download';
  }

  function setupFinalAction() {
    var driveOk = !!CFG.driveEnabled;
    if (state.saveAction === 'drive' && !driveOk) state.saveAction = 'download';
    $('#btn-do-caret').hidden = !driveOk;
    $('#final-action').classList.toggle('has-caret', driveOk);
    var driveItem = document.querySelector('#do-menu li[data-action="drive"]');
    if (driveItem) driveItem.hidden = !driveOk;
    $('#btn-do').textContent = actionLabel(state.saveAction);
  }

  function chooseAction(a) {
    state.saveAction = a;
    writeSavePref(a);
    $('#btn-do').textContent = actionLabel(a);
    $('#do-menu').hidden = true;
    performAction(a);
  }

  function performAction(a) {
    if (!state.token) return;
    if (a === 'drive') driveSave(state.token);
    else doDownload(state.token);
  }

  function doDownload(token) {
    window.open('/download/' + token, '_blank');
    $('#gen-status').textContent = 'Download started.';
  }

  function driveSave(token) {
    var status = $('#gen-status'), errs = $('#preview-errors');
    errs.textContent = '';
    status.textContent = 'Checking Google Drive…';
    fetch('/drive/status', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (st) {
        if (!st.enabled) { errs.textContent = 'Google Drive is not configured for your team.'; status.textContent = ''; return; }
        if (!st.authenticated) {
          status.textContent = 'Complete Google sign-in in the popup…';
          var popup = window.open('/auth/login', 'penguincam_gauth', 'width=600,height=700');
          if (!popup) { errs.textContent = 'Popup blocked — allow popups, then try again.'; status.textContent = ''; return; }
          var iv = setInterval(function () { if (popup.closed) { clearInterval(iv); driveUpload(token); } }, 500);
          setTimeout(function () { clearInterval(iv); }, 180000);
          return;
        }
        driveUpload(token);
      })
      .catch(function (e) { errs.textContent = 'Drive check failed: ' + e; status.textContent = ''; });
  }

  function driveUpload(token) {
    var status = $('#gen-status'), errs = $('#preview-errors'), btn = $('#btn-do');
    status.textContent = 'Uploading to Google Drive…';
    btn.disabled = true;
    fetch('/drive/upload/' + token, { method: 'POST', credentials: 'same-origin',
                                      headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        btn.disabled = false;
        if (res.ok && res.j.success) status.textContent = res.j.message || 'Saved to Google Drive.';
        else { errs.textContent = (res.j && res.j.message) || 'Drive upload failed.'; status.textContent = ''; }
      })
      .catch(function (e) { btn.disabled = false; errs.textContent = 'Drive upload failed: ' + e; status.textContent = ''; });
  }

  function bindFinalAction() {
    $('#btn-do').addEventListener('click', function () { if (!this.disabled) performAction(state.saveAction); });
    $('#btn-do-caret').addEventListener('click', function (e) { e.stopPropagation(); var m = $('#do-menu'); m.hidden = !m.hidden; });
    $('#do-menu').addEventListener('click', function (e) {
      var li = e.target.closest('li[data-action]');
      if (li) chooseAction(li.getAttribute('data-action'));
    });
    document.addEventListener('click', function (e) { if (!e.target.closest('#final-action')) $('#do-menu').hidden = true; });
  }
```

- [ ] **Step 3: Run the node tests, the quick suite, and commit**

Run: `cd /repos/popcornpenguins/PenguinCAM && node --test print/tests/js && uv run python -m unittest discover -s tests --buffer && uv run python -m unittest discover -s print/tests -t . --buffer && uv run python gcode_test.py --quiet`
Expected: all pass. Commit with message `print(d): preview flow with event stream, polling fallback and save button`.

---

### Task 3: `print/static/print_viewer.js`

**Files:**
- Replace: `print/static/print_viewer.js` (the placeholder)
- Create: `print/tests/js/print_viewer.test.js`

**Interfaces:**
- Consumes: `THREE`, `THREE.OrbitControls` (globals from the CDN scripts), and the `printer` object from `/print/part` (`{name, bed_mm: {x, y}, height_mm}`).
- Produces: global `PrintViewer(els)` with `els = {canvas, container, resetButton, emptyState}`; methods `load(arrayBuffer, printer)`, `resetView()`, `setTheme()`; exported for node: `parseSTL(arrayBuffer) -> {positions: Float32Array, count: number, min: [x,y,z], max: [x,y,z]}`.

Coordinates: STL (x, y, z) maps to THREE (x, z, -y), z up as in `gcode_viewer.js`. The bed is a plane of `bed_mm.x` by `bed_mm.y` at THREE y = 0, centred at the origin; the mesh is translated so its footprint centre sits at the origin and its lowest point at y = 0.

- [ ] **Step 1: Write the failing node test**

`print/tests/js/print_viewer.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const v = require(path.join(__dirname, '..', '..', 'static', 'print_viewer.js'));

function binaryStl(tris) {
  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.writeUInt32LE(tris.length, 80);
  tris.forEach((t, i) => {
    let o = 84 + i * 50 + 12;   // skip the normal
    for (const vert of t) for (const c of vert) { buf.writeFloatLE(c, o); o += 4; }
  });
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
}

test('parseSTL reads binary triangles and bounds', () => {
  const buf = binaryStl([[[0, 0, 0], [3, 0, 0], [0, 5, 2]], [[-1, 0, 0], [0, 0, 0], [0, 1, 0]]]);
  const r = v.parseSTL(buf);
  assert.equal(r.count, 2);
  assert.equal(r.positions.length, 18);
  assert.deepEqual(r.min, [-1, 0, 0]);
  assert.deepEqual(r.max, [3, 5, 2]);
});

test('parseSTL reads ASCII', () => {
  const text = 'solid t\n facet normal 0 0 1\n  outer loop\n   vertex 0 0 0\n   vertex 10 0 0\n   vertex 0 20 5\n  endloop\n endfacet\nendsolid t\n';
  const r = v.parseSTL(new TextEncoder().encode(text).buffer);
  assert.equal(r.count, 1);
  assert.deepEqual(r.max, [10, 20, 5]);
});

test('parseSTL handles the checked-in sample part', () => {
  const data = fs.readFileSync(path.join(__dirname, '..', '..', 'print', 'sample_part.stl'));
  const r = v.parseSTL(data.buffer.slice(data.byteOffset, data.byteOffset + data.length));
  assert.equal(r.count, 20);
  assert.deepEqual(r.min, [0, 0, 0]);
  assert.deepEqual(r.max, [40, 30, 12]);
});

test('parseSTL rejects an empty file', () => {
  assert.throws(() => v.parseSTL(new ArrayBuffer(0)), /STL/);
});
```

Run: `cd /repos/popcornpenguins/PenguinCAM && node --test print/tests/js`
Expected: the viewer tests fail (`parseSTL is not a function`).

- [ ] **Step 2: Write the viewer**

```js
/* Mesh-on-bed viewer for the 3D print wizard. Parses binary or ASCII STL, shows
 * the part on a plane the size of the printer bed, orbit controls, reset view.
 * No scrubber, no animation. Requires THREE and THREE.OrbitControls (loaded by
 * print/templates/print_wizard.html). parseSTL is exported for node tests.
 */
(function () {
  'use strict';

  function parseSTL(arrayBuffer) {
    var bytes = new Uint8Array(arrayBuffer);
    if (bytes.length < 15) throw new Error('STL file is empty or truncated');
    var count = 0, positions, i, o;
    var dv = new DataView(arrayBuffer);
    var binaryCount = bytes.length >= 84 ? dv.getUint32(80, true) : -1;
    var isBinary = bytes.length >= 84 && bytes.length === 84 + 50 * binaryCount;
    if (isBinary) {
      count = binaryCount;
      positions = new Float32Array(count * 9);
      for (i = 0; i < count; i++) {
        o = 84 + i * 50 + 12;
        for (var k = 0; k < 9; k++) positions[i * 9 + k] = dv.getFloat32(o + k * 4, true);
      }
    } else {
      var text = '';
      for (i = 0; i < bytes.length; i += 8192) text += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
      var re = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g, m, list = [];
      while ((m = re.exec(text)) !== null) list.push(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
      count = Math.floor(list.length / 9);
      positions = new Float32Array(list.slice(0, count * 9));
    }
    if (count === 0) throw new Error('STL file has no triangles');
    var min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (i = 0; i < positions.length; i += 3) {
      for (var a = 0; a < 3; a++) {
        if (positions[i + a] < min[a]) min[a] = positions[i + a];
        if (positions[i + a] > max[a]) max[a] = positions[i + a];
      }
    }
    return { positions: positions, count: count, min: min, max: max };
  }

  function themeColors() {
    var light = typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'light';
    return light ? { bg: 0xf2f4f7, bed: 0xd8dee6, grid: 0xb8c2cc, part: 0x2f81f7 }
                 : { bg: 0x0a0e14, bed: 0x1e2632, grid: 0x30363d, part: 0x4c9aff };
  }

  function PrintViewer(els) {
    this.els = els;
    this.mesh = null;
    this.bed = null;
    this.grid = null;
    this.fit = { pos: [200, 200, 200], target: [0, 0, 0] };
    this._initScene();
    var self = this;
    if (els.resetButton) els.resetButton.addEventListener('click', function () { self.resetView(); });
  }

  PrintViewer.prototype._initScene = function () {
    var canvas = this.els.canvas;
    var container = this.els.container || canvas.parentElement;
    this.container = container;
    var w = container.clientWidth || 600, h = container.clientHeight || 320;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(themeColors().bg);
    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 5000);
    this.renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    var dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(100, 300, 200);
    this.scene.add(dir);
    this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.maxPolarAngle = Math.PI / 2 + 0.05;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: null };
    this.resetView();
    var self = this;
    (function animate() {
      requestAnimationFrame(animate);
      self.controls.update();
      self.renderer.render(self.scene, self.camera);
    })();
    window.addEventListener('resize', function () { self._resize(); });
  };

  PrintViewer.prototype._resize = function () {
    var w = this.container.clientWidth || 600, h = this.container.clientHeight || 320;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  // STL (x, y, z) -> THREE (x, z, -y): z up, like the G-code viewer.
  PrintViewer.prototype.load = function (arrayBuffer, printer) {
    var stl = parseSTL(arrayBuffer);
    var colors = themeColors();
    var bedX = (printer && printer.bed_mm && printer.bed_mm.x) || 256;
    var bedY = (printer && printer.bed_mm && printer.bed_mm.y) || 256;
    if (this.mesh) this.scene.remove(this.mesh);
    if (this.bed) this.scene.remove(this.bed);
    if (this.grid) this.scene.remove(this.grid);

    var cx = (stl.min[0] + stl.max[0]) / 2, cy = (stl.min[1] + stl.max[1]) / 2, z0 = stl.min[2];
    var arr = new Float32Array(stl.positions.length);
    for (var i = 0; i < stl.positions.length; i += 3) {
      arr[i] = stl.positions[i] - cx;
      arr[i + 1] = stl.positions[i + 2] - z0;
      arr[i + 2] = -(stl.positions[i + 1] - cy);
    }
    var geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    geom.computeVertexNormals();
    this.mesh = new THREE.Mesh(geom, new THREE.MeshPhongMaterial({ color: colors.part, side: THREE.DoubleSide }));
    this.scene.add(this.mesh);

    this.bed = new THREE.Mesh(new THREE.PlaneGeometry(bedX, bedY),
                              new THREE.MeshPhongMaterial({ color: colors.bed, side: THREE.DoubleSide }));
    this.bed.rotation.x = -Math.PI / 2;
    this.bed.position.y = -0.05;
    this.scene.add(this.bed);
    this.grid = new THREE.GridHelper(Math.max(bedX, bedY), Math.round(Math.max(bedX, bedY) / 10), colors.grid, colors.grid);
    this.scene.add(this.grid);

    var span = Math.max(bedX, bedY);
    this.fit = { pos: [span * 0.55, span * 0.6, span * 0.75], target: [0, (stl.max[2] - z0) / 2, 0] };
    this.resetView();
    if (this.els.emptyState) this.els.emptyState.style.display = 'none';
    this._resize();
  };

  PrintViewer.prototype.resetView = function () {
    this.camera.position.set(this.fit.pos[0], this.fit.pos[1], this.fit.pos[2]);
    this.controls.target.set(this.fit.target[0], this.fit.target[1], this.fit.target[2]);
    this.controls.update();
  };

  PrintViewer.prototype.setTheme = function () {
    if (this.scene) this.scene.background = new THREE.Color(themeColors().bg);
  };

  if (typeof window !== 'undefined') window.PrintViewer = PrintViewer;
  if (typeof module !== 'undefined' && module.exports) module.exports = { parseSTL: parseSTL, PrintViewer: PrintViewer };
})();
```

- [ ] **Step 3: Run the node tests, the quick suite, and commit**

Run: `cd /repos/popcornpenguins/PenguinCAM && node --test print/tests/js && uv run python -m unittest discover -s tests --buffer && uv run python -m unittest discover -s print/tests -t . --buffer && uv run python gcode_test.py --quiet`
Expected: all pass. Commit with message `print(d): mesh-on-bed viewer`.

---

### Task 4: The two touches to the CNC wizard

**Files:**
- Modify: `templates/wizard.html` (mode fieldset, lines 92-97)
- Modify: `static/wizard.js` (mode change handler, lines 444-450)
- Modify: `print/tests/test_wizard_page.py` (add one test)

**Interfaces:**
- Consumes: `/print` route; `printPageUrl` semantics (the CNC page builds the same URL inline; it cannot import from `print_wizard.js`).
- Produces: nothing new.

- [ ] **Step 1: Add the failing test**

Append to `print/tests/test_wizard_page.py`:

```python
class CncSetupRadioTest(unittest.TestCase):
    def setUp(self):
        app.config["TESTING"] = True
        self.client = app.test_client()
        limiter.reset()
        limiter.enabled = False

    def tearDown(self):
        limiter.enabled = True

    def test_cnc_setup_offers_3d_printing(self):
        html = self.client.get("/app").get_data(as_text=True)
        self.assertRegex(html, r'<input type="radio" name="mode" value="print">\s*3D Printing')
        js = (REPO / "static" / "wizard.js").read_text()
        self.assertIn("'/print?source='", js)
        self.assertIn("location.pathname + location.search", js)
```

Run: `cd /repos/popcornpenguins/PenguinCAM && uv run python -m unittest tests.test_print_wizard_page -v`
Expected: `test_cnc_setup_offers_3d_printing` fails.

- [ ] **Step 2: Make the two edits**

In `templates/wizard.html`, inside the Mode fieldset after the Tubing radio, add:

```html
                    <label class="radio"><input type="radio" name="mode" value="print"> 3D Printing — slice a part for the Bambu Lab printer</label>
```

In `static/wizard.js`, change the mode change handler to:

```js
    $all('input[name="mode"]').forEach(function (r) {
      r.addEventListener('change', function () {
        if (this.value === 'print') {
          // The print wizard is a separate page. Carry source and theme, and the
          // current path and query as the way back (the panel needs its Onshape
          // parameters to re-handshake).
          location.href = '/print?source=' + encodeURIComponent(state.source) +
            '&theme=' + encodeURIComponent(CFG.theme || 'dark') +
            '&return=' + encodeURIComponent(location.pathname + location.search);
          return;
        }
        state.mode = this.value;
        applyModeUI();
        dbg('mode', state.mode);
      });
    });
```

Nothing else in `wizard.js` changes; `applyModeUI` never sees `print`.

- [ ] **Step 3: Run the tests, the quick suite, then `make test`, and commit**

Run: `cd /repos/popcornpenguins/PenguinCAM && uv run python -m unittest tests.test_print_wizard_page -v && make test`
Expected: all pass. Commit `templates/wizard.html`, `static/wizard.js`, `print/tests/test_wizard_page.py` with message `print(d): 3D Printing radio on the CNC Setup step`.

---

## Self-review

- Spec coverage: separate page with same header, step bar, footer, split button, `drive_enabled` (Task 1); mode radios with 3D Printing checked and 2.5D hidden in upload mode, other radios navigate to `return` (Task 1); read-only Printer/Filament/Process fields, no machine dropdown (Task 1); Parts list with name and bounding box (Task 1); Layout drawing with centred footprint, printer name and bed size, too-big error with Next disabled (Task 1); chips per spec (Task 1 + Task 2's summary); Preview submit, `Queued`/`Slicing` live status with elapsed seconds, summary line, warnings in notes, save enabled on done, error shown on failure, 503/429/404/401 messages (Task 2); EventSource with polling fallback every two seconds, stream closed on leaving the step (Task 2); download and Drive as the CNC page, remembered choice (Task 2); viewer with binary and ASCII STL, bed plane, centred mesh, orbit controls, reset view (Task 3); CNC radio and navigation with `source`, `theme`, `return` (Task 4); grid layout in upload mode (Task 1). `window.PenguinCAM.getJobState` is a small addition for the acceptance run.
- Placeholders: none.
- Names: ids in the template match `print_wizard.js` (`p-printer`, `parts-list`, `info-printer-name`, `info-bed-size`, `layout-canvas`, `layout-errors`, `gen-status`, `preview-result`, `preview-stats`, `viewer-container`, `viewer-empty`, `print-canvas`, `btn-reset-view`, `preview-errors`, `preview-notes`, `btn-do`, `btn-do-caret`, `do-menu`, `final-action`, `btn-next`, `btn-back`, `wiz-summary`, `opt-mode-25d`) and the page test; `PrintViewer` constructor options match Task 2's `showMesh`.

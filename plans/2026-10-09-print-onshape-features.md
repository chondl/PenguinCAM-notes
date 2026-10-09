# Print Path in Onshape, Milestone 1: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A student in Onshape picks parts, places copies of them on the plate, chooses the
team's filament and print settings, and downloads one sliced `.gcode.3mf`; every step can
be followed from the server's logs.

**Architecture:** Everything new lives under `print/`. The server resolves Onshape
selections and exports each part once (`print/onshape_parts.py`), keeps the meshes in a
part store keyed by bearer `ref`s, checks placements with a geometry module mirrored in
Python and JavaScript, writes one 3MF object per copy and runs Orca with
`--arrange 0 --orient 0` against profiles from a committed catalog. One log line per print
event, keyed by a per-page-load page id, makes the path supportable.

**Tech Stack:** Python 3.11, Flask 3.0, flask-limiter, numpy, shapely, requests; Orca
Slicer 2.4.2 at `tools/orca/`; ES5 browser JavaScript with node's built-in test runner;
`unittest`; the Onshape test bed (replay adapter, fake host, Playwright 1.63).

**Spec:** [2026-10-09-print-onshape-features-design.md](../specs/2026-10-09-print-onshape-features-design.md)

**Code tree:** `/repos/popcornpenguins/PenguinCAM/.worktrees/onshape-test-bed`, branch
`feature/onshape-test-bed`. All paths below are relative to it. This plan starts after the
[Onshape test bed plan](2026-10-09-onshape-test-bed.md) has finished its Tasks 1–13; it
consumes the interfaces listed under "Consumed from the test bed".

## Global Constraints

Copied from the spec; every task's requirements include these.

- "**All new code lives under `print/`**: Python modules, routes in the print blueprint,
  templates, styles (`print/static/print_layout.css`; the page keeps loading the shared
  `static/wizard.css` as today) and scripts. The few touches outside `print/` are listed,
  each with why, in section 9." Section 9's list: `frc_cam_gui_app.py`
  (`init_print_routes` call), `onshape_integration.py` (`request_absolute`),
  `team_config.py` (`printing_section()`), `docs/3D_PRINTING.md`, `testbed/`.
  `config_validation.py`: none.
- "**The print path talks to Onshape through its own module**, `print/onshape_parts.py`."
- "**The print page does its own Onshape messaging**, in `print/static/print_onshape.js`.
  It never loads or calls `static/source_onshape.js`."
- "**Configuration for printing is read by `print/print_config.py`** from the raw
  `printing:` section of the team YAML."
- "No CNC code changes: the CNC page's link already carries the return URL."
- Page id: "12 lowercase hex characters drawn with `crypto.getRandomValues` when the print
  page loads, held in page memory only, and sent with every print request in the
  `X-Print-Page` header. The server accepts it only if it matches `^[0-9a-f]{12}$`; a print
  API request without a valid page id gets a 400."
- Line format: `[PRINT] <event> pid=<page id|-> team=<n|-> job=<id8|-> key=value …`
- "no Onshape user id, name or email in print events."
- "**One quoting rule:** a value made only of letters, digits and `._:/@+-` is written bare;
  any other value (a space, a newline, a quote, an `=`, anything non-ASCII) is written
  JSON-encoded with `json.dumps` (ASCII only), so no value can end a line or forge a
  `[PRINT]` line."
- "Tokens, cookies, keys, download tokens, full job ids and pairing codes never do; they
  are not passed to `events.py` at all."
- Route limits: `POST /print/page` session gate, 10 per minute;
  `POST /print/onshape/parts` Onshape sign-in, 20 per minute;
  `GET /print/parts/<ref>.stl` session gate and owning page id, 120 per minute;
  `POST /print-job` existing, 3 per minute; `POST /print/client-event` session gate,
  30 per minute.
- Limits: triangles per part **250,000**; download per part **12.5 MB, streamed**;
  distinct parts per page id **20**; mesh bytes per page id **50 MB**; copies per plate
  **30, quantity 1 to 30 each**; triangles per job **1,000,000**; part store on disk
  **500 MB**. Each with the spec's sentence (section 5 table), copied exactly.
- "every footprint lies inside the printable area, read from the printer profile's
  `printable_area`, with a 3 mm margin"; spacing "**5 mm**", "a constant in
  `print/plate.py` and is sent to the browser with the plate size, so there is one source."
- Part names "are reduced to the file-name character set, letters, digits, `-` and `_`,
  with other characters becoming `_`, at most 40 characters, and `part` if nothing is
  left. The writer XML-escapes attributes as well."
- Delivered name `<first part name>[_plus<N>]-<YYYYMMDD-HHMM>.gcode.3mf`; `local_time`
  accepted only if it matches `^\d{8}-\d{4}$`, otherwise the server's UTC time.
- "Every error the student sees is one plain sentence, shown through `showError` … the
  browser never receives a stack trace or an upstream body."
- "Synthetic message logs are allowed only as self-test fixtures for the fake Onshape host
  and the print page's own node tests, under `testbed/tests/fixtures/`, each marked
  `"synthetic": true`; they are deleted when the real recordings land, and no scenario ever
  replays one." Synthetic REST cassettes, written from the OpenAPI, live there too, marked
  the same way.
- **Gate and environment (owner):** `make test` passes before any task is done
  (`make test-quick` while iterating); Python 3.11 syntax only; no `pyproject.toml`
  (dependencies in `requirements.txt`; numpy and shapely are already there); no live
  Onshape call in any test; only Task 17 needs Onshape credentials.
- **Repository rules:** work on `feature/onshape-test-bed`, never commit to `main`. Docs in
  PenguinCAM never mention the notes repo, specs, plans, the owner's Mac or the container;
  measurements are written neutrally ("on an aarch64 Linux machine"). No `rm` on paths
  built from variables; use literal paths, `"${VAR:?}"` or `shutil.rmtree` on a checked
  path. Never `import print`; use `from print import …`.

## Review Focus

1. **Two different parts with the same name on one plate** (a `Bracket` from two Part
   Studios). Expected: distinct copy labels `Bracket #1`, `Bracket #2`, `Bracket #3`, and
   the `plate_1.json` guard passes. Owning tests: Task 8 shared case
   `same_name_two_parts`, Task 9 `test_same_named_parts_get_distinct_object_names`.
2. **The server restarts (a deploy) between Parts and Preview**, so the part store index is
   gone. Expected: `POST /print-job` answers 400 with "A part is no longer on the server;
   press Refresh from Onshape on the Parts step." Owning test: Task 10
   `test_unknown_ref_asks_for_refresh`.
3. **A copy exactly 5 mm from another, or exactly on the 3 mm margin.** Expected: allowed by
   the browser and the server alike, so a green Layout never meets a 400. Owning tests:
   Task 8 shared cases `exactly_spacing_apart` and `exactly_on_margin`.
4. **Back to Parts after arranging, then a new part or a higher quantity.** Expected: copies
   already placed stay put; new copies wait at the side in red, and the sentence offers
   Arrange. Owning test: Task 11 `syncCopies keeps placed copies and parks new ones`.
5. **The same part arriving twice** (clicked, then picked in the dialog). Expected: listed
   once, exported once. Owning tests: Task 6 `test_same_source_returns_existing_ref`,
   Task 7 `addParts ignores a ref already listed`.

---

## Rulings on spec gaps

The spec leaves these open or contradicts itself; the plan rules as follows.

| # | Gap | Ruling |
|---|---|---|
| R1 | 6.2 "Two files with the same name fail the build", but 104 filament names (for example `Bambu ABS-GF @base`) exist in both `BBL/` and `OrcaFilamentLibrary/`; neither tree has a duplicate inside itself (checked Fri 10-09) | A duplicate inside one tree fails the build. A BBL name shadows the library's, as Orca resolves vendor profiles first; the shadowed count is printed in the build log |
| R2 | 4.2 says `orientation` names "which axis of the part points down", yet `+z` is "as modelled", where `-z` points down | `orientation` names the part axis that points **up**; `+z` is as modelled. Matrices in Task 8 |
| R3 | 2.1 `deliver` has no route: Download and Drive are app routes outside `print/` | New `POST /print/deliver` `{job_id, action, outcome}`, session gate, 30 per minute. The wizard reports download and Drive; `printer_panel.js` reports the printer outcome through `window.PenguinCAM.reportDeliver`. Logged with `job=<id8>` |
| R4 | `EventSource` cannot send the `X-Print-Page` header | `GET` print routes also accept the page id as the `pid` query parameter. `GET /print` and static files need none |
| R5 | 4.4 `arrangeCopies(copies, plate, spacing)` has no footprints | `arrangeCopies(copies, parts, plate)`; `plate.spacing` carries the spacing |
| R6 | Copy numbering `<part name> #<n>`, "n counting from 1 for each part", collides when two parts share a name (Review Focus 1) | One label everywhere (3MF object, `plate_1.json`, Layout sentences): sanitized name + ` #n`, with n counting per sanitized name |
| R7 | 5 "the first build task slices a plate at the caps", but slicing a plate exists only after the 3MF writer | The measurement is a step of Task 9. All caps are constants in `print/limits.py`, so lowering them is one edit |
| R8 | Upload (full-page) mode and `POST /print-job` | A body without `copies` keeps today's sample-part job unchanged (delivered as `sample_part.gcode.3mf`). Upload mode shows the default set read-only, with no overrides |
| R9 | Override defaults | Each of the four menus starts at "Profile default", which sends nothing. With `allow_overrides: false`, a non-empty `overrides` is a 400 |
| R10 | Footprint centre and rotation pivot are not defined | A footprint is centred on its bounding-box centre after the orientation; `angle` rotates counterclockwise seen from above, about that centre; `x, y` place that centre |
| R11 | Sentences the spec does not fix | Fixed in the owning task, in its constants: placement rules (Task 8), page id refusal, mesh too small, assembly part not found (Tasks 1, 4, 5), config warnings (Task 14) |
| R12 | `layout` event "when the student enters Preview" | Logged by `POST /print-job` for a valid placement: entering Preview is what submits |
| R13 | Test bed scenario estimates for the four new scenarios | 12 counted calls each |
| R14 | Docstrings with "fixed set" / "sample part" / "Stage 1" | Swept in Task 14 (server) and Task 15 (template), when they stop being true |

## Consumed from the test bed

- `testbed.settings`: `CASSETTE_DIR`, `MESSAGE_DIR`, `testbed_is_on()`.
- `testbed.cassette`: `Exchange`, `Cassette(scenario, exchanges, synthetic=False)` with
  `save(directory)`.
- `testbed.adapters`: `ReplayAdapter`, `set_current_scenario(name)`,
  `reset_testbed_adapters_for_tests()`. Unit tests mount `ReplayAdapter()` on
  `client.session` and patch `settings.CASSETTE_DIR` to
  `testbed/tests/fixtures/cassettes`, the way `testbed/tests/test_adapters.py` does.
- `testbed.scenarios`: `Step`, `Scenario`, `SCENARIOS`, `scenario_is_recorded(name)`,
  `run_scenario_api(name, client, documents)`, `export_part_stl(client, doc, part_id, params)`.
- `testbed.browser`: `ReplayDevServer`, `launch_test_browser`, `host_url`,
  `sign_in_for_replay`; the fake host's `window.__testbed = {log, setStep, selectPart,
  selectParts, deselect, reloadPanel}`.
- `testbed.messages`: `load_message_log(name, directory=MESSAGE_DIR)`.

## Before Task 1

- [ ] Confirm the test bed plan is through Task 13: `testbed/scenarios/__init__.py`,
  `testbed/browser.py` and `docs/ONSHAPE_TEST_BED.md` exist, and `make test` and
  `make testbed-replay` pass. Record `git rev-parse HEAD` as
  **FEATURES_BASE** for the Verification section.

---

## File structure

```
print/
  events.py            print events: quoting, line format, metrics (Task 1)
  routes.py            page id gate, request lines, new routes, worker (Tasks 1–3, 6, 10, 14)
  onshape_parts.py     panel context, REST address, redirect helper, resolution, export (Tasks 3, 4)
  limits.py            every section 5 limit and its sentence (Task 5)
  mesh.py              numpy STL read, size, six footprints (Task 5)
  part_store.py        PartStore: refs, owner page id, limits, expiry, orphans (Task 5)
  plate.py             orientations (Task 5); copy matrix, labels, placement rules (Task 8)
  plate_3mf.py         3MF writer, delivered name, plate_1.json name guard (Task 9)
  plate_job.py         PlateJob and run_plate_job, the worker's plate path (Task 10)
  print_config.py      catalog, team choices, overrides (Task 14)
  slicer.py            + SliceProfiles, slice_plate, Orca code messages (Task 9)
  jobs.py              submit(payload), sizing note (Tasks 9, 10)
  static/print_onshape.js   Onshape messages, selection, dialog (Task 7)
  static/plate_geometry.js  JS mirror of plate.py, arrangeCopies (Task 8)
  static/print_layout.js    Layout step interaction (Task 11)
  static/print_layout.css   Parts, Layout and Setup styles (Tasks 7, 11, 15)
  static/print_wizard.js    page id, showError, Parts, Preview, Setup (Tasks 2, 7, 12, 15)
  static/print_viewer.js    + loadPlate (Task 12)
  static/printer_panel.js   errors through showError, deliver report (Task 2)
  templates/print_wizard.html  new elements and scripts (Tasks 2, 3, 7, 11, 15)
  scripts/flatten_orca_profiles.py  + name index and catalog (Task 13)
  scripts/measure_plate.py  slices a plate at the caps, prints peak memory and time (Task 9)
  profiles/catalog/    index.json, printer/, filament/, process/ (Task 13, committed)
  tests/fixtures/plate_cases.json   shared Python/JS placement cases (Task 8)
  tests/fixtures/orca_tree/         a tiny fake Orca profile tree (Task 13)
testbed/tests/fixtures/make_print_fixtures.py  writes the synthetic print cassettes and message log (Tasks 4, 7)
testbed/scenarios/__init__.py  + four print scenarios (Task 16)
testbed/tests/browser_print.py  print browser scenarios (Task 16)
```

Outside `print/` and `testbed/`: `onshape_integration.py` and `frc_cam_gui_app.py`
(Task 3), `team_config.py` (Task 14), `docs/3D_PRINTING.md` (Tasks 2, 6, 10, 13, 14),
`CLAUDE.md` key files (Task 16), `Makefile` only if a new slow test module is added (none
planned: slow tests join `print/tests/orca_integration_test.py`).

---

## Sub-project: supportability

### Task 1: Print events and the page id on the server

**Files:**
- Create: `print/events.py`, `print/tests/test_events.py`, `print/tests/test_routes_events.py`
- Modify: `print/routes.py` (page id gate, `request` lines, slice events in `make_worker`,
  `print_job` metric removed), `print/tests/test_routes.py` (send a page id)

**Interfaces:**
- Produces (`print/events.py`, Flask-free):
  - `EVENT_NAMES = frozenset({'page','config','select','export','export_failed','layout',
    'slice_queued','slice_done','slice_failed','deliver','client_error','request'})`
  - `PAGE_ID_RE = re.compile(r'^[0-9a-f]{12}$')`; `valid_page_id(value) -> str | None`
  - `quote_value(value) -> str`: `None` → `-`; `True`/`False` → `yes`/`no`; ints and
    floats via `str`; a list or tuple is joined with `,` and then quoted; a dict raises
    `TypeError`; strings follow the quoting rule (bare when they match
    `^[A-Za-z0-9._:/@+-]+$`, else `json.dumps(value, ensure_ascii=True)`, so `""` for empty).
  - `format_print_line(event: str, pid: str | None, team: int | None, job: str | None, fields: dict) -> str`.
    Raises `ValueError` for an unknown event, for a `pid` failing `PAGE_ID_RE`, or a `job`
    not matching `^[A-Za-z0-9_-]{1,8}$` (the guard that keeps full job ids out). Field order
    is insertion order.
  - `configure_print_events(log: Callable[[str], None], metrics) -> None`
  - `print_event(event: str, *, pid=None, team=None, job=None, **fields) -> str`: writes the
    line through `log`; for every event but `request` also calls
    `metrics.log_event('print_' + event, team_number=team, metadata={'pid': pid, 'job': job, **fields})`.
    Returns the line.
- Produces (`print/routes.py`):
  - `PAGE_ID_MESSAGE = "This page is out of date; reload it."`
  - `_page_id() -> str | None`: the `X-Print-Page` header, or for `GET` the `pid` query
    parameter (R4), passed through `valid_page_id`.
  - `_page_id_gate() -> tuple | None`: `(jsonify({'error': PAGE_ID_MESSAGE}), 400)` when
    `_page_id()` is None. Applied to every print-blueprint route except `GET /print` and
    the blueprint's static endpoint, after the session gate.
  - `_team_for_events() -> int | None`: `None` when `session.get('using_default_config')`,
    else `session.get('team_number')`.
  - A blueprint `after_request` hook writing `print_event('request', pid=…, team=…,
    method=request.method, rule=request.url_rule.rule, status=response.status_code, ms=…)`
    for every print-blueprint request except `print.static`; start time from a
    `before_request` hook in `flask.g`.
  - `make_worker(token_manager, upload_folder, output_folder, log)` (metrics argument
    dropped). The worker logs `slice_done` / `slice_failed` with `job=job_id[:8]`,
    `seconds`, `code`, `reason`. `print_job_submit` logs `slice_queued`.
  - `init_print_routes(...)` calls `configure_print_events(log, metrics)`.

- [ ] **Step 1: Write the failing tests** in `test_events.py`:
  - `test_bare_values_stay_bare`: `quote_value('Bracket_2.stl')` is `Bracket_2.stl`;
    `quote_value('a@b+c:d/e-f')` unchanged.
  - `test_unsafe_values_are_json_encoded`: `'two words'` → `"two words"`; `'x\n[PRINT] page'`
    → `"x\n[PRINT] page"` (a literal backslash-n, one line); `'a=b'` → `"a=b"`; `'Grüße'`
    → `"Grüße"`; `''` → `""`.
  - `test_none_bool_list_and_dict`: `None` → `-`, `True` → `yes`, `['A','B C']` → `"A,B C"`,
    `{}` raises `TypeError`.
  - `test_line_format`: `format_print_line('export', 'abcdef012345', 1234, None, {'bytes': 84})`
    equals `[PRINT] export pid=abcdef012345 team=1234 job=- bytes=84`.
  - `test_full_job_id_refused`: a 43-character job raises `ValueError`.
  - `test_bad_page_id_refused_and_unknown_event_refused`.
  - `test_request_writes_no_metrics_row`: with a `mock.Mock()` metrics, `print_event('request', …)`
    leaves `log_event` uncalled; `print_event('page', …)` calls it with `'print_page'`.
- [ ] **Step 2: Write the failing route tests** in `test_routes_events.py` (pattern of
  `PrintRouteBase` in `test_routes.py`, log captured by patching `ctx.log` and the events
  log with a list appender):
  - `test_print_api_without_page_id_is_400`: `GET /print-job/x` and `POST /print-job` with
    no header → 400 and `PAGE_ID_MESSAGE`; `X-Print-Page: ABCDEF012345` (upper case) → 400.
  - `test_get_accepts_pid_query`: `GET /print-job/nope?pid=abcdef012345` → 404 (past the gate).
  - `test_print_page_needs_no_page_id`: `GET /print` → 200.
  - `test_request_line_logs_rule_not_path`: after `GET /print-job/<full id>?pid=…`, the
    captured lines contain `rule=/print-job/<job_id>` and do not contain the full id.
  - `test_team_dash_on_default_config`: session `using_default_config=True`,
    `team_number=6238` → the line has `team=-`.
  - `test_slice_events_replace_print_job_metric`: submitting a sample job with a mocked
    metrics records `print_slice_queued` and `print_slice_done`, never `print_job`.
- [ ] **Step 3: Run** `uv run python -m unittest print.tests.test_events print.tests.test_routes_events -v`.
  Expect FAIL (no module `print.events`).
- [ ] **Step 4: Implement** `print/events.py` and the `routes.py` changes. Update
  `test_routes.py` so every print API call sends `X-Print-Page: abcdef012345`.
- [ ] **Step 5: Run** the two modules, then `make test-quick`. Expect PASS.
- [ ] **Step 6: Commit** `print: print events and the page id gate`.

### Task 2: Page id, one error helper and client events in the browser

**Files:**
- Create: `print/tests/js/error_paths.test.js`
- Modify: `print/static/print_wizard.js`, `print/static/printer_panel.js`,
  `print/routes.py` (`POST /print/page`, `POST /print/client-event`, `POST /print/deliver`),
  `print/tests/js/print_wizard.test.js`, `print/tests/test_routes_events.py`,
  `print/tests/test_printer_panel.py` (if it asserts the old error path),
  `docs/3D_PRINTING.md` (new section "Support: reading the print logs")

**Interfaces:**
- Consumes: `print_event`, `_page_id`, `_page_id_gate`, `_team_for_events` (Task 1).
- Produces (routes, each registered in `init_print_routes` through `limiter.limit`):
  - `POST /print/page`: session gate, page id, `"10 per minute"`. Body
    `{source, theme, has_onshape_context, wvm, server}`. Logs `page` with those fields plus
    `configured` and `config` (`team` or `default`). Answers `200 {}` in this task; Task 8
    adds `plate` and `limits`, Task 14 adds `config`.
  - `POST /print/client-event`: session gate, page id, `"30 per minute"`. Accepts only
    `step`, `message`, `code`, each cut to 300 characters; any other key → 400. Logs
    `client_error`. Answers 204.
  - `POST /print/deliver` (R3): session gate, page id, `"30 per minute"`. Body
    `{job_id, action: download|drive|printer, outcome}`; logs `deliver` with
    `job=job_id[:8]`, `action`, `outcome` (cut to 40 characters). Answers 204.
- Produces (`print_wizard.js`, exported for node where marked):
  - `makePageId(cryptoObj) -> string` (exported): 6 random bytes from
    `cryptoObj.getRandomValues(new Uint8Array(6))` as 12 lowercase hex characters. Called
    once at load; held in `state.pid`.
  - `printFetch(url, opts) -> Promise<Response>`: `fetch` with `credentials: 'same-origin'`
    and `X-Print-Page: state.pid` merged into `opts.headers`. Every print-route fetch uses
    it; the `EventSource` and polling URLs add `pid=` (R4).
  - `showError(step, message, code)`: writes `message` to the step's error line
    (`#<step>-errors`, steps `setup`, `parts`, `layout`, `preview`), clears that step's
    status line, and posts `{step, message, code}` to `/print/client-event` (failures of
    that post are ignored). `clearError(step)` empties it. These two are the only code that
    touches an error line.
  - `window.PenguinCAM.showError = showError` and
    `window.PenguinCAM.reportDeliver(action, outcome)`, which posts `/print/deliver` with
    the current job id. Download reports `started`; Drive reports `ok` or `failed`.
  - `errorForStatus(status, body)` unchanged.
- Modify `printer_panel.js`: its `errorBox(message)` calls
  `window.PenguinCAM.showError('preview', message, 'printer')` when present (keeping its
  own write only as the fallback for its standalone tests), and `send()` calls
  `window.PenguinCAM.reportDeliver('printer', 'queued'|'refused'|'unreachable')` on its
  three outcomes.
- Template: add `<div id="setup-errors" class="errors">` and `<div id="parts-errors" class="errors">`
  to their sections.

- [ ] **Step 1: Write the failing node tests:**
  - in `print_wizard.test.js`: `makePageId returns 12 lowercase hex characters` (a fake
    `getRandomValues` filling `[0,1,0xab,0xcd,0xef,0xff]` gives `0001abcdefff`).
  - `error_paths.test.js`: `only showError and clearError touch an error line`. Read
    `print_wizard.js`, `print_onshape.js` and `print_layout.js` (those that exist) as text;
    find every occurrence of `-errors`; assert each lies inside the body of `showError`
    or `clearError` (located by brace matching from `function showError(` /
    `function clearError(`). Also assert no `.textContent =` assignment targets a variable
    named `errs`.
- [ ] **Step 2: Write the failing route tests** in `test_routes_events.py`:
  `test_client_event_logs_quoted_message` (message `'Bad\nthing'` arrives as one line),
  `test_client_event_rejects_extra_keys`, `test_client_event_cuts_to_300`,
  `test_page_event_fields`, `test_deliver_logs_short_job_id`.
- [ ] **Step 3: Run** `make test-quick`. Expect FAIL on the new tests.
- [ ] **Step 4: Implement** the routes, the wizard changes (every existing write to
  `#layout-errors`, `#preview-errors` and Drive's `errs` goes through
  `showError`/`clearError`; `init()` posts `/print/page` first) and the panel delegation.
- [ ] **Step 5: Docs.** In `docs/3D_PRINTING.md` add "Support: reading the print logs":
  filter Railway's logs for `[PRINT]`, then for one `pid=`; one line per event from the
  spec's table; the quoting rule; that no Onshape identity, token or full job id is
  logged. Neutral wording.
- [ ] **Step 6: Run** `make test-quick`. Expect PASS. **Commit**
  `print: page id, one error helper, client and deliver events`.

---

## Sub-project: the model from Onshape

### Task 3: Onshape transport, panel context and the moved redirect helper

**Files:**
- Create: `print/onshape_parts.py` (context and transport parts),
  `print/tests/test_onshape_context.py`, `tests/test_onshape_request_absolute.py`
- Modify: `onshape_integration.py` (`request_absolute`; `_make_api_request` calls it),
  `frc_cam_gui_app.py` (`init_print_routes` call), `print/routes.py`
  (`init_print_routes` signature; `print_page` context), `print/templates/print_wizard.html`
  (`window.PenguinCAM.onshape`, `onshapeError`), `testbed/scenarios/__init__.py`
  (`export_part_stl` delegates)

**Interfaces:**
- Produces (`onshape_integration.py`):
  `OnshapeClient.request_absolute(self, method: str, url: str, **kwargs) -> requests.Response`:
  `_ensure_valid_token()`, Basic auth for `apikey`, Bearer for OAuth, the existing 401
  refresh-and-retry and `_dead_credentials` messages (naming `url` where they named
  `endpoint`). `_make_api_request(method, endpoint, **kwargs)` becomes
  `return self.request_absolute(method, f"{self.API_BASE}{endpoint}", **kwargs)`.
- Produces (`print/onshape_parts.py`):
  - `NO_CONTEXT_MESSAGE = "Open this panel from a Part Studio or Assembly tab."`
  - `DEFAULT_SERVER = 'https://cad.onshape.com'`
  - `clean_onshape_id(value) -> str`: `''` for empty or any value containing `{` or `$`
    (the `_clean_onshape_id` rule, written in `print/` so the blueprint never imports the app).
  - `panel_context_from_return(return_url: str) -> dict`: reads `documentId`,
    `workspaceId`, `versionId`, `microversionId`, `elementId`, `server`, and
    `configuration` when present, from the return URL's query. An id is kept raw when it is
    24 hex characters or matches `^\{\$\w+\}$`; otherwise it becomes `''`. `server` is kept
    when it is `https://` and its host is `onshape.com` or ends in `.onshape.com`, else
    `DEFAULT_SERVER`. `configuration` is kept raw, cut to 2,000 characters.
  - `OnshapeAddress` (frozen dataclass): `document_id`, `wvm` (`'w'|'v'|'m'`), `wvm_id`,
    `element_id`, `configuration: str | None`; properties `document_path` (the string
    `OnshapeClient._wvm_path(...)` returns) and `element_path` (`document_path + '/e/' + element_id`).
  - `NoOnshapeContext(Exception)` with `message = NO_CONTEXT_MESSAGE`.
  - `rest_address(context: dict) -> OnshapeAddress`: cleans each id, calls
    `OnshapeClient._wvm_path(did, w, v, m)` (the static method, imported from
    `onshape_integration`), derives `wvm`/`wvm_id` from its result; raises
    `NoOnshapeContext` when it raises `ValueError` or `documentId`/`elementId` is empty.
  - `DownloadTooLarge(Exception)`, `ExportHTTPError(Exception)` with `status`.
  - `fetch_following_redirects(client, path: str, params: dict | None = None, *, byte_cap: int | None = None, max_hops: int = 3) -> tuple[bytes, list[str]]`:
    first `client._make_api_request('GET', path, params=params, allow_redirects=False, stream=True)`;
    on 301/302/303/307/308 with `Location`, a host equal to `onshape.com` or ending in
    `.onshape.com` is fetched with `client.request_absolute('GET', url, allow_redirects=False, stream=True)`,
    any other host with `client.session.get(url, allow_redirects=False, stream=True)` and no
    auth. Returns the final body and the hop URLs. A final status outside 200–299 raises
    `ExportHTTPError(status)`; more than `max_hops` hops raises `ExportHTTPError(310)`. The
    body is read with `iter_content(65536)`; past `byte_cap` the response is closed and
    `DownloadTooLarge` raised.
- Produces (`print/routes.py`):
  `init_print_routes(app, *, limiter, require_session, has_onshape_session, onshape_client, token_manager, upload_folder, output_folder, template_context, metrics, log, pool=None, part_store=None)`;
  `ctx.has_onshape_session`, `ctx.onshape_client`. `print_page` puts
  `panel_context_from_return(return_url)` into the template as `onshape`, and, for
  `source=onshape` when `rest_address` raises, `onshape_error = NO_CONTEXT_MESSAGE`.
- `frc_cam_gui_app.py`: passes `has_onshape_session=_has_onshape_session` and
  `onshape_client=lambda: session_manager.get_client(get_current_user_id()) if ONSHAPE_AVAILABLE else None`.
- `testbed/scenarios/__init__.py`: `export_part_stl(client, doc, part_id, params)` builds its
  path as before and returns `fetch_following_redirects(client, path, params)`; its own
  redirect loop is deleted. The test bed test
  `test_export_follows_redirect_and_reattaches_auth_only_for_onshape` must keep passing
  unchanged.

- [ ] **Step 1: Write the failing tests.** `tests/test_onshape_request_absolute.py`
  (requests mocked with `mock.patch.object(client.session, 'request')`):
  - `test_apikey_absolute_url_gets_basic_auth`
  - `test_oauth_absolute_url_gets_bearer`
  - `test_401_refreshes_once_and_retries`
  - `test_make_api_request_prefixes_api_base` (the URL passed to `request_absolute` is
    `https://cad.onshape.com/api/v13/users/sessioninfo`)

  `print/tests/test_onshape_context.py`:
  - `test_six_fields_and_configuration_read_from_return`
  - `test_placeholder_kept_raw_and_junk_dropped`: `workspaceId={$workspaceId}` stays;
    `elementId=abc` becomes `''`.
  - `test_server_validated`: `https://evil.com` and `http://cad.onshape.com` →
    `DEFAULT_SERVER`; `https://cad-testbed.onshape.com` kept.
  - `test_rest_address_prefers_workspace_then_version_then_microversion`
  - `test_version_context_with_placeholder_workspace` → `wvm == 'v'`.
  - `test_no_wvm_raises_no_context`
  - `test_redirect_reattaches_auth_only_for_onshape` (replay adapter, a synthetic cassette
    written in the test's temp dir: 307 to `https://cad.onshape.com/x` then 307 to
    `https://example.com/y`; assert `request_absolute` was called for the first hop only,
    with `mock.patch.object(client, 'request_absolute', wraps=…)`).
  - `test_byte_cap_stops_download` (body of 100 bytes, cap 50 → `DownloadTooLarge`).
  - `test_print_page_passes_context_and_no_context_sentence` (Flask test client: a return
    URL with no workspace, version or microversion on `source=onshape` renders
    `NO_CONTEXT_MESSAGE` and `window.PenguinCAM.onshape`).
- [ ] **Step 2: Run** `uv run python -m unittest tests.test_onshape_request_absolute print.tests.test_onshape_context -v`.
  Expect FAIL.
- [ ] **Step 3: Implement** in the order: `request_absolute`, `onshape_parts.py` context and
  transport, `init_print_routes` and the app call, template, test bed delegation.
- [ ] **Step 4: Run** `make test-quick` (includes `tests/test_onshape_token_refresh.py` and
  `testbed/tests`). Expect PASS.
- [ ] **Step 5: Commit** `print: Onshape transport, panel context, redirect helper moved from the test bed`.

### Task 4: Resolving selections

**Files:**
- Modify: `print/onshape_parts.py`
- Create: `print/tests/test_onshape_resolve.py`,
  `testbed/tests/fixtures/make_print_fixtures.py`, and its output
  `testbed/tests/fixtures/cassettes/synthetic-print-partstudio.json`,
  `synthetic-print-configured.json`, `synthetic-print-assembly.json`,
  `synthetic-print-dialog.json`, `synthetic-print-export.json` (+ `synthetic-print-export/NNN.bin`)

**Interfaces:**
- Consumes: `OnshapeAddress`, `fetch_following_redirects`, `DownloadTooLarge`,
  `ExportHTTPError` (Task 3); test bed `Cassette`, `Exchange`, `ReplayAdapter`,
  `set_current_scenario`.
- Produces (`print/onshape_parts.py`):
  - `ELEMENT_CACHE_TTL_S = 600`
  - `PartSource` (frozen dataclass): `document_id`, `wvm`, `wvm_id`, `element_id`,
    `part_id`, `configuration: str | None = None`, `link_document_id: str | None = None`;
    `to_json() -> dict` with keys `documentId`, `wvm`, `wvmId`, `elementId`, `partId`, and
    `configuration`/`linkDocumentId` only when set; `PartSource.from_json(d)` validates ids
    (24 hex), `wvm` in `w|v|m`, and raises `ValueError` otherwise; `key()` returns the tuple
    used for de-duplication.
  - `ResolvedPart(name: str, source: PartSource, fallback_name: str | None = None)`:
    `fallback_name` is the dialog's `partName`, used by the `idTag` fallback.
  - `PartRefused(Exception)` with `message` and `name`.
  - Sentences (constants): `NOT_SOLID_MESSAGE = "Only solid parts can be printed: {name} was skipped."`,
    `STANDARD_CONTENT_MESSAGE = "{name} is standard content (hardware) and is not printed."`,
    `CONFIGURED_MESSAGE = "This Part Studio has configurations. Use Add from another document… to pick the configuration to print."`,
    `DUPLICATE_NAME_MESSAGE = "Two parts are named {name}; rename one in Onshape."`,
    `NOT_IN_ASSEMBLY_MESSAGE = "Could not find the selected part in this assembly; use Add from another document…"` (R11).
  - `ElementCache(ttl_s=ELEMENT_CACHE_TTL_S, clock=time.time)`, keyed
    `(document_id, wvm_id, element_id, configuration)`, thread-safe, with:
    `element_type(client, address) -> str` (`GET /documents/{document_path}/elements?elementId={eid}`,
    returns `elementType` such as `PARTSTUDIO`, `ASSEMBLY`),
    `configuration_parameters(client, address) -> list` (`GET /elements/{element_path}/configuration`,
    `configurationParameters`), `assembly_definition(client, address) -> dict`
    (`GET /assemblies/{element_path}`, `configuration` param when set),
    `parts_list(client, address) -> list[dict]` (`GET /parts/{element_path}`).
    Module-level `ELEMENT_CACHE = ElementCache()`.
  - `resolve_selections(client, address: OnshapeAddress, selections: list[dict], via: str, cache=ELEMENT_CACHE) -> tuple[list[ResolvedPart], list[dict]]`.
    `via` is `selection`, `dialog` or `refresh`. Errors are `{'name'?: str, 'message': str}`.
    Rules (spec 3.3), per selection:
    - `selection` in a `PARTSTUDIO`: if `address.configuration` is None and
      `configuration_parameters` is non-empty → error `CONFIGURED_MESSAGE` for every
      selection of that request. Part id: `partId`, else `selectionId`/`bodyId`/`entityId`
      matched against `parts_list` by `partId`. The name always comes from `parts_list`
      (cached); a `bodyType` other than `solid` → `NOT_SOLID_MESSAGE`.
    - `selection` in an `ASSEMBLY`: walk `occurrencePath` (a list of instance ids) from
      `rootAssembly.instances` through `subAssemblies` (matched on `documentId`,
      `elementId` and `documentMicroversion`/`configuration` of the assembly instance).
      `isStandardContent` → `STANDARD_CONTENT_MESSAGE`. Source: the instance's
      `documentId`; `wvm='v'` with `documentVersion` when present, else `'m'` with
      `documentMicroversion`, except an instance in the open document without a version
      uses the open address's `wvm`; `configuration` from the instance; `link_document_id`
      = the open document when the instance's document differs. Name: the instance name
      with a trailing ` <n>` removed. No path or no match → `NOT_IN_ASSEMBLY_MESSAGE`.
    - `dialog`: any of `isSurface`, `isComposite`, `isSketch`, `isFlattenedBody` true →
      `NOT_SOLID_MESSAGE`. Source from the item: `documentId`; `wvm` `w` or `v` from
      `workspaceId`/`versionId`; `elementId`; `part_id = idTag`;
      `configuration = elementConfiguration or None`; `link_document_id` as above.
      `fallback_name = partName`. Name: `partName`.
    - `refresh`: each selection is `{source, name}`; `PartSource.from_json(source)`.
  - `ExportResult(stl: bytes, source: PartSource, calls: int, ms: int, hops: list[str])`
  - `ExportFailed(Exception)` (`name`, `status`, `reason`), `PartTooLarge(Exception)` (`name`),
    `OnshapeLimitReached(Exception)` (`name`).
  - `STL_PARAMS = {'mode': 'binary', 'units': 'millimeter'}`
  - `export_part_mesh(client, part: ResolvedPart, *, byte_cap: int, cache=ELEMENT_CACHE) -> ExportResult`:
    `fetch_following_redirects(client, f"/parts/{…}/e/{eid}/partid/{pid}/stl", STL_PARAMS + configuration + linkDocumentId, byte_cap=byte_cap)`.
    A 402 → `OnshapeLimitReached`; `DownloadTooLarge` → `PartTooLarge`; another
    `ExportHTTPError` with `part.fallback_name` set → fetch `parts_list` for that element,
    match by `name`; exactly one → retry with its `partId` (and return that source); more
    than one → `PartRefused(DUPLICATE_NAME_MESSAGE)`; none or retry failure →
    `ExportFailed`. `calls` counts every HTTP call made, hops included.
- `make_print_fixtures.py` writes the five cassettes with `synthetic=True` from the
  documented OpenAPI shapes: ids are made-up 24-hex strings; STL bodies are binary boxes
  (10 × 20 × 30 mm and a 64-segment cylinder) with real normals. Paths carry the
  `/api/v13` prefix. The export cassette: a 307 to `https://cad.onshape.com/api/v13/blob/…`
  followed by a 200 with the STL body.

- [ ] **Step 1: Write the generator and run it**:
  `uv run python testbed/tests/fixtures/make_print_fixtures.py`. Each JSON has
  `"synthetic": true`. `testbed.tests.test_scrub.test_committed_recordings_are_clean` passes.
- [ ] **Step 2: Write the failing tests** in `test_onshape_resolve.py`, each with a replay
  client (helper `replay_client(scenario)`: `OnshapeClient.from_api_keys('k', 's')`,
  `ReplayAdapter()` mounted on `https://`, `settings.CASSETTE_DIR` patched,
  `set_current_scenario(scenario)`, a fresh `ElementCache()`):
  - `test_partstudio_part_id_used_directly_and_named_from_parts_list`
  - `test_partstudio_selection_id_matched_through_parts_list`
  - `test_configured_partstudio_without_configuration_refused` (`CONFIGURED_MESSAGE`)
  - `test_configured_partstudio_with_panel_configuration_passes_it_through`
    (`source.configuration` equals the context's)
  - `test_assembly_occurrence_maps_to_source_with_link_document`
  - `test_subassembly_occurrence_followed`
  - `test_standard_content_refused`
  - `test_dialog_idtag_used_as_part_id`
  - `test_dialog_idtag_fallback_matches_part_name` (first export 404, parts list has one
    match, retry 307 → 200)
  - `test_dialog_duplicate_names_refused`
  - `test_dialog_surface_refused`
  - `test_element_type_cached_for_ten_minutes` (a fake clock: second resolve within 600 s
    makes no elements call; after 601 s it does)
  - `test_export_402_raises_limit_reached`
  - `test_export_counts_calls_including_redirect` (`calls == 2`)
- [ ] **Step 3: Run** `uv run python -m unittest print.tests.test_onshape_resolve -v`. Expect FAIL.
- [ ] **Step 4: Implement** the resolution and export functions.
- [ ] **Step 5: Run** the module and `make test-quick`. Expect PASS.
- [ ] **Step 6: Commit** `print: resolve Onshape selections and export parts, with synthetic cassettes`.

### Task 5: Mesh, limits and the part store

**Files:**
- Create: `print/limits.py`, `print/mesh.py`, `print/part_store.py`, `print/plate.py`
  (orientations only), `print/tests/test_mesh.py`, `print/tests/test_part_store.py`

**Interfaces:**
- Produces (`print/limits.py`), values and sentences from spec section 5:
  - `MAX_PART_TRIANGLES = 250_000`; `MAX_PART_BYTES = 84 + 50 * MAX_PART_TRIANGLES` (12,500,084)
  - `MAX_PARTS_PER_PAGE = 20`; `MAX_PAGE_BYTES = 50_000_000`
  - `MAX_COPIES = 30`; `MAX_QUANTITY = 30`; `MAX_JOB_TRIANGLES = 1_000_000`
  - `MAX_STORE_BYTES = 500_000_000`; `PART_TTL_S = 3600`
  - `TOO_DETAILED_MESSAGE = "{name} is too detailed to print here (over 250,000 triangles)."`
  - `TOO_MANY_PARTS_MESSAGE = "Up to 20 different parts per print."`
  - `PAGE_BYTES_MESSAGE = "These parts are too large to slice together."`
  - `TOO_MANY_COPIES_MESSAGE = "Up to 30 copies per plate; print the rest in a second job."`
  - `JOB_TRIANGLES_MESSAGE = "These copies are too detailed to slice together; lower the quantities."`
  - `STORE_FULL_MESSAGE = "The print service is busy; try again in a few minutes."`
  - `ONE_PLATE_MESSAGE = "Not every copy fits on one plate; lower the quantities and print the rest in a second job."` (spec 5, first rule)
  - `TOO_SMALL_MESSAGE = "{name} is too small to print (under 0.1 mm)."` (R11)
  - `limits_for_browser() -> dict`: keys `max_copies`, `max_quantity`,
    `max_job_triangles`, `too_many_copies_message`, `job_triangles_message`,
    `one_plate_message`.
- Produces (`print/mesh.py`):
  - `MeshError(Exception)` with `message`.
  - `Mesh` (dataclass): `vertices: np.ndarray` (N×3 float64, unique), `faces: np.ndarray`
    (M×3 int), `triangles: int`.
  - `read_binary_stl(data: bytes, name: str) -> Mesh`: requires the exact binary length
    rule of `print.slicer._binary_triangle_count`; reads with `np.frombuffer` over a
    structured dtype (`normal`, `v0`, `v1`, `v2` as `<f4` triples, `attr` `<u2`);
    de-duplicates vertices with `np.unique(axis=0, return_inverse=True)`. Raises
    `MeshError`: not binary or zero triangles → "Onshape could not export {name}. Try again,
    or Refresh from Onshape."; over `MAX_PART_TRIANGLES` → `TOO_DETAILED_MESSAGE`; any axis
    extent ≤ 0.1 mm → `TOO_SMALL_MESSAGE`.
  - `part_size_mm(mesh) -> dict` `{x, y, z}` rounded to 0.001.
  - `orientation_footprints(mesh) -> dict[str, dict]`, one entry per `plate.ORIENTATIONS`
    key: `{'hull': [[x, y], …] (counterclockwise, centred on its bounding-box centre),
    'height': float, 'offset': [cx, cy, zmin]}`, where `offset` is the bounding-box centre
    and lowest point after the orientation matrix (R10). The hull is
    `shapely.MultiPoint(projected).convex_hull`, coordinates rounded to 0.001. Computes the
    three projections once and mirrors them for the opposite orientations. Uses
    `plate.ORIENTATION_MATRICES`.
- Produces (`print/plate.py`, created here with only these two names; Task 8 adds the rest):
  - `ORIENTATIONS = ('+z', '-z', '+x', '-x', '+y', '-y')`
  - `ORIENTATION_MATRICES` (R2: the named axis ends up pointing up), row-major:

    | Orientation | Matrix |
    |---|---|
    | `+z` | `[[1,0,0],[0,1,0],[0,0,1]]` |
    | `-z` | `[[1,0,0],[0,-1,0],[0,0,-1]]` |
    | `+x` | `[[0,0,-1],[0,1,0],[1,0,0]]` |
    | `-x` | `[[0,0,1],[0,1,0],[-1,0,0]]` |
    | `+y` | `[[1,0,0],[0,0,-1],[0,1,0]]` |
    | `-y` | `[[1,0,0],[0,0,1],[0,-1,0]]` |
- Produces (`print/part_store.py`):
  - `REF_RE = re.compile(r'^[A-Za-z0-9_-]{22}$')`
  - `PartLimit(Exception)` with `message`.
  - `PartEntry` (dataclass): `ref`, `pid`, `name`, `source: dict`, `stl_path: Path`,
    `bytes: int`, `triangles: int`, `size_mm: dict`, `footprints: dict`,
    `last_used: float`, `superseded: bool = False`; `to_json()` returns `ref`, `name`,
    `size_mm`, `triangles`, `source`, `footprints`.
  - `PartStore(root: Path, *, clock=time.time, ttl_s=PART_TTL_S, log=None)`, thread-safe:
    - `check_room(pid: str, new_parts: int) -> None`: raises `PartLimit` with
      `TOO_MANY_PARTS_MESSAGE` when the page's live (not superseded) entries plus
      `new_parts` exceed 20, or `STORE_FULL_MESSAGE` when the store holds
      `MAX_STORE_BYTES` or more.
    - `add(pid, name, source: dict, source_key: tuple, stl: bytes, mesh_info: dict) -> PartEntry`:
      `mesh_info` carries `triangles`, `size_mm`, `footprints`. Raises `PartLimit` with
      `PAGE_BYTES_MESSAGE` past 50 MB live bytes for the page, `STORE_FULL_MESSAGE` past
      500 MB in all. Writes `<root>/<ref>/part.stl`, `ref = secrets.token_urlsafe(16)`.
    - `find_source(pid, source_key: tuple) -> PartEntry | None`: live entries only;
      `source_key` is `PartSource.key()` (Task 4), passed in so the store imports nothing
      from `onshape_parts`.
    - `get(ref: str, pid: str) -> PartEntry | None`: `None` unless `REF_RE` matches, the
      index holds it and `pid` owns it; touches `last_used`. Never builds a path from `ref`
      without the index.
    - `supersede(refs: list[str], pid: str) -> None`: marks owned entries superseded; their
      files stay until expiry.
    - `sweep(now=None) -> int`: drops entries unused for `ttl_s` and deletes their
      directories; deletes directories under `root` with no index entry whose mtime is
      older than `ttl_s`. Returns the count removed.
    - `start_sweeper(interval_s=600) -> threading.Thread` (daemon; logs and survives errors).

- [ ] **Step 1: Write the failing tests.** `test_mesh.py`:
  - `test_reads_binary_box_and_size` (10 × 20 × 30 box → `{x:10, y:20, z:30}`, 12 triangles)
  - `test_ascii_or_truncated_refused`
  - `test_triangle_cap`: a header claiming 250,001 triangles with that length →
    `TOO_DETAILED_MESSAGE` with the name.
  - `test_tiny_part_refused`
  - `test_footprints_six_orientations`: for the 10 × 20 × 30 box, `+z` hull spans 10 × 20
    and height 30; `+x` spans 30 × 20 and height 10; `-y` spans 10 × 30 and height 20;
    each hull's bounding box is centred on (0, 0); `offset[2]` is the lowest z after the
    matrix.
  - `test_opposite_orientations_mirror` (`-z` hull equals `+z` hull mirrored in y).

  `test_part_store.py` (temp root, fake clock):
  - `test_add_get_owner_only` (another pid gets `None`)
  - `test_bad_ref_never_touches_disk` (`'../x'`, `'a' * 22` not in the index → `None`)
  - `test_twenty_parts_per_page` (`check_room(pid, 1)` raises with the 21st)
  - `test_page_bytes_and_store_cap`
  - `test_superseded_not_counted_but_file_kept`
  - `test_expiry_one_hour_after_last_use` (a `get` at 59 min keeps it alive)
  - `test_orphan_directories_older_than_an_hour_deleted` (a directory not in the index
    with an old mtime goes; a new one stays)
- [ ] **Step 2: Run** `uv run python -m unittest print.tests.test_mesh print.tests.test_part_store -v`.
  Expect FAIL.
- [ ] **Step 3: Implement** the three modules.
- [ ] **Step 4: Run** them and `make test-quick`. Expect PASS.
- [ ] **Step 5: Commit** `print: limits, numpy mesh reading with footprints, part store`.

### Task 6: Parts routes

**Files:**
- Modify: `print/routes.py`, `docs/3D_PRINTING.md` (section "Parts from Onshape")
- Create: `print/tests/test_routes_parts.py`

**Interfaces:**
- Consumes: `rest_address` (applied to the request's own `context`),
  `resolve_selections`, `export_part_mesh`, exceptions and sentences (Tasks 3–4);
  `read_binary_stl`, `part_size_mm`, `orientation_footprints`, `MeshError` (Task 5);
  `PartStore` (Task 5); `print_event` (Task 1).
- Produces:
  - `init_print_routes` builds `ctx.part_store = part_store or PartStore(Path(upload_folder) / 'print_parts', log=log)`
    and starts its sweeper (not when `part_store` is passed in, as tests do).
  - `SIGNIN_EXPIRED_MESSAGE = "Your Onshape sign-in expired. Go back, Connect, and return to 3D Printing."`
  - `EXPORT_FAILED_MESSAGE = "Onshape could not export {name}. Try again, or Refresh from Onshape."`
  - `LIMIT_REACHED_MESSAGE = "Onshape refused the export (API limit reached)."`
  - `POST /print/onshape/parts`, `"20 per minute"`: gate `ctx.has_onshape_session()`
    (failing: `401 {"error": SIGNIN_EXPIRED_MESSAGE, "code": "signin_expired"}`), then the
    page id. Body `{context, via, selections, replace?}`. Order: `rest_address(context)`
    (400 with `NO_CONTEXT_MESSAGE`); `check_room(pid, len(selections))` (except for
    `refresh`); `resolve_selections`; for each part, unless `via != 'refresh'` and
    `find_source(pid, source.key())` returns an entry (then that entry is answered with no
    export), `export_part_mesh(byte_cap=MAX_PART_BYTES)`, `read_binary_stl`, `add`. After a
    `refresh`, `supersede(replace, pid)`. `OnshapeAuthError` or a client that is `None` or
    `credentials_dead` → the 401 above. Answers
    `200 {"parts": [entry.to_json()…], "errors": [{name?, message}…]}`; every failure is a
    sentence in `errors`, never an upstream body.
  - Events: `select` (`via`, `count`, `element_type`); per part `export` (`part`, `element`,
    `bytes`, `triangles`, `size_mm` as `"XxYxZ"`, `calls`, `ms`, `outcome`) or
    `export_failed` (`part`, `status`, `reason`).
  - `GET /print/parts/<ref>.stl`, `"120 per minute"`: session gate, page id;
    `part_store.get(ref, pid)` or 404; `send_file(entry.stl_path, mimetype='model/stl')`.

- [ ] **Step 1: Write the failing tests** (Flask test client, `ctx.onshape_client` patched to
  return a replay client on the synthetic cassettes, `ctx.has_onshape_session` patched,
  `ctx.part_store` a temp `PartStore`):
  - `test_signin_gate_401_with_code` (an `app_verified` session without Onshape → 401
    `signin_expired`)
  - `test_two_parts_listed_with_sizes_triangles_and_footprints`
  - `test_same_source_returns_existing_ref` (Review Focus 5: posting the same selection
    twice answers the same `ref`; the second request makes no export call)
  - `test_refresh_issues_new_refs_and_supersedes_old` (old ref still served by the STL route)
  - `test_errors_are_sentences` (configured Part Studio → `CONFIGURED_MESSAGE` in `errors`)
  - `test_too_many_parts_refused_before_export`
  - `test_402_gives_limit_sentence`
  - `test_stl_route_owner_only` (other pid → 404)
  - `test_export_events_logged_without_secrets` (captured lines contain `[PRINT] export`
    with `calls=2`, and no `Authorization`, access key or cookie value)
- [ ] **Step 2: Run** `uv run python -m unittest print.tests.test_routes_parts -v`. Expect FAIL.
- [ ] **Step 3: Implement** the routes and wiring.
- [ ] **Step 4: Docs.** "Parts from Onshape": the two ways of picking, one export per
  part, the part store and `ref`s, Refresh, the 3.5 sentences.
- [ ] **Step 5: Run** `make test-quick`. Expect PASS. **Commit** `print: parts routes and the part store in use`.

### Task 7: Parts step in the browser

**Files:**
- Create: `print/static/print_onshape.js`, `print/static/print_layout.css`,
  `print/tests/js/print_onshape.test.js`,
  `testbed/tests/fixtures/messages/synthetic-print-selection.json` (written by
  `make_print_fixtures.py`, `"synthetic": true`)
- Modify: `print/static/print_wizard.js`, `print/templates/print_wizard.html`,
  `print/tests/js/print_wizard.test.js`

**Interfaces:**
- Consumes: `POST /print/onshape/parts`, `GET /print/parts/<ref>.stl` (Task 6);
  `printFetch`, `showError` (Task 2); `window.PenguinCAM.onshape` (Task 3).
- Produces (`print_onshape.js`, exported for node):
  - `partSelectionsFromMessage(message) -> [{partId?, selectionId?, occurrencePath?, name?}]`:
    reads `message.selections`; per item takes `partId`/`bodyId` as `partId`,
    `selectionId`/`entityId` as `selectionId`, `occurrencePath`/`occurrence.path`/`path`
    when an array, `name`. Items with none of the ids are dropped.
  - `dialogItemToSelection(message) -> object`: the `itemSelectedInSelectItemDialog` fields
    `documentId`, `workspaceId`, `versionId`, `elementId`, `elementConfiguration`,
    `partName`, `idTag`, `isSurface`, `isComposite`, `isSketch`, `isFlattenedBody`.
  - `createOnshapeMessenger({context, post, onSelections}) -> messenger`, where
    `post(message, targetOrigin)` and `onSelections(selections, via)`; every message
    carries `documentId`, `workspaceId`, `elementId` from `context`; `targetOrigin` is
    `context.server`. Methods:
    - `init()` posts `applicationInit`;
    - `enterParts()` marks active and arms: `requestSelection` with
      `messageId: 'penguincam-print-<n>'`, `filterType: 'simple'`,
      `entityTypeSpecifier: ['BODY']`, `bodyTypeSpecifier: ['SOLID']`,
      `requiredSelectionCount: 1`;
    - `leaveParts()` marks inactive, posts `stopRequest`, and `closeSelectItemDialog` when
      the dialog is open;
    - `openDialog()` posts `openSelectItemDialog` with `selectParts: true, selectMultiple: true`;
    - `handleMessage(event)`: drops any `event.origin !== context.server`;
      `REQUESTED_SELECTION` only while active: `PENDING` ignored, empty → re-arm,
      otherwise `onSelections(partSelectionsFromMessage(data), 'selection')` and re-arm;
      `SELECTION` ignored; `itemSelectedInSelectItemDialog` →
      `onSelections([dialogItemToSelection(data)], 'dialog')`; `selectItemDialogClosed` →
      dialog closed, re-arm when active.
  - In the browser: `window.PenguinCAM.onshapeMessenger`, created in Onshape mode with
    `post = window.parent.postMessage` and a `message` listener; `init()` at load.
- Produces (`print_wizard.js`):
  - `state.parts`: ordered `[{ref, name, size_mm, triangles, source, footprints, quantity}]`.
  - `addParts(list, incoming) -> list` (exported): appends parts whose `ref` and whose
    `source` key (`documentId|wvmId|elementId|partId|configuration`) are not listed,
    quantity 1.
  - `clampQuantity(value, max) -> int` (exported): integers 1..max; blank or non-numeric → 1.
  - `requestParts(selections, via)`: posts to `/print/onshape/parts` with
    `{context: CFG.onshape, via, selections}`; each `errors[].message` goes through
    `showError('parts', message, 'select')` (the last one stays visible); a 401 with
    `code: 'signin_expired'` shows the answer's `error` with a link to `CFG.returnUrl` (the
    link is added next to the error line, not inside it).
  - Parts list rows: name, `X x Y x Z mm`, a quantity input (`max` from `limits.max_quantity`,
    else 30) and a remove button. Buttons `#btn-add-from-document` (calls
    `openDialog()`) and `#btn-refresh-parts` (posts `via: 'refresh'` with
    `selections: [{source, name}]` and `replace: [refs]`, then swaps the answer in by
    position).
  - `gotoStep('parts')` calls `messenger.enterParts()`; leaving Parts calls `leaveParts()`.
    Next from Parts is disabled with no parts in Onshape mode.
  - `CFG.onshapeError` (Task 3) is shown through `showError('parts', …, 'context')` on load.
- Template: the Parts hint text becomes "Click a part in Onshape to add it."; add the two
  buttons; load `print_layout.css` after `wizard.css`; load `print_onshape.js` before
  `print_wizard.js` in Onshape mode only.

- [ ] **Step 1: Write the failing node tests.** `print_onshape.test.js` (fake `post`
  collecting messages; the synthetic log provides answer shapes):
  - `every message carries the three ids and goes to the server origin`
  - `enterParts arms a count-1 solid body selection`
  - `an answer adds selections and re-arms`
  - `an empty answer re-arms and adds nothing`
  - `PENDING is ignored`
  - `answers while inactive are ignored`
  - `messages from another origin are ignored`
  - `generic SELECTION is ignored`
  - `dialog items arrive with via dialog, and dialog close re-arms`
  - `leaveParts stops the request and closes an open dialog`
  - `partSelectionsFromMessage accepts the known field names` (cases from the synthetic
    log: `selectionId`, `entityId`, `partId`, `bodyId`, an occurrence path)

  `print_wizard.test.js`: `addParts ignores a ref already listed` (Review Focus 5: also a
  new ref with an identical source), `clampQuantity clamps to 1..30`.
- [ ] **Step 2: Run** `make test-quick`. Expect FAIL on the new node tests.
- [ ] **Step 3: Implement** `print_onshape.js`, the wizard's Parts step, the template and
  the Parts styles.
- [ ] **Step 4: Run** `make test-quick`. Expect PASS, `error_paths.test.js` included.
- [ ] **Step 5: Commit** `print: Onshape messaging and the Parts step`.

---

## Sub-project: placement on the plate

### Task 8: Plate geometry, once in Python and once in JavaScript

**Files:**
- Create: `print/plate.py`, `print/static/plate_geometry.js`,
  `print/tests/fixtures/plate_cases.json`, `print/tests/test_plate.py`,
  `print/tests/js/plate_geometry.test.js`
- Modify: `print/plate.py` (created in Task 5), `print/routes.py`
  (`POST /print/page` answers `plate` and `limits`)

**Interfaces:**
- Produces (`print/plate.py`; the JS file exports the camelCase twin of each):
  - `SPACING_MM = 5.0`, `MARGIN_MM = 3.0`, `EPS_MM = 1e-6`
  - `ORIENTATIONS` and `ORIENTATION_MATRICES` from Task 5 (the JS file copies the table).
  - `ORIENTATION_LABELS = {'+z': 'as modelled', '-z': 'upside down', '+x': 'on its side (x)', '-x': 'on its side (−x)', '+y': 'on its side (y)', '-y': 'on its side (−y)'}`
    (JS only needs the labels in the browser; Python keeps them for the docs and tests.)
  - `copy_matrix(orientation: str, angle: float, offset: list[float], x: float, y: float) -> list[list[float]]`:
    3×4 `[M | t]` with `M = Rz(angle) · R_o`, `Rz` counterclockwise in degrees, and
    `t = (x, y, 0) − Rz(angle) · offset`, so `p_plate = M · p_part + t` (R10).
  - `plate_from_printer(printer: dict) -> dict`:
    `{'min': [x0, y0], 'max': [x1, y1], 'height': printable_height, 'margin': MARGIN_MM, 'spacing': SPACING_MM, 'printer': name}`
    from the bounding box of `printable_area`.
  - `copy_hull(copy: dict, footprint: dict) -> list[list[float]]`: the footprint hull
    rotated by `copy['angle']` and moved to `(copy['x'], copy['y'])`.
  - `sanitize_part_name(name: str) -> str`: every character outside `[A-Za-z0-9_-]` → `_`,
    cut to 40, `part` when empty.
  - `copy_labels(names: list[str]) -> list[str]` (R6): `sanitize_part_name(name) + ' #' + n`,
    n counting per sanitized name in list order.
  - `check_placement(copies: list[dict], parts: dict[str, dict], plate: dict) -> list[dict]`:
    `parts[ref]` carries `name` and `footprints`. Problems in order: every `off_plate`
    (copy index order), then every `too_tall`, then every `too_close` pair `(i, j)` with
    `i < j` lexicographic. Each `{'rule', 'copies': [i] | [i, j], 'message'}` with
    sentences (R11):
    - `off_plate`: `"{label} is not fully on the plate."`: some hull vertex outside
      `[min + margin − EPS, max − margin + EPS]`;
    - `too_tall`: `"{label} is taller than the printer can print ({height:g} mm)."`:
      `footprint.height > plate.height + EPS`;
    - `too_close`: `"{label} and {label2} are closer than {spacing:g} mm."`: polygon
      distance `< spacing − EPS` (overlap counts as distance 0).

    Python computes distance with shapely (`Polygon.distance`); JS writes convex-polygon
    distance itself (0 when a separating-axis test finds overlap, else the minimum over
    vertex-to-edge distances both ways).
- Produces (JS only, `plate_geometry.js`):
  `arrangeCopies(copies, parts, plate) -> {copies, unplaced: [indexes]}` (R5): keeps each
  copy's orientation and angle; orders copies by the area of their rotated hull's bounding
  box, largest first (ties by index); shelf rows from `min + margin`, left to right in x,
  rows advancing in +y, each next box `spacing` after the previous and each row `spacing`
  above the tallest box of the row before. A copy that does not fit is `unplaced`, put at
  `x = max.x + spacing + w/2` beside the plate, stacked in y. Bounding boxes `spacing` apart
  keep hulls at least `spacing` apart.
- `POST /print/page` answers `plate: plate_from_printer(<default printer profile>)` and
  `limits: limits_for_browser()`.
- `plate_cases.json`:
  `{"synthetic": false, "plate": {...}, "parts": {ref: {name, footprints}}, "cases": [{"name", "copies", "problems": [{rule, copies, message}]}], "matrices": [{"orientation", "angle", "offset", "x", "y", "matrix"}], "labels": [{"names", "labels"}], "sanitize": [{"in", "out"}]}`.
  Cases at least: `all_clear`, `off_plate_left`, `off_plate_after_45_rotation`,
  `exactly_on_margin` (OK; Review Focus 3), `too_tall`, `overlap`,
  `four_mm_apart` (too close), `exactly_spacing_apart` (OK; Review Focus 3),
  `rotated_near_miss` (two copies rotated 45°, hull distance 5.2 mm though their bounding
  boxes are 1 mm apart: OK), `same_name_two_parts` (labels `Bracket #1`, `Bracket #2`,
  `Bracket #3` from two refs; Review Focus 1). Sanitize cases include
  `"Bracket (v2) – left"` → `Bracket__v2____left`, `""` → `part`, a 60-character name cut to 40.

- [ ] **Step 1: Write the shared cases** (values computed by hand; boxes and rectangles
  keep the arithmetic exact).
- [ ] **Step 2: Write the failing tests.** `test_plate.py`: `test_shared_cases` (each case's
  problems equal, messages included), `test_shared_matrices` (within 1e-9),
  `test_shared_labels_and_sanitize`, `test_matrices_put_named_axis_up`
  (`M · axis == (0, 0, 1)` for every orientation), `test_plate_from_default_printer`
  (`min [0,0]`, `max [340,320]`, height 340). `plate_geometry.test.js`: the same four
  shared tests, plus `arrangeCopies places six 40 mm squares in two rows`,
  `arrangeCopies leaves what does not fit unplaced beside the plate`,
  `arrangeCopies keeps orientation and angle`, `arranged copies pass checkPlacement`.
- [ ] **Step 3: Run** `uv run python -m unittest print.tests.test_plate -v` and
  `make test-quick`. Expect FAIL.
- [ ] **Step 4: Implement** both files; extend `/print/page`.
- [ ] **Step 5: Run** `make test-quick`. Expect PASS. **Commit** `print: plate geometry mirrored in Python and JavaScript`.

### Task 9: The 3MF writer and slicing a plate

**Files:**
- Create: `print/plate_3mf.py`, `print/tests/test_plate_3mf.py`, `print/scripts/measure_plate.py`
- Modify: `print/slicer.py`, `print/tests/test_slicer.py`,
  `print/tests/orca_integration_test.py`, `print/jobs.py` (sizing note)

**Interfaces:**
- Consumes: `copy_matrix`, `copy_labels`, `sanitize_part_name` (Task 8); `read_binary_stl` (Task 5).
- Produces (`print/plate_3mf.py`):
  - `write_plate_3mf(path: Path, copies: list[dict], parts: dict[str, dict]) -> list[str]`:
    `parts[ref]` carries `name`, `stl_path`, `footprints`. One `<object id name type="model">`
    per copy, named by `copy_labels` over the copies' part names; the mesh is the part's
    de-duplicated vertices and faces (read once per part, written once per copy); one
    `<build><item objectid transform="…">` per copy, the 12 numbers being
    `M[0][0] M[1][0] M[2][0] M[0][1] M[1][1] M[2][1] M[0][2] M[1][2] M[2][2] t0 t1 t2`
    from `copy_matrix` (3MF row-vector order). `unit="millimeter"`. Entries
    `[Content_Types].xml`, `_rels/.rels`, `3D/3dmodel.model`; the model is streamed through
    `ZipFile.open(…, 'w')`, coordinates `%.4f`, attributes through
    `xml.sax.saxutils.quoteattr`. Returns the object names.
  - `LOCAL_TIME_RE = re.compile(r'^\d{8}-\d{4}$')`
  - `delivered_file_name(part_names: list[str], local_time: str | None, now: datetime | None = None) -> str`:
    `part_names` are the distinct parts in copy order; `sanitize_part_name(first)`, then
    `_plus<N>` when N more distinct parts, then `-` and `local_time` when it matches, else
    the UTC time of `now` (default `datetime.now(timezone.utc)`) as `%Y%m%d-%H%M`, then
    `.gcode.3mf`.
  - `plate_object_names(archive: Path) -> list[str]`: `bbox_objects[].name` of
    `Metadata/plate_1.json`.
  - `LEFT_OFF_MESSAGE = "A part was left off the plate"`;
    `check_plate_names(expected: list[str], found: list[str]) -> None`: raises
    `SliceError(LEFT_OFF_MESSAGE, details)` unless `sorted(found) == sorted(expected)` and
    no name is blank.
- Produces (`print/slicer.py`):
  - `SliceError(message, details="", code=None)`: `code` is Orca's return code when known.
  - `SliceProfiles` (frozen dataclass): `printer: Path`, `filament: Path`, `process: Path`;
    `DEFAULT_PROFILES = SliceProfiles(PROFILE_DIR/'printer.json', PROFILE_DIR/'filament.json', PROFILE_DIR/'process.json')`.
  - `ORCA_CODE_MESSAGES = {-101: "Parts are too close together; spread them out.", -52: "A part crosses the edge of the plate.", -100: "A part has no flat face on the plate; choose another Lay flat.", -50: "No part is fully on the plate."}`
  - `orca_return_code(output_dir: Path, exit_code: int) -> int | None`: `return_code` from
    `result.json`, else `exit_code - 256` for exit codes above 127, else `None`.
  - `build_plate_command(model_3mf: Path, profiles: SliceProfiles, output_dir: Path) -> list[str]`:
    the `build_command` form with these profile paths and `--arrange 0 --orient 0`; the
    archive is `plate.gcode.3mf`.
  - `slice_plate(model_3mf, profiles: SliceProfiles, output_dir, timeout_s=DEFAULT_TIMEOUT_S) -> SliceResult`:
    the `slice_stl` environment and error handling; a non-zero exit raises
    `SliceError(ORCA_CODE_MESSAGES.get(code, "The slicer could not process this part."), details, code)`.
    The shared subprocess part of `slice_stl` and `slice_plate` becomes one private
    function; `slice_stl` keeps its behaviour.
- `print/scripts/measure_plate.py`: writes 30 copies of a 36 mm × 20 mm cylinder with
  8,333 segments (33,332 triangles each, 999,960 in all) in a 6 × 5 grid at 50 mm pitch,
  slices it with `DEFAULT_PROFILES`, and prints wall time and the child's peak RSS
  (`resource.getrusage(RUSAGE_CHILDREN).ru_maxrss`, kilobytes on Linux).

- [ ] **Step 1: Write the failing unit tests.** `test_plate_3mf.py`:
  - `test_one_object_per_copy_named_with_labels` (two parts, quantities 2 and 1 → objects
    `Bracket #1`, `Bracket #2`, `Spacer #1`)
  - `test_same_named_parts_get_distinct_object_names` (Review Focus 1)
  - `test_transform_read_back_puts_footprint_centre_at_xy` (parse the model; apply the
    item transform to the part's vertices; the bounding-box centre lands at `(x, y)` within
    1e-3 and the lowest z at 0)
  - `test_names_xml_escaped_and_sanitized` (`'A&B "q" <x>'` → object name `A_B__q___x_ #1`)
  - `test_delivered_name_patterns`: `(['Bracket','Spacer','Hub'], '20261009-1432')` →
    `Bracket_plus2-20261009-1432.gcode.3mf`; a bad `local_time` (`'2026-10-09'`) uses
    `now`; the result never matches `printer_relay._JOB_SUFFIX_RE`, including for a part
    named `j1234567`.
  - `test_name_guard_catches_missing_and_blank`

  `test_slicer.py`: `test_plate_command_disables_arrange_and_orient`,
  `test_orca_codes_map_to_messages` (fake `result.json` with -101, -52, -100, -50, -6),
  `test_return_code_from_exit_status_when_no_result_json` (exit 155 → -101).
- [ ] **Step 2: Write the failing Orca tests** in `orca_integration_test.py`, class
  `PlateSliceTest` (synthetic box and cylinder STLs written in the test):
  - `test_two_part_placement_slices_with_every_name` (`plate_object_names` equals the
    written names)
  - `test_rotated_footprint_matches_without_brim`: a process copy with
    `brim_type: no_brim`; a 40 × 10 × 10 box at angle 30, centre (150, 150); the
    `plate_1.json` bbox equals the rotated footprint's bounding box within 0.5 mm.
  - `test_overlap_maps_to_too_close_message` (two overlapping copies sliced directly →
    `SliceError` with code -101 and its sentence)
- [ ] **Step 3: Run** the unit modules and `make test`. Expect FAIL.
- [ ] **Step 4: Implement** `plate_3mf.py` and the slicer changes.
- [ ] **Step 5: Run** `make test`. Expect PASS.
- [ ] **Step 6: Measure.** `uv run python print/scripts/measure_plate.py`. Record peak RSS
  and wall time in `print/jobs.py`'s sizing note beside the 93 MB figure, neutrally
  ("30 copies, 999,960 triangles: … MB peak, … s on an aarch64 Linux machine"). **If the
  peak exceeds 1 GB, stop and report**: lower `MAX_COPIES` and `MAX_JOB_TRIANGLES` in
  `print/limits.py` (and their sentences) with the controller before continuing.
- [ ] **Step 7: Commit** `print: 3MF plate writer, slice_plate, measured at the caps`.

### Task 10: Plate jobs

**Files:**
- Create: `print/plate_job.py`, `print/tests/test_plate_job.py`, `print/tests/test_routes_jobs.py`
- Modify: `print/jobs.py`, `print/routes.py`, `print/tests/test_jobs.py`,
  `print/tests/test_routes.py`, `docs/3D_PRINTING.md` (sections "Placement" and "Limits")

**Interfaces:**
- Consumes: `check_placement`, `plate_from_printer`, `copy_labels` (Task 8);
  `write_plate_3mf`, `delivered_file_name`, `plate_object_names`, `check_plate_names`,
  `slice_plate`, `SliceProfiles`, `DEFAULT_PROFILES` (Task 9); `PartStore.get` (Task 5);
  limits (Task 5).
- Produces (`print/jobs.py`): `JobPool.submit(self, payload=None) -> str`; the worker is
  called `worker(job_id, payload)`. Existing callers and tests pass `payload=None`.
- Produces (`print/plate_job.py`):
  - `JobPart` (dataclass): `name`, `stl_path: Path`, `footprints: dict`, `triangles: int`.
  - `PlateJob` (dataclass): `copies: list[dict]`, `parts: dict[str, JobPart]`,
    `profiles: SliceProfiles`, `overrides: dict[str, str]`, `filament: str`,
    `process: str`, `delivered_name: str`, `pid: str | None`, `team: int | None`.
  - `run_plate_job(job: PlateJob, scratch: Path) -> SliceResult`: writes the process file
    (Task 14 adds overrides; here the profile's own file is used), `write_plate_3mf`,
    `slice_plate`, then `check_plate_names(names, plate_object_names(result.output_path))`.
- Produces (`print/routes.py`):
  - `REFRESH_PARTS_MESSAGE = "A part is no longer on the server; press Refresh from Onshape on the Parts step."`
  - `print_job_submit`: with no `copies` key → today's sample job (R8). Otherwise validates
    `copies` (each `ref` matching `REF_RE`, `orientation` in `ORIENTATIONS`, integer
    `angle` 0–359, finite `x`, `y`), then: copies ≤ `MAX_COPIES`
    (`TOO_MANY_COPIES_MESSAGE`); every `ref` found by `part_store.get(ref, pid)`, else
    `REFRESH_PARTS_MESSAGE`; summed triangles ≤ `MAX_JOB_TRIANGLES`
    (`JOB_TRIANGLES_MESSAGE`); `check_placement` against the plate of the job's printer
    (400 `{"error": problems[0].message, "rule": problems[0].rule}`). Then builds
    `PlateJob` with `delivered_file_name(...)` and `DEFAULT_PROFILES` (the body's
    `filament`, `process` and `overrides` are ignored until Task 14), logs `layout` (`copies`, `parts`,
    `fill` = summed hull area / plate area as a whole percent, `free_angles` = count of
    angles not a multiple of 90) and `slice_queued` (`job`, `copies`, `triangles`,
    `filament`, `process`), submits `pool.submit(payload=job)`.
  - The worker: `payload is None` → the sample path; otherwise `run_plate_job` in its
    scratch directory, moves the archive to `print_<job_id>.gcode.3mf`, registers it with
    the token manager under `job.delivered_name`, returns
    `{"token", "summary", "part": {"name": job.delivered_name, "copies": n}}`, and logs
    `slice_done` (`job`, `copies`, `triangles`, `seconds`) or `slice_failed` (`job`,
    `code`, `reason`) with the job's `pid` and `team`.
  - Send to Printer needs no code: `POST /printer/jobs` sends the file the token names,
    under the delivered name.

- [ ] **Step 1: Write the failing tests.** `test_jobs.py`: `test_payload_reaches_worker`
  (and update `good_worker` signatures to `(job_id, payload)`). `test_plate_job.py`
  (`slice_plate` mocked to write a fake archive with a chosen `plate_1.json`):
  `test_missing_name_fails_left_off`, `test_names_match_passes`.
  `test_routes_jobs.py` (temp `PartStore` holding two synthetic parts; worker replaced by
  a recorder):
  - `test_overlapping_placement_refused_before_orca` (400, `rule: too_close`, the
    recorder never called)
  - `test_unknown_ref_asks_for_refresh` (Review Focus 2: a ref not in the store →
    `REFRESH_PARTS_MESSAGE`)
  - `test_other_page_ref_refused` (another pid's ref → `REFRESH_PARTS_MESSAGE`)
  - `test_thirty_one_copies_refused`, `test_job_triangle_cap_refused`
  - `test_bad_copy_fields_400` (angle 360, orientation `z`, `x` `NaN`)
  - `test_valid_plate_queues_with_delivered_name` (`local_time` `20261009-1432`; the
    payload's `delivered_name` is `Box_plus1-20261009-1432.gcode.3mf`)
  - `test_layout_and_slice_queued_events`
  - `test_body_without_copies_keeps_sample_job`
- [ ] **Step 2: Run** `uv run python -m unittest print.tests.test_jobs print.tests.test_plate_job print.tests.test_routes_jobs -v`.
  Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Add** to `orca_integration_test.py` `test_plate_job_end_to_end`: two
  synthetic parts in a temp store, `run_plate_job` with `DEFAULT_PROFILES` succeeds and
  the archive's names match.
- [ ] **Step 5: Docs.** "Placement" (the copy model, R2's orientations, R10's pivot, the
  rules, the 3MF with one object per copy, the name guard, the Orca codes, the delivered
  name) and "Limits" (the section 5 table, the measured figure from Task 9).
- [ ] **Step 6: Run** `make test`. Expect PASS. **Commit** `print: plate jobs with server-side placement checks`.

### Task 11: The Layout step in the browser

**Files:**
- Create: `print/static/print_layout.js`, `print/tests/js/print_layout.test.js`
- Modify: `print/static/print_wizard.js`, `print/static/print_layout.css`,
  `print/templates/print_wizard.html`

**Interfaces:**
- Consumes: `checkPlacement`, `arrangeCopies`, `copyHull`, `copyLabels`,
  `ORIENTATIONS`, `ORIENTATION_LABELS` (Task 8); `state.parts` (Task 7); `plate` and
  `limits` from `/print/page` (Task 8); `showError`/`clearError` (Task 2).
- Produces (`print_layout.js`, pure helpers exported for node):
  - `plateView(canvasW, canvasH, plate) -> {scale, ox, oy}`; `plateToCanvas(view, x, y)`,
    `canvasToPlate(view, px, py)` (plate +y drawn upward).
  - `hitCopy(copies, parts, point) -> number` (topmost copy whose hull contains the point, or −1)
  - `rotateCopy(copy, delta) -> copy` (angle kept in 0–359); `setAngle(copy, value)`
    (integers only, taken mod 360; non-numeric leaves it); `setOrientation(copy, o)`
  - `duplicateCopy(copies, i) -> copies` (the copy, unplaced, appended);
    `deleteCopy(copies, i) -> copies`
  - `syncCopies(copies, parts) -> copies`: one copy per unit of quantity, per part in
    `parts` order; existing copies keep `x`, `y`, `angle`, `orientation`; new copies
    `{placed: false}` parked beside the plate; a lowered quantity drops that part's last
    copies; a removed part drops all its copies.
  - `layoutSentence(problems, copies, limits) -> string`: in order, `limits` copies or
    triangles over their cap → that sentence; any unplaced copy after an Arrange →
    `ONE_PLATE_MESSAGE`; any parked new copy → "New copies are waiting beside the plate;
    press Arrange or drag them on."; else the first problem's message; else `''`.
  - `createLayoutEditor({canvas, getState, onChange}) -> {draw(), select(i), selected()}`:
    pointer drag moves the selected copy; click selects; draws each copy's hull (red when
    in a problem or unplaced) and the plate outline with the margin.
- Produces (`print_wizard.js`): on entering Layout, `state.copies = syncCopies(...)`; when
  no copy has been placed yet, `arrangeCopies` runs at once. Controls bound to the selected
  copy: `#btn-rot-minus` (−90), `#btn-rot-plus` (+90), `#layout-angle` (number), `#layout-flat`
  (a `<select>` of the six `ORIENTATION_LABELS`), `#btn-copy-dup`, `#btn-copy-del`;
  `#btn-arrange` for all. After each change: `checkPlacement`; the sentence goes through
  `showError('layout', sentence, rule)` or `clearError('layout')`; Next is disabled while
  the sentence is not empty. Summary chip: `<n> copies`.
- The existing too-big text and `fitsBed` stay for upload mode only.

- [ ] **Step 1: Write the failing node tests:** `plateView round trip`,
  `hitCopy finds the copy under the point`, `rotateCopy wraps to 0..359`,
  `setAngle ignores text and wraps 400 to 40`,
  `syncCopies keeps placed copies and parks new ones` (Review Focus 4),
  `syncCopies drops the last copies when quantity falls`,
  `layoutSentence prefers limits, then one plate, then parked, then the first problem`,
  `duplicate and delete`.
- [ ] **Step 2: Run** `make test-quick`. Expect FAIL.
- [ ] **Step 3: Implement** `print_layout.js`, the wizard wiring, the template controls and
  their styles (the canvas fills the panel width; controls wrap in the narrow panel).
- [ ] **Step 4: Run** `make test-quick`. Expect PASS.
- [ ] **Step 5: Commit** `print: interactive Layout step`.

### Task 12: Preview of the plate

**Files:**
- Modify: `print/static/print_viewer.js`, `print/static/print_wizard.js`,
  `print/tests/js/print_viewer.test.js`, `print/tests/js/print_wizard.test.js`

**Interfaces:**
- Consumes: `POST /print-job` with copies (Task 10); `GET /print/parts/<ref>.stl` (Task 6);
  `copyMatrix` (Task 8); `printFetch`, `reportDeliver` (Task 2).
- Produces (`print_viewer.js`):
  - `transformPositions(positions: Float32Array, matrix) -> Float32Array` (exported): applies
    the 3×4 matrix to every vertex, in plate coordinates.
  - `PrintViewer.prototype.loadPlate(meshes: {ref: ArrayBuffer}, copies, parts, plate)`:
    parses each part's STL once, draws one mesh per copy with
    `transformPositions(positions, copyMatrix(...))`, maps plate `(x, y, z)` to THREE
    `(x − cx, z, −(y − cy))` with `(cx, cy)` the plate centre, a bed plane of the plate's
    size, and the camera fitted to the plate. `load()` stays for the sample part.
- Produces (`print_wizard.js`):
  - `localTimeStamp(date) -> 'YYYYMMDD-HHMM'` (exported, local time, zero-padded).
  - `jobBody(state) -> object` (exported): `{copies: [{ref, orientation, angle, x, y}], filament, process, overrides, local_time}`
    (until Task 15 fills them from Setup, `filament` and `process` are omitted and
    `overrides` is `{}`; the server then uses the default set).
  - `enterPreview()` posts `jobBody(state)` in Onshape mode and no body in upload mode
    (R8). A 400 shows its `error` through `showError('preview', …, rule)`. The re-use of a
    finished job stays, keyed on an unchanged `jobBody` (compared as JSON).
  - `showMesh()` in Onshape mode fetches each distinct ref's STL once through `printFetch`
    and calls `loadPlate`; in upload mode it keeps `/print/part?stl=1`.

- [ ] **Step 1: Write the failing node tests:** `transformPositions applies rotation and
  translation` (a unit triangle with the `+x`, 90° matrix lands where `copyMatrix`
  says), `localTimeStamp pads`, `jobBody lists copies in order and drops UI fields`.
- [ ] **Step 2: Run** `make test-quick`. Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `make test`. Expect PASS. **Commit** `print: plate preview and multi-part slice submit`.

---

## Sub-project: profiles

### Task 13: The profile catalog

**Files:**
- Modify: `print/scripts/flatten_orca_profiles.py`, `print/tests/test_flatten_orca_profiles.py`,
  `print/tests/orca_integration_test.py`, `docs/3D_PRINTING.md` (section 4, "The catalog")
- Create: `print/tests/fixtures/orca_tree/` (a few small JSON profiles: `BBL/machine`,
  `BBL/filament/<vendor>/`, `BBL/process`, `OrcaFilamentLibrary/filament/base/`),
  `print/profiles/catalog/` (generated and committed)

**Interfaces:**
- Produces (`flatten_orca_profiles.py`):
  - `H2S_PRINTERS = ['Bambu Lab H2S 0.2 nozzle', 'Bambu Lab H2S 0.4 nozzle', 'Bambu Lab H2S 0.6 nozzle', 'Bambu Lab H2S 0.8 nozzle']`
  - `CATALOG_OUT = PKG / 'profiles' / 'catalog'`
  - `library_profile_dir() -> Path`: `bbl_profile_dir().parent / 'OrcaFilamentLibrary'`.
  - `build_name_index(roots: list[Path], kind: str) -> tuple[dict[str, Path], int]`: walks
    `root/kind/**/*.json` recursively per root, indexes by `name`; a duplicate inside one
    root raises `ValueError` naming both files; an earlier root's name shadows a later one's
    (R1). Returns the index and the shadowed count.
  - `flatten_indexed(index: dict[str, Path], kind: str, name: str, provenance=None) -> dict`:
    today's `flatten_profile` over the index (same merge, `inherits` cleared, `from` set,
    `DROP_KEYS` dropped). `flatten_profile` and `build_profiles` keep working for the three
    defaults, now through the index.
  - `profile_file_stem(name: str) -> str`: every character outside `[A-Za-z0-9._-]` → `_`;
    two names with one stem fail the build.
  - `build_catalog(bbl_dir: Path, library_dir: Path, printers=H2S_PRINTERS) -> dict`:
    flattens each printer (with `apply_selections`), then every filament and process with
    `instantiation == "true"` that comes from the BBL tree, whose flattened
    `compatible_printers` names a printer in `printers`. Skips, with a reason, a profile
    whose variant array lacks `Direct Drive High Flow`; per printer, drops a filament or
    process whose variant index differs from the printer's (`variant_index`). Returns
    `{'profiles': {kind: {name: flat}}, 'index': …}`.
  - `index.json`: `{"orca_version", "printers": [{name, file}], "filaments": [{name, file, compatible_printers}], "processes": [...], "skipped": [{kind, name, reason}], "dropped": [{printer, kind, name, reason}]}`,
    `compatible_printers` listing only printers that passed the variant check. Files at
    `catalog/<kind>/<stem>.json`, sorted indented JSON as `dump_profiles` writes.
  - `write_catalog(catalog: dict, out_dir: Path) -> None`; `main()` writes the defaults as
    today, then the catalog (`--no-catalog` skips it), and prints the skipped and dropped
    lists and the shadowed count.

- [ ] **Step 1: Write the failing unit tests** (fake tree):
  - `test_index_walks_subfolders_and_library`
  - `test_duplicate_inside_one_tree_fails`
  - `test_bbl_name_shadows_library_name`
  - `test_bbl_filament_inherits_library_base`
  - `test_profile_without_high_flow_skipped_with_reason`
  - `test_mismatched_variant_index_dropped_per_printer`
  - `test_library_bases_never_listed`
  - `test_index_json_lists_skipped_and_dropped`
- [ ] **Step 2: Run** `uv run python -m unittest print.tests.test_flatten_orca_profiles -v`. Expect FAIL.
- [ ] **Step 3: Implement**, then generate:
  `uv run python print/scripts/flatten_orca_profiles.py`. Expect about 163 filaments and
  16 processes, about 1.3 MB, the three defaults unchanged (`git diff print/profiles/*.json`
  empty).
- [ ] **Step 4: Add Orca tests** in `orca_integration_test.py`, class `CatalogTest`:
  `test_catalog_matches_installed_orca` (rebuild into a temp dir; every file and
  `index.json` equal the committed ones) and `test_skipped_list_matches_index` (the build's
  skipped names equal `index.json`'s).
- [ ] **Step 5: Docs.** Section 4 gains "The catalog": the name index, R1, what is flattened
  and skipped, `index.json`, the one-line change for another printer family.
- [ ] **Step 6: Run** `make test`. Expect PASS. **Commit** `print: Orca profile catalog for the H2S family`.

### Task 14: Team print configuration and overrides

**Files:**
- Create: `print/print_config.py`, `print/tests/test_print_config.py`
- Modify: `team_config.py` (`printing_section()`; `pairing_code` uses it), `print/routes.py`
  (`/print/page` answers `config`; `/print-job` takes the choice; `config` event),
  `print/plate_job.py` (merged process file), `print/slicer.py` and `print/__init__.py`
  (docstrings, R14), `print/tests/orca_integration_test.py`,
  `docs/3D_PRINTING.md` (section "Team printing configuration")

**Interfaces:**
- Consumes: `print/profiles/catalog/index.json` (Task 13); `SliceProfiles`,
  `DEFAULT_PROFILES` (Task 9); `PlateJob` (Task 10); `plate_from_printer` (Task 8).
- Produces (`team_config.py`): `TeamConfig.printing_section(self) -> dict | None`: the raw
  `printing` dict from `self._data`, else from `self.get_machine_config()`; `pairing_code`
  reads through it with unchanged behaviour.
- Produces (`print/print_config.py`):
  - `CATALOG_DIR = PKG / 'profiles' / 'catalog'`
  - `Catalog.load(directory=CATALOG_DIR) -> Catalog`; `has_printer(name) -> bool`;
    `profile_path(kind, name) -> Path`; `compatible(kind, name, printer) -> bool`.
  - `UNKNOWN_PRINTER_MESSAGE = "The team configuration names printer '{name}', which PenguinCAM does not know. Ask a mentor to fix printing.printer."`
  - `DROPPED_MESSAGE = "printing.{key} names '{name}', which PenguinCAM does not know or which does not fit printer '{printer}'; it was left out."` (R11)
  - `EMPTY_LIST_MESSAGE = "The team configuration lists no {what} that fits printer '{printer}'. Ask a mentor to fix printing.{key}."` (R11)
  - `PrintChoices` (dataclass): `printer`, `filaments: list[str]`, `processes: list[str]`,
    `allow_overrides: bool`, `warnings: list[str]`, `error: str | None`,
    `skipped: list[str]`, `is_default: bool`; `to_json()` (no paths);
    `slice_profiles(filament, process) -> SliceProfiles` (raises `ValueError` when either
    is not offered or `error` is set); `printer_profile() -> dict` (for `plate_from_printer`).
  - `default_choices() -> PrintChoices`: names from the three files in `print/profiles/`,
    `allow_overrides=True`, `is_default=True`; `slice_profiles` returns `DEFAULT_PROFILES`.
  - `resolve_print_config(printing: dict | None, catalog: Catalog) -> PrintChoices`: no
    `printer` key → `default_choices()`; an unknown printer → `error` set, lists empty, no
    fallback; each unknown or incompatible filament/process dropped with `DROPPED_MESSAGE`
    in `warnings` and its name in `skipped`; an empty list after dropping → `error` with
    `EMPTY_LIST_MESSAGE`; `allow_overrides` defaults to `True`; a non-list `filaments` or
    `processes` counts as empty.
  - `choices_for_request(session_data: dict, force_defaults: bool) -> PrintChoices`:
    `default_choices()` when `force_defaults`, else
    `resolve_print_config(TeamConfig.from_dict(session_data or {}).printing_section(), Catalog.load())`.
  - `OVERRIDE_CHOICES = {'infill': [10, 15, 20, 30, 40, 60, 100], 'walls': [2, 3, 4, 6], 'supports': ['off', 'on'], 'brim': ['auto', 'off', 'outer']}`
  - `OverrideError(Exception)` with `message`.
  - `validate_overrides(raw: dict | None, allowed: bool) -> dict[str, str]`: only the four
    keys and listed values (R9); Orca keys: `infill` → `sparse_infill_density: "<n>%"`;
    `walls` → `wall_loops: "<n>"`; `supports` `off` → `enable_support: "0"`, `on` →
    `enable_support: "1"`, `support_type: "tree(auto)"`; `brim` `auto` → `brim_type: "auto_brim"`,
    `off` → `"no_brim"`, `outer` → `"outer_only"`.
  - `write_process_with_overrides(process_path: Path, overrides: dict[str, str], out_path: Path) -> Path`.
- Routes: `/print/page` answers `config: choices.to_json()` and `overrides: OVERRIDE_CHOICES`,
  and its `plate` from `choices.printer_profile()`; logs `config` (`printer`, `filaments`,
  `processes`, `skipped`, `error`). `/print-job` (copies form) validates `filament`,
  `process` (`slice_profiles`, 400 "Choose a filament and print settings from the list."
  on `ValueError`; 400 with `error` when the choice has one) and `overrides`
  (`validate_overrides`); `PlateJob` carries them; `run_plate_job` writes
  `process.json` in scratch through `write_process_with_overrides`. The plate check uses
  the chosen printer's plate.

- [ ] **Step 1: Write the failing tests** in `test_print_config.py`:
  - `test_printing_section_v2_root_and_v1_machine` (and `pairing_code` unchanged)
  - `test_no_printer_key_gives_default_set`
  - `test_unknown_printer_fails_closed_naming_key` (`error` equals the sentence; no
    fallback; `slice_profiles` raises)
  - `test_spec_example_resolves` (the spec's YAML: 0.4 nozzle, two filaments, two processes,
    no warnings)
  - `test_incompatible_filament_dropped_with_warning` (`Generic PETG @BBL H2S` with the 0.4
    nozzle if the catalog says it does not fit, otherwise a 0.6-only process)
  - `test_list_empty_after_drops_disables_slicing`
  - `test_overrides_mapped_to_orca_keys`
  - `test_override_outside_list_refused` (`infill: 25`, `walls: '3'` as text, an unknown key)
  - `test_overrides_refused_when_not_allowed`
  - `test_route_page_answers_config_and_logs_config_event`
  - `test_route_job_refuses_filament_not_offered`
- [ ] **Step 2: Run** `uv run python -m unittest print.tests.test_print_config -v`. Expect FAIL.
- [ ] **Step 3: Implement**, including the docstring sweep (R14).
- [ ] **Step 4: Add** to `orca_integration_test.py` `test_profile_with_overrides_slices`:
  the spec's 0.4 nozzle set with `{infill: 40, walls: 4, supports: 'on', brim: 'off'}` on
  a synthetic box; the G-code header shows `sparse_infill_density = 40%`, `wall_loops = 4`,
  `enable_support = 1`, `brim_type = no_brim`.
- [ ] **Step 5: Docs.** "Team printing configuration": the YAML keys, the default set,
  fail-closed printer, dropped names, overrides table, that Orca renames make a key fail
  with a message naming it.
- [ ] **Step 6: Run** `make test`. Expect PASS. **Commit** `print: team printing configuration against the catalog, student overrides`.

### Task 15: The Setup step in the browser

**Files:**
- Modify: `print/static/print_wizard.js`, `print/templates/print_wizard.html` (Setup
  fields; the "Stage 1" comment and hint replaced, R14), `print/static/print_layout.css`,
  `print/tests/js/print_wizard.test.js`

**Interfaces:**
- Consumes: `/print/page` `config` and `overrides` (Task 14); `jobBody` (Task 12).
- Produces:
  - Setup shows `#p-printer` (read-only), `<select id="p-filament">`,
    `<select id="p-process">` filled from `config`, first entry selected; `#p-overrides`
    with four `<select>`s (`#ov-infill`, `#ov-walls`, `#ov-supports`, `#ov-brim`), each
    starting at "Profile default" (value `''`), shown only when `allow_overrides`; each
    config warning as a line in `#setup-notes`; `config.error` through
    `showError('setup', error, 'config')`, which also disables Next on every step and the
    slice.
  - `overridesFromForm(values) -> object` (exported): drops `''`; numbers for infill and
    walls; strings for supports and brim.
  - Summary chips show the chosen filament and process names. Upload mode shows the
    default names read-only (R8).

- [ ] **Step 1: Write the failing node tests:** `overridesFromForm drops profile defaults`,
  `a config error blocks Next` (pure gate helper `canSlice(state)` exported:
  false with `config.error`, true otherwise).
- [ ] **Step 2: Run** `make test-quick`. Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `make test`. Expect PASS. **Commit** `print: Setup step with team filaments, print settings and overrides`.

---

## Test bed and validation

### Task 16: Test bed print scenarios and the browser checks

**Files:**
- Modify: `testbed/scenarios/__init__.py`, `testbed/ui_run.py` (two actions, selectors),
  `testbed/panel/testbed_panel.js` (defers to the print page), `CLAUDE.md` (key files)
- Create: `testbed/tests/test_print_scenarios.py`, `testbed/tests/browser_print.py`

**Interfaces:**
- Consumes: test bed `Step`, `Scenario`, `SCENARIOS`, `run_scenario_api`,
  `scenario_is_recorded`, `ReplayDevServer`, `launch_test_browser`, `host_url`,
  `sign_in_for_replay`, `window.__testbed`; `resolve_selections`, `export_part_mesh`,
  `rest_address` (Tasks 3–4).
- Produces:
  - `Step.action` gains `print-parts` (in the print page, go to the Parts step, which arms
    the page's own selection) and `print-dialog` (press `#btn-add-from-document`).
  - `SCENARIOS` gains (estimate 12 each, R13):
    - `print-select-parts`, document `tb-two-parts`, panel: `choose-print`, `print-parts`,
      `select part <box>` (select the box), `select part <cylinder>`, a deselection step.
    - `print-dialog-parts`, `tb-two-parts`, panel: `choose-print`, `print-parts`,
      `print-dialog` picking `tb-box`'s part, then closing the dialog.
    - `print-assembly-part`, `tb-assembly`, panel: `choose-print`, `print-parts`, select
      one instance.
    - `print-export`, `tb-two-parts` and `tb-assembly`, no panel: `run_scenario_api`
      resolves both parts of `tb-two-parts` (via `selection` with part ids from
      `documents.json`) and the assembly's first instance (via an occurrence path from the
      definition), and exports each with `export_part_mesh`.
  - `ui_run`: `SELECTORS` gains `print_next` and `print_add_from_document`; the step driver
    handles the two new actions inside the panel frame. The unbounded-selection reference
    recording (spec 11 step 3) is a step of `print-select-parts` that sends one
    `requestSelection` without `requiredSelectionCount` from the strip, recorded only.
  - `testbed_panel.js`: when `window.PenguinCAM.onshapeMessenger` exists it posts no
    `applicationInit` and hides its ask/dialog buttons; it still records every received
    message (spec 8.3).
  - `browser_print.py`, each test skipped with `needs a recording` unless its scenario is
    recorded: `test_select_two_parts_lists_both_with_sizes`,
    `test_quantity_two_gives_three_copies_arranged`, `test_rotate_then_lay_on_side`,
    `test_slice` (real Orca on the replayed meshes), `test_download` (the download URL
    answers 200 with a `.gcode.3mf` name). Plus one self-test on synthetic fixtures (the
    fake host's own check, allowed by the spec):
    `test_strip_defers_to_print_page_messages`.
  - `CLAUDE.md` key files: `print/onshape_parts.py`, `part_store.py`, `mesh.py`,
    `plate.py`, `plate_3mf.py`, `plate_job.py`, `print_config.py`, `events.py`,
    `limits.py`, `profiles/catalog/`, and the new static files, one line each.

- [ ] **Step 1: Write the failing unit tests** in `test_print_scenarios.py`:
  `test_print_scenarios_defined_with_known_documents_and_estimates`,
  `test_unrecorded_print_scenarios_reported`,
  `test_print_export_runs_against_synthetic_cassette`: `make_print_fixtures.py` gains a
  `synthetic-print-export-run` cassette holding exactly the calls `run_scenario_api`
  makes for `print-export`; the test replays it with a synthetic `documents` dict. No
  scenario ever replays it.
- [ ] **Step 2: Run** `uv run python -m unittest testbed.tests.test_print_scenarios -v`. Expect FAIL.
- [ ] **Step 3: Implement** the scenarios, the API runner branch, the `ui_run` actions, the
  strip change and `browser_print.py`.
- [ ] **Step 4: Run** `make test` and `make testbed-replay`. Expect PASS, with the five
  print browser tests skipped as `needs a recording` and the self-test passing.
- [ ] **Step 5: Commit** `testbed: print scenarios and browser checks`.

### Task 17 (needs Onshape credentials): the validation run with the owner

Blocked on the owner: the test bed's credentials and test folder (test bed spec, section 13).
Step 1 needs none.

- [ ] **Step 1 (no credentials):** write the checklist
  `PenguinCAM-notes/guides/PRINT_VALIDATION_RUN.md` from spec section 11, linking the test
  bed's [ONSHAPE_CHECKPOINT.md](../guides/ONSHAPE_CHECKPOINT.md). Commit it in the notes repo.
- [ ] **Step 2 (credentials):** `uv run python -m testbed build-docs`, then
  `uv run python -m testbed record print-export`; `accept print-export`.
- [ ] **Step 3 (credentials):** `uv run python -m testbed record --ui print-select-parts print-dialog-parts print-assembly-part`.
  The run records the click selection in a Part Studio and an Assembly, the dialog
  (write down whether `idTag` equals the part id), a configured Part Studio, and the
  unbounded selection once. On a bot check, stop and ask the owner for an Onshape
  checkpoint. Then `accept` each.
- [ ] **Step 4:** rewrite the node tests of `partSelectionsFromMessage` and the selection
  handler to read the recorded message logs; delete
  `testbed/tests/fixtures/messages/synthetic-print-selection.json` and every
  `synthetic-print-*` cassette whose tests now use recordings (literal paths); keep
  `test_strip_defers_to_print_page_messages` on its fixture only if no recording covers it.
- [ ] **Step 5:** run the Verification section in full; `make testbed-replay` shows no
  `needs a recording` skip for the print scenarios.
- [ ] **Step 6:** write the findings to a handoff note in `PenguinCAM-notes/handoffs/`
  (what the recordings showed, `idTag`, any rulings to revisit), and commit both repos.

---

## Verification

| # | Spec guarantee | Command | Passes when |
|---|---|---|---|
| V1 | The gate (owner) | `make test` | exit 0 |
| V2 | Separation: new code under `print/`, outside touches only section 9's (0, 9) | `git diff --name-only FEATURES_BASE..HEAD -- . ':!print' ':!testbed'` | only `frc_cam_gui_app.py`, `onshape_integration.py`, `team_config.py`, `docs/3D_PRINTING.md`, `CLAUDE.md`, `tests/test_onshape_request_absolute.py` |
| V3 | The print page never loads `source_onshape.js`; no CNC change (0, 3.1) | `grep -rn source_onshape print/ ; git diff --stat FEATURES_BASE..HEAD -- templates/wizard.html static/` | grep finds nothing; the diff is empty |
| V4 | One quoting rule; `team=-` on defaults; no metrics row for `request`; no token, cookie, full job id or pairing code in a line (2.1, 8.1) | `uv run python -m unittest print.tests.test_events print.tests.test_routes_events print.tests.test_routes_parts -v` | pass |
| V5 | Page id required, 400 without; route limits (2.1) | `uv run python -m unittest print.tests.test_routes_events -v` | `test_print_api_without_page_id_is_400` passes; `grep -n 'per minute' print/routes.py` shows 10, 20, 120, 3, 30, 30 |
| V6 | Every shown error goes through `showError` and reaches the log (2.1, 7) | `node --test print/tests/js/error_paths.test.js` | pass |
| V7 | Context parsing, `_wvm_path` reused, server validated (3.1) | `uv run python -m unittest print.tests.test_onshape_context -v` | pass |
| V8 | Selection: count 1, `REQUESTED_SELECTION`, re-arm, `PENDING`, inactive, dialog close (3.2) | `node --test print/tests/js/print_onshape.test.js` | pass |
| V9 | Resolution: Part Studio, Assembly, subassembly, standard content, dialog, duplicate names, configurations (3.3) | `uv run python -m unittest print.tests.test_onshape_resolve -v` | pass |
| V10 | Redirect rule and `request_absolute`; byte cap (3.3) | `uv run python -m unittest tests.test_onshape_request_absolute print.tests.test_onshape_context -v` | pass |
| V11 | Part store: owner, limits, expiry, orphans, refresh under new refs (3.4) | `uv run python -m unittest print.tests.test_part_store print.tests.test_routes_parts -v` | pass |
| V12 | Footprints for six orientations; triangle cap (4.2, 5) | `uv run python -m unittest print.tests.test_mesh -v` | pass |
| V13 | Placement rules identical in Python and JS (4.3) | `uv run python -m unittest print.tests.test_plate -v && node --test print/tests/js/plate_geometry.test.js` | both pass on the same `plate_cases.json` |
| V14 | One object per copy, names, transforms; delivered name; name guard (4.6) | `uv run python -m unittest print.tests.test_plate_3mf print.tests.test_plate_job -v` | pass |
| V15 | A two-part placement slices with every name; rotated footprint within 0.5 mm without brim; overrides slice; catalog builds and its skipped list matches (8.1) | `uv run python -m unittest print.tests.orca_integration_test -v` | pass |
| V16 | Overlapping placement refused before Orca; limits enforced (4.6, 5) | `uv run python -m unittest print.tests.test_routes_jobs -v` | pass |
| V17 | Caps measured; under 1 GB (5) | `uv run python print/scripts/measure_plate.py` | peak RSS under 1,048,576 KB, and the figure is in `print/jobs.py` |
| V18 | Unknown printer fails closed; drops warn; overrides validated (6.2, 6.3) | `uv run python -m unittest print.tests.test_print_config -v` | pass |
| V19 | Synthetic fixtures only under `testbed/tests/fixtures`, marked; no scenario replays one (8.2) | `grep -rL '"synthetic": true' testbed/tests/fixtures --include='synthetic-*.json'; grep -rln '"synthetic": true' testbed/cassettes testbed/messages` | both print nothing |
| V20 | Browser scenarios skipped until recorded, then replayed (8.2) | `make testbed-replay` | before Task 17: five `needs a recording` skips; after: none |
| V21 | New test bed scenarios recorded and drift clean (8.3, 11) | `uv run python -m testbed record print-export`; `… record --ui …`; `uv run python -m testbed drift` *(credentials)* | the report says `clean` |

V1–V20 (before-recording form) can pass without Onshape. V20's after-recording form and
V21 complete the milestone in the validation run with the owner.

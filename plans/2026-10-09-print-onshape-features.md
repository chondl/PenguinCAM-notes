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
- Limits: triangles per part **150,000**; download per part **7.5 MB, streamed**;
  distinct parts per page id **20**; mesh bytes per page id **50 MB**; copies per plate
  **30, quantity 1 to 30 each**; triangles per job **300,000** (or lower, if Task 0's stop
  rule lowers it); plate slice timeout **240 s**, the sample part's slice keeping
  **120 s**; part store on disk **500 MB**. Each with the spec's sentence (section 5
  table), copied exactly. Every STL export asks for an explicit tessellation:
  `chordTolerance=0.00005` (metres, 0.05 mm) and `angleTolerance=0.1309` (radians, 7.5°),
  constants in `print/limits.py` (spec 3.3).
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
6. **A part added in Onshape a minute after the panel cached the parts list or the assembly
   definition, then clicked.** Expected: the cache miss refetches once and the part is
   added, never refused as unknown. Owning tests: Task 4
   `test_partstudio_cache_miss_refetches_once` and `test_assembly_cache_miss_refetches_once`.
7. **A plate at the limits** (30 copies, 300,000 triangles). Expected: it slices inside the
   240 s plate timeout and under 900 MB. Owning step: Task 0 Step 4 (the stop rule), and V17.

---

## Rulings on spec gaps

The spec leaves these open or contradicts itself; the plan rules as follows.

| # | Gap | Ruling |
|---|---|---|
| R1 | 6.2 "Two files with the same name fail the build", but 104 filament names (for example `Bambu ABS-GF @base`) exist in both `BBL/` and `OrcaFilamentLibrary/`; neither tree has a duplicate inside itself (checked Fri 10-09) | A duplicate inside one tree fails the build. A BBL name shadows the library's, because `BBL.json` registers its own copy of each such profile (for example `"name": "Bambu ASA @base"` with `sub_path` `filament/Bambu ASA @base.json`), so the BBL file is the one Orca loads for a BBL printer. The choice matters: 96 of the 104 shared names differ in value (`PolyLite ASA @base` has a maximum volumetric speed of 13 in one tree and 12 in the other). Neither tree has a duplicate inside itself (BBL machine 63, process 243, filament 2,198; library 482). The shadowed count is printed in the build log |
| R2 | 4.2 says `orientation` names "which axis of the part points down", yet `+z` is "as modelled", where `-z` points down | `orientation` names the part axis that points **up**; `+z` is as modelled. Matrices in Task 8 |
| R3 | 2.1 `deliver` has no route: Download and Drive are app routes outside `print/` | New `POST /print/deliver` `{job_id, action, outcome}`, session gate, 30 per minute. The wizard reports download and Drive; `printer_panel.js` reports the printer outcome through `window.PenguinCAM.reportDeliver`. Logged with `job=<id8>` |
| R4 | `EventSource` cannot send the `X-Print-Page` header | `GET` print routes also accept the page id as the `pid` query parameter. `GET /print`, `GET /print/part` (R15) and static files need none |
| R5 | 4.4 `arrangeCopies(copies, plate, spacing)` has no footprints | `arrangeCopies(copies, parts, plate)`; `plate.spacing` carries the spacing |
| R6 | Copy numbering `<part name> #<n>`, "n counting from 1 for each part", collides when two parts share a name (Review Focus 1) | One label everywhere (3MF object, `plate_1.json`, Layout sentences): sanitized name + ` #n`, with n counting per sanitized name. It changes a durable name (the printer's skip-object list), so it is in the spec's section 12 as a naming decision for the owner to confirm |
| R7 | 5 "the first build task slices a plate at the caps", but slicing a plate exists only after the 3MF writer | The measurement needs only Orca and synthetic meshes, so it is Task 0, before the part store (Task 5): its script writes its own minimal one-object-per-copy 3MF. Task 0 creates `print/limits.py` with the numeric limits, so lowering a cap is one edit; Task 9 moves the script onto `write_plate_3mf` and re-runs it (V17) |
| R8 | Upload (full-page) mode and `POST /print-job` | A body without `copies` keeps today's sample-part job unchanged (delivered as `sample_part.gcode.3mf`). Upload mode shows the default set read-only, with no overrides |
| R9 | Override defaults | Each of the four menus starts at "Profile default", which sends nothing. With `allow_overrides: false`, a non-empty `overrides` is a 400 |
| R10 | Footprint centre and rotation pivot are not defined | A footprint is centred on its bounding-box centre after the orientation; `angle` rotates counterclockwise seen from above, about that centre; `x, y` place that centre |
| R11 | Sentences the spec does not fix | Fixed in the owning task, in its constants: placement rules (Task 8), page id refusal, mesh too small, assembly part not found (Tasks 1, 4, 5), config warnings (Task 14) |
| R12 | `layout` event "when the student enters Preview" | Logged by `POST /print-job` for a valid placement: entering Preview is what submits. A reused finished job (Task 12, unchanged `jobBody`) posts nothing, so it logs no second `layout` event |
| R13 | Test bed scenario estimates for the four new scenarios | Computed per scenario from its steps (Task 16), counting what the ledger counts (responses 200–399, so each export's 307 and its 200 are two): panel load 6 as in `panel-load` |
| R14 | Docstrings with "fixed set" / "sample part" / "Stage 1" | Swept in Task 14 (server) and Task 15 (template), when they stop being true; `docs/3D_PRINTING.md`'s stage 1 text is swept in Task 15 Step 5 (list there) |
| R15 | `GET /print/part` is "deliberately ungated" in `docs/3D_PRINTING.md`, but Task 1's page id gate covers every print route | `/print/part` stays ungated, with no session gate and no page id: it serves only the sample part, for the upload mode. The Onshape flow never calls it (Task 12 fetches `/print/parts/<ref>.stl`). Task 1 exempts it from the page id gate and tests that |
| R16 | Parts list and assembly definition are cached for 600 s, but a workspace changes while a student models | A cache miss (a part id, `selectionId` or occurrence path not found in the cached answer) refetches that answer once, bypassing the cache, before refusing (Task 4) |
| R17 | `targetOrigin = context.server` silently drops every message when the return URL has no `server` on an enterprise domain | Outgoing messages are posted with `'*'`, as `static/source_onshape.js` does; they carry no secret. Incoming messages are accepted from `context.server` or from any `https://` origin whose host is `onshape.com` or ends in `.onshape.com` (the server-validation rule of Task 3), and dropped otherwise (Task 7) |

## Adversarial review (folded in)

The plan review (Fri 10-09) read the test bed worktree and ran Orca. Each finding was checked
against its evidence (the code, and the runs' `/usr/bin/time` output) before folding.

| Finding | Disposition |
|---|---|
| C1 caps fail memory and the 120 s timeout (999,960 triangles: 5 min 52 s, 1,113,140 KB) | Folded with the controller's rulings: 300,000 per job, 150,000 per part, 30 copies, 240 s plate timeout, explicit tessellation; measurement moved to Task 0 with a 900 MB / 180 s stop rule; V17 timed. Spec 3.3, 4.1, 5 updated |
| M1 test bed redirect test not "unchanged" | Folded (Task 3): `ExportHTTPError` is a `RuntimeError` with the test bed's messages; the test keeps passing unchanged, or its change is made in Task 3 |
| M2 STL `Accept` dropped | Folded (Task 3): `headers=` on the helper, `STL_ACCEPT` on every hop, a spy test |
| M3 cassettes split by concern | Folded (Tasks 4, 6): one cassette per request flow, named in every test |
| M4 error-line test fails on `fitLayoutCanvas` | Folded (Task 2): the rule and test cover writes only |
| M5 cached answers miss new parts | Folded (R16, Task 4): a miss refetches once; two tests |
| M6 developer guide keeps stage 1 text | Folded (R14, R15, Task 15 Step 5): an explicit sweep list; `/print/part` stays ungated |
| M7 Send to Printer with plate jobs untested | Folded (Tasks 2, 10; V22) |
| m1–m11 | Folded: R1 reason (m1), Task 14 test (m2), R17 (m3), Task 5 (m4), Task 8 (m5, m6), Task 1 (m7), Task 14 (m8), Task 16 Step 5 (m9), V20 and V23–V25 (m10), Task 4 (m11) |
| Lenses 1–3 | Folded: spec section 10 and route table gain `/print/deliver`; labels live in JS only; the one-worker assumption is written in `part_store.py` and `ElementCache` |
| R7 timing, R13 flat estimate | Rejected rulings replaced: Task 0; per-scenario estimates in Task 16 |

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

## Before Task 0

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
  limits.py            numeric limits, timeout, tessellation (Task 0); sentences (Task 5)
  mesh.py              numpy STL read, size, six footprints (Task 5)
  part_store.py        PartStore: refs, owner page id, limits, expiry, orphans (Task 5)
  plate.py             orientations (Task 5); copy matrix, labels, placement rules (Task 8)
  plate_3mf.py         3MF writer, delivered name, plate_1.json name guard (Task 9)
  plate_job.py         PlateJob and run_plate_job, the worker's plate path (Task 10)
  print_config.py      catalog, team choices, overrides (Task 14)
  slicer.py            + SliceProfiles, slice_plate, Orca code messages (Task 9)
  tests/test_limits.py the limits' relations and the measuring script's meshes (Task 0)
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
  scripts/measure_plate.py  slices plates at the limits, prints peak memory and time (Task 0; Task 9 moves it onto the writer)
  profiles/catalog/    index.json, printer/, filament/, process/ (Task 13, committed)
  tests/fixtures/plate_cases.json   shared Python/JS placement cases (Task 8)
  tests/fixtures/make_rotated_cases.py  computes the rotated cases' numbers (Task 8)
  tests/fixtures/orca_tree/         a tiny fake Orca profile tree (Task 13)
testbed/tests/fixtures/make_print_fixtures.py  writes the synthetic print cassettes, one per request flow, and the message log (Tasks 4, 6, 7, 16)
testbed/scenarios/__init__.py  + four print scenarios (Task 16)
testbed/tests/browser_print.py  print browser scenarios (Task 16)
```

Outside `print/` and `testbed/`: `onshape_integration.py` and `frc_cam_gui_app.py`
(Task 3), `team_config.py` (Task 14), `docs/3D_PRINTING.md` (Tasks 2, 6, 10, 13, 14, 15),
`CLAUDE.md` key files (Task 16), `Makefile` only if a new slow test module is added (none
planned: slow tests join `print/tests/orca_integration_test.py`).

---

## Sub-project: limits first

### Task 0: Measure a plate at the limits

Runs first, before the part store (Task 5) and anything that depends on the caps. It needs
only Orca and synthetic meshes. The plan review measured 30 copies at 999,960 triangles in
all: 5 min 52 s and 1,113,140 KB peak, past the 120 s slice timeout; at 249,960 triangles,
43 s and 732,988 KB. The caps below follow from those figures; this task confirms them on
the real limits before anything is built on them.

**Files:**
- Create: `print/limits.py` (numeric limits only; Task 5 adds the sentences),
  `print/scripts/measure_plate.py`, `print/tests/test_limits.py`
- Modify: `print/jobs.py` (sizing note)

**Interfaces:**
- Produces (`print/limits.py`):
  - `MAX_PART_TRIANGLES = 150_000`; `MAX_PART_BYTES = 84 + 50 * MAX_PART_TRIANGLES` (7,500,084)
  - `MAX_PARTS_PER_PAGE = 20`; `MAX_PAGE_BYTES = 50_000_000`
  - `MAX_COPIES = 30`; `MAX_QUANTITY = 30`; `MAX_JOB_TRIANGLES = 300_000`
  - `PLATE_SLICE_TIMEOUT_S = 240` (the sample part keeps `print.slicer.DEFAULT_TIMEOUT_S = 120`)
  - `MAX_STORE_BYTES = 500_000_000`; `PART_TTL_S = 3600`
  - `STL_CHORD_TOLERANCE_M = 0.00005` (0.05 mm) and `STL_ANGLE_TOLERANCE_RAD = 0.1309`
    (7.5°, 48 segments on every hole), passed as the export's `chordTolerance` and
    `angleTolerance`. Onshape's OpenAPI documents the units (metres; radians, under π/2)
    but not the server's defaults, so the print path never relies on them.
  - `MEASURE_MAX_PEAK_KB = 921_600` (900 MB) and `MEASURE_MAX_SECONDS = 180`: the stop rule.
- Produces (`print/scripts/measure_plate.py`, Flask-free, standard library and numpy):
  - `cylinder_stl(radius_mm, height_mm, segments) -> bytes`: a closed binary STL with
    `4 * segments` triangles and real normals.
  - `write_measure_3mf(path, stl: bytes, centres: list[tuple[float, float]]) -> list[str]`:
    a minimal 3MF (`[Content_Types].xml`, `_rels/.rels`, `3D/3dmodel.model`,
    `unit="millimeter"`) with one `<object>` per copy named `Hub #<n>` and one translated
    `<build><item>` per copy. Returns the names.
  - `PLATES = {'thirty': 30 copies of a 36 mm × 20 mm cylinder with 2,500 segments
    (10,000 triangles each, 300,000 in all) in a 6 × 5 grid at 50 mm pitch from (40, 40);
    'two-big': 2 copies of a 36 mm × 20 mm cylinder with 37,500 segments (150,000 each,
    300,000 in all) at (100, 100) and (200, 100)}`. `--triangles N` scales `thirty`'s
    segments to `N / 120` (rounded down), for the stop rule.
  - `main()`: `--plate thirty|two-big [--triangles N]`; slices with the `build_command`
    form of `print/slicer.py` (default profiles, the slicer's environment), `--arrange 0
    --orient 0`, timeout `PLATE_SLICE_TIMEOUT_S`; checks `Metadata/plate_1.json` lists every
    name; prints one line
    `plate=thirty copies=30 triangles=300000 seconds=… peak_kb=… exit=0 names=ok verdict=ok|over`,
    with `peak_kb` from `resource.getrusage(RUSAGE_CHILDREN).ru_maxrss` (kilobytes on
    Linux). One plate per invocation, because `ru_maxrss` is a maximum over all children.
    Exit status 1 when the verdict is `over`.

- [ ] **Step 1: Write the failing tests** in `print/tests/test_limits.py` (quick; no Orca):
  - `test_part_bytes_follow_part_triangles` (`MAX_PART_BYTES == 7_500_084`)
  - `test_one_part_always_fits_a_job` (`MAX_JOB_TRIANGLES >= MAX_PART_TRIANGLES`)
  - `test_plate_timeout_longer_than_sample_timeout`
  - `test_tessellation_values_valid` (`0 < STL_ANGLE_TOLERANCE_RAD < math.pi / 2`,
    `0 < STL_CHORD_TOLERANCE_M < 0.001`)
  - `test_cylinder_triangle_count` (2,500 segments → 10,000 triangles; the binary length
    rule of `print.slicer._binary_triangle_count` holds)
  - `test_measure_3mf_one_object_per_copy` (three centres → three objects `Hub #1`…`Hub #3`,
    three items whose translations are the centres)
- [ ] **Step 2: Run** `uv run python -m unittest print.tests.test_limits -v`. Expect FAIL.
- [ ] **Step 3: Implement** `limits.py` and `measure_plate.py`. Run the module and
  `make test-quick`. Expect PASS.
- [ ] **Step 4: Measure** (each well under four minutes):
  `uv run python print/scripts/measure_plate.py --plate thirty` and
  `uv run python print/scripts/measure_plate.py --plate two-big`. Record both lines in
  `print/jobs.py`'s sizing note beside the 93 MB figure, neutrally ("30 copies, 300,000
  triangles: … MB peak, … s on an aarch64 Linux machine").
  **Stop rule:** if either plate exceeds `MEASURE_MAX_PEAK_KB` or `MEASURE_MAX_SECONDS`,
  rerun `--plate thirty --triangles N` stepping N down by 25,000 until a run is inside both;
  set `MAX_JOB_TRIANGLES` to the largest N that fits, record that run in the sizing note,
  and report the value to the controller, who updates the spec's section 5 table. If
  `two-big` itself is over, or N would fall below `MAX_PART_TRIANGLES`, stop and report:
  the per-part cap must come down too, which is the controller's decision.
- [ ] **Step 5: Commit** `print: limits module and a plate measured at the limits`.

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
    `_page_id()` is None. Applied to every print-blueprint route except `GET /print`,
    `GET /print/part` (R15: ungated, the upload mode's sample part) and the blueprint's
    static endpoint, after the session gate where the route has one.
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
  - `test_sample_part_route_stays_ungated` (R15): `GET /print/part` with no session and no
    page id → 200, as today.
  - `test_request_line_logs_rule_not_path`: after `GET /print-job/<full id>?pid=…`, the
    captured lines contain `rule=/print-job/<job_id>` and do not contain the full id.
  - `test_team_dash_on_default_config`: session `using_default_config=True`,
    `team_number=6238` → the line has `team=-`.
  - `test_slice_events_replace_print_job_metric`: the pool built with
    `make_worker(...)` (not `PrintRouteBase`'s `good_worker`, which logs nothing) and
    `print.routes.slice_stl` mocked to return a fake result; submitting a sample job with a
    mocked metrics records `print_slice_queued` and `print_slice_done`, never `print_job`.
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
  `print/tests/printer_panel/printer_panel.test.mjs` (the panel's node tests;
  `print/tests/test_printer_panel.py` only runs them under `make test`),
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
    **writes** an error line; reading one is allowed (`fitLayoutCanvas` reads
    `#layout-errors` to size the canvas).
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
  - `error_paths.test.js`: `only showError and clearError write an error line`. Read
    `print_wizard.js`, `print_onshape.js` and `print_layout.js` (those that exist) as text.
    Collect the error-line handles: every variable assigned from an expression containing
    `-errors` (for example `var errors = $('#layout-errors')`, `errs = $('#preview-errors')`)
    and every direct `$('#…-errors')` expression. Assert that every **write** to a handle
    (`.textContent =`, `.innerHTML =`, `.innerText =`, `.append(`, `.appendChild(`,
    `.insertAdjacent`) lies inside the body of `showError` or `clearError` (located by
    brace matching from `function showError(` / `function clearError(`). Reads such as
    `fitLayoutCanvas`'s `errors.offsetHeight` pass. A self-check feeds the scanner a
    snippet with a stray `errs.textContent = 'x'` and expects one violation.
  - in `printer_panel.test.mjs`: `send reports queued, refused and unreachable through
    reportDeliver` (a fake `window.PenguinCAM.reportDeliver` records its calls; fake fetch
    answers 200, 400 and a rejected promise) and `errorBox delegates to showError when it
    exists`.
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
  - `DownloadTooLarge(Exception)`.
  - `ExportHTTPError(RuntimeError)` with `status` and a message, so the test bed's
    `assertRaisesRegex(RuntimeError, …)` lines keep passing unchanged. Three cases, three
    messages: more than `max_hops` hops → status 310, message
    `"export still redirects after {max_hops} hops"` (contains `redirect`); a 3xx with no
    `Location` → status of that answer, message `"export answered {status} without Location"`;
    any other final status outside 200–299 → `"export answered HTTP {status}"`.
  - `fetch_following_redirects(client, path: str, params: dict | None = None, *, headers: dict | None = None, byte_cap: int | None = None, max_hops: int = 3) -> tuple[bytes, list[str]]`:
    first `client._make_api_request('GET', path, params=params, headers=headers, allow_redirects=False, stream=True)`;
    on 301/302/303/307/308 with `Location` (joined to the answer's URL), a host equal to
    `onshape.com` or ending in `.onshape.com` is fetched with
    `client.request_absolute('GET', url, headers=headers, allow_redirects=False, stream=True)`,
    any other host with `client.session.get(url, headers=headers, allow_redirects=False, stream=True)`
    and no auth. `headers` go on the request and on every hop. Returns the final body and
    the hop URLs; raises `ExportHTTPError` as above, the loop case before a fourth hop is
    sent (so the request and three hops are sent, as the test bed asserts). The body is read
    with `iter_content(65536)`; past `byte_cap` the response is closed and
    `DownloadTooLarge` raised.
  - `STL_ACCEPT = 'application/vnd.onshape.v1+octet-stream'` (moved from the test bed's
    `_STL_ACCEPT`).
- Produces (`print/routes.py`):
  `init_print_routes(app, *, limiter, require_session, has_onshape_session, onshape_client, token_manager, upload_folder, output_folder, template_context, metrics, log, pool=None, part_store=None)`;
  `ctx.has_onshape_session`, `ctx.onshape_client`. `print_page` puts
  `panel_context_from_return(return_url)` into the template as `onshape`, and, for
  `source=onshape` when `rest_address` raises, `onshape_error = NO_CONTEXT_MESSAGE`.
- `frc_cam_gui_app.py`: passes `has_onshape_session=_has_onshape_session` and
  `onshape_client=lambda: session_manager.get_client(get_current_user_id()) if ONSHAPE_AVAILABLE else None`.
- `testbed/scenarios/__init__.py`: `export_part_stl(client, doc, part_id, params)` builds its
  path as before and returns
  `fetch_following_redirects(client, path, params, headers={'Accept': STL_ACCEPT})`; its
  own redirect loop, `_STL_ACCEPT` and `_auth_for` (if nothing else uses it) are deleted.
  The test bed's redirect tests in `testbed/tests/test_scenarios.py` keep their contract
  and pass **unchanged**: bodies, hop lists, auth only on `*.onshape.com`, four requests
  for the loop, `RuntimeError` matching `redirect` for the loop and `307 without Location`
  for the bare 307. If the implementation cannot keep a line of that test, the change to
  it is made in this task and named in the commit message.

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
  - `test_headers_sent_on_request_and_every_hop`: with a spy on `ReplayAdapter.send` (as
    the test bed's test does), every sent request of a 307 → 307 → 200 chain carries
    `Accept: application/vnd.onshape.v1+octet-stream`. Replay matching ignores headers, so
    only this spy can show a dropped header before a live run.
  - `test_redirect_errors_are_runtime_errors_with_test_bed_messages`: loop → `RuntimeError`
    matching `redirect`; bare 307 → matching `307 without Location`; a 500 → `HTTP 500`.
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
  `testbed/tests/fixtures/make_print_fixtures.py`, and its output under
  `testbed/tests/fixtures/cassettes/`: one cassette per end-to-end request flow (table
  below), each `synthetic-print-<flow>.json` with its STL bodies in
  `synthetic-print-<flow>/NNN.bin`

**Interfaces:**
- Consumes: `OnshapeAddress`, `fetch_following_redirects`, `STL_ACCEPT`,
  `DownloadTooLarge`, `ExportHTTPError` (Task 3); `STL_CHORD_TOLERANCE_M`,
  `STL_ANGLE_TOLERANCE_RAD` (Task 0); test bed `Cassette`, `Exchange`, `ReplayAdapter`,
  `set_current_scenario`.
- Produces (`print/onshape_parts.py`):
  - `ELEMENT_CACHE_TTL_S = 600`
  - `PartSource` (frozen dataclass): `document_id`, `wvm`, `wvm_id`, `element_id`,
    `part_id`, `configuration: str | None = None`, `link_document_id: str | None = None`;
    `to_json() -> dict` with keys `documentId`, `wvm`, `wvmId`, `elementId`, `partId`, and
    `configuration`/`linkDocumentId` only when set; `PartSource.from_json(d)` validates ids
    (24 hex), `wvm` in `w|v|m`, cuts `configuration` to 2,000 characters, and raises
    `ValueError` otherwise; `key()` returns the tuple used for de-duplication.
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
    `parts_list(client, address) -> list[dict]` (`GET /parts/{element_path}`). Each method
    takes `fresh=False`; `fresh=True` fetches past the cache and stores the new answer.
    Module-level `ELEMENT_CACHE = ElementCache()`. The cache lives in process memory and
    assumes the one-worker `Procfile`, like the part store.
  - **Cache miss = refetch (R16).** When a selection's part id or `selectionId` is not in
    the cached `parts_list`, or its `occurrencePath` does not resolve in the cached
    `assembly_definition`, that answer is fetched once more with `fresh=True` before the
    selection is refused. One refetch per request and element, however many selections
    miss.
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
      `configuration = elementConfiguration or None`, cut to 2,000 characters;
      `link_document_id` as above.
      `fallback_name = partName`. Name: `partName`.
    - `refresh`: each selection is `{source, name}`; `PartSource.from_json(source)`.
  - `ExportResult(stl: bytes, source: PartSource, calls: int, ms: int, hops: list[str])`
  - `ExportFailed(Exception)` (`name`, `status`, `reason`), `PartTooLarge(Exception)` (`name`),
    `OnshapeLimitReached(Exception)` (`name`).
  - `STL_PARAMS = {'mode': 'binary', 'units': 'millimeter', 'chordTolerance': f'{STL_CHORD_TOLERANCE_M:.5f}', 'angleTolerance': f'{STL_ANGLE_TOLERANCE_RAD:.4f}'}`
    (the explicit print tessellation; spec 3.3).
  - `export_part_mesh(client, part: ResolvedPart, *, byte_cap: int, cache=ELEMENT_CACHE) -> ExportResult`:
    `fetch_following_redirects(client, f"/parts/{…}/e/{eid}/partid/{pid}/stl", STL_PARAMS + configuration + linkDocumentId, headers={'Accept': STL_ACCEPT}, byte_cap=byte_cap)`.
    A 402 → `OnshapeLimitReached`; `DownloadTooLarge` → `PartTooLarge`; another
    `ExportHTTPError` with `part.fallback_name` set → fetch `parts_list` for that element,
    match by `name`; exactly one → retry with its `partId` (and return that source); more
    than one → `PartRefused(DUPLICATE_NAME_MESSAGE)`; none or retry failure →
    `ExportFailed`. `calls` counts every HTTP call made, hops included.
- `make_print_fixtures.py` writes the cassettes with `synthetic=True` from the
  documented OpenAPI shapes: ids are made-up 24-hex strings; STL bodies are binary boxes
  (10 × 20 × 30 mm and a 64-segment cylinder) with real normals. Paths carry the
  `/api/v13` prefix; export queries carry `STL_PARAMS`. Every export is a 307 to
  `https://cad.onshape.com/api/v13/blob/…` followed by a 200 with the STL body. Replay
  answers from the one current cassette (`set_current_scenario`), so **each cassette is
  the whole call sequence of one end-to-end flow**, exports included, and each test names
  its cassette. Flows (calls in order):

  | Cassette | Calls | Used by |
  |---|---|---|
  | `synthetic-print-ps-one` | elements (`PARTSTUDIO`), configuration (empty), parts, export box (307, 200) | Task 4 part id and `selectionId` tests, `test_export_counts_calls_including_redirect`; Task 6 single-part tests |
  | `synthetic-print-ps-two` | elements, configuration, parts, export box (307, 200), export cylinder (307, 200) | Task 6 two-part tests |
  | `synthetic-print-ps-refresh` | export box (307, 200), export cylinder (307, 200) | Task 6 refresh request |
  | `synthetic-print-ps-configured` | elements, configuration (one parameter) | configured Part Studio refused |
  | `synthetic-print-ps-configured-passed` | elements, configuration, parts (with `configuration`), export (with `configuration`) | configuration passed through |
  | `synthetic-print-ps-resolve-twice` | elements, configuration, parts; then elements, configuration, parts again | cache expiry |
  | `synthetic-print-ps-cache-miss` | elements, configuration, parts (without the new part), parts (with it), export | R16 Part Studio |
  | `synthetic-print-ps-402` | elements, configuration, parts, export answering 402 | limit reached |
  | `synthetic-print-asm-one` | elements (`ASSEMBLY`), assembly definition, export (with `linkDocumentId`) | assembly occurrence |
  | `synthetic-print-asm-sub` | elements, assembly definition with a subassembly, export | subassembly |
  | `synthetic-print-asm-standard` | elements, assembly definition (standard content instance) | standard content refused |
  | `synthetic-print-asm-cache-miss` | elements, assembly definition (without the instance), assembly definition (with it), export | R16 Assembly |
  | `synthetic-print-dialog-one` | export by `idTag` (307, 200) | dialog `idTag` |
  | `synthetic-print-dialog-fallback` | export by `idTag` (404), parts, export by matched `partId` (307, 200) | `idTag` fallback |
  | `synthetic-print-dialog-duplicate` | export by `idTag` (404), parts with two parts of that name | duplicate names |
  | `synthetic-print-none` | nothing: any call fails the test as unmatched | dialog surface, too many parts, sign-in gate |

- [ ] **Step 1: Write the generator and run it**:
  `uv run python testbed/tests/fixtures/make_print_fixtures.py`. Each JSON has
  `"synthetic": true`. `testbed.tests.test_scrub.test_committed_recordings_are_clean` passes.
- [ ] **Step 2: Write the failing tests** in `test_onshape_resolve.py`, each with a replay
  client (helper `replay_client(scenario)`: `OnshapeClient.from_api_keys('k', 's')`,
  `ReplayAdapter()` mounted on `https://`, `settings.CASSETTE_DIR` patched,
  `set_current_scenario(scenario)`, a fresh `ElementCache()`):
  - `test_partstudio_part_id_used_directly_and_named_from_parts_list` (`synthetic-print-ps-one`)
  - `test_partstudio_selection_id_matched_through_parts_list` (`synthetic-print-ps-one`)
  - `test_configured_partstudio_without_configuration_refused` (`CONFIGURED_MESSAGE`;
    `synthetic-print-ps-configured`)
  - `test_configured_partstudio_with_panel_configuration_passes_it_through`
    (`source.configuration` equals the context's; `synthetic-print-ps-configured-passed`)
  - `test_assembly_occurrence_maps_to_source_with_link_document` (`synthetic-print-asm-one`)
  - `test_subassembly_occurrence_followed` (`synthetic-print-asm-sub`)
  - `test_standard_content_refused` (`synthetic-print-asm-standard`)
  - `test_dialog_idtag_used_as_part_id` (`synthetic-print-dialog-one`)
  - `test_dialog_idtag_fallback_matches_part_name` (first export 404, parts list has one
    match, retry 307 → 200; `synthetic-print-dialog-fallback`)
  - `test_dialog_duplicate_names_refused` (`synthetic-print-dialog-duplicate`)
  - `test_dialog_surface_refused` (`synthetic-print-none`)
  - `test_dialog_configuration_cut_to_2000` (`synthetic-print-none`, resolve only)
  - `test_element_type_cached_for_ten_minutes` (a fake clock: second resolve within 600 s
    makes no call; after 601 s it fetches again; `synthetic-print-ps-resolve-twice`)
  - `test_partstudio_cache_miss_refetches_once` (Review Focus 6: a part id missing from the
    cached parts list is found in the refetched one and exported; `synthetic-print-ps-cache-miss`)
  - `test_assembly_cache_miss_refetches_once` (Review Focus 6; `synthetic-print-asm-cache-miss`)
  - `test_still_missing_after_refetch_refused` (`NOT_IN_ASSEMBLY_MESSAGE` after exactly one
    refetch; `synthetic-print-asm-cache-miss` with an unknown path, its export left unanswered)
  - `test_export_402_raises_limit_reached` (`synthetic-print-ps-402`)
  - `test_export_counts_calls_including_redirect` (`calls == 2`; `synthetic-print-ps-one`)
  - `test_export_asks_for_print_tessellation` (the export request's query carries `mode`,
    `units`, `chordTolerance=0.00005` and `angleTolerance=0.1309`, read from a spy on
    `ReplayAdapter.send`; `synthetic-print-ps-one`)
- [ ] **Step 3: Run** `uv run python -m unittest print.tests.test_onshape_resolve -v`. Expect FAIL.
- [ ] **Step 4: Implement** the resolution and export functions.
- [ ] **Step 5: Run** the module and `make test-quick`. Expect PASS.
- [ ] **Step 6: Commit** `print: resolve Onshape selections and export parts, with synthetic cassettes`.

### Task 5: Mesh, limits and the part store

**Files:**
- Create: `print/mesh.py`, `print/part_store.py`, `print/plate.py`
  (orientations only), `print/tests/test_mesh.py`, `print/tests/test_part_store.py`
- Modify: `print/limits.py` (created in Task 0: add the sentences)

**Interfaces:**
- Consumes: the numeric limits of `print/limits.py` (Task 0), with `MAX_JOB_TRIANGLES` as
  Task 0's stop rule left it.
- Produces (`print/limits.py`), sentences from spec section 5:
  - `TOO_DETAILED_MESSAGE = "{name} is too detailed to print here (over 150,000 triangles)."`
    (the number formatted from `MAX_PART_TRIANGLES`, so the two cannot differ)
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
    There is no start-up sweep: `UPLOAD_FOLDER` is a fresh `mkdtemp()` per process
    (`frc_cam_gui_app.py`), so a new process has nothing to sweep; orphans arise only within
    a process and the periodic pass removes them.
  - The module docstring states that the index, like `ElementCache` and `JobPool`, lives in
    process memory and assumes the one-worker `Procfile`.

- [ ] **Step 1: Write the failing tests.** `test_mesh.py`:
  - `test_reads_binary_box_and_size` (10 × 20 × 30 box → `{x:10, y:20, z:30}`, 12 triangles)
  - `test_ascii_or_truncated_refused`
  - `test_triangle_cap`: a header claiming 150,001 triangles with that length →
    `TOO_DETAILED_MESSAGE` with the name and `150,000`.
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
  return a replay client, `ctx.has_onshape_session` patched, `ctx.part_store` a temp
  `PartStore`, a fresh `ElementCache` per test). Each `POST /print/onshape/parts` replays
  one Task 4 flow cassette, named here; `set_current_scenario` is called before each
  request:
  - `test_signin_gate_401_with_code` (an `app_verified` session without Onshape → 401
    `signin_expired`; `synthetic-print-none`)
  - `test_two_parts_listed_with_sizes_triangles_and_footprints` (`synthetic-print-ps-two`)
  - `test_same_source_returns_existing_ref` (Review Focus 5: first request
    `synthetic-print-ps-one`, then the same selection again under `synthetic-print-none`,
    so any call fails; the second answer has the same `ref`)
  - `test_refresh_issues_new_refs_and_supersedes_old` (first `synthetic-print-ps-two`, then
    the refresh under `synthetic-print-ps-refresh`; the old ref is still served by the STL
    route)
  - `test_errors_are_sentences` (configured Part Studio → `CONFIGURED_MESSAGE` in `errors`;
    `synthetic-print-ps-configured`)
  - `test_too_many_parts_refused_before_export` (`synthetic-print-none`)
  - `test_402_gives_limit_sentence` (`synthetic-print-ps-402`)
  - `test_stl_route_owner_only` (other pid → 404; parts added under `synthetic-print-ps-one`)
  - `test_export_events_logged_without_secrets` (`synthetic-print-ps-one`; captured lines
    contain `[PRINT] export` with `calls=2`, and no `Authorization`, access key or cookie
    value)
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
    `'*'` (R17: as `static/source_onshape.js` posts; the messages carry no secret, and a
    return URL without `server` on an enterprise domain would otherwise drop every
    message). `isOnshapeOrigin(origin, server) -> bool` (exported): true for `server`, or
    for an `https://` origin whose host is `onshape.com` or ends in `.onshape.com`.
    Methods:
    - `init()` posts `applicationInit`;
    - `enterParts()` marks active and arms: `requestSelection` with
      `messageId: 'penguincam-print-<n>'`, `filterType: 'simple'`,
      `entityTypeSpecifier: ['BODY']`, `bodyTypeSpecifier: ['SOLID']`,
      `requiredSelectionCount: 1`;
    - `leaveParts()` marks inactive, posts `stopRequest`, and `closeSelectItemDialog` when
      the dialog is open;
    - `openDialog()` posts `openSelectItemDialog` with `selectParts: true, selectMultiple: true`;
    - `handleMessage(event)`: drops any event for which
      `isOnshapeOrigin(event.origin, context.server)` is false;
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
  - `every message carries the three ids and is posted to '*'`
  - `isOnshapeOrigin accepts the server and onshape.com hosts only` (`https://cad.onshape.com`,
    `https://acme.onshape.com` yes; `http://cad.onshape.com`, `https://onshape.com.evil.io`,
    `https://evilonshape.com` no)
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
- Create: `print/static/plate_geometry.js`,
  `print/tests/fixtures/plate_cases.json`, `print/tests/fixtures/make_rotated_cases.py`,
  `print/tests/test_plate.py`, `print/tests/js/plate_geometry.test.js`
- Modify: `print/plate.py` (created in Task 5), `print/routes.py`
  (`POST /print/page` answers `plate` and `limits`)

**Interfaces:**
- Produces (`print/plate.py`; the JS file exports the camelCase twin of each):
  - `SPACING_MM = 5.0`, `MARGIN_MM = 3.0`, `EPS_MM = 1e-6`
  - `ORIENTATIONS` and `ORIENTATION_MATRICES` from Task 5 (the JS file copies the table).
  - `ORIENTATION_LABELS`, **in `plate_geometry.js` only** (the browser is their only
    user, so there is no Python copy to drift): each names the face that rests on the plate,
    as spec 4.5 asks. With R2 (the named axis points up) the resting face is the opposite
    one: `{'+z': 'as modelled', '-z': 'upside down', '+x': 'on its side, −x face down', '-x': 'on its side, +x face down', '+y': 'on its side, −y face down', '-y': 'on its side, +y face down'}`.
    The docs (Task 10) copy this table.
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

- [ ] **Step 1: Write the shared cases.** Axis-aligned boxes and rectangles are computed
  by hand and keep the arithmetic exact. The rotated cases (`off_plate_after_45_rotation`,
  `rotated_near_miss`) have irrational coordinates: `make_rotated_cases.py` (committed,
  shapely) computes their placements and hull distances and writes them into
  `plate_cases.json`, rounded to 1e-6; each such case keeps at least 0.1 mm between its
  distance and the spacing or margin, so rounding cannot flip a verdict.
- [ ] **Step 2: Write the failing tests.** `test_plate.py`: `test_shared_cases` (each case's
  problems equal, messages included), `test_shared_matrices` (within 1e-9),
  `test_shared_labels_and_sanitize`, `test_matrices_put_named_axis_up`
  (`M · axis == (0, 0, 1)` for every orientation), `test_plate_from_default_printer`
  (`min [0,0]`, `max [340,320]`, height 340). `plate_geometry.test.js`: the same four
  shared tests, plus `orientation labels cover the six orientations`,
`arrangeCopies places six 40 mm squares in two rows`,
  `arrangeCopies leaves what does not fit unplaced beside the plate`,
  `arrangeCopies keeps orientation and angle`, `arranged copies pass checkPlacement`.
- [ ] **Step 3: Run** `uv run python -m unittest print.tests.test_plate -v` and
  `make test-quick`. Expect FAIL.
- [ ] **Step 4: Implement** both files; extend `/print/page`.
- [ ] **Step 5: Run** `make test-quick`. Expect PASS. **Commit** `print: plate geometry mirrored in Python and JavaScript`.

### Task 9: The 3MF writer and slicing a plate

**Files:**
- Create: `print/plate_3mf.py`, `print/tests/test_plate_3mf.py`
- Modify: `print/slicer.py`, `print/tests/test_slicer.py`,
  `print/tests/orca_integration_test.py`, `print/scripts/measure_plate.py` (Task 0),
  `print/tests/test_limits.py`, `print/jobs.py` (sizing note)

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
  - `slice_plate(model_3mf, profiles: SliceProfiles, output_dir, timeout_s=PLATE_SLICE_TIMEOUT_S) -> SliceResult`
    (240 s from `print/limits.py`; `slice_stl` keeps `DEFAULT_TIMEOUT_S = 120`):
    the `slice_stl` environment and error handling; a non-zero exit raises
    `SliceError(ORCA_CODE_MESSAGES.get(code, "The slicer could not process this part."), details, code)`.
    The shared subprocess part of `slice_stl` and `slice_plate` becomes one private
    function; `slice_stl` keeps its behaviour.
- `print/scripts/measure_plate.py` (Task 0) drops its own 3MF writer and command: it
  builds the plates as `copies`/`parts` and calls `write_plate_3mf` and `slice_plate`, so
  the measurement covers the code that ships. Its plates, output line and stop-rule
  constants are unchanged. `write_measure_3mf` and its test in `test_limits.py` are
  deleted; `test_plate_3mf.py` covers one object per copy.

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
  `test_slice_plate_default_timeout_is_plate_timeout` (240 s; `slice_stl`'s stays 120 s),
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
- [ ] **Step 6: Re-measure through the writer** (V17): run both Task 0 plates again,
  `uv run python print/scripts/measure_plate.py --plate thirty` and `--plate two-big`.
  Each must print `verdict=ok` (under `MEASURE_MAX_PEAK_KB` and `MEASURE_MAX_SECONDS`);
  update the sizing note's figures if they moved. A run over either limit applies Task 0's
  stop rule before continuing.
- [ ] **Step 7: Commit** `print: 3MF plate writer and slice_plate, re-measured at the limits`.

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
    `slice_plate` (with its default `PLATE_SLICE_TIMEOUT_S`, 240 s), then `check_plate_names(names, plate_object_names(result.output_path))`.
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
  - Send to Printer needs no code: `POST /printer/jobs` reads `filename` from the token
    manager (`print/printer_routes.py`), so it queues the file the token names under the
    delivered name. `test_send_to_printer_carries_delivered_name` proves it.

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
  - `test_send_to_printer_carries_delivered_name` (spec 4.6): the plate worker runs with
    `run_plate_job` mocked to return a fake archive; its token goes through
    `POST /printer/jobs` (set up as `print/tests/test_printer_routes.py` does: a team
    config with a printer, the relay's job store in a temp dir); the queued job's
    `filename` equals the payload's `delivered_name`
    (`Box_plus1-20261009-1432.gcode.3mf`), and `printer_relay.strip_job_suffix` leaves it
    unchanged.
  - `test_plate_job_uses_plate_timeout` (`slice_plate` mocked; called with no `timeout_s`,
    so 240 s, or with `PLATE_SLICE_TIMEOUT_S`)
- [ ] **Step 2: Run** `uv run python -m unittest print.tests.test_jobs print.tests.test_plate_job print.tests.test_routes_jobs -v`.
  Expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Add** to `orca_integration_test.py` `test_plate_job_end_to_end`: two
  synthetic parts in a temp store, `run_plate_job` with `DEFAULT_PROFILES` succeeds and
  the archive's names match.
- [ ] **Step 5: Docs.** "Placement" (the copy model, R2's orientations, R10's pivot, the
  rules, the 3MF with one object per copy, the name guard, the Orca codes, the delivered
  name) and "Limits" (the section 5 table, the 240 s plate slice timeout, the export
  tessellation, and the measured figures from Tasks 0 and 9).
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
  - `load_catalog() -> Catalog`: `Catalog.load()` once per process, cached (the catalog is
    committed and only changes with a deploy), so `/print/page` does not read about 180
    files per call.
  - `choices_for_request(session_data: dict | None, force_defaults: bool) -> PrintChoices`:
    the caller passes `session.get('team_config_data')` as `session_data`, and
    `force_defaults=True` for the upload mode (R8). `default_choices()` when
    `force_defaults`, else
    `resolve_print_config(TeamConfig.from_dict(session_data or {}).printing_section(), load_catalog())`.
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
  - `test_incompatible_filament_dropped_with_warning`: the 0.4 nozzle printer with process
    `0.24mm Balanced Quality @BBL H2S 0.6 nozzle`, which fits only the 0.6 nozzle, is
    dropped with `DROPPED_MESSAGE` naming `printing.processes`. (`Generic PETG @BBL H2S`
    fits the 0.4, 0.6 and 0.8 nozzles, so it cannot serve here; checked Fri 10-09.)
  - `test_catalog_loaded_once` (two `choices_for_request` calls read the catalog once)
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
  `print/tests/js/print_wizard.test.js`, `docs/3D_PRINTING.md` (the stage 1 sweep, Step 5)

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
- [ ] **Step 4: Run** `make test`. Expect PASS.
- [ ] **Step 5: Docs sweep (R14).** `docs/3D_PRINTING.md` stops describing stage 1 as the
  whole print path. Each item, by section of today's file:
  - the title "(stage 1)" goes; section 1 "What stage 1 does" becomes "What the print path
    does": the Onshape flow (Parts, Layout, Setup, Preview) and the upload mode's sample
    part, which keeps the stage 1 behaviour (R8);
  - section 2's diagram and "Where the files live": the new modules and static files
    (`events.py`, `onshape_parts.py`, `limits.py`, `mesh.py`, `part_store.py`, `plate.py`,
    `plate_3mf.py`, `plate_job.py`, `print_config.py`, `profiles/catalog/`,
    `print_onshape.js`, `plate_geometry.js`, `print_layout.js`, `print_layout.css`);
  - section 6 "The command line": `--arrange 1` stays only for the sample part; a plate is
    sliced with `--arrange 0 --orient 0`, with the 240 s plate timeout beside the sample's
    120 s;
  - section 7 "The worker": the `print_job` metrics event is replaced by `slice_queued`,
    `slice_done` and `slice_failed` (Task 1), and the worker takes a payload (Task 10);
  - section 8 "Routes": the route table gains `POST /print/page`,
    `POST /print/onshape/parts`, `GET /print/parts/<ref>.stl`, `POST /print/client-event`
    and `POST /print/deliver` with their gates and limits, and the page id rule; the
    "`/print/part` is deliberately ungated" paragraph is kept and says why (R15): it serves
    only the sample part for the upload mode, is exempt from the page id gate, and the
    Onshape flow never calls it;
  - section 9 "Frontend": `loadPart()` and `/print/part?stl=1` are the upload mode's path;
    the Onshape mode's Parts, Layout, Setup and Preview are described;
  - section 11 "Testing": the test table gains every new test module and node test file;
  - section 12 "Open items and later stages": items milestone 1 closed (several parts,
    placement, team profiles) are removed; the rest stay.

  Then `grep -n -i 'stage 1' docs/3D_PRINTING.md` finds only the sample part's history,
  if anything. Neutral wording throughout.
- [ ] **Step 6: Run** `make test`. Expect PASS. **Commit** `print: Setup step with team filaments, print settings and overrides; developer guide swept`.

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
  - `SCENARIOS` gains, each `estimate` computed from its steps (R13; the ledger counts
    responses 200–399, so an export's 307 and 200 are two; panel load is 6, as in
    `panel-load`; the print page itself makes no Onshape call):
    - `print-select-parts`, document `tb-two-parts`, panel: `choose-print`, `print-parts`,
      `select part <box>` (select the box), `select part <cylinder>`, a deselection step.
      Estimate **13**: panel 6; the box: elements, configuration, parts, export 2 (5); the
      cylinder: export 2, the element answers cached; deselection and the unbounded
      reference selection 0.
    - `print-dialog-parts`, `tb-two-parts`, panel: `choose-print`, `print-parts`,
      `print-dialog` picking `tb-box`'s part, then closing the dialog. Estimate **11**:
      panel 6; export by `idTag` 2; if `idTag` is not the part id, its failed export is a
      4xx (not counted), then parts 1 and export 2.
    - `print-assembly-part`, `tb-assembly`, panel: `choose-print`, `print-parts`, select
      one instance. Estimate **10**: panel 6; elements, assembly definition, export 2.
    - `print-export`, `tb-two-parts` and `tb-assembly`, no panel: `run_scenario_api`
      resolves both parts of `tb-two-parts` (via `selection` with part ids from
      `documents.json`) and the assembly's first instance (via an occurrence path from the
      definition), and exports each with `export_part_mesh`. Estimate **12**: `tb-two-parts`
      elements, configuration, parts, two exports 4 (7); `tb-assembly` the runner's
      assembly definition read for the path 1, elements 1, the definition again from
      `ELEMENT_CACHE` 0, export 2 (4); 11 in all, plus 1 in case the runner's read does
      not go through `ELEMENT_CACHE`.
    - `test_print_scenarios_defined_with_known_documents_and_estimates` asserts these four
      numbers, so a changed step list forces a recount.
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
  print browser tests skipped as `needs a recording` (the test bed's own panel scenarios
  add their skips while they are unrecorded) and the self-test passing.
- [ ] **Step 5: Rate limits in replay.** The replay server runs the real limiter (all
  requests come from localhost: `POST /print/page` 10 per minute, `POST /print-job`
  3 per minute), and the test bed exempted only its own routes
  (`testbed/flask_hooks.py`, `limiter.exempt(bp)`). Search the replay run's log for
  `429`. If any print request got one, exempt the print blueprint in replay mode the same
  way, inside `testbed/flask_hooks.py` only (never in production code), and rerun.
- [ ] **Step 6: Commit** `testbed: print scenarios and browser checks`.

### Task 17 (needs Onshape credentials): the validation run with the owner

Blocked on the owner: the test bed's credentials and test folder (test bed spec, section 13).
Step 1 needs none.

- [ ] **Step 1 (no credentials):** write the checklist
  `PenguinCAM-notes/guides/PRINT_VALIDATION_RUN.md` from spec section 11, linking the test
  bed's [ONSHAPE_CHECKPOINT.md](../guides/ONSHAPE_CHECKPOINT.md). Commit it in the notes repo.
- [ ] **Step 2 (credentials):** `uv run python -m testbed build-docs`, then
  `uv run python -m testbed record print-export`; `accept print-export`. Write down each
  exported part's triangle count (the `export` lines' `triangles=`) against
  `MAX_PART_TRIANGLES`, to confirm the export tessellation keeps the test parts well under
  it (spec 3.3).
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
| V17 | Plates at the limits measured: under 900 MB and 180 s, inside the 240 s plate timeout (5) | `uv run python print/scripts/measure_plate.py --plate thirty && uv run python print/scripts/measure_plate.py --plate two-big` | both print `verdict=ok`: peak under 921,600 KB and wall time under 180 s each; both figures are in `print/jobs.py`'s sizing note |
| V18 | Unknown printer fails closed; drops warn; overrides validated (6.2, 6.3) | `uv run python -m unittest print.tests.test_print_config -v` | pass |
| V19 | Synthetic fixtures only under `testbed/tests/fixtures`, marked; no scenario replays one (8.2) | `grep -rL '"synthetic": true' testbed/tests/fixtures --include='synthetic-*.json'; grep -rln '"synthetic": true' testbed/cassettes testbed/messages` | both print nothing |
| V20 | Browser scenarios skipped until recorded, then replayed (8.2) | `make testbed-replay` | before Task 17: the five print browser tests skip with `needs a recording` (the test bed's own panel scenarios skip too while they are unrecorded), and no request gets a 429; after: no print scenario skips |
| V21 | New test bed scenarios recorded and drift clean (8.3, 11) | `uv run python -m testbed record print-export`; `… record --ui …`; `uv run python -m testbed drift` *(credentials)* | the report says `clean` |
| V22 | Send to Printer keeps working with plate jobs, under the delivered name (4.6) | `uv run python -m unittest print.tests.test_routes_jobs -v && node --test print/tests/printer_panel/printer_panel.test.mjs` | `test_send_to_printer_carries_delivered_name` and the panel's `reportDeliver` tests pass |
| V23 | Preview draws every copy where it was placed (4.7) | `node --test print/tests/js/print_viewer.test.js` | pass, `transformPositions` included |
| V24 | Layout helpers: hit test, rotation, sync of copies, the sentence order (4.5, 4.4) | `node --test print/tests/js/print_layout.test.js` | pass |
| V25 | Setup: team lists, overrides from the form, a config error blocks slicing (6.4) | `node --test print/tests/js/print_wizard.test.js` | pass, `overridesFromForm` and `canSlice` included |
| V26 | Explicit tessellation, `Accept` on every hop, cache miss refetches (3.3) | `uv run python -m unittest print.tests.test_onshape_resolve print.tests.test_onshape_context -v` | `test_export_asks_for_print_tessellation`, `test_headers_sent_on_request_and_every_hop` and both `cache_miss` tests pass |

V1–V20 (before-recording form) and V22–V26 can pass without Onshape. V20's after-recording form and
V21 complete the milestone in the validation run with the owner.

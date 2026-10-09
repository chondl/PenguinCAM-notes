# Onshape Test Bed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Onshape test bed: record Onshape traffic for the print path once, replay it
locally for everyday development, and report drift when real Onshape changes.

**Architecture:** A `testbed/` package in PenguinCAM, switched on by `PENGUINCAM_TESTBED` and
inert otherwise. One transport adapter, installed in `OnshapeClient.__init__`, records or
replays API traffic for the process's *current scenario*. A Playwright-served fake Onshape host
at `https://cad-testbed.onshape.com` plays back panel messages to the real panel. Real Onshape
is reached unattended through API keys and through an automated UI run in real Chrome.

**Tech Stack:** Python 3.11 (the repo's venv and Docker image), Flask 3.0, requests 2.31 and
urllib3 adapters, Python Playwright 1.63.0, Chromium 151 at `/usr/bin/chromium`, Google Chrome
for ARM64 Linux, `unittest`.

**Spec:** [2026-10-09-onshape-test-bed-design.md](../specs/2026-10-09-onshape-test-bed-design.md)

**Code tree:** `/repos/popcornpenguins/PenguinCAM/.worktrees/onshape-test-bed`, branch
`feature/onshape-test-bed`. It is cut from `feature/printer-relay`, with `origin/main` merged
in and Orca back at `tools/orca`. All paths below are relative to that tree.

**Reviews folded in:** two adversarial reviews of the first draft (code-grounded and external
seams, Fri 10-09). The main changes:

- one replay path, with the fake API server removed;
- the current scenario held per process;
- `/blobelements/` scrubbed;
- sign-in only in replay mode;
- Playwright 1.63;
- the app guards tested in a fresh process, never by a reload;
- the slice test moved out of `test-quick`;
- the Chrome profile kept out of the tree;
- a manual redirect follow that re-attaches auth only for `*.onshape.com`;
- tasks reordered so that each one's inputs exist.

## Global Constraints

- **Off by default.** The test bed is on only when `PENGUINCAM_TESTBED` is `replay` or
  `record`. Every test bed setting is read through `testbed/settings.py`, which imports only
  the standard library. With the variable unset, no test bed route, adapter, template flag or
  script is loaded (spec 5.6).
- **Import guards.** `frc_cam_gui_app` refuses to import with `PENGUINCAM_TESTBED` set when
  `FLASK_ENV=production`, `RAILWAY_ENVIRONMENT` or `VERCEL` is set. In record mode it also
  refuses without `ONSHAPE_CLIENT_ID` and `ONSHAPE_CLIENT_SECRET`, or with a client id
  starting `VKDK` (spec 5.6).
- **No secret on disk or in a log.** That covers API keys, OAuth tokens, `ONSHAPE_PASSWORD`,
  cookies, and `Authorization` in bearer or Basic form (spec 5.2). The one exception is the
  Chrome profile under `~/.local/state/penguincam-testbed/chrome-profile/`, which holds
  Onshape session cookies outside the repository and outside the Docker context (spec 5.9).
  Credentials are read only from the environment; a missing one fails naming the variable.
- **No live calls in tests.** `make test-quick`, `make test` and `make testbed-replay` make
  zero live Onshape calls.
- **No fall-through.** In replay mode every request on any host is answered by the replay
  adapter. Unmatched requests get HTTP **599**, with a body starting `not in the cassette: `
  (spec 5.3).
- **Ports.** Record mode uses the development server on **6238**. Browser scenarios start a
  replay development server on **6240**. Both numbers are constants in `testbed/settings.py`.
- **Fake host.** The origin is exactly `https://cad-testbed.onshape.com`, with no port. It
  gets the Playwright permission `local-network-access`, with a CDP fallback
  `Browser.grantPermissions` for `['localNetwork','loopbackNetwork']` (spec 5.4).
- **Budget.** The default is **250** counted calls per rolling year, with a per-run cap of
  **150** (spec 7).
- **Test documents.** The name starts with `tb-`, the description is exactly
  `created by PenguinCAM test bed`, and the document is listed in the test folder (spec 5.1).
- **Stand-ins.** User `testbed@example.invalid`, name `Test Bed Owner`, user id
  `000000000000000000000001`, companies `0000000000000000000000c1`, `…c2`. They are
  constants in `testbed/scrub.py`, imported wherever needed, never retyped (spec 9).
- **Separation.** The CNC path is not touched: no change to `templates/wizard.html`,
  `static/source_onshape.js` or any DXF code. Test bed browser hooks attach only to the print
  wizard.
- **Dependencies.** No `pyproject.toml`. Playwright goes only in `testbed/requirements.txt`,
  never in `requirements.txt` or the Docker image.
- **Deletes.** No `rm` on paths built from variables. Use literal paths, `"${VAR:?}"`, or
  `shutil.rmtree` on a path that was checked first.
- **Branch.** Work in place on the branch; never commit to `main`.
- **Names.** Names exported across modules are long and self-describing:
  `testbed.settings.testbed_mode()`, not `mode()`.

## Review Focus

1. **A secret in a response shape the scrubber has not seen.** Example: the owner's email
   inside `documents[].owner` or `createdBy`. Expected: it is replaced anyway, because
   scrubbing replaces known values wherever they occur. Owning task: Task 2,
   `test_known_values_replaced_in_any_field`.
2. **The classroom config downloaded through `/blobelements/`.** Expected: the body is
   replaced by the fixture, so no pairing code is saved. Owning task: Task 2,
   `test_blobelements_body_replaced_by_fixture`.
3. **A panel opened on a version, with `workspaceId` the literal `{$workspaceId}`.**
   Expected: passed through raw, with matching unaffected. Owning task: Task 7,
   `test_host_url_keeps_placeholder_workspace`.
4. **Stale cassettes after a code change.** Expected: a 599 naming the method, host and
   path. Owning task: Task 4, `test_unmatched_request_names_method_host_path`.
5. **A repeated GET (panel reload, `/onshape/status`) after its recording is used up.**
   Expected: the last answer repeats instead of a 599. Owning task: Task 4,
   `test_exhausted_match_repeats_last`.

---

## File structure

```
testbed/
  __init__.py          empty (keeps `import testbed` cheap)
  settings.py          testbed_mode(), testbed_is_on(), assert_testbed_allowed(), ports, paths, budget settings
  scrub.py             Scrubber, stand-in constants, find_secrets (Task 2)
  cassette.py          Exchange, Cassette (Task 2)
  ledger.py            CallLedger, BudgetExceeded, AllowanceExhausted (Task 3)
  adapters.py          current scenario, RecordingAdapter, ReplayAdapter, LedgerRetry, install_testbed_adapters (Task 4)
  scenarios/__init__.py  Scenario, Step, SCENARIOS, run_scenario_api (Task 5)
  mesh.py              mesh_size_mm (Task 5)
  messages.py          message log format (Task 6)
  flask_hooks.py       register_testbed_routes(app) (Task 6)
  panel/testbed_panel.js  checklist strip and message recording (Task 6)
  host/index.html, host/host.js   fake Onshape host (Task 7)
  browser.py           ReplayDevServer, launch_test_browser, host_url (Task 7)
  drift.py             drift report, accept (Task 9)
  __main__.py          CLI (Task 10)
  documents.py         test documents builder (Task 11)
  ui_run.py            automated Onshape UI run (Task 12)
  scripts/install-chrome.sh
  fixtures/team-config-fixture.yaml
  cassettes/  messages/   committed recordings (empty until the first live run; .gitkeep)
  requirements.txt     playwright==1.63.0
  tests/               test_*.py (unit, in test-quick), browser_*.py (make testbed-replay), slice_*.py (make test)
  tests/fixtures/      SYNTHETIC recordings and STLs for self-tests only, each JSON marked "synthetic": true
```

Modified outside `testbed/`:

- `onshape_integration.py`: `OnshapeClient.__init__`, `OnshapeSessionManager.get_client`,
  `update_session_tokens`.
- `frc_cam_gui_app.py`: the import guards, route registration, `/onshape/status`.
- `print/templates/print_wizard.html`: one conditional script tag.
- `Makefile`, `.gitignore`, `.dockerignore`, `CLAUDE.md`.
- New guide: `docs/ONSHAPE_TEST_BED.md`.

---

### Task 1: Settings and import guards

**Files:**
- Create: `testbed/__init__.py`, `testbed/settings.py`, `testbed/tests/__init__.py`,
  `testbed/tests/test_settings.py`
- Modify: `frc_cam_gui_app.py` (right after imports), `Makefile` (test-quick discovery; `.PHONY`)

**Interfaces:**
- Produces (`testbed/settings.py`):
  - `testbed_mode() -> str | None`: `'replay'`, `'record'` or `None`. Cached after the
    first read; `reset_testbed_settings_for_tests()` clears the cache. Any other value raises
    `ValueError` naming `PENGUINCAM_TESTBED`.
  - `testbed_is_on() -> bool`
  - `assert_testbed_allowed(environ=os.environ) -> None`. It raises `RuntimeError`:
    - `"PENGUINCAM_TESTBED must not be set on a deployed server"` for any deployed signal;
    - in record mode, `"record mode needs ONSHAPE_CLIENT_ID"` (or `_SECRET`) when missing;
    - in record mode, `"record mode refuses the production Onshape app"` when the id starts
      with `VKDK`.
  - Constants: `RECORD_PORT = 6238`, `REPLAY_PORT = 6240`, `FAKE_HOST_ORIGIN =
    'https://cad-testbed.onshape.com'`, `TESTBED_DIR`, `CASSETTE_DIR`, `MESSAGE_DIR`,
    `FRESH_DIR` (`testbed/.fresh`), `FIXTURE_DIR`.
  - `state_dir() -> Path`: `$XDG_STATE_HOME/penguincam-testbed`, defaulting to
    `~/.local/state/penguincam-testbed`. Created on demand.
  - `budget_settings() -> tuple[int, date | None, int]`: from `TESTBED_BUDGET` (default 250),
    `TESTBED_CYCLE_START` (ISO date, default None) and `TESTBED_RUN_CAP` (default 150).

- [ ] **Step 1: Write the failing tests** in `test_settings.py`. Every test clears
  `PENGUINCAM_TESTBED` in `setUp` and resets the cache.
  - `test_off_by_default`
  - `test_bad_value_raises_naming_variable`
  - `test_refuses_each_deployed_signal` (loop over the three signals)
  - `test_record_mode_needs_dev_app_credentials`
  - `test_record_mode_refuses_production_client_id`
  - `test_import_refuses_when_deployed`: `subprocess.run([sys.executable, '-c', 'import
    frc_cam_gui_app'], env=…PENGUINCAM_TESTBED=replay, RAILWAY_ENVIRONMENT=x…)`. Expect a
    non-zero exit, with the message in stderr.
  - `test_app_without_testbed_has_no_testbed_routes`: a fresh subprocess imports the app
    with the variable unset and prints the rule list. Assert no rule starts with `/testbed`.
- [ ] **Step 2: Run** `uv run python -m unittest discover -s testbed/tests -t . -v`. Expect FAIL.
- [ ] **Step 3: Implement** `settings.py`. In `frc_cam_gui_app.py` add
  `from testbed.settings import assert_testbed_allowed; assert_testbed_allowed()` directly
  after the imports.
- [ ] **Step 4: Makefile.** In `test-quick`, after the print unit tests, add an echo heading
  and `@uv run python -m unittest discover -s testbed/tests -t . --buffer`. The default
  `test*.py` pattern excludes the `browser_*` and `slice_*` modules. Add `testbed-replay` and
  `testbed-record` to `.PHONY`.
- [ ] **Step 5: Run** the tests and `make test-quick`. Expect PASS.
- [ ] **Step 6: Commit** `testbed: settings and import guards`.

### Task 2: Cassettes and scrubbing

**Files:**
- Create: `testbed/scrub.py`, `testbed/cassette.py`,
  `testbed/fixtures/team-config-fixture.yaml`, `testbed/cassettes/.gitkeep`,
  `testbed/messages/.gitkeep`, `testbed/tests/test_scrub.py`, `testbed/tests/test_cassette.py`

**Interfaces:**
- Produces (`cassette.py`):
  - `Exchange` dataclass:
    - `method: str`, `host: str`, `path: str` (the full URL path, for example
      `/api/v13/parts/d/…/stl`), `query: dict[str, list[str]]`;
    - `request_body: str | None`, `status: int`;
    - `headers: dict[str, str]`: only `X-Rate-Limit-Remaining`, `Location`,
      `Content-Type`;
    - `body_text: str | None`, `body_file: str | None`.
  - `Cassette(scenario: str, exchanges: list[Exchange], synthetic: bool = False)`, with
    `save(directory: Path)` and `Cassette.load(directory: Path, scenario: str)`.
    - Files: `<dir>/<scenario>.json`, with binaries in `<dir>/<scenario>/NNN.bin`.
    - JSON is written with `indent=1, sort_keys=True`.
    - `counted_calls() -> int` counts statuses from 200 to 399.
- Produces (`scrub.py`):
  - Constants `STANDIN_EMAIL`, `STANDIN_NAME`, `STANDIN_USER_ID`, and
    `standin_company_id(n: int) -> str`.
  - `Scrubber`:
    - `Scrubber.from_owner(sessioninfo: dict, companies: list[dict])` maps each real value
      to its stand-in;
    - `scrub_exchange(ex: Exchange) -> Exchange`;
    - `scrub_text(text: str) -> str`, for message logs.
  - `scrub_exchange` behaviour:
    - drops `Authorization`, `Cookie` and `Set-Cookie` headers;
    - drops the query of a `Location` whose host does not end in `.onshape.com`;
    - replaces every occurrence of a known value in the path, query, request body and
      response body;
    - replaces the body of any exchange whose path contains `/blobelements/` with the
      fixture's text.
  - `find_secrets(text: str, extra_literals: list[str]) -> list[tuple[int, str]]` returns
    (line number, pattern name) pairs. Patterns:
    - email addresses other than `@example.invalid`;
    - JWT-like strings `eyJ[\w-]+\.[\w-]+\.[\w-]+`;
    - `Bearer \S+`;
    - `Basic [A-Za-z0-9+/=]{8,}`;
    - each extra literal and its base64 form.
- The fixture YAML is minimal and valid for `team_config.py`: team number 0, name
  `Test Bed Team`, no printer pairing code.

- [ ] **Step 1: Write the failing tests:**
  - `test_authorization_removed_both_forms`
  - `test_known_values_replaced_in_any_field`: email and user id inside a nested `owner`
    block, an `href`, and a request body. Review Focus 1.
  - `test_same_standin_both_directions`
  - `test_blobelements_body_replaced_by_fixture`: path
    `/api/v13/blobelements/d/abc/w/def/e/ghi`, body with `pairing_code: SECRET123`.
    Expect no `SECRET123` after scrubbing. Review Focus 2.
  - `test_foreign_redirect_query_dropped`
  - `test_find_secrets_reports_line_and_kind`
  - `test_cassette_roundtrip_with_binary_body`
  - `test_fixture_is_tracked`: `git ls-files testbed/fixtures/team-config-fixture.yaml` is
    non-empty. Run it after Step 5's `git add`; before then it is expected to fail.
- [ ] **Step 2: Run** and expect FAIL.
- [ ] **Step 3: Implement** both modules and the fixture.
- [ ] **Step 4: Add** `test_committed_recordings_are_clean`. Walk `testbed/cassettes`,
  `testbed/messages` and `testbed/tests/fixtures`, passing the environment values of
  `ONSHAPE_ACCESS_KEY`, `ONSHAPE_SECRET_KEY` and `ONSHAPE_PASSWORD` as extras when set.
  The failure message lists `file:line kind`.
- [ ] **Step 5: Run** and expect PASS. **Commit** `testbed: cassette format and scrubbing`.

### Task 3: Call ledger and budget

**Files:**
- Create: `testbed/ledger.py`, `testbed/tests/test_ledger.py`

**Interfaces:**
- Consumes: `settings.state_dir()`, `settings.budget_settings()`.
- Produces:
  - `CallLedger(path: Path | None = None)`, defaulting to `state_dir()/ledger.jsonl`. It
    carries `budget`, `cycle_start` (default: today minus one year, i.e. a rolling year) and
    `per_run_cap`.
  - `record_call(scenario: str, method: str, path: str, status: int, kind: str = 'response') -> None`:
    - appends one line `{"t", "scenario", "method", "path", "status", "kind", "counted"}`;
    - `kind` is `'response'` or `'retry'`;
    - `counted` is `200 <= status < 400 and kind == 'response'`;
    - takes a process-wide lock.
  - `counted_in_cycle() -> int`. A bad line raises `LedgerUnreadable` with its line number.
  - `check_budget(estimate: int) -> None`. It raises `BudgetExceeded`, whose message gives
    the counted total, the estimate, the budget and the cap.
  - `raise_if_allowance_exhausted(status: int) -> None`: raises `AllowanceExhausted` on 402.

- [ ] **Step 1: Write the failing tests:**
  - `test_missing_file_counts_zero`
  - `test_only_2xx_3xx_responses_counted`
  - `test_retry_lines_not_counted_but_kept`
  - `test_cycle_boundary_excludes_older_lines`
  - `test_check_refuses_over_budget`
  - `test_check_refuses_over_run_cap`
  - `test_corrupt_line_refuses_naming_line`
  - `test_402_raises`
- [ ] **Step 2: Run** and expect FAIL. **Step 3: Implement.** **Step 4: Run** and expect PASS.
- [ ] **Step 5: Commit** `testbed: call ledger and budget`.

### Task 4: Adapters and the current scenario, installed in the client

**Files:**
- Create: `testbed/adapters.py`, `testbed/tests/test_adapters.py`,
  `testbed/tests/fixtures/cassettes/synthetic-sessioninfo.json`
- Modify: `onshape_integration.py` (`OnshapeClient.__init__`, `from_api_keys`)

**Interfaces:**
- Consumes: `Exchange`, `Cassette`, `Scrubber` (Task 2); `CallLedger` (Task 3).
- Produces (`adapters.py`):
  - **Current scenario**, one per process:
    - `set_current_scenario(name: str | None) -> None` and `current_scenario() -> str | None`,
      guarded by a lock;
    - `ScenarioRecording`: the in-memory buffer of exchanges for the current scenario in
      record mode, plus its scrubber;
    - `begin_recording(name, client) -> None`. It sets the scenario, then fetches
      `/users/sessioninfo` and `/companies` with `client` to build the `Scrubber` (both
      counted).
    - `finish_recording() -> Path`. It scrubs, writes the cassette to `settings.FRESH_DIR`,
      clears the buffer and returns the path.
  - `LedgerRetry(Retry)`: overrides `increment()` to call
    `ledger.record_call(current_scenario(), method, path, status_or_0, kind='retry')`, then
    defers to `super()`. `new()` must keep the ledger reference.
  - `RecordingAdapter(HTTPAdapter)` performs the real `send`. Then it:
    - calls `ledger.raise_if_allowance_exhausted`;
    - records the call (`kind='response'`);
    - appends an `Exchange` to the current recording, reading the body fully so binary
      files are kept.
  - `ReplayAdapter(HTTPAdapter)` answers from
    `Cassette.load(settings.CASSETTE_DIR, current_scenario())`, cached per scenario:
    - `send()` never touches the network. It builds a `requests.Response`, with `.request`,
      `.url`, `.status_code`, `.headers` and `.raw` as a `urllib3.HTTPResponse` over
      `BytesIO`, so that `resolve_redirects` works.
    - Matching: method, host, path, and query and body with
      `VOLATILE_KEYS = {'microversionId', 'timestamp', 'createdAt', 'modifiedAt'}` removed.
      Each exchange is consumed once; when all matches are used up, the last one repeats,
      except for paths containing `/translations/`, which replay strictly in order.
    - A miss gives a 599 with body
      `not in the cassette: <METHOD> <host><path>?<query> (scenario <name>)`.
  - `install_testbed_adapters(session: requests.Session, retry: Retry) -> None`. When on, it
    mounts the mode's adapter for both `https://` and `http://`. In record mode the adapter
    carries `LedgerRetry` built from `retry`'s parameters; in replay mode it carries `retry`
    itself, which is unused.
- Modify `OnshapeClient.__init__`: after the existing mounts, add
  `from testbed.settings import testbed_is_on` and
  `if testbed_is_on(): from testbed.adapters import install_testbed_adapters; install_testbed_adapters(self.session, retry)`.
- Modify `from_api_keys`: in replay mode only, missing keys fall back to the placeholder
  pair `('testbed-replay', 'testbed-replay')`.

- [ ] **Step 1: Write failing tests** (no network; record-mode tests use a local
  `http.server` thread on a free port):
  - `test_off_mode_installs_nothing`
  - `test_record_buffers_exchange_and_writes_scrubbed_on_finish`
  - `test_record_each_redirect_hop` (server answers 307 then 200; expect two exchanges and
    two ledger lines)
  - `test_retry_attempts_reach_ledger` (server answers 503 twice then 200; expect two
    `retry` lines)
  - `test_record_keeps_retry_parameters`
  - `test_402_stops_recording`
  - `test_replay_returns_recorded_body`
  - `test_replay_ignores_volatile_query_keys`
  - `test_unmatched_request_names_method_host_path` (Review Focus 4)
  - `test_exhausted_match_repeats_last` (Review Focus 5)
  - `test_translation_polls_replay_in_order`
  - `test_replay_follows_recorded_redirect`
  - `test_replay_answers_any_host_without_network`
  - `test_from_api_keys_placeholder_only_in_replay`
  - `test_current_scenario_shared_across_threads`
- [ ] **Step 2: Run** and expect FAIL. **Step 3: Implement.**
- [ ] **Step 4: Run** `testbed/tests` and `make test-quick`. Expect PASS, including the
  existing `tests/test_onshape_token_refresh.py`.
- [ ] **Step 5: Commit** `testbed: record and replay adapters with a per-process scenario`.

### Task 5: Scenario definitions, the part-export runner and mesh checks

**Files:**
- Create: `testbed/scenarios/__init__.py`, `testbed/mesh.py`, `testbed/tests/test_scenarios.py`,
  `testbed/tests/test_mesh.py`, `testbed/tests/slice_fixture_box.py`,
  `testbed/tests/fixtures/stl/box_mm.stl`, `box_inch.stl`, `slab_mm.stl`
  (generated by a short script committed as `testbed/tests/fixtures/stl/make_fixtures.py`)

**Interfaces:**
- Produces (`scenarios/__init__.py`):
  - `Step(name: str, instruction: str, action: str | None, select: list[str])`. `action` is
    one of `ask-part`, `ask-two-parts`, `dialog-part`, `dialog-parts`, `close-dialog`,
    `choose-print`, `back`, or `None`.
  - `Scenario(name: str, document: str, panel: bool, steps: list[Step], estimate: int)`
  - `SCENARIOS: dict[str, Scenario]`, holding `panel-load`, `to-print`, `part-select`,
    `multi-select`, `assembly-select` and `part-export`, with the steps of spec 5.7 and 6.
    Estimates: 6, 6, 2, 2, 2, 45.
  - `scenario_is_recorded(name) -> bool`: the cassette exists and, for panel scenarios, the
    message log exists.
  - `run_scenario_api(name: str, client, documents: dict) -> None`. Only `part-export` has
    API actions.
    - For each part it calls
      `export_part_stl(client, doc, part_id, params) -> tuple[bytes, list[str]]` twice: with
      no params, and with `{'units': 'millimeter', 'mode': 'binary'}`.
    - Once: `GET /translations/translationformats`, and one export from `tb-box`'s saved
      version.
  - `export_part_stl` calls `client._make_api_request('GET', path, params=…,
    allow_redirects=False)`. It follows up to three `Location` hops by hand through
    `client.session`, re-attaching auth only when the host ends in `.onshape.com` (Basic
    for API-key clients, Bearer for OAuth). It returns the body and the hop URLs.
    - `_make_api_request` passes `**kwargs` to `session.request`, so `allow_redirects`
      reaches it; check this in the test.
- Produces (`mesh.py`): `mesh_size_mm(stl_bytes: bytes, units: str) -> tuple[float, float, float]`
  sorts the extents, and scales by 25.4 for `'inch'`. It uses `print.slicer.stl_bounds`.
- `test_scenarios.py`, with no browser and no Orca. These checks run against the fixture STLs
  now and against recorded exports when `part-export` is recorded:
  - `tb-box` in mm gives (10, 30, 40) ± 0.1;
  - `tb-inch` in mm gives (12.7, 25.4, 50.8);
  - the default (inch) export of `tb-box` matches once scaled;
  - `tb-oversized`'s largest extent exceeds the printer profile's plate. Read the plate
    through `print.slicer.part_info()['printer']['bed_mm']` at call time. This is a test
    assertion, not a second implementation of the wizard's `fitsBed`.
- `slice_fixture_box.py` (run by `make test`, not `test-quick`, because it needs Orca):
  `slice_stl(box_mm.stl, tmpdir)` succeeds.

- [ ] **Step 1: Write failing tests:**
  - `test_mesh_size_binary_and_ascii`
  - `test_inch_scaling`
  - `test_fixture_dimensions`
  - `test_oversized_exceeds_plate`
  - `test_definitions_reference_known_documents`
  - `test_unrecorded_scenario_reported`
  - `test_export_follows_redirect_and_reattaches_auth_only_for_onshape` (replay adapter
    with a synthetic cassette: 307 to `https://cad.onshape.com/...` keeps auth; 307 to
    `https://example.com/...` drops it)
- [ ] **Step 2: Run** and expect FAIL. **Step 3: Implement**, and add `slice_fixture_box`
  to `make test`: `@uv run python -m unittest testbed.tests.slice_fixture_box`.
- [ ] **Step 4: Run** `make test`. Expect PASS.
- [ ] **Step 5: Commit** `testbed: scenarios, part export runner and mesh checks`.

### Task 6: Flask hooks, development sign-in, the checklist strip and message logs

**Files:**
- Create: `testbed/flask_hooks.py`, `testbed/messages.py`, `testbed/panel/testbed_panel.js`,
  `testbed/tests/test_flask_hooks.py`, `testbed/tests/test_messages.py`,
  `testbed/tests/flask_hooks_app.py` (a helper script the tests run in a subprocess)
- Modify: `onshape_integration.py` (`get_client`, `update_session_tokens`), `frc_cam_gui_app.py`
  (register; `/onshape/status`), `print/templates/print_wizard.html`

**Interfaces:**
- Consumes: Tasks 1, 2, 4, 5.
- Produces (`messages.py`): the message log file `testbed/messages/<scenario>.json`:
  `{"scenario": str, "synthetic": bool, "steps": [{"step": str, "events": [{"dir": "out"|"in", "origin": str, "data": object, "t_ms": int}]}]}`.
  Functions: `load_message_log(name, directory=MESSAGE_DIR)`,
  `save_message_log(log, directory=FRESH_DIR)` (passes every string through
  `Scrubber.scrub_text`), `message_log_segment(log, step)`.
- Produces (`flask_hooks.py`): `register_testbed_routes(app) -> None`. It is called from
  `frc_cam_gui_app.py` only `if testbed_is_on()`, and adds:
  - `GET /testbed/sign-in`, **replay mode only**. It sets `session['testbed_apikey'] = True`
    and `session['user_email'] = STANDIN_EMAIL`, then returns 204.
  - `GET /testbed/scenarios`: names, steps and instructions from `SCENARIOS`.
  - `POST /testbed/scenario` `{"name"}`. In record mode it calls `begin_recording(name,
    client)`, with the session's client; in replay mode it calls
    `set_current_scenario(name)`.
  - `POST /testbed/messages` `{"step", "events"}` appends to the current message log.
    `POST /testbed/done` saves the message log and calls `finish_recording()` in record mode.
  - `GET /testbed/panel.js` serves the script.
  - A context processor injecting `testbed_mode`. Only `print_wizard.html` uses it:
    `{% if testbed_mode %}<script src="/testbed/panel.js" data-mode="{{ testbed_mode }}"></script>{% endif %}`
    after its other scripts.
- Modify `get_client`: at the top, `if testbed_is_on() and testbed_mode() == 'replay' and
  session.get('testbed_apikey'):` return the `g`-cached client, or
  `OnshapeClient.from_api_keys()` registered via `_register`.
- Modify `update_session_tokens`: return at once when `client.auth_mode == 'apikey'`.
- Modify `/onshape/status`: connected when `client.access_token or client.auth_mode ==
  'apikey'`.
- `testbed_panel.js` (ES5, matching the repo):
  - Read the Onshape context from the print page's `window.PenguinCAM.returnUrl` query
    (`documentId`, `workspaceId`, `elementId`, `versionId`, `microversionId`, `server`).
  - Post `applicationInit` to `window.parent` with `targetOrigin` set to the context's
    `server`.
  - Draw a fixed strip at the top: a scenario picker filled from `/testbed/scenarios`, the
    current step's instruction, buttons for the step's `action`, `Next step`, `Done`.
  - Message shapes:
    - `ask-part`: `requestSelection` with `entityTypeSpecifier: ['BODY']`,
      `requiredSelectionCount: 1`, `messageId: 'testbed-<n>'`;
    - `ask-two-parts`: the same with a count of 2;
    - `dialog-part`: `openSelectItemDialog` with `selectParts: true`;
    - `dialog-parts`: adds `selectMultiple: true`;
    - `close-dialog`: `closeSelectItemDialog`.

    All of them carry `documentId`, `workspaceId` and `elementId`.
  - Record every message the strip sends. Record every received message with a `message`
    listener added at script load. Post the events at `Next step` and `Done`.
- Test approach: the app cannot be reloaded (Flask refuses to re-add blueprint rules).
  - Hook-level tests build a minimal `Flask(__name__)` with `register_testbed_routes`
    applied.
  - Full-app tests run `testbed/tests/flask_hooks_app.py` in a subprocess with
    `PENGUINCAM_TESTBED=replay` and parse its JSON output.

- [ ] **Step 1: Write failing tests:**
  - `test_sign_in_sets_flag_and_standin_user` (minimal app)
  - `test_sign_in_absent_in_record_mode`
  - `test_get_client_returns_apikey_client_after_sign_in` (subprocess)
  - `test_update_session_tokens_noop_for_apikey` (subprocess)
  - `test_status_reports_apikey_client_connected` (subprocess, synthetic cassette)
  - `test_print_page_includes_script_when_on_and_cnc_page_does_not` (subprocess)
  - `test_flag_cookie_ignored_when_off` (subprocess without the variable: a forged
    `testbed_apikey` session gives `get_client() is None`, and `/testbed/sign-in` is 404)
  - `test_message_log_roundtrip_and_segment`
  - `test_saved_message_log_is_scrubbed`
  - `test_scenario_route_sets_current_scenario`
- [ ] **Step 2: Run** and expect FAIL. **Step 3: Implement.**
- [ ] **Step 4: Run** `testbed/tests` and `make test-quick`. Expect PASS.
- [ ] **Step 5: Commit** `testbed: Flask hooks, development sign-in, checklist strip, message logs`.

### Task 7: Fake Onshape host and the browser harness

**Files:**
- Create: `testbed/host/index.html`, `testbed/host/host.js`, `testbed/browser.py`,
  `testbed/requirements.txt`, `testbed/tests/browser_host.py`,
  `testbed/tests/fixtures/messages/synthetic-part-select.json`,
  `testbed/tests/fixtures/cassettes/synthetic-panel.json`
- Modify: `Makefile` (`testbed-replay`), `.gitignore`, `.dockerignore`

**Interfaces:**
- Consumes: Tasks 4–6.
- Produces (`browser.py`):
  - `ReplayDevServer(port=REPLAY_PORT, cassette_dir=None, message_dir=None)`, a context
    manager. It starts `uv run python frc_cam_gui_app.py` with
    `start_new_session=True` and environment:
    - `PORT=<port>`, `PENGUINCAM_TESTBED=replay`, `EMBED_COOKIES=1`;
    - `TESTBED_CASSETTE_DIR` and `TESTBED_MESSAGE_DIR` when given, so self-tests use the
      synthetic fixtures (read through `settings`).

    Output goes to `settings.state_dir()/logs/replay-devserver.log`. It waits for a 200 on
    `/`, then `os.killpg` on exit.
  - `launch_test_browser(headed=False, executable=None) -> (playwright, browser, context)`:
    - the executable is `TESTBED_CHROMIUM` or `/usr/bin/chromium`;
    - `context.grant_permissions(['local-network-access'], origin=FAKE_HOST_ORIGIN)`, and on
      error the CDP fallback from Global Constraints (`browserContextId` from
      `Target.getTargetInfo` of a page session);
    - `context.route(FAKE_HOST_ORIGIN + '/**', serve_fake_host)`.
  - `serve_fake_host(route)` serves:
    - `host/index.html` for `/documents/**`;
    - `host/host.js`;
    - `/_testbed/messages/<scenario>.json` from the message directory.
  - `host_url(document: dict, scenario: str, port=REPLAY_PORT, version_id=None) -> str`
  - `sign_in_for_replay(context, port) -> None` visits `http://localhost:<port>/testbed/sign-in`
    and selects the scenario through `POST /testbed/scenario`.
- `host.js`:
  - It builds the iframe:
    `http://localhost:<port>/onshape-panel?documentId=…&workspaceId=…&elementId=…&server=https%3A%2F%2Fcad-testbed.onshape.com&theme=light`.
    A version adds `versionId=…`, with `workspaceId={$workspaceId}` raw.
  - It logs every message from the frame to `window.__testbed.log`.
  - When a message arrives, it finds, in the current step's segment, the next `out` event
    with the same `messageName` and the same key set. It then posts the `in` events that
    follow that event, up to the next `out` event, to the frame with
    `targetOrigin='http://localhost:<port>'`. If the incoming message has a `messageId`, the
    reply's `messageId` is replaced with it.
  - It exposes `window.__testbed = {log, setStep(name), selectPart(name), selectParts(names),
    deselect(), reloadPanel()}`. `selectPart(name)` posts the `in` events of step
    `select part <name>`.
- `testbed/requirements.txt`: `playwright==1.63.0`.
- `Makefile` `testbed-replay`:
  - `@uv run python -c "import playwright" >/dev/null 2>&1 || uv pip install -r testbed/requirements.txt`;
  - then `PLAYWRIGHT_BROWSERS_PATH=0`-free (browsers are never downloaded) `xvfb-run -a uv run python -m unittest discover -s testbed/tests -p 'browser_*.py' -t . -v`.
- `.gitignore` and `.dockerignore`: `testbed/.fresh/`.

- [ ] **Step 1: Write failing browser tests** (`browser_host.py`, using the synthetic
  fixtures):
  - `test_host_has_onshape_origin`
  - `test_panel_frames_and_sends_application_init`
  - `test_session_cookie_survives_reload` (after sign-in, `authenticated` is true inside the
    frame after `reloadPanel()`)
  - `test_print_page_strip_appears_and_reply_carries_live_message_id` (navigate the frame to
    `/print?source=onshape&return=<panel url>`, press `Ask for a part`, then
    `selectPart('Cylinder')`; the strip's recorded `in` event carries `testbed-1`)
  - `test_host_url_keeps_placeholder_workspace` (Review Focus 3)
  - `test_unrouted_request_to_fake_host_fails_safe`
- [ ] **Step 2: Run** `make testbed-replay` and expect FAIL. **Step 3: Implement.**
- [ ] **Step 4: Run** `make testbed-replay` and expect PASS. A permission or origin failure
  is the spec's "cannot frame the panel" row: stop and report.
- [ ] **Step 5: Commit** `testbed: fake Onshape host and browser harness`.

### Task 8: Browser scenarios

**Files:**
- Create: `testbed/tests/browser_scenarios.py`

**Interfaces:**
- Consumes: Tasks 5 and 7.
- For each scenario with `panel=True`: skip with `needs a recording` when
  `scenario_is_recorded()` is false. Otherwise start the replay development server, sign
  in, drive the host through each step (`choose-print` clicks the 3D Printing radio inside
  the frame; selection steps call `selectPart` or `selectParts`), and assert that the
  strip's recorded events equal the message log's events in names, keys and value types.

- [ ] **Step 1: Write** the module, with a self-test that runs `part-select` against the
  synthetic fixtures through `TESTBED_MESSAGE_DIR`.
- [ ] **Step 2: Run** `make testbed-replay`. Expect PASS for the self-test, and real
  scenarios skipped as `needs a recording`.
- [ ] **Step 3: Commit** `testbed: browser scenarios`.

### Task 9: Drift report and accept

**Files:**
- Create: `testbed/drift.py`, `testbed/tests/test_drift.py`

**Interfaces:**
- Produces:
  - `json_shape(value) -> object`: dicts keep their keys and recurse; lists become the shape
    of their first element; scalars become type names; `VOLATILE_KEYS` plus `id` compare by
    type.
  - `Difference(scenario, index, kind, detail)`. `kind` is `'request'` (PenguinCAM changed)
    or `'response'` (Onshape changed).
  - `diff_cassettes(stored, fresh) -> list[Difference]`. Exchanges to
    `/users/sessioninfo` that appear in only one recording are ignored, because they come
    from sign-in. Meshes compare by bounding box (0.01 mm) and triangle count.
  - `diff_message_logs(stored, fresh) -> list[Difference]`
  - `write_drift_report(diffs, path) -> None`: Markdown, `clean` when there is nothing.
  - `accept_fresh_recording(scenario) -> list[Path]`: moves files from `FRESH_DIR` into the
    committed directories.

- [ ] **Step 1: Write failing tests:**
  - `test_identical_is_clean`
  - `test_changed_request_path_is_request_kind`
  - `test_new_response_key_is_response_kind`
  - `test_volatile_ids_ignored`
  - `test_sign_in_only_calls_ignored`
  - `test_mesh_bbox_change_reported`
  - `test_accept_moves_fresh_into_place`
- [ ] **Step 2–4:** Run them (expect FAIL), implement, then run them again (expect PASS).
- [ ] **Step 5: Commit** `testbed: drift report and accept`.

### Task 10: Command line

**Files:**
- Create: `testbed/__main__.py`, `testbed/tests/test_cli.py`
- Modify: `Makefile` (`testbed-record`)

**Interfaces:**
- Produces `uv run python -m testbed <command>`:
  - `build-docs [--rebuild NAME]` (Task 11)
  - `record [SCENARIO…]`: the live API check. It needs `ONSHAPE_ACCESS_KEY` and
    `ONSHAPE_SECRET_KEY`. It checks the budget, runs `run_scenario_api` inside
    `begin_recording`/`finish_recording`, then writes the drift report. It ends by printing
    `counted calls: N, remaining budget: M`.
  - `record --ui [SCENARIO…]` (Task 12)
  - `drift`, `accept SCENARIO…`
  - `ledger`: the cycle total, budget, remaining, and the last ten lines.
- Exit codes: 2 for `missing environment variable: NAME`, 3 for a stop by an Onshape check,
  4 for `BudgetExceeded`, `LedgerUnreadable` or `AllowanceExhausted`.

- [ ] **Step 1: Write failing tests:**
  - `test_record_without_keys_names_variable`
  - `test_record_refuses_over_budget`
  - `test_record_stops_on_402` (replay adapter with a synthetic 402 cassette and the
    adapter forced to record mode)
  - `test_ledger_command_prints_totals`
  - `test_accept_unknown_scenario_errors`
- [ ] **Step 2–4:** Run them (expect FAIL), implement, then run them again (expect PASS).
- [ ] **Step 5: Commit** `testbed: command line`.

### Task 11: Test documents builder

**Files:**
- Create: `testbed/documents.py`, `testbed/tests/test_documents.py`,
  `testbed/tests/fixtures/cassettes/synthetic-build-docs.json`

**Interfaces:**
- Produces:
  - `DocumentSpec(name, kind, features, instances=None)`.
  - Feature helpers produce `BTFeatureDefinitionCall-1406` bodies:
    - `sketch_rectangle_feature(plane, width_m, height_m)`;
    - `sketch_circle_feature(plane, radius_m)`;
    - `extrude_feature(sketch_feature_id, depth_expression)`;
    - `cube_feature(side_expression)`, where Onshape's `cube` suffices.

    Sketch geometry is in metres; only quantity parameters carry expressions such as
    `"0.5 in"`.
  - `TEST_DOCUMENTS: list[DocumentSpec]`: the six documents of spec 5.1.
  - `build_test_documents(client, folder_id: str, rebuild: str | None = None) -> dict`. It
    makes these calls:
    - list the folder with `GET /documents?parentId=<folder>`;
    - for each missing document, `POST /documents` with `{"name", "description",
      "parentId"}`;
    - `GET /documents/d/{did}/w/{wid}/elements` to find the Part Studio;
    - add the features with `POST /partstudios/d/{did}/w/{wid}/e/{eid}/features`;
    - for `tb-assembly`, `POST /assemblies/d/{did}/w/{wid}` and
      `POST /assemblies/.../instances` with `tb-box`'s version id;
    - save a version of `tb-box` with `POST /documents/d/{did}/versions`;
    - list parts with `GET /parts/d/{did}/w/{wid}/e/{eid}`.

    It writes `testbed/documents.json` as
    `{name: {did, wid, eid, version_id?, parts: {partName: partId}}}`.
  - `assert_test_document(document_json, folder_listing) -> None`. It raises
    `NotATestDocument` unless all three rules hold. It is called before every write and
    delete.
  - The folder id comes from `TESTBED_FOLDER_ID` (read through `settings`). When it is
    missing, the error explains that the id is the last segment of the folder's URL.

- [ ] **Step 1: Write failing tests** (replay adapter, synthetic cassette):
  - `test_build_creates_only_missing_documents`
  - `test_write_refused_for_foreign_document` (each rule broken in turn)
  - `test_rebuild_deletes_only_named_test_document`
  - `test_documents_json_written`
  - `test_sketch_geometry_in_metres_and_depth_as_expression`
  - `test_version_saved_for_tb_box`
- [ ] **Step 2–4:** Run them (expect FAIL), implement, then run them again (expect PASS).
- [ ] **Step 5: Commit** `testbed: test documents builder`.

### Task 12: Real Chrome and the automated Onshape UI run, up to the sign-in page

**Files:**
- Create: `testbed/scripts/install-chrome.sh`, `testbed/ui_run.py`, `testbed/tests/test_ui_run.py`,
  `testbed/tests/browser_chrome.py`, `testbed/tests/fixtures/html/*.html`

**Interfaces:**
- `install-chrome.sh`:
  - Downloads `https://dl.google.com/linux/direct/google-chrome-stable_current_arm64.deb` to
    the state directory. A non-200 answer stops it with that message.
  - Runs `dpkg-deb -x` into `~/.local/opt/google-chrome/` and writes `VERSION`.
  - Runs `ldd` on the binary and prints the missing libraries.
  - Exits 0 when the binary starts with `--headless=new --no-sandbox --version`.
- `ui_run.py`:
  - `chrome_executable() -> str | None`
  - `run_onshape_ui(scenarios, headed=True) -> Path`. It requires `ONSHAPE_USERNAME`,
    `ONSHAPE_PASSWORD`, `ONSHAPE_CLIENT_ID` and `ONSHAPE_CLIENT_SECRET`, and refuses a `VKDK`
    client id.
  - `launch_persistent_chrome()`: the profile is
    `settings.state_dir()/chrome-profile`, the executable is Chrome or else
    `/usr/bin/chromium` (logged), with `--no-sandbox`.
  - `detect_onshape_bot_check(page) -> str | None`. It looks for:
    - iframes whose `src` contains `captcha`, `recaptcha`, `hcaptcha` or
      `challenges.cloudflare.com`;
    - text matching `/verify (that )?you('re| are) (a )?human|unusual activity|security check|verify your email/i`.
  - `sign_in_to_onshape(page)`: fills the email and password fields and submits. The password
    is never logged.
  - `SELECTORS: dict[str, str]`, one table of Onshape page selectors, so that a UI change is a
    one-line fix.
  - The panel steps follow spec 5.9. A bot check means a screenshot to
    `state_dir()/screenshots/`, then exit 3 with `stopped by an Onshape check: <reason>`.
- `browser_chrome.py`:
  - `test_chrome_or_fallback_starts_under_xvfb`
  - `test_onshape_sign_in_page_loads_without_bot_check`. It runs only with
    `TESTBED_ONLINE=1`. It opens `https://cad.onshape.com/signin` and waits for the email
    field. **It never fills or submits it.**

- [ ] **Step 1: Write failing tests** (`test_ui_run.py`, no browser):
  - `test_missing_credentials_named` (each of the four)
  - `test_production_client_id_refused`
  - `test_detect_bot_check_patterns` (HTML fixtures, both positive and negative)
  - `test_password_never_logged` (a stub page)
- [ ] **Step 2: Run** and expect FAIL. **Step 3: Implement.**
- [ ] **Step 4: Run** `bash testbed/scripts/install-chrome.sh`, then
  `TESTBED_ONLINE=1 xvfb-run -a uv run python -m unittest testbed.tests.browser_chrome -v`.
  Record whether Chrome or the Chromium fallback ran.
- [ ] **Step 5: Commit** `testbed: real Chrome and the automated Onshape UI run up to sign-in`.

### Task 13: Documentation

- [ ] **Step 1:** Write `docs/ONSHAPE_TEST_BED.md`, neutral and for any developer. It covers:
  - the terms;
  - switching the test bed on;
  - the two Makefile targets and the CLI;
  - the environment variables;
  - the budget and the ledger;
  - how to add a scenario;
  - why the fake host needs an `onshape.com` origin and the local network permission;
  - that `/usr/bin/chromium` can be overridden with `TESTBED_CHROMIUM`.

  It never mentions the notes repo, the owner's Mac or the container.
- [ ] **Step 2:** Update `CLAUDE.md`:
  - add `testbed/` to the key files;
  - add a doc-table row linking [ONSHAPE_TEST_BED.md](docs/ONSHAPE_TEST_BED.md);
  - add the rule: "`make testbed-replay` must pass before a change to the print path's
    Onshape code is done".
- [ ] **Step 3:** In the notes repo, write `guides/ONSHAPE_CHECKPOINT.md`, the owner's steps
  from spec 6.
- [ ] **Step 4: Commit** both.

### Task 14 (needs Onshape credentials): first live recordings

Blocked on the owner: `ONSHAPE_ACCESS_KEY`, `ONSHAPE_SECRET_KEY`, `ONSHAPE_USERNAME`,
`ONSHAPE_PASSWORD` and `TESTBED_FOLDER_ID`.

- [ ] **Step 1:** `uv run python -m testbed build-docs`. Expect seven `tb-` documents and
  about 30–40 counted calls. Confirm that `parentId` placed them in the folder.
- [ ] **Step 2:** `uv run python -m testbed record part-export`. Log where the 307 points.
  Then `accept part-export`.
- [ ] **Step 3:** `uv run python -m testbed record --ui`. On a bot check: stop, report, and
  ask for an Onshape checkpoint. Then accept.
- [ ] **Step 4:** Run the Verification section in full.

---

## Verification

| # | Check (spec guarantee) | Command | Passes when |
|---|---|---|---|
| V1 | The repo's gate, including the fixture slice (5.7) | `make test` | exit 0 |
| V2 | Unit tests run with every change (8) | `make test-quick` | testbed discovery runs, exit 0 |
| V3 | Inert when off; refuses when deployed; record mode refuses without the dev app (5.6) | `uv run python -m unittest testbed.tests.test_settings testbed.tests.test_flask_hooks testbed.tests.test_adapters -v` | the named guard tests, `test_flag_cookie_ignored_when_off`, `test_print_page_includes_script_when_on_and_cnc_page_does_not` and `test_off_mode_installs_nothing` pass |
| V4 | No secret in committed recordings; `/blobelements/` scrubbed (5.2) | `uv run python -m unittest testbed.tests.test_scrub -v` | pass |
| V5 | Replay never falls through; every hop and retry ledgered (5.3, 7) | `uv run python -m unittest testbed.tests.test_adapters -v` | pass |
| V6 | Fake host passes origin, CSP and local network checks; cookie survives (0.3, 5.4) | `make testbed-replay` | `browser_host` passes |
| V7 | Budget enforced; 402 stops a command (7) | `uv run python -m unittest testbed.tests.test_ledger testbed.tests.test_cli -v` | pass |
| V8 | Sign-in only in replay (5.5) | `uv run python -m unittest testbed.tests.test_flask_hooks -v` | `test_sign_in_absent_in_record_mode` passes |
| V9 | Real Chrome (or fallback) starts; Onshape sign-in page loads with no bot check (5.9) | `TESTBED_ONLINE=1 xvfb-run -a uv run python -m unittest testbed.tests.browser_chrome -v` | pass, with the browser used recorded |
| V10 | Test documents built, writes confined (5.1) | `uv run python -m testbed build-docs` *(credentials)* | seven documents; counted calls reported |
| V11 | Live API check reports counted calls (11) | `uv run python -m testbed record` *(credentials)* | the last line has the counted calls and remaining budget |
| V12 | UI run records every panel scenario; replay passes with no live call; drift clean (11) | `uv run python -m testbed record --ui`; `… accept …`; `make testbed-replay`; `uv run python -m testbed drift` *(credentials)* | no `needs a recording` skips; the report says `clean` |

V1–V9 can pass in this session. V10–V12 complete the sub-project once credentials arrive.

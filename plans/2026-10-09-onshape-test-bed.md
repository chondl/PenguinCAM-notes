# Onshape Test Bed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Onshape test bed: record Onshape traffic for the print path once, replay it
locally for everyday development, and report drift when real Onshape changes.

**Architecture:** A `testbed/` package in PenguinCAM. It is switched on by `PENGUINCAM_TESTBED`
and inert otherwise. Transport adapters on `OnshapeClient.session` record or replay API traffic.
A Playwright-served fake Onshape host at `https://cad-testbed.onshape.com` plays back panel
messages. Real Onshape is reached unattended through API keys and through an automated UI run
in real Chrome.

**Tech Stack:** Python 3.12, Flask, `requests`/urllib3 adapters, Python Playwright (pinned),
Chromium 151 in the container, Google Chrome for ARM64 Linux, `unittest` (the repo's runner).

**Spec:** [2026-10-09-onshape-test-bed-design.md](../specs/2026-10-09-onshape-test-bed-design.md)

**Code tree:** `/repos/popcornpenguins/PenguinCAM/.worktrees/onshape-test-bed`, branch
`feature/onshape-test-bed`. It is cut from `feature/printer-relay` and already has `origin/main`
merged in, plus a fix that puts Orca back at `tools/orca`. Every path below is relative to that
tree.

## Global Constraints

- The test bed is on only when `PENGUINCAM_TESTBED` is `replay` or `record`. With it unset,
  no test bed route, adapter, template flag or script is loaded (spec 5.6).
- `frc_cam_gui_app` refuses to import with `PENGUINCAM_TESTBED` set when `FLASK_ENV=production`,
  `RAILWAY_ENVIRONMENT` or `VERCEL` is set (spec 5.6).
- No secret reaches disk or a log: API keys, OAuth tokens, `ONSHAPE_PASSWORD`, cookies,
  `Authorization` in bearer or Basic form (spec 5.2). Read credentials from the environment
  only; a missing one fails naming the variable.
- Never call real Onshape from a test. `make test-quick` and `make testbed-replay` make zero
  live calls.
- In replay mode an unmatched request gets HTTP **599**, with a body that starts
  `not in the cassette: `, and never falls through to real Onshape (spec 5.3).
- The fake Onshape API listens on port **6239** and serves the `/api/v13` prefix. Record mode
  uses the development server on **6238**, because the dev app's OAuth redirect is pinned
  there. Replay runs start their own development server on **6240**, so a server already on
  6238 is untouched. This is a plan decision; spec 5.4 says 6238.
- The fake host origin is exactly `https://cad-testbed.onshape.com`, with no port. It gets the
  Chrome permission `local-network-access`; on a Chrome that names it differently, it gets
  `loopback-network` and `local-network` (spec 0.3, 5.4).
- Default budget **250** counted calls per cycle; per-run cap **150** (spec 7).
- Test documents: the name starts with `tb-`, the description is exactly
  `created by PenguinCAM test bed`, and the document is listed in the test folder (spec 5.1).
- The development sign-in user is `testbed@example.invalid` (spec 5.5).
- The CNC path (`static/source_onshape.js`, DXF export) is not changed (spec 2).
- The repo's `CLAUDE.md` forbids `pyproject.toml`. Dependencies go in requirements files, and
  Playwright goes only in `testbed/requirements.txt`, never in the Docker image.
- Do not run `rm` on paths built from variables; use literal paths, `"${VAR:?}"`, or
  `shutil.rmtree` on a path that was checked first.
- Work in place; never commit to `main`.

## Review Focus

1. **A secret in a response shape the scrubber has not seen.** Example: the owner's email
   inside `documents[].owner` or `createdBy` of a search result. Expected: it is replaced
   anyway, because scrubbing replaces the owner's known values wherever they occur, not
   only in known fields. Test in Task 2:
   `test_known_values_replaced_in_any_field`.
2. **A panel opened on a version, where `workspaceId` is the literal `{$workspaceId}`.**
   Expected: the fake host passes it through raw, as Onshape does, and request matching
   does not choke on braces. Test in Task 7: `test_host_url_keeps_placeholder_workspace`.
3. **Stale cassettes after a code change.** Expected: the scenario fails with a 599 message
   naming the method and path, not a confusing exception elsewhere. Test in Task 3:
   `test_unmatched_request_names_method_and_path`.
4. **The ledger file is missing, empty, or has a bad line.** Expected: missing or empty
   counts as zero. A bad line makes record mode refuse to start, saying which line, rather
   than undercount silently. Test in Task 4: `test_corrupt_ledger_line_refuses`.
5. **The panel sends a different `messageId` from the one recorded.** Expected: the fake
   host answers with the recorded reply rewritten to the live `messageId`. Test in Task 7:
   `test_reply_carries_live_message_id`.

---

## File structure

```
testbed/
  __init__.py        settings: mode(), is_on(), assert_not_deployed(), paths
  __main__.py        CLI (Task 10)
  scrub.py           Scrubber (Task 2)
  cassette.py        Cassette file format (Task 2)
  adapters.py        RecordingAdapter, ReplayAdapter, install_adapters(session) (Task 3)
  ledger.py          Ledger, BudgetExceeded (Task 4)
  fake_api.py        fake Onshape API server (Task 5)
  flask_hooks.py     dev sign-in route, message log route, template flag (Task 6)
  messages.py        message log format (Task 6)
  panel/testbed_panel.js   checklist strip + message copying (Task 6)
  host/index.html, host/host.js   fake Onshape host (Task 7)
  browser.py         Playwright launch, routing, permission, dev server process (Task 7)
  scenarios/__init__.py, scenarios/*.py   scenario definitions (Task 8)
  mesh.py            exported mesh checks (Task 8)
  drift.py           drift report (Task 9)
  documents.py       test documents builder (Task 11)
  ui_run.py          automated Onshape UI run (Task 12)
  scripts/install-chrome.sh  real Chrome, unpacked without root (Task 12)
  fixtures/PenguinCAM-config.yaml
  cassettes/  messages/      committed recordings (empty until the first live run)
  requirements.txt   playwright==1.55.0 (pinned; development only)
  tests/             unittest tests; tests/fixtures/ holds SYNTHETIC recordings for self-tests only
```

Modified outside `testbed/`: `onshape_integration.py`, `frc_cam_gui_app.py`, `print/routes.py`,
`templates/wizard.html`, `print/templates/print_wizard.html`, `Makefile`, `.gitignore`,
`CLAUDE.md`, plus the new guide `docs/ONSHAPE_TEST_BED.md`.

Pinning note: check that `playwright==1.55.0` installs on aarch64. If it does not, pin the
nearest release that does, and record the version in `testbed/requirements.txt`. Browsers
are never downloaded: replay uses `/usr/bin/chromium` (override with
`TESTBED_CHROMIUM`), and the UI run uses the Chrome from Task 12.

---

### Task 1: Switch, guard and settings

**Files:**
- Create: `testbed/__init__.py`, `testbed/tests/__init__.py`, `testbed/tests/test_settings.py`
- Modify: `frc_cam_gui_app.py` (top of module, after imports), `Makefile` (test-quick discovery)

**Interfaces:**
- Produces (`testbed/__init__.py`):
  - `mode() -> str | None`: `'replay'`, `'record'` or `None`. Read once from
    `PENGUINCAM_TESTBED`; any other value raises `ValueError` naming the variable.
  - `is_on() -> bool`.
  - `assert_not_deployed(environ=os.environ) -> None`: raises `RuntimeError` with
    `"PENGUINCAM_TESTBED must not be set on a deployed server"` when the test bed is on and
    any of `FLASK_ENV=production`, `RAILWAY_ENVIRONMENT` or `VERCEL` is present.
  - `TESTBED_DIR: Path`, `CASSETTE_DIR`, `MESSAGE_DIR`, `FIXTURE_DIR`.
  - `ledger_path() -> Path`: `$XDG_STATE_HOME/penguincam-testbed/ledger.jsonl`, defaulting to
    `~/.local/state/...`.

- [ ] **Step 1: Write the failing tests** in `test_settings.py`:
  - `test_off_by_default`: no variable → `mode() is None`, `is_on()` is False.
  - `test_bad_value_raises`: `PENGUINCAM_TESTBED=yes` → `ValueError` whose message contains
    `PENGUINCAM_TESTBED`.
  - `test_refuses_each_deployed_signal`: parametrised over the three signals → `RuntimeError`.
  - `test_import_refuses_when_deployed`: start a subprocess with
    `PENGUINCAM_TESTBED=replay RAILWAY_ENVIRONMENT=x` running
    `uv run python -c "import frc_cam_gui_app"`. Expect a non-zero exit and the message on
    stderr.
  - `test_app_has_no_testbed_routes_when_off`: import the app with the variable unset; no URL
    rule starts with `/testbed`.
  Cache-reset helper: `mode()` caches its value, so tests call `testbed._reset_for_tests()`.
- [ ] **Step 2: Run** `uv run python -m unittest discover -s testbed/tests -t . -v`. Expect
  FAIL (no module).
- [ ] **Step 3: Implement** `testbed/__init__.py`. Then, in `frc_cam_gui_app.py`, call
  `testbed.assert_not_deployed()` right after the imports, so it runs at import under
  gunicorn too.
- [ ] **Step 4: Add discovery** to `Makefile` `test-quick`: a line
  `@uv run python -m unittest discover -s testbed/tests -t . --buffer` after the print unit
  tests, with an echo heading like its neighbours. Add `testbed-replay testbed-record` to
  `.PHONY`.
- [ ] **Step 5: Run** the tests again and `make test-quick`. Expect PASS.
- [ ] **Step 6: Commit** `testbed: switch, deployed-server guard and settings`.

### Task 2: Cassettes and scrubbing

**Files:**
- Create: `testbed/scrub.py`, `testbed/cassette.py`, `testbed/fixtures/PenguinCAM-config.yaml`,
  `testbed/tests/test_scrub.py`, `testbed/tests/test_cassette.py`

**Interfaces:**
- Produces (`cassette.py`):
  - `Exchange` dataclass: `method: str`, `path: str` (path after the API base, for example
    `/parts/d/…/stl`), `query: dict[str, list[str]]`, `request_body: str | None`,
    `status: int`, `headers: dict[str, str]` (only `X-Rate-Limit-Remaining`, `Location`,
    `Content-Type`), `body_text: str | None`, `body_file: str | None` (a sibling file name
    for binary bodies), `host: str` (`cad.onshape.com` or the redirect host).
  - `Cassette(name: str, exchanges: list[Exchange])` with `save(dir: Path)` and
    `load(dir: Path, name: str)`. The file is `<dir>/<name>.json` and binary bodies sit in
    `<dir>/<name>/NNN.bin`. JSON uses `indent=1` and sorted keys, so diffs stay readable.
- Produces (`scrub.py`):
  - `Scrubber(known: dict[str, str])`, where `known` maps each real value (owner name, email,
    user id, company ids) to its stand-in. Built by `Scrubber.from_sessioninfo(json)` plus
    `add_company(id)`.
  - `scrub_exchange(ex: Exchange) -> Exchange`. It removes `Authorization` and
    `Cookie`/`Set-Cookie`, drops the query of a `Location` whose host is not
    `cad.onshape.com`, replaces every occurrence of a known value in the path, query, request
    body and response body, and replaces any response body whose request path ends in
    `PenguinCAM-config.yaml` content with the fixture file's text.
  - `find_secrets(text: str, extra: list[str]) -> list[str]`: returns the patterns found.
    Patterns: email addresses (except `@example.invalid`), JWT-like `eyJ…\.…\.…`,
    `Bearer `, `Basic ` followed by base64, and each `extra` literal along with its base64
    form.
- Stand-ins: name `Test Bed Owner`, email `testbed@example.invalid`, user id
  `000000000000000000000001`, companies `0000000000000000000000c1`, `…c2` in order seen.

- [ ] **Step 1: Write failing tests**:
  - `test_authorization_removed_both_forms`
  - `test_known_values_replaced_in_any_field`: the email and the user id inside a nested
    `owner` block, inside an `href`, and inside a request body → stand-ins. This is Review
    Focus 1.
  - `test_same_stand_in_both_directions`: a company id in a request body and in a response
    → the same stand-in.
  - `test_config_yaml_replaced_by_fixture`
  - `test_foreign_redirect_query_dropped`
  - `test_find_secrets_catches_key_and_base64`
  - `test_cassette_roundtrip_with_binary_body`
- [ ] **Step 2: Run** them and expect FAIL.
- [ ] **Step 3: Implement** both modules. The fixture YAML is a minimal valid team config
  that `team_config.py` parses: team number 0, name `Test Bed Team`, no pairing code.
- [ ] **Step 4: Add `test_committed_recordings_are_clean`**: walk `testbed/cassettes`,
  `testbed/messages` and `testbed/tests/fixtures`, and assert `find_secrets` finds nothing.
  Also include `os.environ` values of `ONSHAPE_ACCESS_KEY`, `ONSHAPE_SECRET_KEY` and
  `ONSHAPE_PASSWORD` as extras when they are set.
- [ ] **Step 5: Run** the tests and expect PASS.
- [ ] **Step 6: Commit** `testbed: cassette format and scrubbing`.

### Task 3: Recording and replay adapters, installed in the client

**Files:**
- Create: `testbed/adapters.py`, `testbed/tests/test_adapters.py`,
  `testbed/tests/fixtures/cassettes/synthetic-sessioninfo.json` (hand-written, marked
  `"synthetic": true`)
- Modify: `onshape_integration.py` (`OnshapeClient.__init__`, `API_BASE` and
  `from_api_keys`)

**Interfaces:**
- Consumes: `Exchange`, `Cassette`, `Scrubber` (Task 2); `Ledger.record(...)` (Task 4).
  Until Task 4 lands, use a no-op stand-in with the same signature.
- Produces (`adapters.py`):
  - `RecordingAdapter(HTTPAdapter)`: built with `(max_retries, cassette_name, scrubber,
    ledger)`. `send()` performs the real request, appends the scrubbed `Exchange` to the
    active cassette, and calls `ledger.record(scenario, method, path, status)`.
  - `ReplayAdapter(HTTPAdapter)`: built with `(cassette: Cassette)`. `send()` matches on
    method, path, and query and body with volatile keys removed (`VOLATILE_KEYS =
    {'microversionId', 'timestamp', 'createdAt', 'modifiedAt'}`). It returns the recorded
    response; an exchange can be consumed once, and a translation-status path repeats in
    recorded order. Unmatched requests get status 599 with body
    `not in the cassette: <METHOD> <path>?<query>`.
  - `active_scenario`: a context manager, `with active_scenario('part-export'):`, that sets
    the cassette name for both adapters (thread-local).
  - `install_adapters(session: requests.Session, retry: Retry) -> None`: mounts the right
    adapter for `testbed.mode()` on `https://` and `http://`; a no-op when the test bed is off.
- Modify `OnshapeClient.__init__`: after the existing mount, call
  `testbed.adapters.install_adapters(self.session, retry)` inside `if testbed.is_on():`, with
  the import inside the branch so the off path imports nothing. When the test bed is on and
  `ONSHAPE_API_BASE` is set, set `self.API_BASE` from it. `BASE_URL` stays as it is.
- Modify `from_api_keys`: in replay mode only, missing keys fall back to the placeholder pair
  `('testbed-replay', 'testbed-replay')`, because replay needs no real keys. In every other
  mode it raises as today.
- Replay patches the translation wait: `export_dxf_async` is CNC and out of scope, so
  nothing in the print path sleeps. No patch is needed now; leave a one-line note in
  `adapters.py`.

- [ ] **Step 1: Write failing tests** (use `requests.Session`, no network; record mode is
  tested against a local `http.server` thread on a free port):
  - `test_off_mode_installs_nothing`: after `install_adapters`, the session's adapters are
    the original `HTTPAdapter`.
  - `test_record_writes_scrubbed_exchange_and_ledger_line`
  - `test_record_keeps_retry_configuration`: the adapter's `max_retries.total == 4` and its
    `status_forcelist` matches the client's.
  - `test_replay_returns_recorded_body`
  - `test_replay_ignores_volatile_query_keys`
  - `test_unmatched_request_names_method_and_path`: status 599, body starts with
    `not in the cassette: GET /documents`. This is Review Focus 3.
  - `test_replay_repeats_status_sequence_in_order`
  - `test_client_uses_api_base_override_only_when_on`
  - `test_from_api_keys_placeholder_only_in_replay`
- [ ] **Step 2: Run** and expect FAIL.
- [ ] **Step 3: Implement** `adapters.py` and the two client changes.
- [ ] **Step 4: Run** `testbed/tests` and `make test-quick`. Expect PASS: the existing
  `tests/test_onshape_token_refresh.py` stays green.
- [ ] **Step 5: Commit** `testbed: record and replay adapters in OnshapeClient`.

### Task 4: Call ledger and budget

**Files:**
- Create: `testbed/ledger.py`, `testbed/tests/test_ledger.py`

**Interfaces:**
- Produces:
  - `Ledger(path: Path, budget: int = 250, cycle_start: date | None = None, per_run_cap: int = 150)`.
    `budget` and `cycle_start` can come from `TESTBED_BUDGET` and `TESTBED_CYCLE_START`
    (ISO date). The default cycle start is the same month and day one year back from
    today, which means a rolling year.
  - `record(scenario: str, method: str, path: str, status: int) -> None`: appends
    `{"t": iso, "scenario", "method", "path", "status", "counted": 200 <= status < 400}`.
  - `counted_in_cycle() -> int`
  - `check(estimate: int) -> None`: raises `BudgetExceeded`, whose message gives the total,
    the estimate and the budget, when `counted + estimate > budget` or `estimate > per_run_cap`.
  - `stop_on_402(status: int) -> None`: raises `OnshapeAllowanceExhausted` on 402.
  - `estimate_for(scenarios: list[str]) -> int`: counted calls in the last recording of each
    scenario, read from the cassettes. A scenario with no recording uses its scenario's
    `estimate` field (Task 8).
- The recorder calls `stop_on_402` after each live response.

- [ ] **Step 1: Write failing tests**: `test_missing_ledger_counts_zero`,
  `test_only_2xx_3xx_counted`, `test_cycle_boundary_excludes_older_lines`,
  `test_check_refuses_over_budget`, `test_check_refuses_over_run_cap`,
  `test_corrupt_ledger_line_refuses` (the message names the line number; Review Focus 4),
  `test_402_raises`.
- [ ] **Step 2: Run** and expect FAIL.
- [ ] **Step 3: Implement**. Wire `RecordingAdapter` to the real `Ledger`.
- [ ] **Step 4: Run** and expect PASS.
- [ ] **Step 5: Commit** `testbed: call ledger and budget`.

### Task 5: Fake Onshape API server

**Files:**
- Create: `testbed/fake_api.py`, `testbed/tests/test_fake_api.py`

**Interfaces:**
- Consumes: `ReplayAdapter`'s matcher. Factor it out as
  `match(cassette, method, path, query, body) -> Exchange | None` in `adapters.py`, so both
  use one matcher.
- Produces:
  - `FakeOnshapeApi(cassettes_dir: Path, port: int = 6239)` with `start()` (a daemon thread
    running `http.server.ThreadingHTTPServer`, bound to `127.0.0.1`) and `stop()`.
  - `use_scenario(name)` selects the cassette. It is also reachable over HTTP as
    `POST /_testbed/scenario` with body `{"name": …}`, which the browser runner calls.
  - It serves only paths under `/api/v13`; anything else gets 404. Unmatched requests get
    the same 599 as the adapter.

- [ ] **Step 1: Write failing tests**: `test_serves_recorded_response_under_api_prefix`,
  `test_unmatched_is_599`, `test_switch_scenario_over_http`, `test_binary_body_served_bytes`.
- [ ] **Step 2: Run** and expect FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** and expect PASS.
- [ ] **Step 5: Commit** `testbed: fake Onshape API server`.

### Task 6: Development sign-in, panel flag, panel script and message logs

**Files:**
- Create: `testbed/flask_hooks.py`, `testbed/messages.py`, `testbed/panel/testbed_panel.js`,
  `testbed/tests/test_flask_hooks.py`, `testbed/tests/test_messages.py`
- Modify: `onshape_integration.py` (`OnshapeSessionManager.get_client`,
  `update_session_tokens`), `frc_cam_gui_app.py` (register hooks; `/onshape/status`; pass
  `testbed` to the panel template), `print/routes.py` (pass `testbed` to `print_wizard.html`),
  `templates/wizard.html` and `print/templates/print_wizard.html` (one conditional script tag
  each)

**Interfaces:**
- Produces (`messages.py`), the message log format: `testbed/messages/<scenario>.json` holds
  `{"scenario": str, "steps": [{"step": str, "events": [{"dir": "out"|"in", "origin": str,
  "data": object, "t_ms": int}]}]}`. Functions: `load(name) -> dict`,
  `save(name, log) -> None` (scrubbed through `Scrubber` by known values),
  `segment(log, step) -> list[event]`.
- Produces (`flask_hooks.py`): `register(app) -> None`, called from `frc_cam_gui_app.py` only
  `if testbed.is_on()`. It adds:
  - `GET /testbed/sign-in`: sets `session['testbed_apikey'] = True` and
    `session['user_email'] = 'testbed@example.invalid'`, then returns 204.
  - `POST /testbed/messages`: body `{"scenario", "step", "events"}`; appends to an
    in-progress log. `POST /testbed/messages/done` saves it.
  - `GET /testbed/panel.js`: serves `testbed/panel/testbed_panel.js`.
  - A template context processor that injects `testbed_mode` (`'replay'` or `'record'`).
    Both templates add
    `{% if testbed_mode %}<script src="/testbed/panel.js" data-mode="{{ testbed_mode }}"></script>{% endif %}`.
    With the test bed off the processor is not registered, so `testbed_mode` is undefined and
    nothing renders.
- Modify `OnshapeSessionManager.get_client`: first, when `testbed.is_on()` and
  `session.get('testbed_apikey')`, return the cached `g` client or a new
  `OnshapeClient.from_api_keys()` (registered via `_register`). Otherwise the existing path is
  unchanged.
- Modify `update_session_tokens`: return immediately when `client.auth_mode == 'apikey'`.
- Modify `/onshape/status`: treat `client.auth_mode == 'apikey'` as connected, alongside
  `client.access_token`.
- `testbed_panel.js` (plain ES5, matching the repo's style):
  - In both modes, draw a checklist strip, a fixed bar at the top. Its steps come from
    `GET /testbed/checklist?scenario=…`, served by `flask_hooks`, which reads scenario
    definitions (Task 8). Buttons: `Ask for a part` (posts `requestSelection` with
    `entityTypeSpecifier: ['BODY']`, `requiredSelectionCount: 1`), `Ask for two parts`
    (`requiredSelectionCount: 2`), `Select dialog` (`openSelectItemDialog` with
    `selectParts: true`), `Select dialog (several)` (adds `selectMultiple: true`),
    `Next step`, `Done`. Each request carries `documentId`, `workspaceId`, `elementId`, and
    a `messageId` of `testbed-<n>`.
  - It records every message the strip sends, and adds `window.addEventListener('message',
    …)` to record every message received, before the panel's own filters. Events buffer per
    step and are posted on `Next step` and `Done`.
  - The context comes from `window.PenguinCAM.onshape` on `/onshape-panel`. On `/print` it
    is parsed from the `return` link's query, the only place the print page has it today
    (spec section 11).
  - The plan shows the strip in replay mode too, so a browser scenario can press its
    buttons. The spec text "shown only in record mode" is updated to "shown only while the
    test bed is on" in this task's commit to the notes repo.

- [ ] **Step 1: Write failing tests** (Flask test client, with the module imported under
  `PENGUINCAM_TESTBED=replay` in a subprocess-free way: set the environment, call
  `testbed._reset_for_tests()`, then `importlib.reload` in `setUpClass`):
  - `test_sign_in_sets_flag_and_standin_user`
  - `test_get_client_returns_apikey_client_after_sign_in`
  - `test_update_session_tokens_noop_for_apikey`: the cookie gains no `onshape_tokens`.
  - `test_status_reports_apikey_client_connected`: replay adapter with
    `synthetic-sessioninfo`.
  - `test_panel_and_print_pages_include_script_when_on`
  - `test_flag_cookie_ignored_when_off`: in a subprocess with the test bed off, a forged
    session with `testbed_apikey` → `get_client` returns None and `/testbed/sign-in` is 404.
  - `test_message_log_roundtrip_and_segment`
  - `test_saved_message_log_is_scrubbed`
- [ ] **Step 2: Run** and expect FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** `testbed/tests` and `make test-quick`. Expect PASS.
- [ ] **Step 5: Commit** `testbed: development sign-in, panel script and message logs`.

### Task 7: Fake Onshape host and the browser harness

**Files:**
- Create: `testbed/host/index.html`, `testbed/host/host.js`, `testbed/browser.py`,
  `testbed/requirements.txt`, `testbed/tests/browser_host.py`,
  `testbed/tests/fixtures/messages/synthetic-part-select.json` (hand-written, `"synthetic": true`)
- Modify: `Makefile` (target `testbed-replay`)

**Interfaces:**
- Consumes: `FakeOnshapeApi` (Task 5); message log format (Task 6).
- Produces (`browser.py`):
  - `DevServer(port: int = 6240, mode: str = 'replay')`, a context manager. It starts
    `uv run python frc_cam_gui_app.py` in its own process group with environment
    `PORT=<port>` (the app's existing port setting), `PENGUINCAM_TESTBED=mode`,
    `EMBED_COOKIES=1` and `ONSHAPE_API_BASE=http://127.0.0.1:6239/api/v13`. Output goes to
    `testbed/.logs/devserver.log`, which is git-ignored. It waits for a 200 on `/`, and on
    exit kills the whole process group (Flask's reloader runs a parent and a child).
  - `launch(headed: bool = False, executable: str | None = None) -> (playwright, browser, context)`.
    Chromium comes from `TESTBED_CHROMIUM` or `/usr/bin/chromium`. The context gets the
    permission `local-network-access` for `https://cad-testbed.onshape.com`, with a fallback
    to `['loopback-network', 'local-network']` when Chrome rejects the name. It also routes
    `https://cad-testbed.onshape.com/**` to `serve_host(route)`.
  - `serve_host(route)` serves `host/index.html` for `/documents/**`, plus `host/host.js` and
    `/_testbed/messages/<scenario>.json` (from `TESTBED_MESSAGE_DIR`, default
    `testbed/messages`).
  - `host_url(doc: dict, panel_port: int, scenario: str, version: bool = False) -> str`
- `host.js` behaviour:
  - Create the iframe:
    `http://localhost:<port>/onshape-panel?documentId=…&workspaceId=…&elementId=…&server=https%3A%2F%2Fcad-testbed.onshape.com&theme=light`.
    For a version, pass `versionId` and `workspaceId={$workspaceId}` raw.
  - Listen for messages from the iframe and log them to `window.__testbed.log`.
  - On a message with a `messageName`, find the current step's segment and post the `in`
    events that follow the matching `out` event. A matching `out` has the same `messageName`
    and the same keys; answers are posted to the iframe with
    `targetOrigin = 'http://localhost:<port>'`, rewriting any `messageId` to the live one.
  - Expose `window.__testbed = {log, setStep(name), selectPart(name), deselect(), reloadPanel()}`.
    `selectPart` posts the `in` events of the step whose name is `select part <name>`.
- `testbed/requirements.txt`: `playwright==1.55.0`, per the pinning note.
- `Makefile` target `testbed-replay`. It installs the requirements if the import fails (the
  same pattern as `test-daemon`), never downloads browsers, and runs
  `uv run python -m unittest discover -s testbed/tests -p 'browser_*.py' -t . -v` under
  `xvfb-run -a` when `DISPLAY` is unset. Name the browser test modules `browser_*.py`, so
  that `make test-quick`'s default `test*.py` discovery skips them.

- [ ] **Step 1: Write failing browser tests** in `testbed/tests/browser_host.py` (renamed from
  the file listed above to follow the `browser_*` rule), using the synthetic message log via
  `TESTBED_MESSAGE_DIR`:
  - `test_host_has_onshape_origin`: `location.origin` in the host page is
    `https://cad-testbed.onshape.com`.
  - `test_panel_frames_and_receives_application_init`: the iframe loads (no
    `ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS`) and the host log contains `applicationInit`
    from the panel.
  - `test_session_cookie_survives_reload`: after `/testbed/sign-in` in the same context and a
    `reloadPanel()`, the panel renders as authenticated (`window.PenguinCAM.authenticated`
    inside the frame is true).
  - `test_reply_carries_live_message_id`: press `Ask for a part`, then `selectPart('Cylinder')`;
    the panel script's recorded `in` event carries `messageId` `testbed-1`. Review Focus 5.
  - `test_host_url_keeps_placeholder_workspace`: a version URL reaches the panel with
    `{$workspaceId}` intact. Review Focus 2.
- [ ] **Step 2: Run** `make testbed-replay` and expect FAIL.
- [ ] **Step 3: Implement** `browser.py`, `host/`, and the Makefile target.
- [ ] **Step 4: Run** `make testbed-replay` and expect PASS. If the permission name or the
  routing approach fails, stop and report: this is the spec's "the test browser cannot frame
  the panel" row.
- [ ] **Step 5: Commit** `testbed: fake Onshape host and browser harness`.

### Task 8: Scenarios and mesh checks

**Files:**
- Create: `testbed/scenarios/__init__.py`, `testbed/scenarios/definitions.py`, `testbed/mesh.py`,
  `testbed/tests/test_mesh.py`, `testbed/tests/browser_scenarios.py`,
  `testbed/tests/test_scenarios.py`, `testbed/tests/fixtures/stl/` (small synthetic STLs:
  a 40 × 30 × 10 mm box, the same box in inches, a 400 × 50 × 10 mm slab)
- Modify: `testbed/flask_hooks.py` (`/testbed/checklist` reads definitions)

**Interfaces:**
- Produces (`definitions.py`): `Scenario` dataclass with `name: str`, `document: str` (a key
  in `testbed/documents.json`), `panel: bool`, `steps: list[Step]`, and `estimate: int`
  (counted calls when there is no recording yet). `Step` has `name: str`, `instruction: str`
  (checklist text), `action: str | None` (one of the strip buttons), and `select: list[str]`.
  `SCENARIOS: dict[str, Scenario]` holds `panel-load`, `to-print`, `part-select`,
  `multi-select`, `assembly-select` and `part-export`, with the steps from spec 5.7 and 6.
  `estimate` values: `panel-load` 6, `to-print` 6, `part-select` 2, `multi-select` 2,
  `assembly-select` 2, `part-export` 40.
- Produces (`scenarios/__init__.py`):
  - `run_api(name, client) -> None`: executes a scenario's API-only actions inside
    `active_scenario(name)`. Only `part-export` has them. For each document part it calls
    `client._make_api_request('GET', f'/parts/d/{did}/{wvm}/{wvmid}/e/{eid}/partid/{pid}/stl', params=…)`
    twice: with no params (Onshape's defaults) and with
    `{'units': 'millimeter', 'mode': 'binary'}`. Redirects are followed by `requests`, and
    each hop is recorded. It also calls `GET /translations/translationformats` once, and does
    one export from a version of `tb-box`.
  - `recorded(name) -> bool`: true when the cassette, or the message log for panel
    scenarios, exists under the committed directories.
- Produces (`mesh.py`):
  - `size_mm(stl_bytes, units: str) -> tuple[float, float, float]`: uses
    `print.slicer.stl_bounds`, scaling by 25.4 when `units == 'inch'`.
  - `fits_plate(size, bed=part_info()['printer']['bed_mm']) -> bool`
- `browser_scenarios.py`: for each panel scenario, skip with `needs a recording` when
  `recorded()` is false; otherwise drive the host through its steps and assert the panel
  script's recorded events equal the message log's events by name, keys and value types.
- `test_scenarios.py` (no browser):
  - `part-export` replay, when recorded: each mm export of `tb-box` has `size_mm` within 0.1
    of (40, 30, 10) in some axis order, `tb-inch` matches (50.8, 25.4, 12.7), the default
    (inch) export of `tb-box` gives (40, 30, 10) once scaled by 25.4, `slice_stl` succeeds on
    `tb-box`, and `fits_plate` is false for `tb-oversized`.
  - The same assertions always run against `testbed/tests/fixtures/stl/`, so the checks are
    tested before any recording exists.

- [ ] **Step 1: Write failing tests**: `test_size_mm_binary_and_ascii`, `test_inch_scaling`,
  `test_fits_plate_false_for_slab`, `test_fixture_box_slices` (calls `slice_stl` into a temp
  dir; mark it with the same skip as `print/tests/orca_integration_test.py` uses when Orca is
  absent), `test_definitions_reference_known_documents`, `test_unrecorded_scenario_skips`.
- [ ] **Step 2: Run** and expect FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** `make test-quick` and `make testbed-replay`. Expect PASS, with the panel
  scenarios skipped as `needs a recording`.
- [ ] **Step 5: Commit** `testbed: scenarios and exported-mesh checks`.

### Task 9: Drift report and accept

**Files:**
- Create: `testbed/drift.py`, `testbed/tests/test_drift.py`

**Interfaces:**
- Produces:
  - `shape(value) -> object`: maps a JSON value to its structure. Dicts keep their keys
    with `shape` of each value, lists become the shape of their first element, scalars
    become type names. Volatile keys (`VOLATILE_KEYS` from Task 3, plus `id`, `href` under
    ids) compare by type only.
  - `diff_cassettes(old: Cassette, new: Cassette) -> list[Difference]`. A `Difference` has
    `scenario`, `index`, `kind` (`'request'` = PenguinCAM changed, `'response'` = Onshape
    changed) and `detail`. Exported meshes compare by bounding box (to 0.01 mm) and triangle
    count.
  - `diff_messages(old, new) -> list[Difference]`
  - `report(diffs, path: Path) -> None`: Markdown with one section per scenario, `clean`
    when there is none.
  - Fresh recordings go to `testbed/.fresh/` (git-ignored). `accept(name)` moves a fresh
    cassette or message log into the committed directory.

- [ ] **Step 1: Write failing tests**: `test_identical_is_clean`,
  `test_changed_request_path_is_request_kind`, `test_new_response_key_is_response_kind`,
  `test_volatile_ids_ignored`, `test_mesh_bbox_change_reported`,
  `test_accept_moves_fresh_into_place`.
- [ ] **Step 2: Run** and expect FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** and expect PASS.
- [ ] **Step 5: Commit** `testbed: drift report and accept`.

### Task 10: Command line

**Files:**
- Create: `testbed/__main__.py`, `testbed/tests/test_cli.py`
- Modify: `Makefile` (`testbed-record`), `.gitignore` (`testbed/.fresh/`, `testbed/.logs/`,
  `testbed/.chrome-profile/`)

**Interfaces:**
- Consumes: everything above.
- Produces: `uv run python -m testbed <command>`:
  - `build-docs [--rebuild NAME]` (Task 11)
  - `record [SCENARIO…]`: live API check; requires `ONSHAPE_ACCESS_KEY` and
    `ONSHAPE_SECRET_KEY`; checks the ledger first; writes to `.fresh/`; then runs drift.
  - `record --ui [SCENARIO…]` (Task 12)
  - `drift`
  - `accept SCENARIO…`
  - `ledger`: counted calls this cycle, budget, remaining, last ten lines.
  - Every command that needs a credential exits 2 with `missing environment variable: NAME`.
- `testbed-record` in the Makefile runs `record`.

- [ ] **Step 1: Write failing tests**: `test_record_without_keys_names_variable`,
  `test_record_refuses_over_budget` (ledger set up near the cap), `test_ledger_command_prints_totals`,
  `test_accept_unknown_scenario_errors`.
- [ ] **Step 2: Run** and expect FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** and expect PASS.
- [ ] **Step 5: Commit** `testbed: command line`.

### Task 11: Test documents builder

**Files:**
- Create: `testbed/documents.py`, `testbed/tests/test_documents.py`,
  `testbed/tests/fixtures/cassettes/synthetic-build-docs.json` (hand-written from Onshape's
  OpenAPI shapes, `"synthetic": true`)

**Interfaces:**
- Produces:
  - `DOCUMENTS: list[DocSpec]`. Each `DocSpec` has `name`, `kind` (`partstudio` or
    `assembly`) and `features: list[dict]`: Onshape feature JSON built by helpers
    `sketch_rectangle(plane, w, h, units)`, `sketch_circle(plane, r, units)` and
    `extrude(sketch_feature_id, depth, units)`, with values as expressions such as `"40 mm"`
    or `"2 in"`. For `tb-assembly`, `instances` gives two of `tb-box`.
  - `build(client, folder_id: str, rebuild: str | None = None) -> dict`: lists the folder,
    creates what is missing with `POST /documents` (`{"name", "description":
    "created by PenguinCAM test bed", "parentId": folder_id}`), then adds the features, and
    writes `testbed/documents.json`
    (`{name: {did, wid, eid, parts: {partName: partId}}}`).
  - `assert_test_document(doc_json, folder_listing) -> None`: raises `NotATestDocument`
    unless all three rules in Global Constraints hold. It is called before every write and
    every delete.
  - The folder id comes from `TESTBED_FOLDER_ID`. When it is missing, exit
    `missing environment variable: TESTBED_FOLDER_ID` and say how to find it (the id in the
    folder's URL).

- [ ] **Step 1: Write failing tests**, against the replay adapter with the synthetic cassette:
  `test_build_creates_only_missing_documents`, `test_write_refused_for_foreign_document`
  (each rule broken in turn), `test_rebuild_deletes_only_named_test_document`,
  `test_documents_json_written`, `test_feature_json_uses_expressions_with_units`.
- [ ] **Step 2: Run** and expect FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** and expect PASS.
- [ ] **Step 5: Commit** `testbed: test documents builder`.

### Task 12: Real Chrome and the automated Onshape UI run, up to the login form

**Files:**
- Create: `testbed/scripts/install-chrome.sh`, `testbed/ui_run.py`, `testbed/tests/test_ui_run.py`,
  `testbed/tests/browser_chrome.py`

**Interfaces:**
- Produces:
  - `install-chrome.sh`. It downloads Google Chrome stable for arm64 Linux
    (`https://dl.google.com/linux/direct/google-chrome-stable_current_arm64.deb`); when that
    URL does not answer 200, it stops and says so instead of guessing another. It unpacks the
    `.deb` with `dpkg-deb -x` into `~/.local/opt/google-chrome/`, writes the version to
    `~/.local/opt/google-chrome/VERSION`, and prints the binary path. No root.
  - `chrome_path() -> str | None`
  - `ui_run.py`:
    - `run(scenarios: list[str], headed=True) -> Path` (returns the drift report path). It
      requires `ONSHAPE_USERNAME`, `ONSHAPE_PASSWORD`, `ONSHAPE_CLIENT_ID` and
      `ONSHAPE_CLIENT_SECRET`, and refuses a `ONSHAPE_CLIENT_ID` starting with `VKDK` (the
      production app's id).
    - `launch_persistent(profile_dir='testbed/.chrome-profile')`
    - `detect_bot_check(page) -> str | None`. It returns a reason when it sees a CAPTCHA
      iframe (`iframe[src*="captcha"]`, `iframe[src*="challenges.cloudflare.com"]`), text
      matching `/verify (you are|you're) (a )?human|unusual activity|security check/i`, or an
      email-verification prompt. On a reason, `run` saves a screenshot to `testbed/.logs/`
      and exits 3 with `stopped by an Onshape check: <reason>`.
    - `login(page)`: fills the login form and submits; the password goes only into the
      form field.
    - Panel steps:
      - open each document;
      - open the panel by clicking the right-panel icon with the accessible name
        `PenguinCAM-chondl-dev`;
      - connect through OAuth in the panel's popup;
      - press the checklist strip's buttons inside the frame;
      - select in Onshape's parts list by part name.
      The Onshape selectors live in one table at the top of the module (`SELECTORS = {…}`),
      so a UI change is a one-line fix.
- `browser_chrome.py`:
  - `test_chrome_installed_and_starts_under_xvfb`: skips when `chrome_path()` is None.
  - `test_onshape_login_page_loads_without_bot_check`: opens `https://cad.onshape.com/signin`
    in real Chrome with the persistent profile, waits for the email field, and asserts
    `detect_bot_check` returns None. **It does not fill or submit the form.** It is the only
    test that touches the internet. It runs only when `TESTBED_ONLINE=1`, never in
    `make testbed-replay`.

- [ ] **Step 1: Write failing tests** (`test_ui_run.py`, no browser):
  `test_missing_credentials_named` (each of the four),
  `test_production_client_id_refused`, `test_detect_bot_check_patterns` (against saved
  HTML snippets in `testbed/tests/fixtures/html/`), `test_password_never_logged` (run
  `login` against a stub page object; assert the password is absent from captured logs).
- [ ] **Step 2: Run** and expect FAIL.
- [ ] **Step 3: Implement** `install-chrome.sh` and `ui_run.py`.
- [ ] **Step 4: Run** `bash testbed/scripts/install-chrome.sh`, then
  `TESTBED_ONLINE=1 xvfb-run -a uv run python -m unittest testbed.tests.browser_chrome -v`.
  Expect Chrome to start and the sign-in page to load with no bot check. If Chrome cannot be
  installed, record that, set the run to use `/usr/bin/chromium` headed, and continue.
- [ ] **Step 5: Commit** `testbed: real Chrome and the automated Onshape UI run up to sign-in`.

### Task 13: Documentation

**Files:**
- Create: `docs/ONSHAPE_TEST_BED.md` (in PenguinCAM; neutral, for any developer)
- Create in the notes repo: `guides/ONSHAPE_CHECKPOINT.md` (the owner's checklist)
- Modify: `CLAUDE.md` (add `testbed/` to the key files, a doc-table row linking
  `docs/ONSHAPE_TEST_BED.md`, and the `make testbed-replay` command)

- [ ] **Step 1:** `docs/ONSHAPE_TEST_BED.md` covers:
  - what the test bed is and the terms (from spec section 3);
  - switching it on;
  - `make testbed-replay`, `make testbed-record` and the CLI commands;
  - the environment variables (`PENGUINCAM_TESTBED`, `ONSHAPE_API_BASE`, `TESTBED_*`, the
    four credentials);
  - the budget and the ledger;
  - how to add a scenario;
  - why the fake host needs an `onshape.com` origin and the Local Network Access permission.
  Nothing in it mentions the notes repo, the owner's Mac or the container.
- [ ] **Step 2:** `guides/ONSHAPE_CHECKPOINT.md` in the notes repo: the steps from spec
  section 6, with the command that starts the development server in record mode.
- [ ] **Step 3: Commit** both (the PenguinCAM commit on the branch, the notes commit on the
  notes repo's `main`).

### Task 14 (needs Onshape credentials; not started until they arrive): first live recordings

Blocked on the owner: `ONSHAPE_ACCESS_KEY`, `ONSHAPE_SECRET_KEY`, `ONSHAPE_USERNAME`,
`ONSHAPE_PASSWORD` and `TESTBED_FOLDER_ID` in the environment.

- [ ] **Step 1:** `uv run python -m testbed build-docs`. Expect seven `tb-` documents in the
  folder, `testbed/documents.json` written, and about 25–30 counted calls reported. Check
  that `parentId` placed them in the folder. If not, the UI run moves them (Step 3).
- [ ] **Step 2:** `uv run python -m testbed record part-export`, then
  `uv run python -m testbed accept part-export`. Commit the scrubbed cassette after the scrub
  test passes.
- [ ] **Step 3:** `uv run python -m testbed record --ui`, which runs every panel scenario,
  switches `tb-inch` to inches, and records the panel URL. On a bot check: stop, report, and
  ask the owner for an Onshape checkpoint instead. Accept the recordings.
- [ ] **Step 4:** run the Verification section in full.

---

## Verification

Every check names its command. All but V9–V12 run with no credentials and no live call.

| # | Check (spec guarantee) | Command | Passes when |
|---|---|---|---|
| V1 | The repo's gate is unbroken | `make test` | exit 0 |
| V2 | Test bed unit tests run with every change (8) | `make test-quick` | output includes the testbed discovery, exit 0 |
| V3 | Inert when off; refuses on a deployed server (5.6) | `uv run python -m unittest testbed.tests.test_settings testbed.tests.test_flask_hooks -v` | `test_import_refuses_when_deployed`, `test_app_has_no_testbed_routes_when_off`, `test_flag_cookie_ignored_when_off` pass |
| V4 | No secret in committed recordings (5.2) | `uv run python -m unittest testbed.tests.test_scrub -v` | `test_committed_recordings_are_clean` passes |
| V5 | Replay never falls through to Onshape (5.3) | `uv run python -m unittest testbed.tests.test_adapters testbed.tests.test_fake_api -v` | 599 tests pass |
| V6 | Fake host passes origin, CSP and Local Network Access; cookie survives (0.3, 5.4) | `make testbed-replay` | `browser_host` tests pass |
| V7 | Budget enforced; 402 stops (7) | `uv run python -m unittest testbed.tests.test_ledger testbed.tests.test_cli -v` | pass |
| V8 | Mesh checks: size in mm, inch scaling, slicing, oversized (5.7) | `make test` (includes `test_fixture_box_slices`) | pass |
| V9 | Real Chrome starts; Onshape sign-in page loads with no bot check (5.9) | `TESTBED_ONLINE=1 xvfb-run -a uv run python -m unittest testbed.tests.browser_chrome -v` | pass, or the Chromium fallback is recorded |
| V10 | Test documents built, writes confined (5.1) | `uv run python -m testbed build-docs` *(needs credentials)* | seven documents, calls reported |
| V11 | One live API check with counted calls reported (10) | `uv run python -m testbed record` *(needs credentials)* | report ends with the call count and the remaining budget |
| V12 | One automated Onshape UI run records every panel scenario; replay then passes with no live call; drift clean (10) | `uv run python -m testbed record --ui`, then `uv run python -m testbed accept …`, then `make testbed-replay`, then `uv run python -m testbed drift` *(needs credentials)* | no skips for `needs a recording`; the drift report says `clean` |

Done for this session means V1–V9 pass. V10–V12 complete the sub-project once the owner's
credentials arrive.

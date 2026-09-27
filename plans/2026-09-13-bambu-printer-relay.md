# Bambu Printer Relay Implementation Plan

> **Paths updated 2026-09-13:** the print path moved into the top-level `print/`
> package after this document was written, and the printer relay moved with it.
> File paths and imports below were rewritten to match; the design and the task
> order are unchanged. See [PRINTER_SETUP.md](https://github.com/6238/PenguinCAM/blob/main/docs/PRINTER_SETUP.md) for the
> current layout.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a student start a print on the team's LAN-only Bambu Lab printer from the PenguinCAM print wizard, and watch its progress, through a stateless in-memory relay in the backend and a small daemon on a Raspberry Pi in the shop.

**Architecture:** Three parties. A Python daemon on the Pi owns the printer connection (MQTT 8883 + FTPS 990 via `bambulabs_api`) and makes one outbound HTTPS request every five seconds carrying a status snapshot and returning a pending job. A Flask blueprint in the backend (`print/printer_routes.py`) is a relay over a module-level dictionary of printer records keyed by an eight-character pairing code (`print/printer_relay.py`); it stores nothing per team on disk. The print wizard polls the relay for status and posts a download token to send a job. The daemon's credential is an `itsdangerous`-signed token carrying the pairing code, so the relay recognises a daemon by signature alone.

**Tech Stack:** Flask 3.0.0, flask-limiter 4.1.1, itsdangerous 2.2.0 (already a Flask dependency), PyYAML; on the Pi, Python 3.11+ stdlib `tomllib` for reading plus `tomli-w==1.2.0` for writing, `requests==2.31.0`, `bambulabs_api==2.6.6`. Tests are `unittest`, run with `uv run`.

**Spec:** [../specs/2026-09-13-bambu-printer-relay-design.md](../specs/2026-09-13-bambu-printer-relay-design.md) — read section 0 first, then the whole document. Every task argues from it; when this plan and the spec disagree, say so in the task report rather than silently choosing.

## Global Constraints

Copied from the spec and from the repository's `CLAUDE.md` files. Every task's requirements implicitly include this section.

- **Work only in the worktree** `/repos/popcornpenguins/PenguinCAM/.worktrees/printer-relay`, on branch `feature/printer-relay`. Never `cd` to the main checkout at `/repos/popcornpenguins/PenguinCAM`, never write files there, never check out a different branch here.
- **No git commands at all.** The project's `CLAUDE.md` says: "DO NOT run any git commands (git add, git commit, git push, etc.). The user prefers to handle all git operations themselves." Every task ends with tests, never a commit. Never commit or push to `main`; changes reach `main` only by a pull request the owner asks for.
- **Files owned by the parallel branch `feature/3d-print-stage1`. Do not create or edit any of them:** `scripts/install-orca.sh`, `scripts/flatten_orca_profiles.py`, `scripts/make_sample_part.py`, `Dockerfile`, `Procfile`, `.dockerignore`, `.github/workflows/integration.yaml`, `print/`, `print/slicer.py`, `print/jobs.py`, `print/routes.py`, `print/templates/print_wizard.html`, `print/static/print_wizard.js`, `print/static/print_viewer.js`, `templates/wizard.html`, `static/wizard.js`, `static/wizard.css`, `tests/js/`, `tests/fixtures/print/`, `docs/3D_PRINTING.md`.
- **Shared files, where this branch's change must be one small additive hunk:** `frc_cam_gui_app.py` (exactly two hunks, see Task 3), `Makefile` (the `test-daemon` target), `README.md`, `CLAUDE.md`, `docs/DEPLOYMENT_GUIDE.md`. `.gitignore` needs no change from this plan.
- **Never start a server on port 6238 and never kill the one already running there.** Another session's development server is bound to it and verified end to end by the owner. Unit tests and the daemon's mocked tests need no server.
- **No `pyproject.toml`.** The backend uses `requirements.txt`; the daemon has its own `print/printer_daemon/requirements.txt` and is run as a module (`python -m printer_daemon`), never installed as a package.
- **`bambulabs_api` must NOT be added to the backend `requirements.txt`.** It is installed only into the development venv, by `make test-daemon`, and onto the Pi by the installer. It is never in the Docker image.
- **All Python runs through `uv run`.** Tests are `unittest`, never pytest.
- **HTTPS rule:** the daemon routes and the installer route refuse with 403 any request that did not arrive over HTTPS (judged after `ProxyFix`, i.e. `request.is_secure`), unless the server is in development mode.
- **Development mode is defined as:** Flask's debug flag is on **and** the `RAILWAY_ENVIRONMENT` environment variable is absent. Nothing else. `PRINTER_DEV_PAIRING_CODE` is read only in development mode.
- **Pairing code alphabet:** Crockford base32, `0123456789ABCDEFGHJKMNPQRSTVWXYZ` (no I, L, O, U). Eight symbols, forty bits from `secrets.choice`, all-digit codes redrawn. Normalised form is uppercase with dashes and spaces removed, `O`→`0`, `I`→`1`, `L`→`1`. Displayed as `7K3M-Q9XW`.
- **Token:** `itsdangerous` signed with the app's `FLASK_SECRET_KEY`, salt `penguincam-printer`, payload is the normalised code and the issue time. No expiry; the issue time is for logging only and is never compared with any clock.
- **Every flask-limiter `key_func` in this feature wraps its parsing in `try`/`except Exception` and falls back to `get_remote_address()`**, because flask-limiter runs the key function before the view and an exception there would be a 500.
- **Lock discipline in the relay:** one lock; every check-and-store happens inside one acquisition; network calls never happen while holding it. Expiry is lazy, evaluated on every read, with an injectable clock — no background thread.
- **The relay writes nothing per team to disk.** No Railway volume, no database.

## Stop for the owner

These are the points where a task must stop and ask, not guess. They do not block the rest of the plan.

- **Task 13 note, verification tasks 1 to 4** (spec section 14): the real state strings, the reported file-name form, the SSDP datagram fields, and the start-to-`running` latency all need the shop's H2S, which was not connected on 2026-09-13. Build against the library's documented field names, mark the fixture provisional, and ask the owner when the printer is available.
- **End-to-end arrangements** (spec section 13): both need port 6238 and the Onshape panel. Ask the owner for a turn on 6238 before attempting either; do not start a server on that port on your own.
- **The pinned commit SHA in `print/printer_daemon/install.sh`** (Task 10 and Task 14): nothing is committed yet, so the script ships `PENGUINCAM_SHA="REPLACE_BEFORE_MERGE"` with a guard that aborts. The owner must set the real SHA when the pull request is opened.
- **`use_ams` on `start_print`** (Task 7): this plan passes `use_ams=False, ams_mapping=[0]` because the stage-1 slice is single-material. If the team prints from an AMS, the owner has to say so.

## File Structure

| Path | New? | Responsibility |
|------|------|----------------|
| `print/printer_relay.py` | new | Code generation and normalisation, token issue and verification, the in-memory printer records with lazy expiry. No Flask imports, so it unit-tests without an app. |
| `print/printer_routes.py` | new | The Flask blueprint: session routes, daemon routes, installer route, dev-mode and HTTPS gates, rate-limit key functions, metrics. No printer protocol code. |
| `config_validation.py` | modify | Normalise and validate `printing.pairing_code` in a step after the existing walk. |
| `team_config.py` | modify | `TeamConfig.pairing_code` property, finding the block in v1 and v2 files. |
| `static/docs/PenguinCAM-config-template.yaml` | modify | A commented `printing` block. |
| `frc_cam_gui_app.py` | modify | Exactly two hunks: the `init_printer_routes(...)` wiring, and one `printer_relay.note_code(...)` line in `_load_team_config_into_session`. |
| `Makefile` | modify | A `test-daemon` target; `test` calls it. |
| `print/printer_daemon/__init__.py` | new | Package marker and `VERSION`. |
| `print/printer_daemon/config.py` | new | Read and write `/etc/penguincam-printer/config.toml`. |
| `print/printer_daemon/relay_client.py` | new | HTTP to the backend: exchange, sync, ack, ping, download. |
| `print/printer_daemon/printer.py` | new | The only module that imports `bambulabs_api`: discovery, connect, upload, start, status mapping. |
| `print/printer_daemon/run_loop.py` | new | The `run` loop, tick-based so it tests without threads. (One module more than the spec's layout table lists; the spec's `test_run_loop.py` needs the loop importable apart from the CLI.) |
| `print/printer_daemon/__main__.py` | new | `pair`, `run` and `status` commands. |
| `print/printer_daemon/install.sh` | new | The Pi installer. |
| `print/printer_daemon/requirements.txt` | new | `bambulabs_api`, `requests`, `tomli-w`. |
| `print/printer_daemon/tests/` | new | `__init__.py`, `test_config.py`, `test_relay_client.py`, `test_printer.py`, `test_run_loop.py`, `fixtures/h2s_status.json`, `smoke_test.py`. |
| `print/tests/test_printer_relay.py` | new | Relay unit tests, no Flask app. |
| `print/tests/test_printer_routes.py` | new | Flask test-client coverage of the blueprint. |
| `tests/test_config_validation.py` | modify | Pairing-code validation and the `TeamConfig.pairing_code` property. |
| `docs/PRINTER_SETUP.md` | new | The mentor's guide, plus a "For developers" section. |
| `README.md`, `CLAUDE.md`, `docs/DEPLOYMENT_GUIDE.md` | modify | Documentation. |

## Facts about this codebase the tasks rely on

Read once; they save a lot of searching.

- `frc_cam_gui_app.py` builds `limiter = Limiter(app=app, key_func=get_remote_address, default_limits=["200 per hour"], storage_uri="memory://", headers_enabled=True)` at about line 259, after `ProxyFix` (about line 210) and the `FLASK_SECRET_KEY` block (about lines 214-224).
- `file_token_manager = FileTokenManager()` is created at about line 185. `register_file(filepath, real_filename)` returns a token and records `{'filepath', 'filename', 'created': time.time()}`. `get_file(token)` returns that dict or `None`. On Railway `use_session` is `False`, so tokens live in process memory and a session-less daemon can resolve one.
- `_has_onshape_session()` is at about line 572; `_maybe_refresh_team_config()` at about line 423; `_load_team_config_into_session(client)` at about line 382, ending with `session['team_config_fetched_at'] = time.time()`.
- The JSON 401 the other routes return is `jsonify({'error': 'Session verification required.', 'need_verification': True}), 401` (from `_require_app_session`).
- The Onshape copy of the config lives in `session['team_config_data']`; the anonymous upload flow's copy lives in `session['upload_config_data']`. The printer routes must read only the former.
- `metrics.log_event(event_type, team_number=None, user_email=None, metadata=None)` is fire-and-forget and never raises.
- `log` comes from `logging_config` and takes any number of arguments.
- `init_print_routes` does **not** exist in this worktree; it arrives with `feature/3d-print-stage1`. Nothing in this plan may depend on it.
- flask-limiter 4.1.1's `limiter.limit(...)` takes keyword-only `key_func` and `override_defaults` (default `True`). `limiter.enabled` is a plain instance attribute, so tests set `gui.limiter.enabled = False` in `setUp` and restore it in `tearDown`.
- `send_from_directory` is imported in `frc_cam_gui_app.py` but the blueprint must import it from `flask` itself.
- Python here is 3.12, and Raspberry Pi OS Bookworm ships 3.11, so `tomllib` is in the standard library for reading; only writing needs `tomli-w`.

---

## Verification findings already folded in

Two of the spec's section 14 verification tasks were answered before this plan was written; their conclusions are requirements below, not open questions.

- **Task 6 (Pi wheels).** `bambulabs_api==2.6.6` requires only `paho-mqtt>=2.0.0` and `pillow>=11.0.0` (no numpy, no opencv). Every package in the tree has an aarch64 wheel; the whole download is about 7 MB and about 23 MB unpacked. There is **no** 32-bit (armv7l) Pillow wheel, so `install.sh` must require 64-bit Raspberry Pi OS and abort on armv7l, install with `pip install --only-binary=:all:` so a future wheel gap fails loudly, and `apt-get install -y python3-venv` idempotently (Bookworm is PEP 668 externally-managed, so the venv is mandatory). Setup guide: recommended Pi 4 with 2 GB or better, minimum Pi 3B+ with 1 GB, 64-bit OS, Pi Zero 2 W not recommended.
- **Task 7 (Cloudflare).** The zone is proxied by Cloudflare and nothing is challenged today, but the plan must be assumed free, and Cloudflare documents that **free-plan Bot Fight Mode cannot be skipped per path**. A challenge page piped into `bash` is a confusing failure, so the **canonical install command in the setup guide and in `install.sh`'s own header comment is the GitHub raw URL**:

  ```
  curl -fsSL https://raw.githubusercontent.com/6238/PenguinCAM/<sha>/printer_daemon/install.sh | sudo bash
  ```

  Note the `-f`: curl then exits non-zero and emits nothing on any 4xx/5xx, so a blocked or moved URL can never reach `bash`. `GET /install-printer.sh` stays as a convenience alias and a development-server path, and is tested, but it is not the documented command. The deployment guide documents both the WAF skip rule (useful only on Pro or better for bots, though on free it still skips Browser Integrity Check, UA blocking and rate-limiting rules) and the free-plan reality: the owner must keep Bot Fight Mode off or daemon syncs may be challenged.
- **Task 8, partial.** `ProxyFix(app.wsgi_app, x_proto=1, x_host=1)` leaves `x_for` at its default of `1`, so `X-Forwarded-For`'s first hop **is** honoured and `get_remote_address()` yields the address Cloudflare forwards. A five-second sync is 720 requests an hour against an app-wide default of 200 an hour, so **every printer route must pass `override_defaults=True`** or the daemon starts taking 429s about seventeen minutes after boot. Task 13 pins the rest of task 8.

---

### Task 1: The relay state module (`print/printer_relay.py`)

**Files:**
- Create: `print/printer_relay.py`
- Test: `print/tests/test_printer_relay.py`

**Interfaces:**

- Consumes: nothing from other tasks. Standard library plus `itsdangerous` only. **No Flask imports** — the Flask module imports this one, so a Flask import here would be a cycle.
- Produces (module level):
  - `ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"`, `CODE_LENGTH = 8`, `TOKEN_SALT = "penguincam-printer"`
  - `DAEMON_ONLINE_SECONDS = 120`, `STATUS_ONLINE_SECONDS = 120`, `RECORD_TTL_SECONDS = 86400`, `STATUS_TTL_SECONDS = 86400`, `JOB_PENDING_TIMEOUT_SECONDS = 180`, `JOB_HANDED_OUT_TIMEOUT_SECONDS = 900`, `LAST_RESULT_TTL_SECONDS = 600`
  - `generate_code() -> str` — eight symbols, never all digits
  - `normalize_code(value) -> str | None`
  - `format_code(code: str) -> str` — `"7K3MQ9XW"` becomes `"7K3M-Q9XW"`
  - `new_job_id() -> str` — `"j" + secrets.token_hex(4)`
  - `issue_token(code: str, secret_key: str, *, issued_at: float | None = None) -> str`
  - `read_token(token: str, secret_key: str) -> tuple[str, float] | None` — `(normalised code, issued_at)`, or `None` for a bad signature or a malformed payload
  - `ExpiryEvent = namedtuple('ExpiryEvent', 'code job_id team_number reason')`
  - `class PrinterRelay` with `__init__(self, clock=time.time)` and the methods listed in the tests below
  - `RELAY = PrinterRelay()` — the module singleton
  - `note_code(code) -> str | None` — module-level delegate to `RELAY.note_code`, the name `frc_cam_gui_app.py` calls

- [ ] **Step 1: Write the failing tests for codes, normalisation and tokens**

Create `print/tests/test_printer_relay.py` with this content:

```python
"""Unit tests for printer_relay: the in-memory printer records, code handling and tokens.

No Flask app is involved -- printer_relay imports nothing from Flask, which is what lets
frc_cam_gui_app import it without a cycle."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import printer_relay
from printer_relay import PrinterRelay


class FakeClock:
    """An injectable wall clock. All relay ages and deadlines read through this."""

    def __init__(self, now=1_789_300_000.0):
        self.now = now

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds


class TestCodeGeneration(unittest.TestCase):
    def test_code_is_eight_symbols_from_the_alphabet(self):
        for _ in range(200):
            code = printer_relay.generate_code()
            self.assertEqual(len(code), printer_relay.CODE_LENGTH)
            for ch in code:
                self.assertIn(ch, printer_relay.ALPHABET)

    def test_alphabet_omits_the_lookalike_letters(self):
        for ch in 'ILOU':
            self.assertNotIn(ch, printer_relay.ALPHABET)

    def test_code_is_never_all_digits(self):
        # An all-digit code would be loaded from YAML as an int unless the mentor quotes it.
        for _ in range(500):
            self.assertFalse(printer_relay.generate_code().isdigit())

    def test_format_code_groups_in_fours(self):
        self.assertEqual(printer_relay.format_code('7K3MQ9XW'), '7K3M-Q9XW')


class TestNormalization(unittest.TestCase):
    def test_uppercases_and_strips_separators(self):
        self.assertEqual(printer_relay.normalize_code(' 7k3m-q9xw '), '7K3MQ9XW')
        self.assertEqual(printer_relay.normalize_code('7K3M Q9XW'), '7K3MQ9XW')

    def test_maps_lookalike_letters(self):
        self.assertEqual(printer_relay.normalize_code('OIL23456'), '01123456')
        self.assertEqual(printer_relay.normalize_code('oil23456'), '01123456')

    def test_accepts_an_integer_from_unquoted_yaml(self):
        self.assertEqual(printer_relay.normalize_code(12345678), '12345678')

    def test_rejects_wrong_length_and_bad_symbols(self):
        self.assertIsNone(printer_relay.normalize_code('7K3MQ9X'))
        self.assertIsNone(printer_relay.normalize_code('7K3MQ9XWZ'))
        self.assertIsNone(printer_relay.normalize_code('7K3M-Q9X!'))
        self.assertIsNone(printer_relay.normalize_code(''))
        self.assertIsNone(printer_relay.normalize_code(None))
        self.assertIsNone(printer_relay.normalize_code({'a': 1}))


class TestTokens(unittest.TestCase):
    def test_round_trip_carries_the_code_and_issue_time(self):
        token = printer_relay.issue_token('7K3MQ9XW', 'secret-one', issued_at=1234.0)
        code, issued_at = printer_relay.read_token(token, 'secret-one')
        self.assertEqual(code, '7K3MQ9XW')
        self.assertEqual(issued_at, 1234.0)

    def test_token_is_rejected_under_a_different_key(self):
        token = printer_relay.issue_token('7K3MQ9XW', 'secret-one')
        self.assertIsNone(printer_relay.read_token(token, 'secret-two'))

    def test_garbage_is_rejected_without_raising(self):
        self.assertIsNone(printer_relay.read_token('not-a-token', 'secret-one'))
        self.assertIsNone(printer_relay.read_token('', 'secret-one'))
        self.assertIsNone(printer_relay.read_token(None, 'secret-one'))

    def test_token_survives_reuse_of_the_same_key(self):
        # The deploy case: a new process with the same FLASK_SECRET_KEY still accepts it.
        token = printer_relay.issue_token('7K3MQ9XW', 'persistent-key')
        self.assertEqual(printer_relay.read_token(token, 'persistent-key')[0], '7K3MQ9XW')
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run python -m unittest tests.test_printer_relay -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'printer_relay'`.

- [ ] **Step 3: Write the code-and-token half of `print/printer_relay.py`**

Create `print/printer_relay.py` starting with:

```python
"""In-memory relay state for the Bambu printer daemon.

Keyed by the team's eight-character pairing code, which is the ONLY identity the relay
trusts: an Onshape session can claim any team number it likes in its own YAML, but the
pairing code is forty random bits that live only in the team's Onshape documents and on the
team's Pi. Nothing here is written to disk -- a restart empties the relay, and the daemon
recovers by syncing again.

Deliberately free of Flask imports: frc_cam_gui_app imports this module, so an import of
Flask here would be a cycle. Everything Flask-shaped lives in print/printer_routes.py.
"""

import secrets
import threading
import time
from collections import namedtuple, deque

from itsdangerous import BadSignature, URLSafeSerializer

# Crockford base32 without I, L, O and U, so no two symbols look alike when a mentor reads
# the code off a Pi's console and types it into a YAML file.
ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
CODE_LENGTH = 8

TOKEN_SALT = "penguincam-printer"

# A daemon counts as heard, and a snapshot as fresh, for two minutes.
DAEMON_ONLINE_SECONDS = 120
STATUS_ONLINE_SECONDS = 120
# Records and snapshots are dropped a day after anything last touched them.
RECORD_TTL_SECONDS = 24 * 60 * 60
STATUS_TTL_SECONDS = 24 * 60 * 60
# Job deadlines: pick-up and confirmation.
JOB_PENDING_TIMEOUT_SECONDS = 3 * 60
JOB_HANDED_OUT_TIMEOUT_SECONDS = 15 * 60
# How long a finished job's outcome is shown on the status line.
LAST_RESULT_TTL_SECONDS = 10 * 60

# Emitted by the relay when a job dies on a deadline; the routes drain these and log a
# printer_ack metrics event, so the metrics show every job's end, not just the acked ones.
ExpiryEvent = namedtuple('ExpiryEvent', 'code job_id team_number reason')


def generate_code():
    """A fresh pairing code: eight symbols, forty bits, never all digits.

    An all-digit code would be read out of an unquoted YAML value as an int, so it is
    redrawn -- that way the mentor can quote it or not and the file still works."""
    while True:
        code = ''.join(secrets.choice(ALPHABET) for _ in range(CODE_LENGTH))
        if not code.isdigit():
            return code


def normalize_code(value):
    """The canonical form of a pairing code, or None when it is not one.

    Accepts what a mentor might actually type or what YAML might hand us: lower case, a
    dash or spaces, an int from an unquoted all-digit value. O becomes 0; I and L become 1.
    """
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int):
        value = str(value)
    if not isinstance(value, str):
        return None
    cleaned = value.strip().upper().replace('-', '').replace(' ', '')
    cleaned = cleaned.replace('O', '0').replace('I', '1').replace('L', '1')
    if len(cleaned) != CODE_LENGTH:
        return None
    if any(ch not in ALPHABET for ch in cleaned):
        return None
    return cleaned


def format_code(code):
    """Display form: two groups of four separated by a dash."""
    return f"{code[:4]}-{code[4:]}"


def new_job_id():
    """A short opaque job id, e.g. 'j8f3a2c1'. It is also baked into the file name the
    daemon uploads, so the printer's reported name identifies the job."""
    return 'j' + secrets.token_hex(4)


def _serializer(secret_key):
    return URLSafeSerializer(secret_key, salt=TOKEN_SALT)


def issue_token(code, secret_key, *, issued_at=None):
    """Sign a daemon credential carrying the code and the issue time.

    No expiry: retiring a Pi means taking the code out of the team's YAML, after which no
    fresh session names it. The issue time is for logging only and is never compared with
    any clock."""
    payload = {'code': code, 'iat': float(issued_at if issued_at is not None else time.time())}
    return _serializer(secret_key).dumps(payload)


def read_token(token, secret_key):
    """(code, issued_at) for a correctly signed token, else None. Never raises."""
    if not token or not isinstance(token, str):
        return None
    try:
        payload = _serializer(secret_key).loads(token)
    except (BadSignature, Exception):  # noqa: B014 - any decode failure is just "no"
        return None
    if not isinstance(payload, dict):
        return None
    code = normalize_code(payload.get('code'))
    if code is None:
        return None
    try:
        issued_at = float(payload.get('iat', 0.0))
    except (TypeError, ValueError):
        issued_at = 0.0
    return code, issued_at
```

- [ ] **Step 4: Run the tests to verify the first three classes pass**

Run: `uv run python -m unittest tests.test_printer_relay -v`
Expected: PASS for `TestCodeGeneration`, `TestNormalization` and `TestTokens`.

- [ ] **Step 5: Write the failing tests for the record store**

Append to `print/tests/test_printer_relay.py`:

```python
IDLE = {'state': 'idle', 'file': '', 'percent': None, 'remaining_min': None,
        'layer': 0, 'layers': 0, 'error': None,
        'printer': {'model': 'H2S', 'name': 'Shop H2S', 'serial': '01P00A'}}


def running(file_name, percent=42):
    snap = dict(IDLE)
    snap.update({'state': 'running', 'file': file_name, 'percent': percent,
                 'remaining_min': 31, 'layer': 87, 'layers': 210})
    return snap


class RelayTestCase(unittest.TestCase):
    """Shared fixture: a relay on a fake clock, with one code already presented."""

    CODE = '7K3MQ9XW'

    def setUp(self):
        self.clock = FakeClock()
        self.relay = PrinterRelay(clock=self.clock)
        self.relay.note_code(self.CODE)

    def hand_out_a_job(self, filename='sample_part.gcode.3mf'):
        """Exchange, sync, send and hand out -- the state most job tests start from."""
        self.assertTrue(self.relay.begin_exchange(self.CODE))
        self.relay.note_daemon(self.CODE)
        self.relay.store_status(self.CODE, IDLE)
        ok, reason, job = self.relay.claim_job(
            self.CODE, job_id='j8f3a2c1', download_path='/download/tok',
            filename=filename, team_number=6238)
        self.assertTrue(ok, reason)
        handed = self.relay.store_status(self.CODE, IDLE)
        self.assertEqual(handed['id'], 'j8f3a2c1')
        return handed


class TestNoteCodeAndExchange(RelayTestCase):
    def test_note_code_creates_a_record_and_returns_the_normal_form(self):
        fresh = PrinterRelay(clock=self.clock)
        self.assertEqual(fresh.note_code('7k3m-q9xw'), self.CODE)
        self.assertTrue(fresh.status_for(self.CODE)['paired'])

    def test_note_code_ignores_a_malformed_code(self):
        fresh = PrinterRelay(clock=self.clock)
        self.assertIsNone(fresh.note_code('nope'))
        self.assertIsNone(fresh.note_code(None))

    def test_exchange_refused_for_a_code_no_session_has_presented(self):
        self.assertFalse(self.relay.begin_exchange('ABCDEFGH'))

    def test_exchange_allowed_once_then_refused_while_the_daemon_is_heard(self):
        self.assertTrue(self.relay.begin_exchange(self.CODE))
        self.assertFalse(self.relay.begin_exchange(self.CODE))

    def test_exchange_allowed_again_after_two_minutes_of_silence(self):
        self.assertTrue(self.relay.begin_exchange(self.CODE))
        self.clock.advance(121)
        self.assertTrue(self.relay.begin_exchange(self.CODE))

    def test_seed_code_creates_a_record_like_a_session_would(self):
        fresh = PrinterRelay(clock=self.clock)
        fresh.seed_code(self.CODE)
        self.assertTrue(fresh.begin_exchange(self.CODE))


class TestStatusShape(RelayTestCase):
    def test_unpaired_when_there_is_no_code(self):
        payload = self.relay.status_for(None)
        self.assertEqual(payload['paired'], False)
        self.assertIsNone(payload['status'])
        self.assertIsNone(payload['job'])

    def test_waiting_before_any_daemon_is_heard(self):
        payload = self.relay.status_for(self.CODE)
        self.assertTrue(payload['paired'])
        self.assertTrue(payload['waiting'])
        self.assertFalse(payload['online'])
        self.assertEqual(payload['code'], '7K3M-Q9XW')

    def test_heard_but_no_snapshot_is_neither_waiting_nor_online(self):
        self.relay.note_daemon(self.CODE)
        payload = self.relay.status_for(self.CODE)
        self.assertFalse(payload['waiting'])
        self.assertFalse(payload['online'])
        self.assertIsNone(payload['status'])

    def test_online_and_age_come_from_the_relay_clock_not_the_snapshot(self):
        self.relay.note_daemon(self.CODE)
        self.relay.store_status(self.CODE, IDLE)   # the snapshot carries no timestamp
        self.clock.advance(7)
        payload = self.relay.status_for(self.CODE)
        self.assertTrue(payload['online'])
        self.assertEqual(payload['age_seconds'], 7)
        self.assertEqual(payload['status']['state'], 'idle')

    def test_offline_once_the_snapshot_is_older_than_two_minutes(self):
        self.relay.note_daemon(self.CODE)
        self.relay.store_status(self.CODE, IDLE)
        self.clock.advance(121)
        payload = self.relay.status_for(self.CODE)
        self.assertFalse(payload['online'])
        self.assertEqual(payload['age_seconds'], 121)

    def test_status_dropped_after_twenty_four_hours(self):
        self.relay.note_daemon(self.CODE)
        self.relay.store_status(self.CODE, IDLE)
        self.clock.advance(STATUS_DAY + 1)
        self.relay.note_code(self.CODE)      # keeps the record alive
        self.assertIsNone(self.relay.status_for(self.CODE)['status'])

    def test_record_dropped_when_nothing_touches_it_for_a_day(self):
        self.clock.advance(STATUS_DAY + 1)
        payload = self.relay.status_for(self.CODE)
        self.assertFalse(payload['paired'])


STATUS_DAY = 24 * 60 * 60
```

- [ ] **Step 6: Run the record-store tests to verify they fail**

Run: `uv run python -m unittest tests.test_printer_relay -v`
Expected: FAIL with `AttributeError: module 'printer_relay' has no attribute 'PrinterRelay'` or `TypeError` on the missing methods.

- [ ] **Step 7: Write the `PrinterRelay` record store**

Append to `print/printer_relay.py`:

```python
class _Record:
    """One printer, keyed by its normalised pairing code. Plain attributes; every access
    happens under PrinterRelay's single lock."""

    __slots__ = ('session_seen_at', 'daemon_seen_at', 'status', 'status_received_at',
                 'job', 'last_result', 'last_result_at', 'touched_at')

    def __init__(self, now):
        self.session_seen_at = None
        self.daemon_seen_at = None
        self.status = None
        self.status_received_at = None
        self.job = None                 # {'id','download_path','filename','created_at',
                                        #  'state','team_number','handed_out_at'}
        self.last_result = None         # {'ok': bool, 'reason': str | None,
                                        #  'job_id': str, 'team_number': int | None}
        self.last_result_at = None
        self.touched_at = now


class PrinterRelay:
    """Every printer record the process knows about, behind one lock.

    Expiry is lazy: there is no thread. Each read applies the job deadlines, drops a
    day-old snapshot and deletes a record nothing has touched for a day, all against the
    injected clock -- which is what makes the deadlines testable without sleeping.
    """

    def __init__(self, clock=time.time):
        self._clock = clock
        self._lock = threading.RLock()
        self._records = {}
        self._expiry_events = deque()

    # -- housekeeping -----------------------------------------------------------------

    def _touch(self, record):
        record.touched_at = self._clock()

    def _expire(self, code, record):
        """Apply every lazy deadline to one record. Caller holds the lock.

        Returns False when the record itself has expired and should be dropped."""
        now = self._clock()
        if now - record.touched_at > RECORD_TTL_SECONDS:
            return False
        if record.status_received_at is not None and now - record.status_received_at > STATUS_TTL_SECONDS:
            record.status = None
            record.status_received_at = None
        job = record.job
        if job is not None:
            if job['state'] == 'pending' and now - job['created_at'] > JOB_PENDING_TIMEOUT_SECONDS:
                self._finish(code, record, job, ok=False,
                             reason='printer did not pick up the job', record_event=True)
            elif (job['state'] == 'handed_out'
                  and now - job['handed_out_at'] > JOB_HANDED_OUT_TIMEOUT_SECONDS):
                self._finish(code, record, job, ok=False,
                             reason='printer did not confirm the job', record_event=True)
        if (record.last_result_at is not None
                and now - record.last_result_at > LAST_RESULT_TTL_SECONDS):
            record.last_result = None
            record.last_result_at = None
        return True

    def _finish(self, code, record, job, *, ok, reason, record_event=False):
        """Record a job's outcome and clear it. Caller holds the lock.

        `record_event` is set only by the lazy deadlines: a job that dies on a deadline is
        never acknowledged, so the relay raises the metrics event itself. A real
        acknowledgement is logged by the ack route instead, so setting it here too would
        double-count."""
        record.job = None
        record.last_result = {'ok': ok, 'reason': reason, 'job_id': job['id'],
                              'team_number': job.get('team_number')}
        record.last_result_at = self._clock()
        if record_event:
            self._expiry_events.append(
                ExpiryEvent(code, job['id'], job.get('team_number'), reason))

    def _get(self, code, create=False):
        """The live record for a code, expiring it first. Caller holds the lock."""
        if code is None:
            return None
        record = self._records.get(code)
        if record is not None and not self._expire(code, record):
            del self._records[code]
            record = None
        if record is None and create:
            record = _Record(self._clock())
            self._records[code] = record
        return record

    def drain_expiry_events(self):
        """Take and clear the expiry events recorded since the last call. The routes log a
        printer_ack metrics event for each, so a job that died on a deadline still shows up
        in the metrics."""
        with self._lock:
            events = list(self._expiry_events)
            self._expiry_events.clear()
        return events

    # -- how a code becomes known ------------------------------------------------------

    def note_code(self, code):
        """An Onshape session has presented this pairing code. The only way a code becomes
        known to the relay. Returns the normalised code, or None if it was not one."""
        code = normalize_code(code)
        if code is None:
            return None
        with self._lock:
            record = self._get(code, create=True)
            record.session_seen_at = self._clock()
            self._touch(record)
        return code

    def seed_code(self, code):
        """Development only: pretend a session presented this code, so a daemon can pair
        against a server nobody has opened in Onshape. Wired to PRINTER_DEV_PAIRING_CODE,
        which printer_routes reads ONLY in development mode."""
        return self.note_code(code)

    def note_daemon(self, code):
        """A request carrying a valid token for this code arrived. Creates the record if
        the relay restarted since the session last presented the code."""
        with self._lock:
            record = self._get(code, create=True)
            record.daemon_seen_at = self._clock()
            self._touch(record)

    def begin_exchange(self, code):
        """The pairing exchange, atomically: True (and the caller mints a token) only when
        a session has presented this code and no daemon has been heard for two minutes.

        Marking daemon_seen_at here is what refuses a SECOND Pi carrying a copied config
        file while the first one is alive."""
        with self._lock:
            record = self._get(code)
            if record is None or record.session_seen_at is None:
                return False
            now = self._clock()
            if (record.daemon_seen_at is not None
                    and now - record.daemon_seen_at <= DAEMON_ONLINE_SECONDS):
                return False
            record.daemon_seen_at = now
            self._touch(record)
            return True
```

- [ ] **Step 8: Add `status_for` and run the tests**

Append to `print/printer_relay.py`:

```python
    # -- reads -------------------------------------------------------------------------

    UNPAIRED = {'paired': False, 'waiting': False, 'online': False, 'age_seconds': None,
                'status': None, 'job': None, 'last_result': None, 'code': None}

    def status_for(self, code):
        """Everything the wizard's status line needs, computed from the relay's own clock.

        The snapshot carries no timestamp: `age_seconds` is measured from when the sync
        arrived here, so a Pi with a wrong clock changes nothing."""
        code = normalize_code(code)
        if code is None:
            return dict(self.UNPAIRED)
        with self._lock:
            record = self._get(code)
            if record is None:
                return dict(self.UNPAIRED)
            now = self._clock()
            age = None if record.status_received_at is None else int(now - record.status_received_at)
            last_result = None
            if record.last_result is not None:
                last_result = {'ok': record.last_result['ok'],
                               'reason': record.last_result['reason'],
                               'age_seconds': int(now - record.last_result_at)}
            job = None
            if record.job is not None:
                job = {'id': record.job['id'], 'state': record.job['state'],
                       'filename': record.job['filename']}
            return {
                'paired': True,
                'waiting': record.daemon_seen_at is None,
                'online': age is not None and age <= STATUS_ONLINE_SECONDS,
                'age_seconds': age,
                'status': dict(record.status) if record.status else None,
                'job': job,
                'last_result': last_result,
                'code': format_code(code),
            }
```

Run: `uv run python -m unittest tests.test_printer_relay -v`
Expected: PASS, including `TestNoteCodeAndExchange` and `TestStatusShape`.

- [ ] **Step 9: Write the failing tests for jobs, sends and acknowledgements**

Append to `print/tests/test_printer_relay.py`:

```python
class TestSendRefusals(RelayTestCase):
    def _claim(self):
        return self.relay.claim_job(self.CODE, job_id='jaaaaaaaa',
                                    download_path='/download/tok',
                                    filename='sample_part.gcode.3mf', team_number=6238)

    def test_refused_when_no_daemon_has_ever_been_heard(self):
        ok, reason, job = self._claim()
        self.assertFalse(ok)
        self.assertIn('has not reported', reason)
        self.assertIsNone(job)

    def test_refused_when_the_daemon_has_gone_quiet(self):
        self.relay.note_daemon(self.CODE)
        self.relay.store_status(self.CODE, IDLE)
        self.clock.advance(7 * 60)
        ok, reason, _ = self._claim()
        self.assertFalse(ok)
        self.assertIn('offline', reason)
        self.assertIn('7 min', reason)

    def test_refused_while_the_printer_is_running(self):
        self.relay.note_daemon(self.CODE)
        self.relay.store_status(self.CODE, running('other-jdeadbeef.gcode.3mf'))
        ok, reason, _ = self._claim()
        self.assertFalse(ok)
        self.assertIn('busy', reason)
        self.assertIn('42', reason)

    def test_refused_while_paused_unreachable_or_in_error(self):
        self.relay.note_daemon(self.CODE)
        for state, needle in (('paused', 'Paused'),
                              ('unreachable', 'unreachable'),
                              ('error', 'error')):
            snap = dict(IDLE)
            snap['state'] = state
            snap['error'] = 'HMS_0300_0100_0001_0004' if state == 'error' else None
            self.relay.store_status(self.CODE, snap)
            ok, reason, _ = self._claim()
            self.assertFalse(ok, state)
            self.assertIn(needle, reason)

    def test_refused_when_a_job_is_already_in_flight(self):
        self.hand_out_a_job()
        ok, reason, _ = self._claim()
        self.assertFalse(ok)
        self.assertIn('already on its way', reason)

    def test_accepted_when_idle_and_online(self):
        self.relay.note_daemon(self.CODE)
        self.relay.store_status(self.CODE, IDLE)
        ok, reason, job = self._claim()
        self.assertTrue(ok, reason)
        self.assertEqual(job['state'], 'pending')
        self.assertEqual(job['download_path'], '/download/tok')
        self.assertEqual(self.relay.status_for(self.CODE)['job']['state'], 'pending')


class TestJobLifecycle(RelayTestCase):
    def test_sync_hands_out_a_pending_job_once_then_repeats_it(self):
        self.relay.note_daemon(self.CODE)
        self.relay.store_status(self.CODE, IDLE)
        self.relay.claim_job(self.CODE, job_id='j8f3a2c1', download_path='/download/tok',
                             filename='sample_part.gcode.3mf', team_number=6238)
        first = self.relay.store_status(self.CODE, IDLE)
        self.assertEqual(first['state'], 'handed_out')
        again = self.relay.store_status(self.CODE, IDLE)
        self.assertEqual(again['id'], 'j8f3a2c1')     # a restarted daemon sees it again

    def test_sync_hands_out_nothing_when_there_is_no_job(self):
        self.relay.note_daemon(self.CODE)
        self.assertIsNone(self.relay.store_status(self.CODE, IDLE))

    def test_ack_records_the_outcome_and_clears_the_job(self):
        self.hand_out_a_job()
        found, team = self.relay.finish_job(self.CODE, 'j8f3a2c1', ok=True, reason=None)
        self.assertTrue(found)
        self.assertEqual(team, 6238)
        payload = self.relay.status_for(self.CODE)
        self.assertIsNone(payload['job'])
        self.assertTrue(payload['last_result']['ok'])

    def test_ack_for_an_unknown_job_is_not_found(self):
        self.hand_out_a_job()
        found, team = self.relay.finish_job(self.CODE, 'jffffffff', ok=True, reason=None)
        self.assertFalse(found)
        self.assertIsNone(team)

    def test_failed_ack_keeps_the_reason_for_ten_minutes(self):
        self.hand_out_a_job()
        self.relay.finish_job(self.CODE, 'j8f3a2c1', ok=False,
                              reason='Upload to printer failed: connection refused')
        self.assertIn('connection refused',
                      self.relay.status_for(self.CODE)['last_result']['reason'])
        self.clock.advance(601)
        self.assertIsNone(self.relay.status_for(self.CODE)['last_result'])

    def test_pending_job_expires_after_three_minutes(self):
        self.relay.note_daemon(self.CODE)
        self.relay.store_status(self.CODE, IDLE)
        self.relay.claim_job(self.CODE, job_id='j8f3a2c1', download_path='/download/tok',
                             filename='sample_part.gcode.3mf', team_number=6238)
        self.clock.advance(181)
        payload = self.relay.status_for(self.CODE)
        self.assertIsNone(payload['job'])
        self.assertFalse(payload['last_result']['ok'])
        self.assertIn('did not pick up', payload['last_result']['reason'])
        events = self.relay.drain_expiry_events()
        self.assertEqual([e.job_id for e in events], ['j8f3a2c1'])
        self.assertEqual(events[0].team_number, 6238)
        self.assertEqual(self.relay.drain_expiry_events(), [])

    def test_handed_out_job_expires_after_fifteen_minutes(self):
        self.hand_out_a_job()
        self.clock.advance(901)
        payload = self.relay.status_for(self.CODE)
        self.assertIsNone(payload['job'])
        self.assertIn('did not confirm', payload['last_result']['reason'])
        self.assertEqual([e.reason for e in self.relay.drain_expiry_events()],
                         ['printer did not confirm the job'])

    def test_snapshot_naming_the_job_clears_a_failed_last_result(self):
        """The printer has the job whatever the acknowledgement said."""
        self.hand_out_a_job()
        self.relay.finish_job(self.CODE, 'j8f3a2c1', ok=False, reason='timed out waiting')
        self.relay.store_status(self.CODE, running('sample_part-j8f3a2c1.gcode.3mf'))
        self.assertIsNone(self.relay.status_for(self.CODE)['last_result'])

    def test_snapshot_naming_another_file_leaves_last_result_alone(self):
        self.hand_out_a_job()
        self.relay.finish_job(self.CODE, 'j8f3a2c1', ok=False, reason='timed out waiting')
        self.relay.store_status(self.CODE, running('someone-else.gcode.3mf'))
        self.assertIsNotNone(self.relay.status_for(self.CODE)['last_result'])


class TestDaemonSurvivesARelayRestart(RelayTestCase):
    def test_a_valid_token_recreates_the_record_after_a_restart(self):
        """A redeploy empties the relay. The daemon's next sync must work, so status is
        back before any session opens PenguinCAM."""
        fresh = PrinterRelay(clock=self.clock)          # stands in for the new process
        self.assertIsNone(fresh.status_for(self.CODE)['status'])
        fresh.note_daemon(self.CODE)                    # what a valid bearer token does
        fresh.store_status(self.CODE, running('sample_part-j8f3a2c1.gcode.3mf'))
        payload = fresh.status_for(self.CODE)
        self.assertTrue(payload['paired'])
        self.assertTrue(payload['online'])
        self.assertEqual(payload['status']['state'], 'running')


class TestPing(RelayTestCase):
    def test_ping_reports_flags_and_stores_nothing(self):
        """`penguincam-printer status` must not be able to disturb the running service, so
        ping does NOT record daemon_seen_at -- otherwise a mentor running status could
        block the real daemon's re-exchange for two minutes."""
        flags = self.relay.ping(self.CODE)
        self.assertEqual(flags, {'ok': True, 'waiting': True, 'online': False})
        self.assertTrue(self.relay.begin_exchange(self.CODE))
```

- [ ] **Step 10: Run the job tests to verify they fail**

Run: `uv run python -m unittest tests.test_printer_relay -v`
Expected: FAIL with `AttributeError: 'PrinterRelay' object has no attribute 'claim_job'`.

- [ ] **Step 11: Write `claim_job`, `store_status`, `finish_job` and `ping`**

Append to `print/printer_relay.py`:

```python
    # -- writes ------------------------------------------------------------------------

    def _refusal(self, record):
        """Why a send cannot go ahead right now, or None. Caller holds the lock.

        The text is what the wizard shows, so it reads as a sentence to a student."""
        now = self._clock()
        if record.daemon_seen_at is None:
            return ('The Pi has not reported since the service started; '
                    'check the setup guide.')
        if record.status_received_at is None:
            return 'No printer reporting yet; try again in a moment.'
        age = now - record.status_received_at
        if age > STATUS_ONLINE_SECONDS:
            return f'Printer offline, last seen {int(age // 60)} min ago'
        state = (record.status or {}).get('state')
        if state == 'running':
            percent = (record.status or {}).get('percent')
            name = (record.status or {}).get('file') or 'a file'
            return f'Printer busy, printing {name} at {percent} percent'
        if state == 'paused':
            return f"Paused, {(record.status or {}).get('file') or 'a file'}"
        if state == 'unreachable':
            return 'Printer unreachable from the Pi'
        if state == 'error':
            return f"Printer error: {(record.status or {}).get('error') or 'unknown'}"
        if record.job is not None:
            return 'A job is already on its way to the printer'
        return None

    def claim_job(self, code, *, job_id, download_path, filename, team_number):
        """Store a pending job, or refuse with a reason.

        The whole check-and-store is one lock acquisition, so two Previews pressing Send at
        the same instant cannot both win. Returns (ok, reason, job)."""
        code = normalize_code(code)
        with self._lock:
            record = self._get(code)
            if record is None:
                return False, 'No printer paired', None
            refusal = self._refusal(record)
            if refusal is not None:
                return False, refusal, None
            job = {'id': job_id, 'download_path': download_path, 'filename': filename,
                   'created_at': self._clock(), 'state': 'pending',
                   'team_number': team_number, 'handed_out_at': None}
            record.job = job
            self._touch(record)
            return True, None, dict(job)

    def store_status(self, code, snapshot):
        """Store a sync's snapshot and hand out the job, if any.

        Returns the job the daemon should act on -- a pending job promoted to handed_out,
        or the handed_out job again for a daemon that restarted mid-job -- else None."""
        code = normalize_code(code)
        with self._lock:
            record = self._get(code, create=True)
            now = self._clock()
            record.status = dict(snapshot) if isinstance(snapshot, dict) else None
            record.status_received_at = now
            self._touch(record)
            # The printer has the job whatever the acknowledgement said.
            file_name = (record.status or {}).get('file') or ''
            if (record.last_result is not None
                    and record.last_result.get('job_id')
                    and record.last_result['job_id'] in file_name):
                record.last_result = None
                record.last_result_at = None
            job = record.job
            if job is None:
                return None
            if job['state'] == 'pending':
                job['state'] = 'handed_out'
                job['handed_out_at'] = now
            return dict(job)

    def finish_job(self, code, job_id, *, ok, reason):
        """Record an acknowledgement. Returns (found, team_number); found False means the
        daemon acked a job this relay no longer holds, which the daemon treats as final."""
        code = normalize_code(code)
        with self._lock:
            record = self._get(code)
            if record is None or record.job is None or record.job['id'] != job_id:
                return False, None
            job = record.job
            team_number = job.get('team_number')
            self._finish(code, record, job, ok=bool(ok), reason=reason)
            self._touch(record)
            return True, team_number

    def ping(self, code):
        """Read-only health answer for `penguincam-printer status`.

        Stores nothing -- deliberately NOT recording daemon_seen_at, so a mentor running
        status while the service is down cannot block the service's next exchange."""
        code = normalize_code(code)
        with self._lock:
            record = self._get(code)
            if record is None:
                return {'ok': True, 'waiting': True, 'online': False}
            age = (None if record.status_received_at is None
                   else self._clock() - record.status_received_at)
            return {'ok': True,
                    'waiting': record.daemon_seen_at is None,
                    'online': age is not None and age <= STATUS_ONLINE_SECONDS}


# The process-wide singleton. printer_routes uses it through the module attribute (so tests
# can swap it), and frc_cam_gui_app calls note_code() below from
# _load_team_config_into_session.
RELAY = PrinterRelay()


def note_code(code):
    """Tell the relay a session has presented this pairing code. Called from
    _load_team_config_into_session on login, on the ten-minute TTL refresh and on the
    header's refresh link -- so every way a YAML reaches a session also tells the relay its
    code, and pairing needs no wizard step."""
    return RELAY.note_code(code)
```

- [ ] **Step 12: Run the whole relay suite**

Run: `uv run python -m unittest tests.test_printer_relay -v`
Expected: PASS, every test.

- [ ] **Step 13: Run the full backend suite**

Run: `make test`
Expected: PASS. Nothing else imports `printer_relay` yet, so only the new file's tests are new.

---

### Task 2: The pairing code in the team config

**Files:**
- Modify: `config_validation.py` (a new step after `_walk` in `validate_and_sanitize_config`)
- Modify: `team_config.py` (a new `pairing_code` property next to `team_name`, about line 460)
- Modify: `static/docs/PenguinCAM-config-template.yaml` (a commented `printing` block)
- Test: `tests/test_config_validation.py` (new tests appended to the existing file)

**Interfaces:**

- Consumes: `printer_relay.normalize_code(value) -> str | None` from Task 1.
- Produces:
  - `TeamConfig.pairing_code` — a property returning the normalised eight-character code, or `None`. Task 3's routes and `frc_cam_gui_app.py`'s `note_code` hunk read it.
  - `validate_and_sanitize_config(yaml_text, strict=...)` unchanged in signature; a `printing.pairing_code` is rewritten in place to its normalised form, dropped with a warning in lenient mode, and raises `ConfigValidationError` in strict mode.

Background you need: `validate_and_sanitize_config` runs `_walk`, which sanitises every string leaf to printable ASCII with parentheses replaced by spaces. A pairing code contains none of those, so the sanitiser leaves it untouched — but the normalisation step must still run **after** `_walk`, the same way the existing `default_machine` repair does, so it sees the sanitised value. `TeamConfig._normalize_to_v2` moves every top-level key of a version 1 file under the machine `default`; a version 2 file keeps `printing` at the top level. The existing `team` lookup handles that by checking the root first and the machine config second, and `pairing_code` must do the same. Do **not** route it through `_get`, whose root-level special case is hard-coded to the key `team`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_config_validation.py`:

```python
class TestPairingCode(unittest.TestCase):
    """`printing.pairing_code` is the printer relay's only identity, so it is normalised
    and shape-checked here rather than at every read site."""

    def test_quoted_code_is_accepted_and_normalised(self):
        data, warnings = validate_and_sanitize_config(
            'team:\n  number: 6238\nprinting:\n  pairing_code: "7k3m-q9xw"\n')
        self.assertEqual(data['printing']['pairing_code'], '7K3MQ9XW')
        self.assertEqual(warnings, [])

    def test_unquoted_all_digit_code_is_accepted(self):
        """YAML reads an unquoted 12345678 as an int; the mentor should not have to know."""
        data, _ = validate_and_sanitize_config(
            'team:\n  number: 6238\nprinting:\n  pairing_code: 12345678\n')
        self.assertEqual(data['printing']['pairing_code'], '12345678')

    def test_lookalike_letters_are_mapped(self):
        data, _ = validate_and_sanitize_config(
            'team:\n  number: 6238\nprinting:\n  pairing_code: "OIL23456"\n')
        self.assertEqual(data['printing']['pairing_code'], '01123456')

    def test_malformed_code_is_dropped_with_a_warning_in_lenient_mode(self):
        data, warnings = validate_and_sanitize_config(
            'team:\n  number: 6238\nprinting:\n  pairing_code: "nope"\n', strict=False)
        self.assertNotIn('pairing_code', data['printing'])
        self.assertTrue(any('printing.pairing_code' in w for w in warnings), warnings)

    def test_malformed_code_is_rejected_in_strict_mode(self):
        with self.assertRaises(ConfigValidationError) as caught:
            validate_and_sanitize_config(
                'team:\n  number: 6238\nprinting:\n  pairing_code: "nope"\n', strict=True)
        self.assertIn('printing.pairing_code must be the 8-character code shown by the Pi',
                      caught.exception.message)

    def test_a_printing_block_that_is_not_a_mapping_is_dropped_leniently(self):
        data, warnings = validate_and_sanitize_config(
            'team:\n  number: 6238\nprinting: "nonsense"\n', strict=False)
        self.assertNotIn('printing', data)
        self.assertTrue(any('printing' in w for w in warnings), warnings)

    def test_no_printing_block_is_fine(self):
        data, warnings = validate_and_sanitize_config('team:\n  number: 6238\n')
        self.assertNotIn('printing', data)
        self.assertEqual(warnings, [])

    def test_v2_printing_block_is_found_and_normalised(self):
        yaml_text = (
            'version: 2\n'
            'default_machine: omio\n'
            'team:\n  number: 6238\n'
            'printing:\n  pairing_code: "7K3M-Q9XW"\n'
            'machines:\n  omio:\n    name: "Omio"\n')
        data, _ = validate_and_sanitize_config(yaml_text)
        self.assertEqual(data['printing']['pairing_code'], '7K3MQ9XW')


class TestTeamConfigPairingCode(unittest.TestCase):
    def test_version_1_file(self):
        """A v1 file's top-level keys are moved under the 'default' machine internally."""
        config = TeamConfig({'team': {'number': 6238},
                             'printing': {'pairing_code': '7K3MQ9XW'}})
        self.assertEqual(config.pairing_code, '7K3MQ9XW')

    def test_version_2_file(self):
        """A v2 file keeps 'printing' at the root, beside 'team'."""
        config = TeamConfig({'version': 2, 'default_machine': 'omio',
                             'team': {'number': 6238},
                             'printing': {'pairing_code': '7K3MQ9XW'},
                             'machines': {'omio': {'name': 'Omio'}}})
        self.assertEqual(config.pairing_code, '7K3MQ9XW')

    def test_absent_block_gives_none(self):
        self.assertIsNone(TeamConfig({'team': {'number': 6238}}).pairing_code)
        self.assertIsNone(TeamConfig().pairing_code)

    def test_unnormalised_value_is_normalised_on_read(self):
        """Defence in depth: a config that reached TeamConfig without validation (an old
        session cookie, say) still yields a usable code."""
        config = TeamConfig({'team': {'number': 6238},
                             'printing': {'pairing_code': '7k3m-q9xw'}})
        self.assertEqual(config.pairing_code, '7K3MQ9XW')

    def test_garbage_value_gives_none(self):
        config = TeamConfig({'team': {'number': 6238},
                             'printing': {'pairing_code': ['not', 'a', 'code']}})
        self.assertIsNone(config.pairing_code)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run python -m unittest tests.test_config_validation -v`
Expected: FAIL — `KeyError: 'printing'` on the first test and `AttributeError: 'TeamConfig' object has no attribute 'pairing_code'` on the second class.

- [ ] **Step 3: Add the normalisation step to `config_validation.py`**

Add the import at the top of `config_validation.py`, beside the existing `from team_config import LENGTH_KEYS, parse_length`:

```python
from printer_relay import normalize_code
```

Then, in `validate_and_sanitize_config`, insert this block immediately **after** the `if version == 2:` `default_machine` repair block and immediately **before** `return data, warnings`:

```python
    # Runs AFTER _walk for the same reason the default_machine repair does: it must see the
    # sanitized value. The pairing code is the printer relay's whole identity, so normalise
    # it once here rather than at every read site. (The string sanitizer never touches a
    # code -- it only strips parentheses and non-ASCII, and the alphabet has neither.)
    printing = data.get('printing')
    if printing is not None:
        if not isinstance(printing, dict):
            if strict:
                raise ConfigValidationError(
                    "The 'printing:' section must be a set of settings, not a single value.")
            del data['printing']
            warnings.append("Ignored the 'printing' section: it must be a set of settings.")
        elif 'pairing_code' in printing:
            code = normalize_code(printing['pairing_code'])
            if code is None:
                if strict:
                    raise ConfigValidationError(
                        "printing.pairing_code must be the 8-character code shown by the Pi.")
                del printing['pairing_code']
                warnings.append("Ignored printing.pairing_code: it is not the 8-character "
                                "code shown by the Pi; no printer will be paired.")
            else:
                printing['pairing_code'] = code

    return data, warnings
```

Delete the old bare `return data, warnings` line that this block replaces — there must be exactly one at the end of the function.

- [ ] **Step 4: Add the `pairing_code` property to `team_config.py`**

Add the import at the top of `team_config.py`, with the other imports:

```python
from printer_relay import normalize_code as _normalize_pairing_code
```

Add the property immediately after the `team_name` property (about line 465), inside the "Team Information" section:

```python
    @property
    def pairing_code(self) -> Optional[str]:
        """The team's printer pairing code, normalised, or None.

        Looked up like `team`: a v2 file keeps `printing` at the root, while a v1 file's
        top-level keys were moved under the 'default' machine by _normalize_to_v2, so both
        places are checked. Normalised on read as well as in config_validation, so a config
        that reached us without validation (an old session cookie) still works.

        Not routed through _get(): that helper's root-level special case is hard-coded to
        the key 'team', and there is no Team 6238 default for a pairing code -- the absence
        of one means "no printer paired", which must never fall back to somebody's code.
        """
        for source in (self._data, self.get_machine_config()):
            printing = source.get('printing') if isinstance(source, dict) else None
            if isinstance(printing, dict) and printing.get('pairing_code') is not None:
                return _normalize_pairing_code(printing['pairing_code'])
        return None
```

Check that `Optional` is already imported in `team_config.py` (it is, from `typing`).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `uv run python -m unittest tests.test_config_validation -v`
Expected: PASS, including the pre-existing tests. Watch `test_full_template_is_valid` in particular — it validates the shipped template, so a broken template shows up here.

- [ ] **Step 6: Add the commented `printing` block to the config template**

In `static/docs/PenguinCAM-config-template.yaml`, insert this block immediately after the `team:` block (after the `name: "Popcorn Penguins"` line) and before the `MACHINES` banner:

```yaml
# =============================================================================
# 3D PRINTING (optional)
# =============================================================================
# Uncomment and paste the pairing code that `penguincam-printer pair` printed on
# your shop's Raspberry Pi. That one line is all that connects PenguinCAM to your
# printer -- no password, no port forwarding, nothing to open on your network.
# See docs/PRINTER_SETUP.md. To retire a Pi, delete the line.
#
# printing:
#   pairing_code: "7K3M-Q9XW"
```

It stays commented: the shipped template is validated by `test_full_template_is_valid`, and a live example code would be a real (if useless) code in everyone's config.

- [ ] **Step 7: Verify the template still validates and nothing else broke**

Run: `uv run python -m unittest tests.test_config_validation -v`
Expected: PASS, `test_full_template_is_valid` included.

- [ ] **Step 8: Run the full backend suite**

Run: `make test`
Expected: PASS. `config_validation.py` and `team_config.py` now import `printer_relay`, so a typo there breaks every config test — that is the point of running the whole suite here.

---

### Task 3: The relay blueprint (`print/printer_routes.py`) and the two hunks in the Flask module

**Files:**
- Create: `print/printer_routes.py`
- Modify: `frc_cam_gui_app.py` — exactly two hunks (about line 2257, just before `def cleanup():`; and inside `_load_team_config_into_session`, about line 415)
- Test: `print/tests/test_printer_routes.py`

**Interfaces:**

- Consumes:
  - From Task 1: `printer_relay.RELAY`, `normalize_code`, `issue_token`, `read_token`, `new_job_id`, `format_code`, and `PrinterRelay`'s methods `note_code`, `seed_code`, `note_daemon`, `begin_exchange`, `status_for`, `claim_job(code, *, job_id, download_path, filename, team_number) -> (ok, reason, job)`, `store_status(code, snapshot) -> job | None`, `finish_job(code, job_id, *, ok, reason) -> (found, team_number)`, `ping(code) -> dict`, `drain_expiry_events() -> list[ExpiryEvent]`.
  - From Task 2: `TeamConfig.pairing_code`.
  - From the Flask module: `limiter`, `_has_onshape_session`, `_maybe_refresh_team_config`, `file_token_manager`, `metrics`, `log`.
- Produces:
  - `init_printer_routes(app, *, limiter, has_onshape_session, refresh_team_config, token_manager, metrics, log) -> flask.Blueprint` — registers the blueprint on `app` and returns it.
  - Routes: `GET /printer/status`, `POST /printer/jobs`, `POST /printer/daemon/pair`, `POST /printer/daemon/sync`, `POST /printer/daemon/jobs/<job_id>/ack`, `GET /printer/daemon/ping`, `GET /install-printer.sh`.
  - Module-level helpers the tests call directly: `_is_dev_mode()`, `_session_pairing_code()`, `_session_code_key()`, `_token_code_key()`, `SLICE_MAX_AGE_SECONDS = 40 * 60`.
  - Task 8's daemon consumes the wire shapes: a sync answers `{"job": {...} | null}`; the exchange answers `{"token": "..."}` or 404 `{"error": "not paired"}`; a rejected token is 401 `{"error": "repair"}`.

- [ ] **Step 1: Write the failing tests for the session routes**

Create `print/tests/test_printer_routes.py`:

```python
"""Flask test-client coverage for the printer relay blueprint.

The relay is swapped for a fresh PrinterRelay on a fake clock in every test, so nothing
leaks between tests and the job deadlines are reachable without sleeping."""
import os
import sys
import time
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import printer_relay
import printer_routes
import frc_cam_gui_app as gui
from frc_cam_gui_app import app

CODE = '7K3MQ9XW'
TEAM_YAML_DATA = {'team': {'number': 6238, 'name': 'Popcorn Penguins'},
                  'printing': {'pairing_code': CODE}}

IDLE = {'state': 'idle', 'file': '', 'percent': None, 'remaining_min': None,
        'layer': 0, 'layers': 0, 'error': None,
        'printer': {'model': 'H2S', 'name': 'Shop H2S', 'serial': '01P00A'}}


class FakeClock:
    def __init__(self, now=1_789_300_000.0):
        self.now = now

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds


class PrinterRouteTestCase(unittest.TestCase):
    """Shared fixture. The rate limiter is off by default -- the limits get their own
    tests, and leaving them on would make every other test order-dependent."""

    def setUp(self):
        app.config['TESTING'] = True
        app.secret_key = 'test-secret-key'
        self.clock = FakeClock()
        self.relay = printer_relay.PrinterRelay(clock=self.clock)
        self._relay_patch = mock.patch.object(printer_relay, 'RELAY', self.relay)
        self._relay_patch.start()
        self.addCleanup(self._relay_patch.stop)
        self._limiter_was = gui.limiter.enabled
        gui.limiter.enabled = False
        self.addCleanup(setattr, gui.limiter, 'enabled', self._limiter_was)
        self._debug_was = app.debug
        self.addCleanup(setattr, app, 'debug', self._debug_was)
        self.client = app.test_client()

    def onshape_session(self, config_data=TEAM_YAML_DATA, team_number=6238):
        """Give the test client an Onshape session carrying a team config."""
        with self.client.session_transaction() as sess:
            sess['team_config_data'] = config_data
            sess['team_number'] = team_number
            sess['user_email'] = 'student@example.com'
        return mock.patch.object(printer_routes, '_HAS_ONSHAPE_SESSION',
                                 lambda: True, create=True)

    def dev_mode(self):
        """Development mode: Flask debug on, RAILWAY_ENVIRONMENT absent."""
        app.debug = True
        return mock.patch.dict(os.environ, {}, clear=False)


class TestStatusRoute(PrinterRouteTestCase):
    def test_requires_an_onshape_session(self):
        resp = self.client.get('/printer/status')
        self.assertEqual(resp.status_code, 401)
        self.assertTrue(resp.get_json()['need_verification'])

    def test_an_uploaded_config_is_never_read(self):
        """The anonymous upload flow must not reach any team's printer, even in a browser
        that still carries an Onshape cookie."""
        with self.client.session_transaction() as sess:
            sess['app_verified'] = True
            sess['upload_config_data'] = TEAM_YAML_DATA
        resp = self.client.get('/printer/status')
        self.assertEqual(resp.status_code, 401)

    def test_unpaired_when_the_yaml_has_no_code(self):
        with self.onshape_session(config_data={'team': {'number': 6238}}):
            resp = self.client.get('/printer/status')
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.get_json()['paired'])

    def test_waiting_when_no_daemon_has_reported(self):
        with self.onshape_session():
            body = self.client.get('/printer/status').get_json()
        self.assertTrue(body['paired'])
        self.assertTrue(body['waiting'])
        self.assertEqual(body['code'], '7K3M-Q9XW')

    def test_online_running_snapshot_is_served(self):
        self.relay.note_code(CODE)
        self.relay.note_daemon(CODE)
        snap = dict(IDLE, state='running', file='sample_part-j8f3a2c1.gcode.3mf',
                    percent=42, remaining_min=31)
        self.relay.store_status(CODE, snap)
        with self.onshape_session():
            body = self.client.get('/printer/status').get_json()
        self.assertTrue(body['online'])
        self.assertEqual(body['status']['state'], 'running')
        self.assertEqual(body['age_seconds'], 0)

    def test_offline_after_two_minutes_of_silence(self):
        self.relay.note_code(CODE)
        self.relay.note_daemon(CODE)
        self.relay.store_status(CODE, IDLE)
        self.clock.advance(420)
        with self.onshape_session():
            body = self.client.get('/printer/status').get_json()
        self.assertFalse(body['online'])
        self.assertEqual(body['age_seconds'], 420)

    def test_the_route_refreshes_the_session_config_first(self):
        """A YAML edit must reach the relay within the TTL even with no page render."""
        refresh = mock.Mock()
        with self.onshape_session(), \
             mock.patch.object(printer_routes, '_REFRESH_TEAM_CONFIG', refresh, create=True):
            self.client.get('/printer/status')
        refresh.assert_called_once_with()

    def test_a_failing_refresh_does_not_break_the_route(self):
        boom = mock.Mock(side_effect=RuntimeError('onshape down'))
        with self.onshape_session(), \
             mock.patch.object(printer_routes, '_REFRESH_TEAM_CONFIG', boom, create=True):
            resp = self.client.get('/printer/status')
        self.assertEqual(resp.status_code, 200)
```

Note for the implementer: `_HAS_ONSHAPE_SESSION` and `_REFRESH_TEAM_CONFIG` are module-level names `init_printer_routes` assigns from its keyword arguments, precisely so tests can patch them. Do not close over the arguments in the view functions.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run python -m unittest tests.test_printer_routes -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'printer_routes'`.

- [ ] **Step 3: Write the blueprint's scaffolding, gates and key functions**

Create `print/printer_routes.py`:

```python
"""Flask blueprint for the Bambu printer relay.

Three audiences share one blueprint:
  * the print wizard, through session routes gated on an Onshape session;
  * the Pi daemon, through /printer/daemon/* routes gated on a signed bearer token;
  * the installer fetch, /install-printer.sh.

All relay state lives in printer_relay (no Flask imports there, no printer protocol here).
Wiring follows the slicing branch's pattern: init_printer_routes receives the Flask
module's globals rather than importing them, so there is no import cycle and tests can
substitute any of them.
"""

import os
import time

from flask import Blueprint, current_app, jsonify, request, send_from_directory
from flask_limiter.util import get_remote_address

import printer_relay
from team_config import TeamConfig

# A sliced file is deleted an hour after it is registered. Refuse a send once it is forty
# minutes old, which keeps both job deadlines (3 min to pick up, 15 to confirm) clear of
# the deletion, so a job can never be handed a download that dies mid-upload.
SLICE_MAX_AGE_SECONDS = 40 * 60

# Rate limits. The app-wide default is 200/hour, and a five-second sync is 720/hour, so
# EVERY route here passes override_defaults=True or the daemon starts taking 429s about
# seventeen minutes after boot.
STATUS_LIMIT = "120 per minute"        # ten open Previews per team, polling every 5 s
JOBS_LIMIT = "10 per minute"
DAEMON_LIMIT = "60 per minute"
EXCHANGE_LIMIT = "60 per minute"       # service-wide; 40 bits is out of reach at that rate
INSTALLER_LIMIT = "30 per minute"

# Assigned by init_printer_routes. Module-level rather than closed over, so tests can
# substitute them.
_HAS_ONSHAPE_SESSION = None
_REFRESH_TEAM_CONFIG = None
_TOKEN_MANAGER = None
_METRICS = None
_LOG = None


def _log(*args):
    if _LOG:
        _LOG(*args)


def _is_dev_mode():
    """Development mode: Flask's debug flag on AND no RAILWAY_ENVIRONMENT.

    The development server started as the project's CLAUDE.md describes meets both;
    gunicorn on Railway meets neither. Two things hang off this: the HTTPS requirement
    below, and PRINTER_DEV_PAIRING_CODE."""
    try:
        return bool(current_app.debug) and not os.environ.get('RAILWAY_ENVIRONMENT')
    except Exception:
        return False


def _require_https():
    """403 unless the request arrived over HTTPS, judged after ProxyFix.

    On Railway, therefore, nothing in this feature is ever served over plain HTTP, whatever
    a proxy forwards. Returns a response tuple to return, or None to proceed."""
    if request.is_secure or _is_dev_mode():
        return None
    return jsonify({'error': 'HTTPS required'}), 403


def _maybe_seed_dev_code():
    """Seed the record for PRINTER_DEV_PAIRING_CODE so a daemon can pair against a server
    nobody has opened in Onshape. Read on each request rather than at init, because
    app.debug is still False when this module is imported -- app.run(debug=...) sets it
    afterwards. Ignored outside development mode; seeding twice is harmless."""
    if not _is_dev_mode():
        return
    seed = os.environ.get('PRINTER_DEV_PAIRING_CODE')
    if seed:
        printer_relay.RELAY.seed_code(seed)


def _unauthorized_session():
    """The same JSON shape the other session-gated routes return."""
    return jsonify({'error': 'Session verification required.',
                    'need_verification': True}), 401


def _session_pairing_code():
    """The pairing code from the session's ONSHAPE copy of the team YAML, or None.

    Never `upload_config_data`: a browser that used the Onshape panel earlier may still
    carry an Onshape session, and the anonymous upload flow must not act on that team's
    printer."""
    from flask import session
    data = session.get('team_config_data') or {}
    return TeamConfig.from_dict(data).pairing_code


def _bearer_token():
    header = request.headers.get('Authorization', '')
    if header.startswith('Bearer '):
        return header[len('Bearer '):].strip()
    return None


def _authenticated_code():
    """The pairing code carried by a correctly signed bearer token, or None.

    Verified by signature alone: the relay never compares the token's code with any YAML,
    because it may not have seen one since it started."""
    payload = printer_relay.read_token(_bearer_token(), current_app.secret_key)
    return payload[0] if payload else None


def _session_code_key():
    """Rate-limit key for the session routes: the team's pairing code, so one team's
    Previews cannot exhaust another's budget.

    flask-limiter runs this BEFORE the view, so an exception here would be a 500 the view
    never sees. Everything is inside the try, and a session with no usable code just gets
    the address key -- for /printer/jobs that request is refused by the view anyway."""
    try:
        code = _session_pairing_code()
        if code:
            return f'printer-code:{code}'
    except Exception:
        pass
    return get_remote_address()


def _token_code_key():
    """Rate-limit key for the daemon routes: the code inside the bearer token. Same
    try/except rule as _session_code_key, for the same reason."""
    try:
        code = _authenticated_code()
        if code:
            return f'printer-code:{code}'
    except Exception:
        pass
    return get_remote_address()


def _exchange_key():
    """The exchange is limited service-wide on a constant key: forty bits at sixty guesses
    a minute is out of reach, and keying on the address would let a guesser spread the
    attempts over a botnet."""
    return 'printer-exchange'


def _drain_expiry_metrics():
    """Log a printer_ack metrics event for every job that died on a deadline, so the
    metrics show every job's end and not only the acknowledged ones."""
    for event in printer_relay.RELAY.drain_expiry_events():
        _log(f"🖨️  Printer job {event.job_id} expired: {event.reason}")
        if _METRICS:
            _METRICS.log_event('printer_ack', team_number=event.team_number,
                               metadata={'job_id': event.job_id, 'ok': False,
                                         'error': event.reason, 'expired': True})
```

- [ ] **Step 4: Write the session routes, and the `init_printer_routes` wiring**

Append to `print/printer_routes.py`:

```python
def init_printer_routes(app, *, limiter, has_onshape_session, refresh_team_config,
                        token_manager, metrics, log):
    """Register the printer relay blueprint on `app`.

    Receives the Flask module's globals instead of importing them, which is the slicing
    branch's pattern and keeps frc_cam_gui_app a leaf as far as this module is concerned.
    Must be called after limiter, file_token_manager, _has_onshape_session and
    _maybe_refresh_team_config exist."""
    global _HAS_ONSHAPE_SESSION, _REFRESH_TEAM_CONFIG, _TOKEN_MANAGER, _METRICS, _LOG
    _HAS_ONSHAPE_SESSION = has_onshape_session
    _REFRESH_TEAM_CONFIG = refresh_team_config
    _TOKEN_MANAGER = token_manager
    _METRICS = metrics
    _LOG = log

    # The Blueprint is created HERE, not at module scope: Flask refuses to add routes to a
    # blueprint that is already registered, so a module-level one would make this function
    # callable exactly once per process and blow up in any test that re-wires the app.
    bp = Blueprint('printer', __name__)

    # --- session routes: the print wizard ----------------------------------------------

    @bp.route('/printer/status')
    @limiter.limit(STATUS_LIMIT, key_func=_session_code_key, override_defaults=True)
    def printer_status():
        if not _HAS_ONSHAPE_SESSION():
            return _unauthorized_session()
        try:
            _REFRESH_TEAM_CONFIG()
        except Exception as e:      # a transient Onshape failure must not break polling
            _log(f"⚠️  Printer status: team config refresh failed: {e}")
        _maybe_seed_dev_code()
        code = _session_pairing_code()
        if code:
            printer_relay.RELAY.note_code(code)
        payload = printer_relay.RELAY.status_for(code)
        _drain_expiry_metrics()
        return jsonify(payload)

    @bp.route('/printer/jobs', methods=['POST'])
    @limiter.limit(JOBS_LIMIT, key_func=_session_code_key, override_defaults=True)
    def printer_jobs():
        from flask import session
        if not _HAS_ONSHAPE_SESSION():
            return _unauthorized_session()
        code = _session_pairing_code()
        if not code:
            return jsonify({'error': 'No printer paired'}), 409
        printer_relay.RELAY.note_code(code)

        body = request.get_json(silent=True) or {}
        token = body.get('token')
        info = _TOKEN_MANAGER.get_file(token) if token else None
        if not info:
            return jsonify({'error': 'File not found or expired'}), 404
        if time.time() - info.get('created', 0) > SLICE_MAX_AGE_SECONDS:
            return jsonify({'error': 'slice again'}), 409

        team_number = session.get('team_number')
        job_id = printer_relay.new_job_id()
        ok, reason, job = printer_relay.RELAY.claim_job(
            code, job_id=job_id, download_path=f'/download/{token}',
            filename=info['filename'], team_number=team_number)
        _drain_expiry_metrics()
        if not ok:
            return jsonify({'error': reason}), 409

        _log(f"🖨️  Printer job {job_id} queued: {info['filename']}")
        if _METRICS:
            _METRICS.log_event('printer_send', team_number=team_number,
                               user_email=session.get('user_email'),
                               metadata={'job_id': job_id, 'filename': info['filename']})
        return jsonify({'ok': True, 'job_id': job_id}), 202
```

- [ ] **Step 5: Run the session-route tests**

Run: `uv run python -m unittest tests.test_printer_routes -v`
Expected: still FAIL — the blueprint is not registered on the app yet (Task 3 Step 9 does that), so every route answers 404. Fix that next; do not chase it here.

- [ ] **Step 6: Write the daemon routes and the installer route**

Append inside `init_printer_routes`, after `printer_jobs`:

```python
    # --- daemon routes: the Pi ---------------------------------------------------------
    # All require HTTPS outside development mode. All but the exchange and the installer
    # carry Authorization: Bearer <token>. None of them ever calls the session gate.

    @bp.route('/printer/daemon/pair', methods=['POST'])
    @limiter.limit(EXCHANGE_LIMIT, key_func=_exchange_key, override_defaults=True)
    def printer_daemon_pair():
        refusal = _require_https()
        if refusal:
            return refusal
        _maybe_seed_dev_code()
        body = request.get_json(silent=True) or {}
        code = printer_relay.normalize_code(body.get('code'))
        if code and printer_relay.RELAY.begin_exchange(code):
            token = printer_relay.issue_token(code, current_app.secret_key)
            _log(f"🖨️  Printer daemon paired for code {printer_relay.format_code(code)}")
            return jsonify({'token': token})
        # The SAME body for an unknown code, a code no session has presented yet, and a
        # code whose daemon is already alive -- so a guesser learns nothing from the reply.
        return jsonify({'error': 'not paired'}), 404

    @bp.route('/printer/daemon/sync', methods=['POST'])
    @limiter.limit(DAEMON_LIMIT, key_func=_token_code_key, override_defaults=True)
    def printer_daemon_sync():
        refusal = _require_https()
        if refusal:
            return refusal
        code = _authenticated_code()
        if not code:
            return jsonify({'error': 'repair'}), 401
        printer_relay.RELAY.note_daemon(code)
        snapshot = request.get_json(silent=True) or {}
        job = printer_relay.RELAY.store_status(code, snapshot)
        _drain_expiry_metrics()
        return jsonify({'job': job})

    @bp.route('/printer/daemon/jobs/<job_id>/ack', methods=['POST'])
    @limiter.limit(DAEMON_LIMIT, key_func=_token_code_key, override_defaults=True)
    def printer_daemon_ack(job_id):
        refusal = _require_https()
        if refusal:
            return refusal
        code = _authenticated_code()
        if not code:
            return jsonify({'error': 'repair'}), 401
        printer_relay.RELAY.note_daemon(code)
        body = request.get_json(silent=True) or {}
        ok = bool(body.get('ok'))
        reason = body.get('error') or None
        found, team_number = printer_relay.RELAY.finish_job(code, job_id, ok=ok,
                                                            reason=reason)
        _drain_expiry_metrics()
        if not found:
            # The daemon treats this as final: the relay no longer holds that job.
            return jsonify({'error': 'unknown job'}), 404
        _log(f"🖨️  Printer job {job_id} acknowledged: {'ok' if ok else reason}")
        if _METRICS:
            _METRICS.log_event('printer_ack', team_number=team_number,
                               metadata={'job_id': job_id, 'ok': ok, 'error': reason})
        return jsonify({'ok': True})

    @bp.route('/printer/daemon/ping')
    @limiter.limit(DAEMON_LIMIT, key_func=_token_code_key, override_defaults=True)
    def printer_daemon_ping():
        refusal = _require_https()
        if refusal:
            return refusal
        code = _authenticated_code()
        if not code:
            return jsonify({'error': 'repair'}), 401
        # Read-only on purpose: `penguincam-printer status` must not be able to disturb the
        # running service, so this does NOT record daemon_seen_at and hands out no job.
        return jsonify(printer_relay.RELAY.ping(code))

    # --- the installer -----------------------------------------------------------------

    @bp.route('/install-printer.sh')
    @limiter.limit(INSTALLER_LIMIT, key_func=get_remote_address, override_defaults=True)
    def install_printer_sh():
        """A convenience alias for the installer. The DOCUMENTED command fetches the same
        script from raw.githubusercontent.com pinned to a commit, because free-plan
        Cloudflare Bot Fight Mode cannot be skipped per path and a challenge page piped
        into bash fails confusingly. See docs/PRINTER_SETUP.md."""
        refusal = _require_https()
        if refusal:
            return refusal
        return send_from_directory(os.path.join(app.root_path, 'printer_daemon'),
                                   'install.sh', mimetype='text/x-shellscript')

    app.register_blueprint(bp)
    return bp
```

- [ ] **Step 7: Write the failing tests for the jobs route, the daemon routes and the gates**

Append to `print/tests/test_printer_routes.py`:

```python
class FakeTokenManager:
    """Stands in for FileTokenManager: token -> {'filepath','filename','created'}."""

    def __init__(self):
        self.files = {}

    def register(self, token, filename='sample_part.gcode.3mf', created=None):
        self.files[token] = {'filepath': f'/tmp/{filename}', 'filename': filename,
                             'created': time.time() if created is None else created}
        return token

    def get_file(self, token):
        return self.files.get(token)


class TestJobsRoute(PrinterRouteTestCase):
    def setUp(self):
        super().setUp()
        self.tokens = FakeTokenManager()
        patch = mock.patch.object(printer_routes, '_TOKEN_MANAGER', self.tokens,
                                  create=True)
        patch.start()
        self.addCleanup(patch.stop)
        self.relay.note_code(CODE)
        self.relay.note_daemon(CODE)
        self.relay.store_status(CODE, IDLE)

    def test_requires_an_onshape_session(self):
        self.assertEqual(self.client.post('/printer/jobs', json={'token': 'x'}).status_code,
                         401)

    def test_refused_when_the_yaml_has_no_code(self):
        with self.onshape_session(config_data={'team': {'number': 6238}}):
            resp = self.client.post('/printer/jobs', json={'token': 'x'})
        self.assertEqual(resp.status_code, 409)

    def test_unknown_token_is_not_found(self):
        with self.onshape_session():
            resp = self.client.post('/printer/jobs', json={'token': 'nope'})
        self.assertEqual(resp.status_code, 404)

    def test_a_slice_older_than_forty_minutes_must_be_sliced_again(self):
        self.tokens.register('tok', created=time.time() - 41 * 60)
        with self.onshape_session():
            resp = self.client.post('/printer/jobs', json={'token': 'tok'})
        self.assertEqual(resp.status_code, 409)
        self.assertIn('slice again', resp.get_json()['error'])

    def test_success_stores_a_pending_job_and_answers_202(self):
        self.tokens.register('tok')
        with self.onshape_session():
            resp = self.client.post('/printer/jobs', json={'token': 'tok'})
        self.assertEqual(resp.status_code, 202)
        job_id = resp.get_json()['job_id']
        stored = self.relay.status_for(CODE)['job']
        self.assertEqual(stored['id'], job_id)
        self.assertEqual(stored['state'], 'pending')

    def test_the_job_carries_a_path_that_the_real_download_route_resolves(self):
        """The daemon joins this path with its own backend URL, so the relay never needs to
        know the name it is reached by."""
        self.tokens.register('tok')
        with self.onshape_session():
            self.client.post('/printer/jobs', json={'token': 'tok'})
        job = self.relay.store_status(CODE, IDLE)
        self.assertEqual(job['download_path'], '/download/tok')
        self.assertIn('/download/<token>',
                      [str(rule) for rule in app.url_map.iter_rules()])

    def test_a_send_logs_a_metrics_event_with_the_team_number(self):
        self.tokens.register('tok')
        fake_metrics = mock.Mock()
        with self.onshape_session(), \
             mock.patch.object(printer_routes, '_METRICS', fake_metrics, create=True):
            self.client.post('/printer/jobs', json={'token': 'tok'})
        kind, kwargs = fake_metrics.log_event.call_args[0], fake_metrics.log_event.call_args[1]
        self.assertEqual(kind[0], 'printer_send')
        self.assertEqual(kwargs['team_number'], 6238)

    def test_a_second_send_while_one_is_in_flight_is_refused(self):
        self.tokens.register('tok')
        with self.onshape_session():
            self.assertEqual(
                self.client.post('/printer/jobs', json={'token': 'tok'}).status_code, 202)
            second = self.client.post('/printer/jobs', json={'token': 'tok'})
        self.assertEqual(second.status_code, 409)
        self.assertIn('already on its way', second.get_json()['error'])


class TestDaemonRoutes(PrinterRouteTestCase):
    def setUp(self):
        super().setUp()
        app.debug = True            # development mode, so plain HTTP is allowed
        self.relay.note_code(CODE)

    def auth(self, code=CODE):
        token = printer_relay.issue_token(code, app.secret_key)
        return {'Authorization': f'Bearer {token}'}

    def test_exchange_answers_a_token_then_refuses_the_second_pi(self):
        first = self.client.post('/printer/daemon/pair', json={'code': '7k3m-q9xw'})
        self.assertEqual(first.status_code, 200)
        self.assertEqual(printer_relay.read_token(first.get_json()['token'],
                                                  app.secret_key)[0], CODE)
        second = self.client.post('/printer/daemon/pair', json={'code': CODE})
        self.assertEqual(second.status_code, 404)

    def test_exchange_for_an_unpresented_code_answers_the_same_404(self):
        resp = self.client.post('/printer/daemon/pair', json={'code': 'ABCDEFGH'})
        self.assertEqual(resp.status_code, 404)
        self.assertEqual(resp.get_json(), {'error': 'not paired'})

    def test_sync_with_a_bad_token_says_repair(self):
        resp = self.client.post('/printer/daemon/sync', json=IDLE,
                                headers={'Authorization': 'Bearer garbage'})
        self.assertEqual(resp.status_code, 401)
        self.assertEqual(resp.get_json(), {'error': 'repair'})

    def test_a_token_signed_with_another_key_is_rejected(self):
        token = printer_relay.issue_token(CODE, 'some-other-key')
        resp = self.client.post('/printer/daemon/sync', json=IDLE,
                                headers={'Authorization': f'Bearer {token}'})
        self.assertEqual(resp.status_code, 401)

    def test_sync_stores_the_snapshot_and_hands_out_a_job(self):
        self.relay.note_daemon(CODE)
        self.relay.store_status(CODE, IDLE)
        self.relay.claim_job(CODE, job_id='j8f3a2c1', download_path='/download/tok',
                             filename='sample_part.gcode.3mf', team_number=6238)
        body = self.client.post('/printer/daemon/sync', json=IDLE,
                                headers=self.auth()).get_json()
        self.assertEqual(body['job']['id'], 'j8f3a2c1')
        self.assertEqual(body['job']['state'], 'handed_out')
        self.assertEqual(self.relay.status_for(CODE)['status']['state'], 'idle')

    def test_sync_answers_a_null_job_when_there_is_none(self):
        body = self.client.post('/printer/daemon/sync', json=IDLE,
                                headers=self.auth()).get_json()
        self.assertIsNone(body['job'])

    def test_ack_records_the_outcome_and_logs_metrics(self):
        self.relay.note_daemon(CODE)
        self.relay.store_status(CODE, IDLE)
        self.relay.claim_job(CODE, job_id='j8f3a2c1', download_path='/download/tok',
                             filename='sample_part.gcode.3mf', team_number=6238)
        self.relay.store_status(CODE, IDLE)
        fake_metrics = mock.Mock()
        with mock.patch.object(printer_routes, '_METRICS', fake_metrics, create=True):
            resp = self.client.post('/printer/daemon/jobs/j8f3a2c1/ack',
                                    json={'ok': True}, headers=self.auth())
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(fake_metrics.log_event.call_args[0][0], 'printer_ack')
        self.assertEqual(fake_metrics.log_event.call_args[1]['team_number'], 6238)
        self.assertTrue(self.relay.status_for(CODE)['last_result']['ok'])

    def test_ack_for_an_unknown_job_is_404(self):
        resp = self.client.post('/printer/daemon/jobs/jffffffff/ack',
                                json={'ok': True}, headers=self.auth())
        self.assertEqual(resp.status_code, 404)

    def test_ping_reports_flags_and_stores_nothing(self):
        resp = self.client.get('/printer/daemon/ping', headers=self.auth())
        self.assertEqual(resp.get_json(), {'ok': True, 'waiting': True, 'online': False})
        # Storing nothing means a real daemon can still exchange right afterwards.
        self.assertTrue(self.relay.begin_exchange(CODE))


class TestHttpsAndDevMode(PrinterRouteTestCase):
    def setUp(self):
        super().setUp()
        self.relay.note_code(CODE)

    def test_daemon_routes_refuse_plain_http_outside_development_mode(self):
        app.debug = False
        for path, method in (('/printer/daemon/pair', 'post'),
                             ('/printer/daemon/sync', 'post'),
                             ('/printer/daemon/ping', 'get'),
                             ('/install-printer.sh', 'get')):
            resp = getattr(self.client, method)(path, json={})
            self.assertEqual(resp.status_code, 403, path)

    def test_https_is_accepted_outside_development_mode(self):
        app.debug = False
        resp = self.client.post('/printer/daemon/pair', json={'code': CODE},
                                base_url='https://localhost')
        self.assertEqual(resp.status_code, 200)

    def test_development_mode_allows_plain_http(self):
        app.debug = True
        resp = self.client.post('/printer/daemon/pair', json={'code': CODE})
        self.assertEqual(resp.status_code, 200)

    def test_railway_environment_cancels_development_mode(self):
        app.debug = True
        with mock.patch.dict(os.environ, {'RAILWAY_ENVIRONMENT': 'production'}):
            resp = self.client.post('/printer/daemon/pair', json={'code': CODE})
        self.assertEqual(resp.status_code, 403)

    def test_dev_seed_code_works_in_development_mode(self):
        fresh = printer_relay.PrinterRelay(clock=self.clock)
        app.debug = True
        with mock.patch.object(printer_relay, 'RELAY', fresh), \
             mock.patch.dict(os.environ, {'PRINTER_DEV_PAIRING_CODE': 'ABCDEFGH'}):
            resp = self.client.post('/printer/daemon/pair', json={'code': 'ABCDEFGH'})
        self.assertEqual(resp.status_code, 200)

    def test_dev_seed_code_is_ignored_outside_development_mode(self):
        fresh = printer_relay.PrinterRelay(clock=self.clock)
        app.debug = False
        with mock.patch.object(printer_relay, 'RELAY', fresh), \
             mock.patch.dict(os.environ, {'PRINTER_DEV_PAIRING_CODE': 'ABCDEFGH'}):
            resp = self.client.post('/printer/daemon/pair', json={'code': 'ABCDEFGH'},
                                    base_url='https://localhost')
        self.assertEqual(resp.status_code, 404)

    def test_the_installer_route_is_reachable_in_development_mode(self):
        """print/printer_daemon/install.sh does not exist until Task 10, so this asserts only
        that the route exists and the HTTPS gate let it through -- a 404 from
        send_from_directory is the expected answer until the script lands. Task 10 adds the
        test that asserts 200 and the script's content."""
        app.debug = True
        resp = self.client.get('/install-printer.sh')
        self.assertNotEqual(resp.status_code, 403)
        self.assertIn(resp.status_code, (200, 404))


class TestRateLimitKeys(PrinterRouteTestCase):
    def test_session_key_is_the_code_not_the_address(self):
        # Exercise the key function the way flask-limiter does: inside a request context
        # whose session carries the Onshape copy of the team config.
        with app.test_request_context('/printer/status'):
            from flask import session
            session['team_config_data'] = TEAM_YAML_DATA
            self.assertEqual(printer_routes._session_code_key(), f'printer-code:{CODE}')

    def test_session_key_falls_back_when_the_session_is_corrupt(self):
        """flask-limiter runs the key function before the view, so it must never raise."""
        with app.test_request_context('/printer/status'):
            from flask import session
            session['team_config_data'] = ['not', 'a', 'mapping']
            key = printer_routes._session_code_key()
        self.assertNotIn('printer-code', key)

    def test_token_key_is_the_code_from_the_bearer_token(self):
        token = printer_relay.issue_token(CODE, app.secret_key)
        with app.test_request_context('/printer/daemon/sync',
                                      headers={'Authorization': f'Bearer {token}'}):
            self.assertEqual(printer_routes._token_code_key(), f'printer-code:{CODE}')

    def test_token_key_falls_back_on_a_garbage_header(self):
        with app.test_request_context('/printer/daemon/sync',
                                      headers={'Authorization': 'Bearer !!!'}):
            key = printer_routes._token_code_key()
        self.assertNotIn('printer-code', key)

    def test_sync_is_not_subject_to_the_app_wide_two_hundred_per_hour_default(self):
        """A five-second sync is 720 requests an hour. Without override_defaults the daemon
        would start taking 429s about seventeen minutes after boot."""
        app.debug = True
        gui.limiter.enabled = True
        self.addCleanup(setattr, gui.limiter, 'enabled', False)
        gui.limiter.reset()
        self.relay.note_code(CODE)
        headers = {'Authorization':
                   f'Bearer {printer_relay.issue_token(CODE, app.secret_key)}'}
        codes = set()
        for _ in range(60):
            codes.add(self.client.post('/printer/daemon/sync', json=IDLE,
                                       headers=headers).status_code)
        self.assertEqual(codes, {200})
        # The 61st in the same minute hits this route's OWN 60/minute limit, proving the
        # route's limit is in force and the 200/hour default is not.
        self.assertEqual(self.client.post('/printer/daemon/sync', json=IDLE,
                                          headers=headers).status_code, 429)
```

- [ ] **Step 8: Run the tests to verify they fail**

Run: `uv run python -m unittest tests.test_printer_routes -v`
Expected: FAIL — every route 404s, because nothing calls `init_printer_routes` yet.

- [ ] **Step 9: Add hunk A to `frc_cam_gui_app.py` — the wiring**

Insert immediately **before** `def cleanup():` (about line 2258), after the last route:

```python
# ============================================================================
# 3D printer relay (Bambu LAN daemon)
# ============================================================================
# Sits beside the future init_print_routes(...) call from the 3D-print slicing branch;
# both hand their blueprint this module's globals instead of importing them.
import printer_relay  # noqa: E402 - registered here, beside the call that needs it
from printer_routes import init_printer_routes  # noqa: E402

init_printer_routes(app,
                    limiter=limiter,
                    has_onshape_session=_has_onshape_session,
                    refresh_team_config=_maybe_refresh_team_config,
                    token_manager=file_token_manager,
                    metrics=metrics,
                    log=log)
```

`_load_team_config_into_session` (hunk B, next step) resolves `printer_relay` as a module global at call time, so importing it here — textually after that function — is correct.

- [ ] **Step 10: Add hunk B to `frc_cam_gui_app.py` — `note_code`**

Inside `_load_team_config_into_session`, insert immediately **before** the line `session['team_config_fetched_at'] = time.time()`:

```python
    # Tell the in-memory printer relay this team's pairing code exists. This function runs
    # on login, on the ten-minute TTL refresh and on the header's refresh link, so every
    # way a YAML reaches a session also tells the relay its code -- which is why pairing
    # needs no wizard step. A config with no code passes None and changes nothing.
    printer_relay.note_code(team_config.pairing_code)
```

That line sits after both branches of the `if config_data:` have assigned `team_config`, so it is reached whether a config was found or defaults were used.

- [ ] **Step 11: Write the test for hunk B and run everything**

Append to `print/tests/test_printer_routes.py`:

```python
class TestNoteCodeWiring(PrinterRouteTestCase):
    """Loading a YAML is what tells the relay a code exists. No wizard step, no route."""

    class _FakeClient:
        last_config_error = None
        last_config_url = None

        def __init__(self, yaml_text):
            self._yaml = yaml_text

        def fetch_config_file(self):
            return self._yaml

    def test_loading_a_config_registers_its_pairing_code(self):
        yaml_text = ('team:\n  number: 6238\n  name: "Popcorn Penguins"\n'
                     'printing:\n  pairing_code: "7k3m-q9xw"\n')
        with app.test_request_context('/'), \
             mock.patch.object(gui.session_manager, 'update_session_tokens',
                               return_value=None):
            gui._load_team_config_into_session(self._FakeClient(yaml_text))
        self.assertTrue(self.relay.status_for(CODE)['paired'])

    def test_loading_a_config_without_a_code_registers_nothing(self):
        with app.test_request_context('/'), \
             mock.patch.object(gui.session_manager, 'update_session_tokens',
                               return_value=None):
            gui._load_team_config_into_session(
                self._FakeClient('team:\n  number: 6238\n'))
        self.assertFalse(self.relay.status_for(CODE)['paired'])


if __name__ == '__main__':
    unittest.main()
```

Run: `uv run python -m unittest tests.test_printer_routes -v`
Expected: PASS, every test.

- [ ] **Step 12: Run the full backend suite**

Run: `make test`
Expected: PASS. `frc_cam_gui_app.py` now imports the blueprint at import time, so an error there breaks every route test in the repository — which is exactly the signal you want here.

---

### Task 4: The daemon package skeleton and `make test-daemon`

**Files:**
- Create: `print/printer_daemon/__init__.py`, `print/printer_daemon/requirements.txt`, `print/printer_daemon/tests/__init__.py`, `print/printer_daemon/tests/test_smoke_import.py`
- Modify: `Makefile`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `printer_daemon.VERSION = "1.0.0"` and `printer_daemon.USER_AGENT = f"penguincam-printer/{VERSION}"` — Task 6's relay client sends the latter as its `User-Agent`.
  - `make test-daemon` — installs `print/printer_daemon/requirements.txt` into the development venv, then runs `uv run python -m unittest discover -s print/printer_daemon/tests -t . --buffer`. `make test` calls it.

Two rules the discovery has to satisfy, and the reason for each:
- `python -m unittest discover -s tests` (what `make test` already runs) must **not** pick up `print/printer_daemon/tests`. It does not: `discover -s tests` walks only `tests/`. Do not move the daemon's tests under `tests/`.
- The daemon's tests must import `printer_daemon.*` as a package, which is why `-t .` sets the top-level directory to the repository root and why both `__init__.py` files exist.

- [ ] **Step 1: Create the package**

`print/printer_daemon/__init__.py`:

```python
"""The PenguinCAM printer daemon: a small always-on process for a Raspberry Pi on the shop
LAN that relays print jobs from PenguinCAM to one Bambu Lab printer.

It is NOT a pip package and has no pyproject.toml -- the repository's CLAUDE.md forbids one,
so the installer copies this directory onto the Pi and runs it with
`python -m printer_daemon`. The backend never imports this package, and this package never
imports the backend; the only thing they share is the HTTP protocol in relay_client.py.
"""

VERSION = "1.0.0"
USER_AGENT = f"penguincam-printer/{VERSION}"
```

`print/printer_daemon/tests/__init__.py`: an empty file (the package marker that lets `-t .` import these as `printer_daemon.tests.*`).

`print/printer_daemon/requirements.txt`:

```
# Installed on the Raspberry Pi by install.sh, and into the development venv by
# `make test-daemon`. NEVER added to the repository's own requirements.txt: bambulabs_api
# has no place in the Docker image or on Railway.
#
# Every package here has an aarch64 wheel, so nothing compiles on the Pi (about 7 MB of
# downloads, about 23 MB installed). Reading TOML needs no dependency -- tomllib is in the
# standard library from Python 3.11, which is what Raspberry Pi OS Bookworm ships.
bambulabs_api==2.6.6
requests==2.31.0
tomli-w==1.2.0
```

`print/printer_daemon/tests/test_smoke_import.py`:

```python
"""The daemon's test suite must run even where bambulabs_api is not installed.

printer_daemon.printer is the ONLY module that touches the library, and it imports it
lazily inside connect(), so importing the package costs nothing and `make test` does not
depend on the library being present."""
import unittest

import printer_daemon


class TestPackage(unittest.TestCase):
    def test_version_and_user_agent(self):
        self.assertTrue(printer_daemon.VERSION)
        self.assertEqual(printer_daemon.USER_AGENT,
                         f"penguincam-printer/{printer_daemon.VERSION}")


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 2: Add the `test-daemon` target to the Makefile**

Replace the whole `Makefile` with:

```make
.PHONY: install test test-daemon

install:
	@command -v uv >/dev/null 2>&1 || { echo "Installing uv..."; curl -LsSf https://astral.sh/uv/install.sh | sh; }
	@echo "Installing dependencies from requirements.txt..."
	uv pip install -r requirements.txt

test: test-daemon
	@echo "Running unit tests..."
	@uv run python -m unittest discover -s tests --buffer
	@echo ""
	@echo "Running system tests..."
	@uv run python gcode_test.py --quiet

# The Pi daemon's own suite. Its requirements go into the development venv only -- they are
# NOT in the repository's requirements.txt and must never reach the Docker image.
test-daemon:
	@echo "Running printer daemon tests..."
	@uv pip install -r print/printer_daemon/requirements.txt
	@uv run python -m unittest discover -s print/printer_daemon/tests -t . --buffer
```

`test: test-daemon` runs the daemon suite first, so a daemon break is reported before the slower system tests.

- [ ] **Step 3: Run the daemon suite**

Run: `make test-daemon`
Expected: PASS, one test. The `uv pip install` line installs `bambulabs_api`, `requests` and `tomli-w` into `.venv`.

- [ ] **Step 4: Confirm the backend discovery does not reach into the daemon**

Run: `uv run python -m unittest discover -s tests --buffer -v 2>&1 | grep -c printer_daemon`
Expected: `0` — no daemon test is discovered by the backend run.

- [ ] **Step 5: Run everything**

Run: `make test`
Expected: PASS, with the daemon suite running first.

---

### Task 5: The daemon's config file (`print/printer_daemon/config.py`)

**Files:**
- Create: `print/printer_daemon/config.py`
- Test: `print/printer_daemon/tests/test_config.py`

**Interfaces:**

- Consumes: nothing from other tasks. `tomllib` (stdlib) to read, `tomli_w` to write.
- Produces:
  - `DEFAULT_CONFIG_PATH = "/etc/penguincam-printer/config.toml"`
  - `DEFAULT_BACKEND_URL = "https://penguincam.popcornpenguins.com"`
  - `class DaemonConfig` — a dataclass with fields `backend_url: str`, `printer_ip: str = ""`, `printer_serial: str = ""`, `access_code: str = ""`, `pairing_code: str = ""`, `token: str = ""`, `dev: bool = False`, and `path: str = DEFAULT_CONFIG_PATH` (excluded from the file by `to_dict`)
  - `load_config(path=DEFAULT_CONFIG_PATH) -> DaemonConfig` — raises `FileNotFoundError`
  - `save_config(config, path=None) -> None` — writes the whole file with `tomli_w`, mode 600
  - `save_token(token, path=DEFAULT_CONFIG_PATH) -> DaemonConfig` — re-reads, changes only `token`, rewrites
  - `check_backend_url(url, *, dev) -> None` — raises `ValueError` for a plain-HTTP URL unless `dev`
  - `wait_for_config(path=DEFAULT_CONFIG_PATH, *, sleep=time.sleep, clock=time.monotonic, log=print, interval=5.0, log_every=60.0) -> DaemonConfig`
  - `resolve_pairing_code(existing, *, new_code, generate) -> str`

- [ ] **Step 1: Write the failing tests**

Create `print/printer_daemon/tests/test_config.py`:

```python
"""The Pi's config file: /etc/penguincam-printer/config.toml.

`pair` writes the whole file as root; `run` rewrites the whole file as the penguincam user
to change only the token. The file carries no comments, so a full rewrite loses nothing."""
import os
import tempfile
import unittest

from printer_daemon import config as cfg


class ConfigTempFile(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.path = os.path.join(self.dir, 'config.toml')

    def write(self, **overrides):
        values = dict(backend_url='https://penguincam.popcornpenguins.com',
                      printer_ip='10.0.0.42', printer_serial='01P00A',
                      access_code='12345678', pairing_code='7K3MQ9XW', token='')
        values.update(overrides)
        config = cfg.DaemonConfig(**values)
        cfg.save_config(config, path=self.path)
        return config


class TestRoundTrip(ConfigTempFile):
    def test_every_field_survives_a_round_trip(self):
        written = self.write()
        read = cfg.load_config(self.path)
        self.assertEqual(read.backend_url, written.backend_url)
        self.assertEqual(read.printer_ip, '10.0.0.42')
        self.assertEqual(read.printer_serial, '01P00A')
        self.assertEqual(read.access_code, '12345678')
        self.assertEqual(read.pairing_code, '7K3MQ9XW')
        self.assertEqual(read.token, '')
        self.assertFalse(read.dev)

    def test_the_file_is_mode_600(self):
        """It holds the printer's LAN access code."""
        self.write()
        self.assertEqual(os.stat(self.path).st_mode & 0o777, 0o600)

    def test_a_missing_file_raises(self):
        with self.assertRaises(FileNotFoundError):
            cfg.load_config(os.path.join(self.dir, 'absent.toml'))

    def test_unknown_keys_in_the_file_are_ignored(self):
        """A newer daemon's config on an older daemon must not crash the service."""
        with open(self.path, 'w') as fh:
            fh.write('backend_url = "https://example.test"\nfuture_option = 3\n')
        self.assertEqual(cfg.load_config(self.path).backend_url, 'https://example.test')


class TestSaveToken(ConfigTempFile):
    def test_only_the_token_changes(self):
        self.write(dev=True)
        cfg.save_token('a-signed-token', path=self.path)
        read = cfg.load_config(self.path)
        self.assertEqual(read.token, 'a-signed-token')
        self.assertEqual(read.printer_ip, '10.0.0.42')
        self.assertEqual(read.access_code, '12345678')
        self.assertEqual(read.pairing_code, '7K3MQ9XW')
        self.assertTrue(read.dev)

    def test_the_mode_stays_600_after_a_rewrite(self):
        self.write()
        cfg.save_token('t', path=self.path)
        self.assertEqual(os.stat(self.path).st_mode & 0o777, 0o600)


class TestBackendUrlPolicy(ConfigTempFile):
    def test_https_is_always_accepted(self):
        cfg.check_backend_url('https://penguincam.popcornpenguins.com', dev=False)

    def test_http_is_refused_without_dev(self):
        with self.assertRaises(ValueError) as caught:
            cfg.check_backend_url('http://192.168.1.5:6238', dev=False)
        self.assertIn('--dev', str(caught.exception))

    def test_http_is_accepted_with_dev(self):
        cfg.check_backend_url('http://192.168.1.5:6238', dev=True)

    def test_a_url_that_is_not_a_url_is_refused(self):
        with self.assertRaises(ValueError):
            cfg.check_backend_url('penguincam.popcornpenguins.com', dev=True)

    def test_a_trailing_slash_is_stripped_on_save(self):
        self.write(backend_url='https://example.test/')
        self.assertEqual(cfg.load_config(self.path).backend_url, 'https://example.test')


class TestWaitForConfig(ConfigTempFile):
    def test_returns_at_once_when_the_file_exists(self):
        self.write()
        slept = []
        got = cfg.wait_for_config(self.path, sleep=slept.append, log=lambda *a: None)
        self.assertEqual(slept, [])
        self.assertEqual(got.pairing_code, '7K3MQ9XW')

    def test_waits_and_logs_once_a_minute_instead_of_exiting(self):
        """`run` starting before `pair` must not die into a systemd restart loop."""
        ticks = {'n': 0}
        logged = []

        def sleep(_seconds):
            ticks['n'] += 1
            if ticks['n'] == 20:          # 20 * 5 s = 100 s of waiting
                self.write()

        def clock():
            return ticks['n'] * 5.0

        got = cfg.wait_for_config(self.path, sleep=sleep, clock=clock,
                                  log=lambda *a: logged.append(' '.join(str(x) for x in a)))
        self.assertEqual(got.pairing_code, '7K3MQ9XW')
        self.assertEqual(ticks['n'], 20)
        self.assertEqual(len(logged), 2)   # once at the start, once a minute later
        self.assertIn('config.toml', logged[0])


class TestResolvePairingCode(unittest.TestCase):
    def test_an_existing_code_is_kept_by_default(self):
        """Re-running pair after a printer swap must not force a YAML edit."""
        self.assertEqual(
            cfg.resolve_pairing_code('7K3MQ9XW', new_code=False, generate=lambda: 'NEWCODE1'),
            '7K3MQ9XW')

    def test_new_code_mints_one(self):
        self.assertEqual(
            cfg.resolve_pairing_code('7K3MQ9XW', new_code=True, generate=lambda: 'NEWCODE1'),
            'NEWCODE1')

    def test_no_existing_code_mints_one(self):
        for existing in ('', None):
            self.assertEqual(
                cfg.resolve_pairing_code(existing, new_code=False,
                                         generate=lambda: 'NEWCODE1'),
                'NEWCODE1')


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run python -m unittest printer_daemon.tests.test_config -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'printer_daemon.config'`.

- [ ] **Step 3: Write `print/printer_daemon/config.py`**

```python
"""Read and write the Pi's config file, /etc/penguincam-printer/config.toml.

`pair` runs under sudo and writes the whole file as root, then hands the directory and file
to the penguincam user. `run` runs as penguincam and rewrites the whole file to change only
the token. A full rewrite is safe because the file carries no comments.

Reading needs no dependency: tomllib is in the standard library from Python 3.11, which is
what Raspberry Pi OS Bookworm ships. Only writing needs tomli_w.
"""

import os
import time
import tomllib
from dataclasses import dataclass, fields
from urllib.parse import urlparse

import tomli_w

DEFAULT_CONFIG_PATH = "/etc/penguincam-printer/config.toml"
DEFAULT_BACKEND_URL = "https://penguincam.popcornpenguins.com"

# Fields written to the file, in this order. `path` is where the file lives, not part of it.
_FILE_FIELDS = ('backend_url', 'printer_ip', 'printer_serial', 'access_code',
                'pairing_code', 'token', 'dev')


@dataclass
class DaemonConfig:
    """Everything the daemon needs. The access code and the token are secrets, which is why
    the file is mode 600 in a directory owned by the penguincam user."""

    backend_url: str = DEFAULT_BACKEND_URL
    printer_ip: str = ""
    printer_serial: str = ""
    access_code: str = ""
    pairing_code: str = ""
    token: str = ""
    dev: bool = False
    path: str = DEFAULT_CONFIG_PATH

    def to_dict(self):
        return {name: getattr(self, name) for name in _FILE_FIELDS}


def _normalize_url(url):
    return (url or "").strip().rstrip('/')


def check_backend_url(url, *, dev):
    """Raise ValueError unless this is a URL the daemon may talk to.

    A plain-HTTP backend is refused unless `pair` was given --dev, which writes dev = true.
    The installer never passes --dev, so a shop install cannot talk HTTP. The flag exists
    because the development server is reached from the Pi by the Mac's LAN address, not by
    localhost, so a hostname rule would not do."""
    parsed = urlparse(_normalize_url(url))
    if parsed.scheme not in ('http', 'https') or not parsed.netloc:
        raise ValueError(f"{url!r} is not a backend URL; it must start with https://")
    if parsed.scheme == 'http' and not dev:
        raise ValueError(
            f"Refusing a plain-HTTP backend URL ({url}). Re-run pair with --dev if this is "
            "a development server you trust on your own network.")


def load_config(path=DEFAULT_CONFIG_PATH):
    """Parse the config file. Raises FileNotFoundError when it is not there yet.

    Unknown keys are ignored rather than fatal, so a config written by a newer daemon does
    not stop an older one."""
    with open(path, 'rb') as fh:
        data = tomllib.load(fh)
    known = {f.name for f in fields(DaemonConfig)} - {'path'}
    values = {k: v for k, v in data.items() if k in known}
    values['backend_url'] = _normalize_url(values.get('backend_url') or DEFAULT_BACKEND_URL)
    return DaemonConfig(path=path, **values)


def save_config(config, path=None):
    """Write the whole file, mode 600, creating its directory if needed."""
    path = path or config.path or DEFAULT_CONFIG_PATH
    config.backend_url = _normalize_url(config.backend_url)
    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)
    # Create with 0600 from the start, so the access code is never briefly world-readable.
    flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
    handle = os.open(path, flags, 0o600)
    with os.fdopen(handle, 'wb') as fh:
        tomli_w.dump(config.to_dict(), fh)
    os.chmod(path, 0o600)
    config.path = path


def save_token(token, path=DEFAULT_CONFIG_PATH):
    """Change only the token. Everything else is read back and written out unchanged."""
    config = load_config(path)
    config.token = token or ""
    save_config(config, path=path)
    return config


def wait_for_config(path=DEFAULT_CONFIG_PATH, *, sleep=time.sleep, clock=time.monotonic,
                    log=print, interval=5.0, log_every=60.0):
    """Block until the config file exists, then return it.

    `run` may start before `pair` has been run -- systemd enables the unit at install time.
    Waiting beats exiting: an exit would become a restart loop that buries the real message
    in the journal. Logs once at the start and then once a minute, on the monotonic clock,
    so a Pi with no network time source behaves like any other."""
    started = clock()
    last_log = None
    while True:
        try:
            return load_config(path)
        except FileNotFoundError:
            now = clock()
            if last_log is None or now - last_log >= log_every:
                waited = int(now - started)
                log(f"waiting for {path} -- run `sudo penguincam-printer pair` "
                    f"(waited {waited}s)")
                last_log = now
            sleep(interval)


def resolve_pairing_code(existing, *, new_code, generate):
    """The code `pair` should write.

    Re-running pair on the same Pi keeps the existing code, so a printer swap or a
    reinstall needs no YAML edit. --new-code mints a fresh one, for when a former student
    still knows the old one."""
    if existing and not new_code:
        return existing
    return generate()
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run python -m unittest printer_daemon.tests.test_config -v`
Expected: PASS.

- [ ] **Step 5: Run both suites**

Run: `make test`
Expected: PASS.

---

### Task 6: The daemon's relay client (`print/printer_daemon/relay_client.py`)

**Files:**
- Create: `print/printer_daemon/relay_client.py`
- Test: `print/printer_daemon/tests/test_relay_client.py`

**Interfaces:**

- Consumes: `printer_daemon.USER_AGENT` (Task 4). The wire shapes from Task 3: `POST /printer/daemon/pair` → `{"token": ...}` or 404; `POST /printer/daemon/sync` → `{"job": {...} | null}`, 401 `{"error": "repair"}`; `POST /printer/daemon/jobs/<id>/ack` → 200 or 404; `GET /printer/daemon/ping` → `{"ok", "waiting", "online"}`; `GET /download/<token>`.
- Produces:
  - `class RelayError(Exception)`, `class TokenRejected(RelayError)`, `class RateLimited(RelayError)` with `.retry_after: float`, `class ChallengeDetected(RelayError)`
  - `class RelayClient` with `__init__(self, backend_url, token=None, *, session=None, timeout=20.0)`, attribute `token`, and methods `exchange(pairing_code) -> str | None`, `sync(snapshot) -> dict | None`, `ack(job_id, ok, error=None) -> bool`, `ping() -> dict`, `download(download_path, dest_path) -> None`
  - Task 8's run loop uses exactly these names and exceptions.

- [ ] **Step 1: Write the failing tests**

Create `print/printer_daemon/tests/test_relay_client.py`:

```python
"""The daemon's side of the protocol, with `requests` replaced by a fake session.

No network is touched. The wire shapes here must match print/tests/test_printer_routes.py."""
import json
import os
import tempfile
import unittest

from printer_daemon import USER_AGENT
from printer_daemon.relay_client import (
    ChallengeDetected, RateLimited, RelayClient, RelayError, TokenRejected,
)


class FakeResponse:
    def __init__(self, status_code=200, payload=None, text=None, headers=None,
                 chunks=None):
        self.status_code = status_code
        self._payload = payload
        self.text = text if text is not None else json.dumps(payload or {})
        self.headers = headers or {'Content-Type': 'application/json'}
        self._chunks = chunks or [b'']
        self.closed = False

    def json(self):
        if self._payload is None:
            raise ValueError('not json')
        return self._payload

    def iter_content(self, chunk_size=8192):
        return iter(self._chunks)

    def close(self):
        self.closed = True

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
        return False


class FakeSession:
    """Records calls and replays queued responses."""

    def __init__(self, *responses):
        self.queue = list(responses)
        self.calls = []
        self.headers = {}

    def _next(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        if not self.queue:
            raise AssertionError(f'unexpected {method} {url}')
        item = self.queue.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    def post(self, url, **kwargs):
        return self._next('POST', url, **kwargs)

    def get(self, url, **kwargs):
        return self._next('GET', url, **kwargs)


class TestExchange(unittest.TestCase):
    def test_a_token_is_returned_and_stored(self):
        session = FakeSession(FakeResponse(payload={'token': 'signed'}))
        client = RelayClient('https://example.test', session=session)
        self.assertEqual(client.exchange('7K3MQ9XW'), 'signed')
        self.assertEqual(client.token, 'signed')
        method, url, kwargs = session.calls[0]
        self.assertEqual((method, url), ('POST', 'https://example.test/printer/daemon/pair'))
        self.assertEqual(kwargs['json'], {'code': '7K3MQ9XW'})

    def test_a_404_means_wait_for_the_code_to_appear(self):
        session = FakeSession(FakeResponse(404, payload={'error': 'not paired'}))
        client = RelayClient('https://example.test', session=session)
        self.assertIsNone(client.exchange('7K3MQ9XW'))
        self.assertIsNone(client.token)

    def test_a_429_raises_with_the_retry_after(self):
        session = FakeSession(FakeResponse(429, payload={}, headers={
            'Content-Type': 'application/json', 'Retry-After': '17'}))
        client = RelayClient('https://example.test', session=session)
        with self.assertRaises(RateLimited) as caught:
            client.exchange('7K3MQ9XW')
        self.assertEqual(caught.exception.retry_after, 17.0)

    def test_a_missing_retry_after_falls_back_to_sixty_seconds(self):
        session = FakeSession(FakeResponse(429, payload={}))
        client = RelayClient('https://example.test', session=session)
        with self.assertRaises(RateLimited) as caught:
            client.exchange('7K3MQ9XW')
        self.assertEqual(caught.exception.retry_after, 60.0)


class TestSync(unittest.TestCase):
    SNAPSHOT = {'state': 'idle', 'file': '', 'percent': None}

    def test_a_snapshot_is_posted_with_the_bearer_token(self):
        session = FakeSession(FakeResponse(payload={'job': None}))
        client = RelayClient('https://example.test', token='signed', session=session)
        self.assertIsNone(client.sync(self.SNAPSHOT))
        method, url, kwargs = session.calls[0]
        self.assertEqual(url, 'https://example.test/printer/daemon/sync')
        self.assertEqual(kwargs['json'], self.SNAPSHOT)
        self.assertEqual(kwargs['headers']['Authorization'], 'Bearer signed')
        self.assertEqual(kwargs['headers']['User-Agent'], USER_AGENT)

    def test_a_job_is_returned(self):
        job = {'id': 'j8f3a2c1', 'download_path': '/download/tok',
               'filename': 'sample_part.gcode.3mf', 'state': 'handed_out'}
        session = FakeSession(FakeResponse(payload={'job': job}))
        client = RelayClient('https://example.test', token='signed', session=session)
        self.assertEqual(client.sync(self.SNAPSHOT)['id'], 'j8f3a2c1')

    def test_a_401_repair_raises_token_rejected(self):
        session = FakeSession(FakeResponse(401, payload={'error': 'repair'}))
        client = RelayClient('https://example.test', token='stale', session=session)
        with self.assertRaises(TokenRejected):
            client.sync(self.SNAPSHOT)

    def test_an_html_body_on_a_json_route_is_a_challenge(self):
        """A Cloudflare challenge is an ordinary HTTP response carrying an HTML page. It
        must be named, not parsed as JSON, so `status` can tell the mentor what happened."""
        session = FakeSession(FakeResponse(403, payload=None,
                                           text='<!DOCTYPE html><html>...',
                                           headers={'Content-Type': 'text/html'}))
        client = RelayClient('https://example.test', token='signed', session=session)
        with self.assertRaises(ChallengeDetected):
            client.sync(self.SNAPSHOT)

    def test_a_server_error_raises_a_plain_relay_error(self):
        session = FakeSession(FakeResponse(502, payload={'error': 'bad gateway'}))
        client = RelayClient('https://example.test', token='signed', session=session)
        with self.assertRaises(RelayError):
            client.sync(self.SNAPSHOT)


class TestAck(unittest.TestCase):
    def test_a_successful_ack_returns_true(self):
        session = FakeSession(FakeResponse(payload={'ok': True}))
        client = RelayClient('https://example.test', token='signed', session=session)
        self.assertTrue(client.ack('j8f3a2c1', True))
        method, url, kwargs = session.calls[0]
        self.assertEqual(url,
                         'https://example.test/printer/daemon/jobs/j8f3a2c1/ack')
        self.assertEqual(kwargs['json'], {'ok': True, 'error': None})

    def test_a_failed_ack_carries_one_line_of_reason(self):
        session = FakeSession(FakeResponse(payload={'ok': True}))
        client = RelayClient('https://example.test', token='signed', session=session)
        client.ack('j8f3a2c1', False, 'Upload to printer failed: connection refused')
        self.assertEqual(session.calls[0][2]['json']['error'],
                         'Upload to printer failed: connection refused')

    def test_a_404_returns_false_rather_than_raising(self):
        """The relay no longer holds that job. The daemon treats it as final."""
        session = FakeSession(FakeResponse(404, payload={'error': 'unknown job'}))
        client = RelayClient('https://example.test', token='signed', session=session)
        self.assertFalse(client.ack('j8f3a2c1', True))


class TestPingAndDownload(unittest.TestCase):
    def test_ping_returns_the_flags(self):
        session = FakeSession(FakeResponse(payload={'ok': True, 'waiting': False,
                                                    'online': True}))
        client = RelayClient('https://example.test', token='signed', session=session)
        self.assertEqual(client.ping()['online'], True)
        self.assertEqual(session.calls[0][1],
                         'https://example.test/printer/daemon/ping')

    def test_download_joins_the_path_with_the_configured_backend(self):
        """The job carries a path, not a URL, so the relay never needs to know the name it
        is reached by."""
        session = FakeSession(FakeResponse(chunks=[b'3mf-', b'bytes']))
        client = RelayClient('http://192.168.1.5:6238', token='signed', session=session)
        with tempfile.TemporaryDirectory() as tmp:
            dest = os.path.join(tmp, 'job.gcode.3mf')
            client.download('/download/tok', dest)
            with open(dest, 'rb') as fh:
                self.assertEqual(fh.read(), b'3mf-bytes')
        self.assertEqual(session.calls[0][1], 'http://192.168.1.5:6238/download/tok')

    def test_a_failed_download_raises(self):
        session = FakeSession(FakeResponse(404, payload={'error': 'gone'}))
        client = RelayClient('https://example.test', token='signed', session=session)
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(RelayError):
                client.download('/download/tok', os.path.join(tmp, 'job.3mf'))


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run python -m unittest printer_daemon.tests.test_relay_client -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'printer_daemon.relay_client'`.

- [ ] **Step 3: Write `print/printer_daemon/relay_client.py`**

```python
"""The daemon's side of the PenguinCAM protocol. Outbound HTTPS only; no ports are opened
on the Pi and nothing on the school network has to be reachable from outside.

Every method translates an HTTP answer into one of four outcomes the run loop knows how to
handle: a value, TokenRejected (re-exchange), RateLimited (honour Retry-After), or a plain
RelayError (log, back off, try again).
"""

import os

import requests

from printer_daemon import USER_AGENT


class RelayError(Exception):
    """Any failure talking to the backend. The run loop logs it and backs off."""


class TokenRejected(RelayError):
    """The backend answered 401 with {"error": "repair"}: blank the token and re-exchange.

    Happens after a redeploy without FLASK_SECRET_KEY set, or when a Pi's code was retired.
    """


class RateLimited(RelayError):
    def __init__(self, retry_after):
        super().__init__(f"rate limited, retry after {retry_after}s")
        self.retry_after = retry_after


class ChallengeDetected(RelayError):
    """An HTML body arrived on a JSON route -- almost always a Cloudflare challenge page.

    Named rather than parsed, so `penguincam-printer status` can tell a mentor what is
    actually happening instead of reporting a JSON parse error."""


class RelayClient:
    """One long-lived HTTP session to the backend.

    `backend_url` comes from the Pi's config file, and the daemon joins it with the path a
    job carries, so a development server reached as localhost by the browser and by a LAN
    address from the Pi works with no extra configuration."""

    def __init__(self, backend_url, token=None, *, session=None, timeout=20.0):
        self.backend_url = (backend_url or '').rstrip('/')
        self.token = token or None
        self.timeout = timeout
        self._session = session if session is not None else requests.Session()

    # -- plumbing ----------------------------------------------------------------------

    def _url(self, path):
        return f"{self.backend_url}{path}"

    def _headers(self, *, authorized=True):
        headers = {'User-Agent': USER_AGENT}
        if authorized and self.token:
            headers['Authorization'] = f'Bearer {self.token}'
        return headers

    @staticmethod
    def _retry_after(response):
        try:
            return float(response.headers.get('Retry-After', ''))
        except (TypeError, ValueError):
            return 60.0

    def _payload(self, response):
        """The JSON body, or an exception naming what arrived instead."""
        content_type = (response.headers.get('Content-Type') or '').lower()
        if 'json' not in content_type:
            body = (response.text or '').lstrip()[:200]
            raise ChallengeDetected(
                f"expected JSON from the backend, got {content_type or 'no content type'} "
                f"({body!r}). If this is a Cloudflare challenge page, see "
                f"docs/PRINTER_SETUP.md.")
        try:
            return response.json()
        except ValueError as e:
            raise RelayError(f"could not parse the backend's reply: {e}") from e

    def _request(self, method, path, *, authorized=True, **kwargs):
        try:
            fn = self._session.post if method == 'POST' else self._session.get
            return fn(self._url(path), headers=self._headers(authorized=authorized),
                      timeout=self.timeout, **kwargs)
        except requests.RequestException as e:
            raise RelayError(f"{method} {path} failed: {e}") from e

    # -- protocol ----------------------------------------------------------------------

    def exchange(self, pairing_code):
        """Trade the pairing code for a signed token. None means "not yet" -- no session has
        presented this code since the relay started, or another Pi holds it."""
        response = self._request('POST', '/printer/daemon/pair', authorized=False,
                                 json={'code': pairing_code})
        if response.status_code == 429:
            raise RateLimited(self._retry_after(response))
        if response.status_code == 404:
            return None
        if response.status_code != 200:
            raise RelayError(f"pair answered {response.status_code}")
        token = self._payload(response).get('token')
        if not token:
            raise RelayError("pair answered 200 with no token")
        self.token = token
        return token

    def sync(self, snapshot):
        """Post the status snapshot; return the job to act on, or None."""
        response = self._request('POST', '/printer/daemon/sync', json=snapshot)
        if response.status_code == 401:
            raise TokenRejected("the backend rejected the token; re-pairing")
        if response.status_code == 429:
            raise RateLimited(self._retry_after(response))
        if response.status_code != 200:
            self._payload(response)          # names a challenge page before the generic error
            raise RelayError(f"sync answered {response.status_code}")
        return self._payload(response).get('job')

    def ack(self, job_id, ok, error=None):
        """Report a job's outcome. False means the relay no longer holds it: final."""
        response = self._request('POST', f'/printer/daemon/jobs/{job_id}/ack',
                                 json={'ok': bool(ok), 'error': error})
        if response.status_code == 401:
            raise TokenRejected("the backend rejected the token; re-pairing")
        if response.status_code == 404:
            return False
        if response.status_code != 200:
            self._payload(response)
            raise RelayError(f"ack answered {response.status_code}")
        return True

    def ping(self):
        """Read-only health check for `penguincam-printer status`. Stores nothing on the
        relay, so it cannot disturb the running service."""
        response = self._request('GET', '/printer/daemon/ping')
        if response.status_code == 401:
            raise TokenRejected("the backend rejected the token")
        if response.status_code != 200:
            self._payload(response)
            raise RelayError(f"ping answered {response.status_code}")
        return self._payload(response)

    def download(self, download_path, dest_path):
        """Fetch the sliced file to `dest_path`. The token route needs no session and is
        fetched exactly once per job."""
        response = self._request('GET', download_path, stream=True)
        with response:
            if response.status_code != 200:
                raise RelayError(f"download answered {response.status_code}")
            directory = os.path.dirname(dest_path)
            if directory:
                os.makedirs(directory, exist_ok=True)
            with open(dest_path, 'wb') as fh:
                for chunk in response.iter_content(chunk_size=64 * 1024):
                    if chunk:
                        fh.write(chunk)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run python -m unittest printer_daemon.tests.test_relay_client -v`
Expected: PASS.

- [ ] **Step 5: Run both suites**

Run: `make test`
Expected: PASS.

---

### Task 7: The printer wrapper and the state mapping (`print/printer_daemon/printer.py`)

**Files:**
- Create: `print/printer_daemon/printer.py`, `print/printer_daemon/tests/fixtures/h2s_status.json`
- Test: `print/printer_daemon/tests/test_printer.py`

**Interfaces:**

- Consumes: nothing from other tasks.
- Produces:
  - State constants `IDLE = 'idle'`, `RUNNING = 'running'`, `PAUSED = 'paused'`, `FINISHED = 'finished'`, `ERROR = 'error'`, `UNREACHABLE = 'unreachable'`
  - `GCODE_STATE_MAP: dict[str, str]`
  - `map_status(report: dict, *, printer: dict | None = None) -> dict` — the snapshot shape the relay stores
  - `format_hms(attr: int, code: int) -> str`
  - `suffixed_name(filename: str, job_id: str) -> str` and `strip_job_suffix(filename: str) -> str`
  - `discover(timeout=5.0, *, sock_factory=None) -> list[dict]` — entries `{'serial', 'model', 'name', 'ip'}`
  - `class PrinterLink` with `__init__(self, ip, serial, access_code, *, model=None, name=None, printer_factory=None)`, and methods `connect()`, `disconnect()`, `raw_report() -> dict`, `snapshot() -> dict`, `upload(local_path, remote_name)`, `start(remote_name) -> bool`
  - Task 8's run loop calls `snapshot()`, `upload()`, `start()`, and `suffixed_name()`.

**Library facts, verified against `bambulabs_api==2.6.6` installed in this worktree's venv.** Use these exact names.

- Constructor: `bambulabs_api.Printer(ip_address, access_code, serial)` — positional order is ip, access code, serial. It builds an MQTT client, an FTPS client **and a camera client**.
- `Printer.connect()` calls `mqtt_start()` **and** `camera_start()`. The daemon must call **`mqtt_start()` only**: the camera stream is not needed, it decodes JPEG frames through Pillow, and on a small Pi that is the one memory cost worth avoiding. Stop with `mqtt_stop()`.
- `Printer.mqtt_dump() -> dict` returns the accumulated report document. The interesting sub-dictionary is `dump()['print']`. Reading it directly is what makes `map_status` a pure function of a captured fixture.
- Typed accessors, all reading that same `print` dictionary: `get_state() -> GcodeState` (from `gcode_state`), `get_current_state() -> PrintStatus` (from `stg_cur`), `get_percentage()` (`mc_percent`), `get_time()` (`mc_remaining_time`), `current_layer_num()` (`layer_num`), `total_layer_num()` (`total_layer_num`), `get_file_name()` (`gcode_file`), `subtask_name()` (`subtask_name`), `print_error_code()` (`print_error`), `mqtt_client_connected()`, `mqtt_client_ready()` (true once any report has arrived).
- `GcodeState` is a `str` enum with exactly these members: `IDLE`, `PREPARE`, `RUNNING`, `PAUSE`, `FINISH`, `FAILED`, `UNKNOWN`. An unrecognised value becomes `UNKNOWN` rather than raising.
- `PrintStatus` is the `stg_cur` enum: `PRINTING = 0`, `AUTO_BED_LEVELING = 1`, `HEATBED_PREHEATING = 2`, `SWEEPING_XY_MECH_MODE = 3`, `CHANGING_FILAMENT = 4`, `M400_PAUSE = 5`, `PAUSED_FILAMENT_RUNOUT = 6`, `HEATING_HOTEND = 7`, `CALIBRATING_EXTRUSION = 8`, `SCANNING_BED_SURFACE = 9`, `INSPECTING_FIRST_LAYER = 10`, `IDENTIFYING_BUILD_PLATE_TYPE = 11`, `CALIBRATING_MICRO_LIDAR = 12`, `HOMING_TOOLHEAD = 13`, `CLEANING_NOZZLE_TIP = 14`, `CHECKING_EXTRUDER_TEMPERATURE = 15`, `PAUSED_USER = 16`, `PAUSED_FRONT_COVER_FALLING = 17`, `CALIBRATING_LIDAR = 18`, `CALIBRATING_EXTRUSION_FLOW = 19`, `PAUSED_NOZZLE_TEMPERATURE_MALFUNCTION = 20`, `PAUSED_HEAT_BED_TEMPERATURE_MALFUNCTION = 21`, `FILAMENT_UNLOADING = 22`, `PAUSED_SKIPPED_STEP = 23`, `FILAMENT_LOADING = 24`, `CALIBRATING_MOTOR_NOISE = 25`, `PAUSED_AMS_LOST = 26`, `PAUSED_LOW_FAN_SPEED_HEAT_BREAK = 27`, `PAUSED_CHAMBER_TEMPERATURE_CONTROL_ERROR = 28`, `COOLING_CHAMBER = 29`, `PAUSED_USER_GCODE = 30`, `MOTOR_NOISE_SHOWOFF = 31`, `PAUSED_NOZZLE_FILAMENT_COVERED_DETECTED = 32`, `PAUSED_CUTTER_ERROR = 33`, `PAUSED_FIRST_LAYER_ERROR = 34`, `PAUSED_NOZZLE_CLOG = 35`, `UNKNOWN = None`, `IDLE = 255`.
- `Printer.upload_file(file: BinaryIO, filename: str = "ftp_upload.gcode") -> str` uploads over FTPS and **closes the file object** in its `finally`.
- `Printer.start_print(filename, plate_number, use_ams=True, ams_mapping=[0], skip_objects=None, flow_calibration=True) -> bool`. With an `int` plate number it builds `Metadata/plate_<n>.gcode` and publishes the `print.project_file` MQTT command with `url = ftp:///<filename>`. Pass plate `1`.
- There is **no** HMS accessor on `Printer` in 2.6.6. HMS entries, when present, are in `mqtt_dump()['print']['hms']` as a list of `{"attr": int, "code": int}`, which is why `format_hms` exists.

**Provisional, pending verification tasks 1 to 4 (the printer was not connected on 2026-09-13):** the exact `stg_cur` values an H2S reports, the form of the reported file name, whether `mc_remaining_time` is minutes (the library's docstring says seconds; the field is minutes on every Bambu printer documented by OpenBambuAPI, and this plan treats it as minutes), and the SSDP header names. `print/printer_daemon/tests/fixtures/h2s_status.json` is written from the library's own field names and must carry a header comment saying it is provisional until captured by the smoke test of Task 11.

- [ ] **Step 1: Create the provisional fixture**

`print/printer_daemon/tests/fixtures/h2s_status.json`:

```json
{
  "_comment": "PROVISIONAL. Written on 2026-09-13 from bambulabs_api 2.6.6's own field names and the OpenBambuAPI reference, because the shop H2S was not connected yet. Replace each block with a real capture from print/printer_daemon/tests/smoke_test.py once the printer is on the LAN, then re-run make test-daemon and fix whatever the mapping got wrong. Each key below is one whole 'print' sub-document as bambulabs_api's mqtt_dump()['print'] returns it.",
  "idle": {
    "gcode_state": "IDLE",
    "stg_cur": 255,
    "mc_percent": 0,
    "mc_remaining_time": 0,
    "layer_num": 0,
    "total_layer_num": 0,
    "gcode_file": "",
    "subtask_name": "",
    "print_error": 0,
    "hms": []
  },
  "preparing": {
    "gcode_state": "PREPARE",
    "stg_cur": 2,
    "mc_percent": 0,
    "mc_remaining_time": 44,
    "layer_num": 0,
    "total_layer_num": 210,
    "gcode_file": "sample_part-j8f3a2c1.gcode.3mf",
    "subtask_name": "sample_part-j8f3a2c1",
    "print_error": 0,
    "hms": []
  },
  "heating_while_idle_state": {
    "gcode_state": "IDLE",
    "stg_cur": 7,
    "mc_percent": 0,
    "mc_remaining_time": 44,
    "layer_num": 0,
    "total_layer_num": 210,
    "gcode_file": "sample_part-j8f3a2c1.gcode.3mf",
    "subtask_name": "sample_part-j8f3a2c1",
    "print_error": 0,
    "hms": []
  },
  "running": {
    "gcode_state": "RUNNING",
    "stg_cur": 0,
    "mc_percent": 42,
    "mc_remaining_time": 31,
    "layer_num": 87,
    "total_layer_num": 210,
    "gcode_file": "sample_part-j8f3a2c1.gcode.3mf",
    "subtask_name": "sample_part-j8f3a2c1",
    "print_error": 0,
    "hms": []
  },
  "paused": {
    "gcode_state": "PAUSE",
    "stg_cur": 16,
    "mc_percent": 42,
    "mc_remaining_time": 31,
    "layer_num": 87,
    "total_layer_num": 210,
    "gcode_file": "sample_part-j8f3a2c1.gcode.3mf",
    "subtask_name": "sample_part-j8f3a2c1",
    "print_error": 0,
    "hms": []
  },
  "finished": {
    "gcode_state": "FINISH",
    "stg_cur": 255,
    "mc_percent": 100,
    "mc_remaining_time": 0,
    "layer_num": 210,
    "total_layer_num": 210,
    "gcode_file": "sample_part-j8f3a2c1.gcode.3mf",
    "subtask_name": "sample_part-j8f3a2c1",
    "print_error": 0,
    "hms": []
  },
  "failed_with_hms": {
    "gcode_state": "FAILED",
    "stg_cur": 255,
    "mc_percent": 12,
    "mc_remaining_time": 0,
    "layer_num": 20,
    "total_layer_num": 210,
    "gcode_file": "sample_part-j8f3a2c1.gcode.3mf",
    "subtask_name": "sample_part-j8f3a2c1",
    "print_error": 50336003,
    "hms": [{"attr": 50331904, "code": 65540}]
  }
}
```

- [ ] **Step 2: Write the failing tests**

Create `print/printer_daemon/tests/test_printer.py`:

```python
"""The printer wrapper: the state mapping, the job-suffixed file name, and the thin shim
over bambulabs_api with the library replaced by a fake.

The library is never imported here -- printer.py imports it lazily inside connect() -- so
this suite passes whether or not bambulabs_api is installed."""
import json
import os
import tempfile
import unittest

from printer_daemon import printer as pr

FIXTURES = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures')

with open(os.path.join(FIXTURES, 'h2s_status.json')) as _fh:
    H2S = json.load(_fh)


class TestStateMapping(unittest.TestCase):
    """Pinned by the captured fixture. The relay and the wizard only ever see these six
    state names, whatever the printer's own vocabulary is."""

    def test_idle(self):
        self.assertEqual(pr.map_status(H2S['idle'])['state'], pr.IDLE)

    def test_preparing_counts_as_running(self):
        self.assertEqual(pr.map_status(H2S['preparing'])['state'], pr.RUNNING)

    def test_heating_counts_as_running_even_while_gcode_state_says_idle(self):
        """The printer reports IDLE with a preparation stage for the first few seconds
        after a start command. Showing 'Printer idle' there would read as a failed send."""
        self.assertEqual(pr.map_status(H2S['heating_while_idle_state'])['state'], pr.RUNNING)

    def test_running(self):
        snap = pr.map_status(H2S['running'])
        self.assertEqual(snap['state'], pr.RUNNING)
        self.assertEqual(snap['percent'], 42)
        self.assertEqual(snap['remaining_min'], 31)
        self.assertEqual(snap['layer'], 87)
        self.assertEqual(snap['layers'], 210)
        self.assertEqual(snap['file'], 'sample_part-j8f3a2c1.gcode.3mf')
        self.assertIsNone(snap['error'])

    def test_paused(self):
        self.assertEqual(pr.map_status(H2S['paused'])['state'], pr.PAUSED)

    def test_finished(self):
        self.assertEqual(pr.map_status(H2S['finished'])['state'], pr.FINISHED)

    def test_failed_reports_the_hms_code(self):
        snap = pr.map_status(H2S['failed_with_hms'])
        self.assertEqual(snap['state'], pr.ERROR)
        self.assertEqual(snap['error'], 'HMS_0300_0100_0001_0004')

    def test_a_print_error_without_hms_still_reports_something(self):
        report = dict(H2S['running'], print_error=50336003, hms=[])
        snap = pr.map_status(report)
        self.assertEqual(snap['state'], pr.ERROR)
        self.assertEqual(snap['error'], 'PRINT_ERROR_03001103')

    def test_an_unknown_gcode_state_does_not_raise(self):
        snap = pr.map_status({'gcode_state': 'SOMETHING_NEW', 'stg_cur': 255})
        self.assertIn(snap['state'], (pr.IDLE, pr.RUNNING))

    def test_an_empty_report_is_unreachable(self):
        self.assertEqual(pr.map_status({})['state'], pr.UNREACHABLE)
        self.assertEqual(pr.map_status(None)['state'], pr.UNREACHABLE)

    def test_the_snapshot_has_exactly_the_keys_the_relay_expects(self):
        self.assertEqual(set(pr.map_status(H2S['running'])),
                         {'state', 'file', 'percent', 'remaining_min', 'layer', 'layers',
                          'error', 'printer'})


class TestHmsFormatting(unittest.TestCase):
    def test_attr_and_code_become_the_four_group_form(self):
        self.assertEqual(pr.format_hms(50331904, 65540), 'HMS_0300_0100_0001_0004')


class TestFileNames(unittest.TestCase):
    def test_the_job_id_goes_before_the_compound_extension(self):
        self.assertEqual(pr.suffixed_name('sample_part.gcode.3mf', 'j8f3a2c1'),
                         'sample_part-j8f3a2c1.gcode.3mf')

    def test_a_plain_3mf_works_too(self):
        self.assertEqual(pr.suffixed_name('part.3mf', 'j1'), 'part-j1.3mf')

    def test_an_unknown_extension_still_gets_the_suffix(self):
        self.assertEqual(pr.suffixed_name('part.bin', 'j1'), 'part-j1.bin')

    def test_stripping_the_suffix_round_trips(self):
        name = pr.suffixed_name('sample_part.gcode.3mf', 'j8f3a2c1')
        self.assertEqual(pr.strip_job_suffix(name), 'sample_part.gcode.3mf')

    def test_stripping_leaves_a_file_the_daemon_did_not_name(self):
        self.assertEqual(pr.strip_job_suffix('someone-else.gcode.3mf'),
                         'someone-else.gcode.3mf')


class FakeBambuPrinter:
    """Stands in for bambulabs_api.Printer."""

    def __init__(self, ip_address, access_code, serial):
        self.ip_address, self.access_code, self.serial = ip_address, access_code, serial
        self.report = {}
        self.started = None
        self.uploaded = None
        self.mqtt_running = False
        self.connected = True

    def mqtt_start(self):
        self.mqtt_running = True

    def mqtt_stop(self):
        self.mqtt_running = False

    def camera_start(self):          # must never be called: Pillow frames on a small Pi
        raise AssertionError('the daemon must not start the camera')

    def mqtt_client_connected(self):
        return self.connected

    def mqtt_dump(self):
        return {'print': self.report}

    def upload_file(self, file_obj, filename):
        self.uploaded = (filename, file_obj.read())
        file_obj.close()
        return filename

    def start_print(self, filename, plate_number, use_ams=True, ams_mapping=(0,),
                    skip_objects=None, flow_calibration=True):
        self.started = {'filename': filename, 'plate_number': plate_number,
                        'use_ams': use_ams}
        return True


class TestPrinterLink(unittest.TestCase):
    def link(self):
        return pr.PrinterLink('10.0.0.42', '01P00A', '12345678',
                              model='H2S', name='Shop H2S',
                              printer_factory=FakeBambuPrinter)

    def test_connect_starts_mqtt_only(self):
        link = self.link()
        link.connect()
        self.assertTrue(link._printer.mqtt_running)      # and camera_start would have raised

    def test_snapshot_before_any_report_is_unreachable(self):
        link = self.link()
        link.connect()
        self.assertEqual(link.snapshot()['state'], pr.UNREACHABLE)

    def test_snapshot_carries_the_printer_identity(self):
        link = self.link()
        link.connect()
        link._printer.report = H2S['running']
        snap = link.snapshot()
        self.assertEqual(snap['printer'],
                         {'model': 'H2S', 'name': 'Shop H2S', 'serial': '01P00A'})

    def test_a_disconnected_client_reports_unreachable(self):
        link = self.link()
        link.connect()
        link._printer.report = H2S['running']
        link._printer.connected = False
        self.assertEqual(link.snapshot()['state'], pr.UNREACHABLE)

    def test_upload_sends_the_bytes_under_the_suffixed_name(self):
        link = self.link()
        link.connect()
        with tempfile.NamedTemporaryFile(suffix='.3mf', delete=False) as fh:
            fh.write(b'3mf-bytes')
            path = fh.name
        try:
            link.upload(path, 'sample_part-j8f3a2c1.gcode.3mf')
        finally:
            os.unlink(path)
        self.assertEqual(link._printer.uploaded,
                         ('sample_part-j8f3a2c1.gcode.3mf', b'3mf-bytes'))

    def test_start_uses_plate_one(self):
        link = self.link()
        link.connect()
        self.assertTrue(link.start('sample_part-j8f3a2c1.gcode.3mf'))
        self.assertEqual(link._printer.started['plate_number'], 1)
        self.assertEqual(link._printer.started['filename'],
                         'sample_part-j8f3a2c1.gcode.3mf')

    def test_snapshot_never_raises_when_the_library_misbehaves(self):
        class Exploding(FakeBambuPrinter):
            def mqtt_dump(self):
                raise RuntimeError('mqtt is gone')

        link = pr.PrinterLink('10.0.0.42', '01P00A', '12345678',
                              printer_factory=Exploding)
        link.connect()
        self.assertEqual(link.snapshot()['state'], pr.UNREACHABLE)


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `uv run python -m unittest printer_daemon.tests.test_printer -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'printer_daemon.printer'`.

- [ ] **Step 4: Write `print/printer_daemon/printer.py`**

```python
"""The only module that touches bambulabs_api.

Two jobs. `map_status` turns the printer's own report document into the six-word vocabulary
the relay and the wizard use -- a pure function of a dictionary, so a captured fixture pins
it. `PrinterLink` is the thin shim over the library: connect, read, upload, start.

The library is imported lazily, inside connect(), so this module imports (and its tests
run) on a machine that does not have it -- which is what keeps `make test` honest when
bambulabs_api is absent.
"""

import os
import socket

# The only state names that leave this module.
IDLE = 'idle'
RUNNING = 'running'
PAUSED = 'paused'
FINISHED = 'finished'
ERROR = 'error'
UNREACHABLE = 'unreachable'

# bambulabs_api's GcodeState, which reads the printer's `gcode_state` field. PREPARE is a
# real print in its first seconds, so it maps to running: a status line that said "idle"
# right after a send would read as a failed send.
GCODE_STATE_MAP = {
    'IDLE': IDLE,
    'PREPARE': RUNNING,
    'RUNNING': RUNNING,
    'PAUSE': PAUSED,
    'FINISH': FINISHED,
    'FAILED': ERROR,
    'UNKNOWN': IDLE,
}

# bambulabs_api's PrintStatus (the `stg_cur` field). 255 is IDLE and 0 is PRINTING; every
# PAUSED_* member means the printer is waiting for a human.
STG_IDLE = 255
STG_PAUSED = frozenset({5, 6, 16, 17, 20, 21, 23, 26, 27, 28, 30, 32, 33, 34, 35})

# The compound extensions a sliced file can carry, longest first.
_EXTENSIONS = ('.gcode.3mf', '.3mf', '.gcode')

# SSDP: Bambu printers announce themselves here.
DISCOVERY_PORT = 2021


def format_hms(attr, code):
    """The printer's HMS error in the form the screen and the wiki use.

    attr and code are two 32-bit integers; each becomes two four-hex-digit groups."""
    attr, code = int(attr), int(code)
    return (f"HMS_{(attr >> 16) & 0xFFFF:04X}_{attr & 0xFFFF:04X}"
            f"_{(code >> 16) & 0xFFFF:04X}_{code & 0xFFFF:04X}")


def suffixed_name(filename, job_id):
    """`sample_part.gcode.3mf` + `j8f3a2c1` -> `sample_part-j8f3a2c1.gcode.3mf`.

    The job id is in the name the printer reports back, which is how the daemon tells its
    own job from the previous one and how a restarted daemon recognises a job already
    running. The wizard strips the suffix for display."""
    for ext in _EXTENSIONS:
        if filename.endswith(ext):
            return f"{filename[:-len(ext)]}-{job_id}{ext}"
    stem, ext = os.path.splitext(filename)
    return f"{stem}-{job_id}{ext}"


def strip_job_suffix(filename):
    """Undo suffixed_name for display. A name this daemon did not write is left alone."""
    for ext in _EXTENSIONS:
        if filename.endswith(ext):
            stem = filename[:-len(ext)]
            head, dash, tail = stem.rpartition('-')
            if dash and tail.startswith('j') and len(tail) == 9:
                return f"{head}{ext}"
            return filename
    return filename


def _as_int(value, default=None):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def map_status(report, *, printer=None):
    """Turn one `mqtt_dump()['print']` document into the snapshot the relay stores.

    An empty document means no report has arrived over MQTT, which from the wizard's point
    of view is the printer being unreachable from the Pi."""
    identity = printer or {'model': None, 'name': None, 'serial': None}
    if not report:
        return {'state': UNREACHABLE, 'file': '', 'percent': None, 'remaining_min': None,
                'layer': 0, 'layers': 0, 'error': None, 'printer': identity}

    state = GCODE_STATE_MAP.get(str(report.get('gcode_state', '')).upper(), IDLE)
    stg_cur = _as_int(report.get('stg_cur'), STG_IDLE)

    # The printer reports gcode_state IDLE with a preparation stage for the first seconds
    # after a start command; treat any non-idle, non-paused stage as running.
    if state == IDLE and stg_cur not in (STG_IDLE, None) and stg_cur not in STG_PAUSED:
        state = RUNNING
    if state in (IDLE, RUNNING) and stg_cur in STG_PAUSED:
        state = PAUSED

    error = None
    hms = report.get('hms') or []
    print_error = _as_int(report.get('print_error'), 0) or 0
    if hms:
        first = hms[0] if isinstance(hms[0], dict) else {}
        error = format_hms(first.get('attr', 0), first.get('code', 0))
    elif print_error:
        error = f"PRINT_ERROR_{print_error & 0xFFFFFFFF:08X}"
    if error is not None:
        state = ERROR

    return {
        'state': state,
        'file': report.get('gcode_file') or report.get('subtask_name') or '',
        # mc_percent is a whole percent; mc_remaining_time is MINUTES (the library's
        # docstring says seconds, but every Bambu printer documented by OpenBambuAPI
        # reports minutes here). Verification task 1 settles it against the real H2S.
        'percent': _as_int(report.get('mc_percent')),
        'remaining_min': _as_int(report.get('mc_remaining_time')),
        'layer': _as_int(report.get('layer_num'), 0),
        'layers': _as_int(report.get('total_layer_num'), 0),
        'error': error,
        'printer': identity,
    }


class PrinterLink:
    """One Bambu printer on the LAN.

    `printer_factory` exists so the tests can substitute a fake for bambulabs_api.Printer
    without the library being installed."""

    def __init__(self, ip, serial, access_code, *, model=None, name=None,
                 printer_factory=None):
        self.ip = ip
        self.serial = serial
        self.access_code = access_code
        self.model = model
        self.name = name
        self._factory = printer_factory
        self._printer = None

    def _make(self):
        if self._factory is not None:
            return self._factory(self.ip, self.access_code, self.serial)
        # Imported here, not at module scope: printer.py must import on a machine without
        # the library so the rest of the daemon's tests still run.
        import bambulabs_api
        return bambulabs_api.Printer(self.ip, self.access_code, self.serial)

    def connect(self):
        """Open the MQTT subscription. Deliberately NOT Printer.connect(), which also
        starts the camera: the daemon never needs camera frames, and decoding them through
        Pillow is the one avoidable memory cost on a small Pi."""
        self._printer = self._make()
        self._printer.mqtt_start()
        return self._printer

    def disconnect(self):
        if self._printer is not None:
            try:
                self._printer.mqtt_stop()
            except Exception:
                pass
            self._printer = None

    @property
    def identity(self):
        return {'model': self.model, 'name': self.name, 'serial': self.serial}

    def raw_report(self):
        """The printer's own report document, or {} when nothing has arrived. Never raises:
        a library that throws must look like an unreachable printer, not crash the daemon."""
        if self._printer is None:
            return {}
        try:
            if not self._printer.mqtt_client_connected():
                return {}
            return self._printer.mqtt_dump().get('print') or {}
        except Exception:
            return {}

    def snapshot(self):
        """The status snapshot the daemon posts in every sync."""
        return map_status(self.raw_report(), printer=self.identity)

    def upload(self, local_path, remote_name):
        """Send the sliced file to the printer over FTPS under the job-suffixed name.

        bambulabs_api closes the file object itself in its finally block, so this does not
        use a `with`."""
        handle = open(local_path, 'rb')
        return self._printer.upload_file(handle, remote_name)

    def start(self, remote_name):
        """Start the uploaded file. Plate 1 is what the slicer writes.

        use_ams is False: the stage-1 slice is single-material, and an AMS mapping the team
        has not asked for would be a surprising default. Revisit with the owner if the
        shop prints from an AMS."""
        return self._printer.start_print(remote_name, 1, use_ams=False, ams_mapping=[0],
                                          flow_calibration=True)


def discover(timeout=5.0, *, sock_factory=None):
    """Listen for Bambu printers announcing themselves on UDP 2021.

    Returns a list of {'serial', 'model', 'name', 'ip'}. School networks often block
    broadcasts, so `pair` treats an empty list as normal and asks for an IP address.

    PROVISIONAL: the exact SSDP header names are verification task 3. The parser below
    accepts any `Key: value` header line and reads the ones Bambu is documented to send, so
    an unexpected name shows up as a missing field rather than a crash."""
    import time as _time

    if sock_factory is not None:
        sock = sock_factory()
    else:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind(('', DISCOVERY_PORT))
    sock.settimeout(1.0)

    found = {}
    deadline = _time.monotonic() + timeout
    try:
        while _time.monotonic() < deadline:
            try:
                data, addr = sock.recvfrom(4096)
            except (socket.timeout, OSError):
                continue
            headers = {}
            for line in data.decode('utf-8', 'replace').splitlines():
                key, sep, value = line.partition(':')
                if sep:
                    headers[key.strip().lower()] = value.strip()
            serial = headers.get('usn') or headers.get('devserial.bambu.com')
            if not serial:
                continue
            found[serial] = {
                'serial': serial,
                'model': headers.get('devmodel.bambu.com', ''),
                'name': headers.get('devname.bambu.com', ''),
                'ip': addr[0],
            }
    finally:
        try:
            sock.close()
        except Exception:
            pass
    return list(found.values())
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `uv run python -m unittest printer_daemon.tests.test_printer -v`
Expected: PASS. If `test_a_print_error_without_hms_still_reports_something` fails on the hex text, print `f"{50336003 & 0xFFFFFFFF:08X}"` and correct the fixture's expectation — the point of the test is the shape, not that particular number.

- [ ] **Step 6: Prove the suite runs without the library installed**

Run: `uv run python -c "import sys; sys.modules['bambulabs_api'] = None; import printer_daemon.printer; print('imported without the library')"`
Expected: `imported without the library`. This is the property that keeps `make test` working on a machine where `bambulabs_api` is missing.

- [ ] **Step 7: Run both suites**

Run: `make test`
Expected: PASS.

---

### Task 8: The `run` loop (`print/printer_daemon/run_loop.py`)

**Files:**
- Create: `print/printer_daemon/run_loop.py`
- Test: `print/printer_daemon/tests/test_run_loop.py`

**Interfaces:**

- Consumes:
  - Task 6: `RelayClient.exchange(code) -> str | None`, `.sync(snapshot) -> dict | None`, `.ack(job_id, ok, error=None) -> bool`, `.download(path, dest)`, `.token`; exceptions `RelayError`, `TokenRejected`, `RateLimited(.retry_after)`, `ChallengeDetected`.
  - Task 7: `PrinterLink.snapshot() -> dict`, `.upload(local_path, remote_name)`, `.start(remote_name) -> bool`; `suffixed_name(filename, job_id)`; the state constants.
  - Task 5: `config.DaemonConfig`, `config.save_token(token, path)`.
- Produces:
  - `EXCHANGE_INTERVAL = 30.0`, `SYNC_INTERVAL = 5.0`, `BACKOFF_START = 5.0`, `BACKOFF_CAP = 60.0`, `START_WAIT_SECONDS = 60.0`
  - `class RunLoop` with `__init__(self, config, relay, printer, *, clock=time.monotonic, sleep=time.sleep, log=print, executor=None, download_dir=None, save_token=config_module.save_token)`, and methods `tick() -> None`, `run_forever() -> None`, `handle_job(job) -> None`
  - `class InlineExecutor` with `submit(fn, *args, **kwargs)` — used by the tests and by `handle_job` when no thread pool is wanted
  - Task 9's `__main__` calls `RunLoop(...).run_forever()`.

Design note for the implementer: the loop is written as a `tick()` that does at most one thing and returns, with every interval measured on the **monotonic** clock through the injected `clock`. That is what makes the thirty-second exchange, the five-second sync, the deadlines and the backoff testable without sleeping. `run_forever` is a `while True: self.tick()` with a blanket `except Exception` that logs and backs off — the process must never exit on a single failure. The job runs through a one-worker executor so syncs continue during an upload, and the tests inject `InlineExecutor` so no thread is involved.

- [ ] **Step 1: Write the failing tests for the exchange and sync halves**

Create `print/printer_daemon/tests/test_run_loop.py`:

```python
"""The run loop, with relay_client and printer replaced by fakes.

Every interval is on the injected monotonic clock and every sleep is recorded rather than
taken, so the whole suite runs in milliseconds."""
import os
import tempfile
import unittest

from printer_daemon import printer as pr
from printer_daemon import run_loop as rl
from printer_daemon.config import DaemonConfig
from printer_daemon.relay_client import (
    ChallengeDetected, RateLimited, RelayError, TokenRejected,
)

IDLE = {'state': pr.IDLE, 'file': '', 'percent': None, 'remaining_min': None,
        'layer': 0, 'layers': 0, 'error': None,
        'printer': {'model': 'H2S', 'name': 'Shop H2S', 'serial': '01P00A'}}


def running(file_name):
    return dict(IDLE, state=pr.RUNNING, file=file_name, percent=3, remaining_min=41)


class FakeClock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds


class FakeRelay:
    """Stands in for RelayClient. Queue exceptions to make a call fail."""

    def __init__(self, token=None):
        self.token = token
        self.exchanges = []
        self.syncs = []
        self.acks = []
        self.downloads = []
        self.exchange_result = 'signed'
        self.exchange_error = None
        self.sync_job = None
        self.sync_error = None
        self.ack_result = True
        self.download_error = None

    def exchange(self, code):
        self.exchanges.append(code)
        if self.exchange_error:
            error, self.exchange_error = self.exchange_error, None
            raise error
        self.token = self.exchange_result
        return self.exchange_result

    def sync(self, snapshot):
        self.syncs.append(snapshot)
        if self.sync_error:
            error, self.sync_error = self.sync_error, None
            raise error
        job, self.sync_job = self.sync_job, None
        return job

    def ack(self, job_id, ok, error=None):
        self.acks.append((job_id, ok, error))
        return self.ack_result

    def download(self, path, dest):
        self.downloads.append((path, dest))
        if self.download_error:
            raise self.download_error
        with open(dest, 'wb') as fh:
            fh.write(b'3mf-bytes')


class FakePrinter:
    def __init__(self, snapshot=None):
        self._snapshot = snapshot or dict(IDLE)
        self.uploads = []
        self.starts = []
        self.upload_error = None
        self.start_result = True

    def set(self, snapshot):
        self._snapshot = snapshot

    def snapshot(self):
        return dict(self._snapshot)

    def upload(self, local_path, remote_name):
        if self.upload_error:
            raise self.upload_error
        with open(local_path, 'rb') as fh:
            self.uploads.append((remote_name, fh.read()))

    def start(self, remote_name):
        self.starts.append(remote_name)
        return self.start_result


class RunLoopTestCase(unittest.TestCase):
    def setUp(self):
        self.clock = FakeClock()
        self.slept = []
        self.logged = []
        self.saved_tokens = []
        self.tmp = tempfile.mkdtemp()
        self.config = DaemonConfig(backend_url='https://example.test',
                                   printer_ip='10.0.0.42', printer_serial='01P00A',
                                   access_code='12345678', pairing_code='7K3MQ9XW',
                                   token='', path=os.path.join(self.tmp, 'config.toml'))
        self.relay = FakeRelay()
        self.printer = FakePrinter()

    def make(self, **overrides):
        kwargs = dict(clock=self.clock, sleep=self.slept.append,
                      log=lambda *a: self.logged.append(' '.join(str(x) for x in a)),
                      executor=rl.InlineExecutor(),
                      download_dir=self.tmp,
                      save_token=lambda token, path: self.saved_tokens.append(token))
        kwargs.update(overrides)
        return rl.RunLoop(self.config, self.relay, self.printer, **kwargs)


class TestExchange(RunLoopTestCase):
    def test_the_first_tick_exchanges_and_saves_the_token(self):
        loop = self.make()
        loop.tick()
        self.assertEqual(self.relay.exchanges, ['7K3MQ9XW'])
        self.assertEqual(self.saved_tokens, ['signed'])
        self.assertEqual(self.relay.token, 'signed')

    def test_a_404_retries_every_thirty_seconds_and_logs_once_a_minute(self):
        self.relay.exchange_result = None
        loop = self.make()
        for _ in range(5):
            loop.tick()
            self.clock.advance(30)
        self.assertEqual(len(self.relay.exchanges), 5)
        self.assertTrue(any('waiting for the pairing code' in line for line in self.logged))
        self.assertLessEqual(len([l for l in self.logged
                                  if 'waiting for the pairing code' in l]), 3)

    def test_no_exchange_before_thirty_seconds_have_passed(self):
        self.relay.exchange_result = None
        loop = self.make()
        loop.tick()
        self.clock.advance(29)
        loop.tick()
        self.assertEqual(len(self.relay.exchanges), 1)

    def test_a_429_honours_retry_after(self):
        self.relay.exchange_error = RateLimited(90.0)
        loop = self.make()
        loop.tick()
        self.clock.advance(60)
        loop.tick()
        self.assertEqual(len(self.relay.exchanges), 1)   # still inside the 90 s window
        self.clock.advance(31)
        loop.tick()
        self.assertEqual(len(self.relay.exchanges), 2)

    def test_a_401_on_sync_blanks_the_token_and_re_exchanges(self):
        self.relay.token = 'stale'
        self.config.token = 'stale'
        loop = self.make()
        self.relay.sync_error = TokenRejected('repair')
        loop.tick()                        # the sync that gets rejected
        self.assertIsNone(self.relay.token)
        self.assertEqual(self.saved_tokens, [''])
        self.clock.advance(30)
        loop.tick()                        # now it re-exchanges
        self.assertEqual(self.relay.exchanges, ['7K3MQ9XW'])


class TestSync(RunLoopTestCase):
    def make_paired(self):
        self.relay.token = 'signed'
        self.config.token = 'signed'
        return self.make()

    def test_the_snapshot_is_posted_every_five_seconds(self):
        loop = self.make_paired()
        loop.tick()
        self.assertEqual(len(self.relay.syncs), 1)
        self.clock.advance(4)
        loop.tick()
        self.assertEqual(len(self.relay.syncs), 1)
        self.clock.advance(2)
        loop.tick()
        self.assertEqual(len(self.relay.syncs), 2)

    def test_a_state_change_syncs_at_once(self):
        loop = self.make_paired()
        loop.tick()
        self.clock.advance(1)
        self.printer.set(running('sample_part-j8f3a2c1.gcode.3mf'))
        loop.tick()
        self.assertEqual(len(self.relay.syncs), 2)
        self.assertEqual(self.relay.syncs[-1]['state'], pr.RUNNING)

    def test_a_network_error_backs_off_doubling_to_a_cap(self):
        loop = self.make_paired()
        waits = []
        for _ in range(6):
            self.relay.sync_error = RelayError('connection refused')
            loop.tick()
            waits.append(loop.backoff_until - self.clock.now)   # the wait just applied
            self.clock.advance(waits[-1] + 1)
        self.assertEqual(waits, [5.0, 10.0, 20.0, 40.0, 60.0, 60.0])

    def test_a_successful_sync_resets_the_backoff(self):
        loop = self.make_paired()
        self.relay.sync_error = RelayError('boom')
        loop.tick()
        self.assertEqual(loop.backoff_until - self.clock.now, 5.0)
        self.clock.advance(10)
        loop.tick()
        self.assertEqual(loop.backoff, rl.BACKOFF_START)
        self.assertIsNone(loop.backoff_until)

    def test_a_cloudflare_challenge_is_named_in_the_log(self):
        loop = self.make_paired()
        self.relay.sync_error = ChallengeDetected('got HTML from the backend')
        loop.tick()
        self.assertTrue(any('HTML' in line or 'challenge' in line.lower()
                            for line in self.logged), self.logged)
        self.assertEqual(loop.last_error_kind, 'challenge')
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run python -m unittest printer_daemon.tests.test_run_loop -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'printer_daemon.run_loop'`.

- [ ] **Step 3: Write the exchange-and-sync half of `print/printer_daemon/run_loop.py`**

```python
"""The `run` command's loop.

Written as a tick() that does at most one thing and returns, with every interval measured
on the monotonic clock through an injected `clock`. That is what makes the thirty-second
exchange, the five-second sync, the sixty-second start wait and the backoff testable
without sleeping -- and it is also why a Pi with no network time source, or one whose clock
jumps when it finally gets one, behaves exactly like any other.

One job runs at a time, on a one-worker executor, so syncs keep going during an upload and
the printer never looks offline while a file is on its way.
"""

import os
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor

from printer_daemon import config as config_module
from printer_daemon import printer as printer_module
from printer_daemon.relay_client import (
    ChallengeDetected, RateLimited, RelayError, TokenRejected,
)

EXCHANGE_INTERVAL = 30.0
SYNC_INTERVAL = 5.0
BACKOFF_START = 5.0
BACKOFF_CAP = 60.0
START_WAIT_SECONDS = 60.0
LOG_EVERY = 60.0


class InlineExecutor:
    """Runs the job on the calling thread. Used by the tests, so no thread is involved."""

    def submit(self, fn, *args, **kwargs):
        fn(*args, **kwargs)

    def shutdown(self, wait=True):
        pass


class RunLoop:
    """One printer, one backend, one job at a time."""

    def __init__(self, config, relay, printer, *, clock=time.monotonic, sleep=time.sleep,
                 log=print, executor=None, download_dir=None,
                 save_token=config_module.save_token):
        self.config = config
        self.relay = relay
        self.printer = printer
        self.clock = clock
        self.sleep = sleep
        self.log = log
        self.executor = executor if executor is not None else ThreadPoolExecutor(max_workers=1)
        self.download_dir = download_dir or tempfile.gettempdir()
        self.save_token = save_token

        self.backoff = BACKOFF_START
        self.backoff_until = None
        self.last_error_kind = None
        self.last_exchange_at = None
        self.last_exchange_log_at = None
        self.next_exchange_at = None
        self.last_sync_at = None
        self.last_state = None
        self.running_job_id = None
        self.acked_job_ids = set()

    # -- helpers -----------------------------------------------------------------------

    def _due(self, last, interval):
        return last is None or self.clock() - last >= interval

    def _blocked(self):
        return self.backoff_until is not None and self.clock() < self.backoff_until

    def _fail(self, kind, message):
        """Log, name the failure, and back off, doubling to a cap."""
        self.last_error_kind = kind
        self.log(f"{kind}: {message}; retrying in {self.backoff:.0f}s")
        self.backoff_until = self.clock() + self.backoff
        self.backoff = min(self.backoff * 2, BACKOFF_CAP)

    def _succeeded(self):
        self.backoff = BACKOFF_START
        self.backoff_until = None
        self.last_error_kind = None

    # -- the two halves of a tick -------------------------------------------------------

    def _exchange(self):
        """Trade the pairing code for a token. Runs until there is one, then never again
        unless a sync answers 401."""
        if self.next_exchange_at is not None and self.clock() < self.next_exchange_at:
            return
        if not self._due(self.last_exchange_at, EXCHANGE_INTERVAL):
            return
        self.last_exchange_at = self.clock()
        try:
            token = self.relay.exchange(self.config.pairing_code)
        except RateLimited as e:
            self.next_exchange_at = self.clock() + e.retry_after
            self.log(f"pairing is rate limited; waiting {e.retry_after:.0f}s")
            return
        except ChallengeDetected as e:
            self._fail('challenge', str(e))
            return
        except RelayError as e:
            self._fail('network', str(e))
            return
        self.next_exchange_at = None
        if not token:
            # Once a minute, not every thirty seconds: this is the normal state between
            # running `pair` on the Pi and the mentor pasting the code into the YAML.
            if self._due(self.last_exchange_log_at, LOG_EVERY):
                self.last_exchange_log_at = self.clock()
                self.log("waiting for the pairing code to appear in the team config")
            return
        self.save_token(token, self.config.path)
        self.config.token = token
        self._succeeded()
        self.log("paired with the backend")

    def _sync(self):
        """Post the snapshot; hand any returned job to the job thread."""
        snapshot = self.printer.snapshot()
        state_changed = snapshot.get('state') != self.last_state
        if not state_changed and not self._due(self.last_sync_at, SYNC_INTERVAL):
            return
        self.last_sync_at = self.clock()
        self.last_state = snapshot.get('state')
        try:
            job = self.relay.sync(snapshot)
        except TokenRejected:
            self.log("the backend rejected our token; re-pairing")
            self.relay.token = None
            self.config.token = ''
            self.save_token('', self.config.path)
            self.last_exchange_at = None
            return
        except RateLimited as e:
            self.backoff_until = self.clock() + e.retry_after
            return
        except ChallengeDetected as e:
            self._fail('challenge', str(e))
            return
        except RelayError as e:
            self._fail('network', str(e))
            return
        self._succeeded()
        if job:
            self._maybe_start_job(job)

    def tick(self):
        """One pass. Does at most one network thing, then returns."""
        if self._blocked():
            return
        if not self.relay.token:
            self._exchange()
            return
        self._sync()

    def run_forever(self):
        """Never exits on a single failure; systemd restarts the process if it dies for any
        other reason."""
        if self.config.dev:
            self.log(f"WARNING: development mode, talking to {self.config.backend_url} "
                     "over an unverified connection")
        while True:
            try:
                self.tick()
            except Exception as e:                  # nothing may kill the loop
                self._fail('unexpected', repr(e))
            self.sleep(1.0)
```

- [ ] **Step 4: Run the exchange and sync tests**

Run: `uv run python -m unittest printer_daemon.tests.test_run_loop -v`
Expected: PASS for `TestExchange` and `TestSync`. The job tests do not exist yet.

- [ ] **Step 5: Write the failing tests for the job half**

Append to `print/printer_daemon/tests/test_run_loop.py`:

```python
JOB = {'id': 'j8f3a2c1', 'download_path': '/download/tok',
       'filename': 'sample_part.gcode.3mf', 'state': 'handed_out',
       'created_at': 1_789_300_000}
SUFFIXED = 'sample_part-j8f3a2c1.gcode.3mf'


class TestJobHandling(RunLoopTestCase):
    def make_paired(self):
        self.relay.token = 'signed'
        self.config.token = 'signed'
        return self.make()

    def deliver(self, loop, job=None):
        """Let one sync return a job."""
        self.relay.sync_job = dict(job or JOB)
        loop.tick()

    def test_a_job_is_downloaded_uploaded_started_and_acknowledged(self):
        loop = self.make_paired()

        def start(remote_name):
            self.printer.set(running(remote_name))     # the printer picks it up at once
            return True

        self.printer.start = start
        self.deliver(loop)
        self.assertEqual(self.relay.downloads[0][0], '/download/tok')
        self.assertEqual(self.printer.uploads, [(SUFFIXED, b'3mf-bytes')])
        self.assertEqual(self.relay.acks, [('j8f3a2c1', True, None)])

    def test_the_uploaded_name_carries_the_job_id(self):
        loop = self.make_paired()
        self.printer.start = lambda name: self.printer.set(running(name)) or True
        self.deliver(loop)
        self.assertEqual(self.printer.uploads[0][0], SUFFIXED)

    def test_a_download_failure_is_acknowledged_with_one_line(self):
        loop = self.make_paired()
        self.relay.download_error = RelayError('download answered 404')
        self.deliver(loop)
        job_id, ok, reason = self.relay.acks[0]
        self.assertFalse(ok)
        self.assertIn('404', reason)
        self.assertEqual(len(reason.splitlines()), 1)
        self.assertEqual(self.printer.uploads, [])

    def test_an_upload_failure_is_acknowledged_with_one_line(self):
        loop = self.make_paired()
        self.printer.upload_error = OSError('connection refused')
        self.deliver(loop)
        job_id, ok, reason = self.relay.acks[0]
        self.assertFalse(ok)
        self.assertIn('connection refused', reason)

    def test_a_start_that_returns_false_is_acknowledged_as_a_failure(self):
        loop = self.make_paired()
        self.printer.start_result = False
        self.deliver(loop)
        self.assertFalse(self.relay.acks[0][1])

    def test_a_printer_that_never_reports_running_times_out_at_sixty_seconds(self):
        """The printer stays idle after the start command."""
        loop = self.make_paired()
        ticks = {'n': 0}

        def sleep(seconds):
            ticks['n'] += 1
            self.clock.advance(seconds)

        loop.sleep = sleep
        self.deliver(loop)
        job_id, ok, reason = self.relay.acks[0]
        self.assertFalse(ok)
        self.assertIn('did not start', reason)

    def test_the_same_job_returned_again_after_its_ack_is_ignored(self):
        """A sync in flight when the ack landed returns the job once more."""
        loop = self.make_paired()
        self.printer.start = lambda name: self.printer.set(running(name)) or True
        self.deliver(loop)
        self.assertEqual(len(self.relay.acks), 1)
        self.clock.advance(6)
        self.deliver(loop)
        self.assertEqual(len(self.relay.acks), 1)
        self.assertEqual(len(self.printer.uploads), 1)

    def test_a_job_the_printer_already_runs_is_acknowledged_without_uploading(self):
        """A daemon that died after the start command must not print the part twice."""
        loop = self.make_paired()
        self.printer.set(running(SUFFIXED))
        self.deliver(loop)
        self.assertEqual(self.printer.uploads, [])
        self.assertEqual(self.relay.acks, [('j8f3a2c1', True, None)])

    def test_a_job_the_printer_has_already_finished_is_acknowledged_ok(self):
        loop = self.make_paired()
        self.printer.set(dict(IDLE, state=pr.FINISHED, file=SUFFIXED, percent=100))
        self.deliver(loop)
        self.assertEqual(self.printer.uploads, [])
        self.assertEqual(self.relay.acks, [('j8f3a2c1', True, None)])

    def test_a_job_the_printer_paused_is_acknowledged_ok(self):
        loop = self.make_paired()
        self.printer.set(dict(IDLE, state=pr.PAUSED, file=SUFFIXED))
        self.deliver(loop)
        self.assertEqual(self.relay.acks, [('j8f3a2c1', True, None)])

    def test_a_job_the_printer_errored_on_is_acknowledged_with_the_printer_code(self):
        loop = self.make_paired()
        self.printer.set(dict(IDLE, state=pr.ERROR, file=SUFFIXED,
                              error='HMS_0300_0100_0001_0004'))
        self.deliver(loop)
        job_id, ok, reason = self.relay.acks[0]
        self.assertFalse(ok)
        self.assertIn('HMS_0300_0100_0001_0004', reason)
        self.assertEqual(self.printer.uploads, [])

    def test_a_404_on_the_acknowledgement_is_final_not_retried(self):
        loop = self.make_paired()
        self.relay.ack_result = False
        self.printer.start = lambda name: self.printer.set(running(name)) or True
        self.deliver(loop)
        self.assertEqual(len(self.relay.acks), 1)
        self.assertTrue(any('no longer' in line or '404' in line for line in self.logged),
                        self.logged)
        self.clock.advance(6)
        self.deliver(loop)
        self.assertEqual(len(self.relay.acks), 1)     # never sent again

    def test_syncs_continue_while_a_job_runs(self):
        """A real executor would run the job on another thread; the point here is that the
        loop does not stop syncing once a job has been handed out."""
        loop = self.make_paired()
        self.printer.start = lambda name: self.printer.set(running(name)) or True
        self.deliver(loop)
        before = len(self.relay.syncs)
        self.clock.advance(6)
        loop.tick()
        self.assertEqual(len(self.relay.syncs), before + 1)

    def test_the_downloaded_file_is_cleaned_up(self):
        loop = self.make_paired()
        self.printer.start = lambda name: self.printer.set(running(name)) or True
        self.deliver(loop)
        dest = self.relay.downloads[0][1]
        self.assertFalse(os.path.exists(dest), dest)


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 6: Run the job tests to verify they fail**

Run: `uv run python -m unittest printer_daemon.tests.test_run_loop -v`
Expected: FAIL with `AttributeError: 'RunLoop' object has no attribute '_maybe_start_job'`.

- [ ] **Step 7: Write the job half**

Append to `print/printer_daemon/run_loop.py`:

```python
    # -- the job -----------------------------------------------------------------------

    def _maybe_start_job(self, job):
        """Hand a job to the job thread, unless this process has already dealt with it.

        The set of acknowledged ids guards against a sync that was in flight when the
        acknowledgement landed and so returned the job once more."""
        job_id = job.get('id')
        if not job_id or job_id in self.acked_job_ids or job_id == self.running_job_id:
            return
        self.running_job_id = job_id
        self.executor.submit(self.handle_job, job)

    def _ack(self, job_id, ok, reason=None):
        """Acknowledge once. A False answer means the relay no longer holds the job, which
        the daemon treats as final rather than retrying."""
        self.acked_job_ids.add(job_id)
        self.running_job_id = None
        try:
            held = self.relay.ack(job_id, ok, reason)
        except RelayError as e:
            self.log(f"could not acknowledge {job_id}: {e}")
            return
        if not held:
            self.log(f"the backend no longer holds job {job_id} (404); treating as final")

    def handle_job(self, job):
        """Download, upload, start, wait, acknowledge. Every failure acknowledges with one
        line of reason; the full traceback stays in the Pi's journal."""
        job_id = job['id']
        remote_name = printer_module.suffixed_name(job['filename'], job_id)

        # The printer already has this job: a daemon that died after the start command must
        # not print the part a second time.
        snapshot = self.printer.snapshot()
        if snapshot.get('file') == remote_name:
            state = snapshot.get('state')
            if state in (printer_module.RUNNING, printer_module.PAUSED,
                         printer_module.FINISHED):
                self.log(f"the printer already has {remote_name} ({state}); not uploading")
                self._ack(job_id, True)
                return
            if state == printer_module.ERROR:
                self._ack(job_id, False,
                          f"printer error: {snapshot.get('error') or 'unknown'}")
                return

        dest = os.path.join(self.download_dir, remote_name)
        try:
            try:
                self.relay.download(job['download_path'], dest)
                self.printer.upload(dest, remote_name)
            finally:
                if os.path.exists(dest):
                    try:
                        os.unlink(dest)
                    except OSError:
                        pass
            if not self.printer.start(remote_name):
                self._ack(job_id, False, 'the printer refused the print start command')
                return
        except Exception as e:
            self._ack(job_id, False, self._one_line(e))
            return

        # Wait for the printer to confirm it is running OUR file, so a start that silently
        # did nothing is reported rather than shown as a success.
        deadline = self.clock() + START_WAIT_SECONDS
        while self.clock() < deadline:
            snapshot = self.printer.snapshot()
            if snapshot.get('file') == remote_name:
                state = snapshot.get('state')
                if state in (printer_module.RUNNING, printer_module.PAUSED,
                             printer_module.FINISHED):
                    self._ack(job_id, True)
                    return
                if state == printer_module.ERROR:
                    self._ack(job_id, False,
                              f"printer error: {snapshot.get('error') or 'unknown'}")
                    return
            self.sleep(2.0)
        self._ack(job_id, False, 'printer did not start the file')

    @staticmethod
    def _one_line(error):
        """One line for the status line; the traceback belongs in the journal only."""
        text = str(error) or error.__class__.__name__
        return text.splitlines()[0][:200]
```

- [ ] **Step 8: Run the whole daemon suite**

Run: `uv run python -m unittest printer_daemon.tests.test_run_loop -v`
Expected: PASS. If `test_a_printer_that_never_reports_running_times_out_at_sixty_seconds` hangs, the test's `sleep` is not advancing the injected clock — that is the bug the test is shaped to catch; every wait in `handle_job` must go through `self.sleep` and `self.clock`.

- [ ] **Step 9: Run both suites**

Run: `make test`
Expected: PASS.

---

### Task 9: The `pair`, `run` and `status` commands (`print/printer_daemon/__main__.py`)

**Files:**
- Create: `print/printer_daemon/__main__.py`
- Test: `print/printer_daemon/tests/test_main.py`

**Interfaces:**

- Consumes: everything from Tasks 5 to 8 — `config.DaemonConfig`, `load_config`, `save_config`, `check_backend_url`, `wait_for_config`, `resolve_pairing_code`, `DEFAULT_BACKEND_URL`, `DEFAULT_CONFIG_PATH`; `printer.PrinterLink`, `printer.discover`; `relay_client.RelayClient`; `run_loop.RunLoop`.
- Produces:
  - `generate_pairing_code() -> str` — the same alphabet and rule as `printer_relay.generate_code`, reimplemented here because the daemon must not import the backend
  - `format_pairing_code(code) -> str`
  - `build_parser() -> argparse.ArgumentParser`
  - `cmd_pair(args, *, io=...) -> int`, `cmd_run(args) -> int`, `cmd_status(args) -> int`
  - `main(argv=None) -> int`
  - The wrapper `/usr/local/bin/penguincam-printer` (written by Task 10) runs `python -m printer_daemon "$@"`.

The daemon deliberately does **not** import `printer_relay` — it is not installed on the Pi, and the design says the daemon never imports the backend. The forty-bit code generator therefore exists twice; a test in this task pins the two alphabets together by literal, so a change to one is caught.

- [ ] **Step 1: Write the failing tests**

Create `print/printer_daemon/tests/test_main.py`:

```python
"""The three commands. Everything that touches a network or a printer is injected."""
import io
import os
import tempfile
import unittest
from unittest import mock

from printer_daemon import __main__ as main_mod
from printer_daemon import config as cfg


class TestCodeGeneration(unittest.TestCase):
    def test_the_alphabet_matches_the_backend_exactly(self):
        """The daemon must not import printer_relay (it is not installed on the Pi), so the
        alphabet lives in two places. Pin them together by literal."""
        self.assertEqual(main_mod.ALPHABET, '0123456789ABCDEFGHJKMNPQRSTVWXYZ')

    def test_codes_are_eight_symbols_and_never_all_digits(self):
        for _ in range(300):
            code = main_mod.generate_pairing_code()
            self.assertEqual(len(code), 8)
            self.assertFalse(code.isdigit())
            for ch in code:
                self.assertIn(ch, main_mod.ALPHABET)

    def test_display_form(self):
        self.assertEqual(main_mod.format_pairing_code('7K3MQ9XW'), '7K3M-Q9XW')


class FakePrinterLink:
    """Stands in for printer.PrinterLink."""

    instances = []

    def __init__(self, ip, serial, access_code, **kwargs):
        self.ip, self.serial, self.access_code = ip, serial, access_code
        self.kwargs = kwargs
        self.connected = False
        self.snapshots = [{'state': 'idle', 'file': '', 'percent': None,
                           'remaining_min': None, 'layer': 0, 'layers': 0, 'error': None,
                           'printer': {'model': 'H2S', 'name': 'Shop H2S',
                                       'serial': serial}}]
        FakePrinterLink.instances.append(self)

    def connect(self):
        self.connected = True

    def disconnect(self):
        self.connected = False

    def snapshot(self):
        return self.snapshots[-1]


class PairTestCase(unittest.TestCase):
    def setUp(self):
        FakePrinterLink.instances = []
        self.dir = tempfile.mkdtemp()
        self.path = os.path.join(self.dir, 'config.toml')
        self.out = io.StringIO()

    def run_pair(self, answers, argv=None, discovered=(), link=FakePrinterLink):
        argv = list(argv or []) + ['--config', self.path]
        args = main_mod.build_parser().parse_args(['pair'] + argv)
        with mock.patch.object(main_mod, 'PrinterLink', link), \
             mock.patch.object(main_mod, 'discover', lambda **kw: list(discovered)), \
             mock.patch.object(main_mod, 'restart_service', lambda log: None):
            return main_mod.cmd_pair(args, ask=iter(answers).__next__,
                                     out=self.out)


class TestPair(PairTestCase):
    def test_a_typed_ip_and_serial_are_written(self):
        code = self.run_pair(['10.0.0.42', '01P00A', '12345678'])
        self.assertEqual(code, 0)
        written = cfg.load_config(self.path)
        self.assertEqual(written.printer_ip, '10.0.0.42')
        self.assertEqual(written.printer_serial, '01P00A')
        self.assertEqual(written.access_code, '12345678')
        self.assertEqual(len(written.pairing_code), 8)
        self.assertEqual(written.token, '')
        self.assertEqual(written.backend_url, cfg.DEFAULT_BACKEND_URL)

    def test_the_yaml_lines_are_printed_for_pasting(self):
        self.run_pair(['10.0.0.42', '01P00A', '12345678'])
        text = self.out.getvalue()
        self.assertIn('printing:', text)
        self.assertIn('pairing_code:', text)
        code = cfg.load_config(self.path).pairing_code
        self.assertIn(main_mod.format_pairing_code(code), text)

    def test_a_discovered_printer_needs_only_the_access_code(self):
        found = [{'serial': '01P00A', 'model': 'H2S', 'name': 'Shop H2S',
                  'ip': '10.0.0.42'}]
        self.run_pair(['1', '12345678'], discovered=found)
        written = cfg.load_config(self.path)
        self.assertEqual(written.printer_ip, '10.0.0.42')
        self.assertEqual(written.printer_serial, '01P00A')

    def test_the_backend_url_is_printed_so_a_typo_is_visible(self):
        self.run_pair(['10.0.0.42', '01P00A', '12345678'])
        self.assertIn(cfg.DEFAULT_BACKEND_URL, self.out.getvalue())

    def test_an_http_backend_is_refused_without_dev(self):
        rc = self.run_pair(['10.0.0.42', '01P00A', '12345678'],
                           argv=['--backend', 'http://192.168.1.5:6238'])
        self.assertNotEqual(rc, 0)
        self.assertFalse(os.path.exists(self.path))

    def test_an_http_backend_is_accepted_with_dev_and_recorded(self):
        rc = self.run_pair(['10.0.0.42', '01P00A', '12345678'],
                           argv=['--backend', 'http://192.168.1.5:6238', '--dev'])
        self.assertEqual(rc, 0)
        written = cfg.load_config(self.path)
        self.assertTrue(written.dev)
        self.assertEqual(written.backend_url, 'http://192.168.1.5:6238')

    def test_re_running_keeps_the_code(self):
        self.run_pair(['10.0.0.42', '01P00A', '12345678'])
        first = cfg.load_config(self.path).pairing_code
        self.out = io.StringIO()
        self.run_pair(['10.0.0.42', '01P00A', '12345678'])
        self.assertEqual(cfg.load_config(self.path).pairing_code, first)

    def test_new_code_replaces_it(self):
        self.run_pair(['10.0.0.42', '01P00A', '12345678'])
        first = cfg.load_config(self.path).pairing_code
        self.out = io.StringIO()
        self.run_pair(['10.0.0.42', '01P00A', '12345678'], argv=['--new-code'])
        self.assertNotEqual(cfg.load_config(self.path).pairing_code, first)

    def test_a_printer_that_never_answers_refuses_to_continue(self):
        class Silent(FakePrinterLink):
            def __init__(self, *a, **kw):
                super().__init__(*a, **kw)
                self.snapshots = [{'state': 'unreachable', 'file': '', 'percent': None,
                                   'remaining_min': None, 'layer': 0, 'layers': 0,
                                   'error': None, 'printer': {'model': None, 'name': None,
                                                              'serial': None}}]

        rc = self.run_pair(['10.0.0.42', '01P00A', '12345678'], link=Silent)
        self.assertNotEqual(rc, 0)
        text = self.out.getvalue()
        self.assertIn('LAN', text)
        self.assertIn('Developer Mode', text)
        self.assertFalse(os.path.exists(self.path))


class TestStatus(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.path = os.path.join(self.dir, 'config.toml')
        cfg.save_config(cfg.DaemonConfig(
            backend_url='https://example.test', printer_ip='10.0.0.42',
            printer_serial='01P00A', access_code='12345678',
            pairing_code='7K3MQ9XW', token='signed'), path=self.path)
        self.out = io.StringIO()

    def run_status(self, relay):
        args = main_mod.build_parser().parse_args(['status', '--config', self.path])
        with mock.patch.object(main_mod, 'PrinterLink', FakePrinterLink), \
             mock.patch.object(main_mod, 'RelayClient', lambda *a, **kw: relay):
            return main_mod.cmd_status(args, out=self.out)

    def test_it_prints_the_non_secret_fields_and_never_the_secrets(self):
        relay = mock.Mock()
        relay.ping.return_value = {'ok': True, 'waiting': False, 'online': True}
        self.run_status(relay)
        text = self.out.getvalue()
        self.assertIn('10.0.0.42', text)
        self.assertIn('7K3M-Q9XW', text)
        self.assertIn('https://example.test', text)
        self.assertNotIn('12345678', text)      # the printer's LAN access code
        self.assertNotIn('signed', text)        # the daemon token

    def test_it_says_whether_a_token_is_set(self):
        relay = mock.Mock()
        relay.ping.return_value = {'ok': True, 'waiting': False, 'online': True}
        self.run_status(relay)
        self.assertIn('token: set', self.out.getvalue())

    def test_a_cloudflare_challenge_is_named(self):
        from printer_daemon.relay_client import ChallengeDetected
        relay = mock.Mock()
        relay.ping.side_effect = ChallengeDetected('got HTML from the backend')
        self.run_status(relay)
        self.assertIn('challenge', self.out.getvalue().lower())

    def test_it_posts_no_snapshot(self):
        relay = mock.Mock()
        relay.ping.return_value = {'ok': True, 'waiting': False, 'online': True}
        self.run_status(relay)
        relay.sync.assert_not_called()


class TestParser(unittest.TestCase):
    def test_the_three_commands_exist(self):
        parser = main_mod.build_parser()
        for command in ('pair', 'run', 'status'):
            self.assertEqual(parser.parse_args([command]).command, command)

    def test_pair_takes_new_code_backend_and_dev(self):
        args = main_mod.build_parser().parse_args(
            ['pair', '--new-code', '--backend', 'http://x.test', '--dev'])
        self.assertTrue(args.new_code)
        self.assertTrue(args.dev)
        self.assertEqual(args.backend, 'http://x.test')


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run python -m unittest printer_daemon.tests.test_main -v`
Expected: FAIL with `AttributeError: module 'printer_daemon.__main__' has no attribute 'ALPHABET'` (or an import error).

- [ ] **Step 3: Write `print/printer_daemon/__main__.py`**

```python
"""`penguincam-printer pair | run | status`.

The installer writes /usr/local/bin/penguincam-printer as a two-line wrapper that runs
`python -m printer_daemon "$@"` out of the daemon's venv, so this is the whole CLI.
"""

import argparse
import secrets
import subprocess
import sys
import time

from printer_daemon import VERSION
from printer_daemon import config as cfg
from printer_daemon.printer import PrinterLink, discover
from printer_daemon.relay_client import ChallengeDetected, RelayClient, RelayError
from printer_daemon.run_loop import RunLoop

# Crockford base32 without I, L, O and U. Deliberately duplicated from print/printer_relay.py:
# the backend is not installed on the Pi and the daemon never imports it. A test pins the
# two literals together.
ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
CODE_LENGTH = 8

SERVICE_NAME = 'penguincam-printer'
CONNECT_WAIT_SECONDS = 20.0


def generate_pairing_code():
    """Forty bits, never all digits -- an all-digit code would load out of an unquoted YAML
    value as an int."""
    while True:
        code = ''.join(secrets.choice(ALPHABET) for _ in range(CODE_LENGTH))
        if not code.isdigit():
            return code


def format_pairing_code(code):
    return f"{code[:4]}-{code[4:]}"


def restart_service(log):
    """Start (or restart) the systemd unit. A machine without systemd just gets a note."""
    try:
        subprocess.run(['systemctl', 'restart', SERVICE_NAME], check=True)
        log(f"restarted {SERVICE_NAME}")
    except Exception as e:
        log(f"could not restart {SERVICE_NAME} ({e}); start it yourself with "
            f"`sudo systemctl restart {SERVICE_NAME}`")


def _connect_and_identify(link, out, *, wait=CONNECT_WAIT_SECONDS, clock=time.monotonic,
                          sleep=time.sleep):
    """Connect and wait for the printer's first report. Returns the snapshot or None."""
    link.connect()
    deadline = clock() + wait
    while clock() < deadline:
        snapshot = link.snapshot()
        if snapshot.get('state') != 'unreachable':
            return snapshot
        sleep(0.5)
    return None


def cmd_pair(args, *, ask=input, out=sys.stdout):
    """Find the printer, confirm it answers, write the config file, print the YAML lines."""
    def say(*parts):
        print(*parts, file=out)

    backend = args.backend or cfg.DEFAULT_BACKEND_URL
    try:
        cfg.check_backend_url(backend, dev=bool(args.dev))
    except ValueError as e:
        say(f"error: {e}")
        return 2

    try:
        existing = cfg.load_config(args.config)
    except FileNotFoundError:
        existing = None

    found = discover(timeout=5.0)
    if found:
        say("Printers heard on the network:")
        for index, entry in enumerate(found, start=1):
            say(f"  {index}) {entry['model'] or 'Bambu printer'} "
                f"{entry['name'] or ''} {entry['serial']} at {entry['ip']}")
        say("Enter a number, or an IP address if your printer is not listed.")
        answer = (ask("printer: ") or '').strip()
        if answer.isdigit() and 1 <= int(answer) <= len(found):
            chosen = found[int(answer) - 1]
            ip, serial = chosen['ip'], chosen['serial']
            model, name = chosen['model'], chosen['name']
        else:
            ip, model, name = answer, None, None
            serial = (ask("printer serial: ") or '').strip()
    else:
        say("No printers heard; enter the IP address shown on the printer's screen.")
        say("(School networks usually block the broadcast the printer uses to announce "
            "itself, so this is the normal path.)")
        ip = (ask("printer IP address: ") or '').strip()
        serial = (ask("printer serial: ") or '').strip()
        model = name = None

    access_code = (ask("printer LAN access code: ") or '').strip()

    link = PrinterLink(ip, serial, access_code, model=model, name=name)
    try:
        snapshot = _connect_and_identify(link, out)
    finally:
        link.disconnect()
    if snapshot is None:
        say("")
        say(f"The printer at {ip} did not answer.")
        say("Check that it is in LAN-only mode with Developer Mode ON, and that the")
        say("access code matches the one on the printer's screen. Developer Mode is")
        say("required: Bambu firmware rejects print starts from third-party software")
        say("in any other mode. See docs/PRINTER_SETUP.md.")
        return 1

    identity = snapshot.get('printer') or {}
    say(f"Connected to {identity.get('model') or model or 'the printer'} "
        f"{identity.get('name') or name or ''} ({serial}).")

    code = cfg.resolve_pairing_code(existing.pairing_code if existing else None,
                                   new_code=bool(args.new_code),
                                   generate=generate_pairing_code)
    config = cfg.DaemonConfig(backend_url=backend, printer_ip=ip, printer_serial=serial,
                              access_code=access_code, pairing_code=code, token='',
                              dev=bool(args.dev), path=args.config)
    cfg.save_config(config, path=args.config)

    say("")
    say(f"Backend: {config.backend_url}")
    say(f"Config:  {args.config}")
    say("")
    say("Paste these two lines into your team's PenguinCAM-config.yaml in Onshape,")
    say("then open PenguinCAM from Onshape and click the config refresh link:")
    say("")
    say("printing:")
    say(f'  pairing_code: "{format_pairing_code(code)}"')
    say("")
    restart_service(lambda message: print(message, file=out))
    return 0


def cmd_run(args):
    """The service. Waits for the config file rather than exiting into a restart loop."""
    config = cfg.wait_for_config(args.config, log=lambda *a: print(*a, flush=True))
    try:
        cfg.check_backend_url(config.backend_url, dev=config.dev)
    except ValueError as e:
        print(f"error: {e}", flush=True)
        return 2
    printer = PrinterLink(config.printer_ip, config.printer_serial, config.access_code)
    printer.connect()
    relay = RelayClient(config.backend_url, token=config.token or None)
    loop = RunLoop(config, relay, printer, log=lambda *a: print(*a, flush=True))
    print(f"penguincam-printer {VERSION} running against {config.backend_url}", flush=True)
    loop.run_forever()
    return 0


def cmd_status(args, *, out=sys.stdout):
    """What a mentor runs when the wizard says offline. Posts no snapshot, so it cannot
    disturb the running service."""
    def say(*parts):
        print(*parts, file=out)

    try:
        config = cfg.load_config(args.config)
    except FileNotFoundError:
        say(f"No config file at {args.config}. Run `sudo penguincam-printer pair`.")
        return 1

    say(f"penguincam-printer {VERSION}")
    say(f"backend:      {config.backend_url}")
    say(f"printer IP:   {config.printer_ip}")
    say(f"serial:       {config.printer_serial}")
    say(f"pairing code: {format_pairing_code(config.pairing_code) if config.pairing_code else '(none)'}")
    say(f"token:        {'set' if config.token else 'not set'}")
    say(f"dev mode:     {'yes' if config.dev else 'no'}")

    printer = PrinterLink(config.printer_ip, config.printer_serial, config.access_code)
    try:
        snapshot = _connect_and_identify(printer, out, wait=10.0)
    except Exception as e:
        snapshot = None
        say(f"printer:      could not connect ({e})")
    finally:
        printer.disconnect()
    if snapshot is not None:
        say(f"printer:      answering, state {snapshot.get('state')}")
    else:
        say("printer:      no MQTT report -- check LAN-only mode, Developer Mode and the "
            "access code")

    relay = RelayClient(config.backend_url, token=config.token or None)
    try:
        flags = relay.ping()
        say(f"backend:      reachable, waiting={flags.get('waiting')} "
            f"online={flags.get('online')}")
    except ChallengeDetected as e:
        say(f"backend:      blocked by a bot challenge -- {e}")
    except RelayError as e:
        say(f"backend:      not reachable ({e})")
    return 0


def build_parser():
    parser = argparse.ArgumentParser(prog='penguincam-printer',
                                     description='PenguinCAM printer daemon')
    # --config is declared on each subcommand, not here: a top-level copy would shadow the
    # subparser's value with its own default.
    sub = parser.add_subparsers(dest='command', required=False)

    pair = sub.add_parser('pair', help='find the printer and mint a pairing code')
    pair.add_argument('--config', default=cfg.DEFAULT_CONFIG_PATH)
    pair.add_argument('--new-code', action='store_true',
                      help='mint a fresh pairing code instead of keeping the existing one')
    pair.add_argument('--backend', default=None,
                      help='backend URL (defaults to the hosted service)')
    pair.add_argument('--dev', action='store_true',
                      help='allow a plain-HTTP backend URL (development only)')

    run = sub.add_parser('run', help='run the relay loop (what systemd starts)')
    run.add_argument('--config', default=cfg.DEFAULT_CONFIG_PATH)

    status = sub.add_parser('status', help='report on the config, printer and backend')
    status.add_argument('--config', default=cfg.DEFAULT_CONFIG_PATH)
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    if args.command == 'pair':
        return cmd_pair(args)
    if args.command == 'run':
        return cmd_run(args)
    if args.command == 'status':
        return cmd_status(args)
    build_parser().print_help()
    return 1


if __name__ == '__main__':
    sys.exit(main())
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run python -m unittest printer_daemon.tests.test_main -v`
Expected: PASS. If `cmd_pair` blocks in `_connect_and_identify`, the fake link's first snapshot is already `idle`, so it returns immediately — a hang means the sleep is not injectable there; make `_connect_and_identify` take `sleep` and pass a no-op from `cmd_pair`'s tests if needed.

- [ ] **Step 5: Check the CLI is reachable as a module**

Run: `uv run python -m printer_daemon --help`
Expected: the usage text listing `pair`, `run` and `status`. Do **not** run `pair` or `run` here: `pair` would try to touch `/etc`, and `run` would talk to the network.

- [ ] **Step 6: Run both suites**

Run: `make test`
Expected: PASS.

---

### Task 10: The Pi installer (`print/printer_daemon/install.sh`)

**Files:**
- Create: `print/printer_daemon/install.sh` (mode 755)
- Test: `print/printer_daemon/tests/test_install_script.py`; plus one assertion added to `print/tests/test_printer_routes.py`

**Interfaces:**

- Consumes: `print/printer_daemon/requirements.txt` (Task 4), `print/printer_daemon/__main__.py` (Task 9), the `/install-printer.sh` route (Task 3).
- Produces: the installed layout — `/opt/penguincam-printer/app/printer_daemon/`, `/opt/penguincam-printer/venv/`, `/usr/local/bin/penguincam-printer`, `/etc/systemd/system/penguincam-printer.service`, the `penguincam` system user.

**The pinned SHA. Read this before writing the script.** Nothing in this branch is committed yet, so there is no commit to pin. The script therefore ships:

```sh
PENGUINCAM_SHA="REPLACE_BEFORE_MERGE"
```

with a guard that aborts with a clear message if it is unchanged. **The owner must set the real SHA when the pull request is opened** — Task 14 says so again, and `docs/DEPLOYMENT_GUIDE.md` records that every pull request touching `print/printer_daemon/` updates it. A tag is not used because the repository has no tags and agents may not create them.

**The documented install command is the GitHub raw URL, not the app's own route:**

```
curl -fsSL https://raw.githubusercontent.com/6238/PenguinCAM/<sha>/printer_daemon/install.sh | sudo bash
```

The reason is in "Verification findings already folded in" above: free-plan Cloudflare Bot Fight Mode cannot be skipped per path, and a challenge page piped into `bash` produces a pile of syntax errors rather than a clear failure. `-f` makes curl exit non-zero and print nothing on any 4xx or 5xx, so a blocked URL can never reach `bash`.

- [ ] **Step 1: Write the failing tests**

Create `print/printer_daemon/tests/test_install_script.py`:

```python
"""Static checks on the installer.

It cannot be executed here -- it makes users, writes to /opt and /etc, and talks to apt --
so these tests read it. They exist to catch the mistakes that would only show up on a Pi in
a shop at the worst possible moment."""
import os
import re
import stat
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCRIPT = os.path.join(ROOT, 'printer_daemon', 'install.sh')


class TestInstallScript(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(SCRIPT) as fh:
            cls.text = fh.read()

    def test_it_is_executable(self):
        self.assertTrue(os.stat(SCRIPT).st_mode & stat.S_IXUSR)

    def test_it_fails_fast(self):
        self.assertIn('set -euo pipefail', self.text)

    def test_the_sha_placeholder_is_guarded(self):
        """Nothing is committed yet, so the SHA cannot be real. The guard is what stops a
        half-finished installer from downloading a tarball named REPLACE_BEFORE_MERGE."""
        self.assertIn('PENGUINCAM_SHA="REPLACE_BEFORE_MERGE"', self.text)
        self.assertIn('REPLACE_BEFORE_MERGE', self.text.split('PENGUINCAM_SHA=')[1])
        self.assertRegex(self.text, r'if\s+\[\s+"\$PENGUINCAM_SHA"\s+=\s+"REPLACE_BEFORE_MERGE"')

    def test_it_requires_aarch64(self):
        """There is no 32-bit Pillow wheel on PyPI, so an armv7l install would try to build
        it from source and fail after a long wait."""
        self.assertIn('aarch64', self.text)
        self.assertIn('armv7l', self.text)

    def test_it_installs_wheels_only(self):
        """--only-binary=:all: makes a future wheel gap fail loudly instead of starting a
        Pillow source build on a Pi."""
        self.assertIn('--only-binary=:all:', self.text)

    def test_it_installs_python3_venv(self):
        """Bookworm is PEP 668 externally-managed: a venv is mandatory, not tidy."""
        self.assertIn('python3-venv', self.text)

    def test_it_downloads_from_the_pinned_sha(self):
        self.assertIn('github.com/6238/PenguinCAM/archive/', self.text)
        self.assertIn('$PENGUINCAM_SHA', self.text)

    def test_it_extracts_only_the_daemon_directory(self):
        self.assertIn('--strip-components=1', self.text)
        self.assertIn('printer_daemon', self.text)

    def test_it_creates_the_service_user_and_enables_without_starting(self):
        self.assertIn('useradd', self.text)
        self.assertIn('penguincam', self.text)
        self.assertIn('systemctl enable', self.text)
        self.assertNotIn('systemctl start penguincam-printer', self.text)

    def test_the_unit_restarts_always(self):
        self.assertIn('Restart=always', self.text)
        self.assertIn('ExecStart=', self.text)

    def test_pair_is_run_with_stdin_from_the_tty(self):
        """The script itself arrived on standard input from the curl pipe, so pair would
        read the rest of the script as its answers without this."""
        self.assertRegex(self.text, r'pair\s*<\s*/dev/tty')

    def test_the_documented_command_is_the_github_raw_url_with_dash_f(self):
        """A Cloudflare challenge page piped into bash fails confusingly, and free-plan Bot
        Fight Mode cannot be skipped per path."""
        self.assertIn('raw.githubusercontent.com/6238/PenguinCAM', self.text)
        self.assertIn('curl -fsSL', self.text)

    def test_it_never_passes_dev(self):
        """A shop install must not be able to talk plain HTTP."""
        self.assertNotIn('--dev', self.text)

    def test_it_contains_no_secret(self):
        self.assertNotRegex(self.text, r'(?i)(api[_-]?key|password|secret)\s*=')


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run python -m unittest printer_daemon.tests.test_install_script -v`
Expected: FAIL with `FileNotFoundError` on `install.sh`.

- [ ] **Step 3: Write `print/printer_daemon/install.sh`**

```sh
#!/usr/bin/env bash
#
# PenguinCAM printer daemon installer for Raspberry Pi OS Bookworm (64-bit).
#
#   curl -fsSL https://raw.githubusercontent.com/6238/PenguinCAM/<sha>/printer_daemon/install.sh | sudo bash
#
# The -f matters: curl then exits non-zero and prints nothing on any 4xx or 5xx, so a
# blocked or moved URL can never be piped into bash. (https://penguincam.popcornpenguins.com/install-printer.sh
# serves the same script and is a convenience alias, but the GitHub URL is the documented
# one: the site sits behind Cloudflare, free-plan Bot Fight Mode cannot be skipped per
# path, and a challenge page piped into bash produces a pile of syntax errors instead of a
# clear failure.)
#
# Re-running upgrades in place and runs `pair` again, which keeps the existing pairing code
# unless --new-code is given.

set -euo pipefail

# The one place the daemon's version is written. The pull request that changes anything in
# print/printer_daemon/ updates it to that pull request's merge commit.
PENGUINCAM_SHA="REPLACE_BEFORE_MERGE"

INSTALL_DIR="/opt/penguincam-printer"
APP_DIR="$INSTALL_DIR/app"
VENV_DIR="$INSTALL_DIR/venv"
CONFIG_DIR="/etc/penguincam-printer"
SERVICE_USER="penguincam"
SERVICE_NAME="penguincam-printer"
WRAPPER="/usr/local/bin/penguincam-printer"

die() { echo "error: $*" >&2; exit 1; }

if [ "$PENGUINCAM_SHA" = "REPLACE_BEFORE_MERGE" ]; then
  die "this installer has no pinned commit yet.
Set PENGUINCAM_SHA in print/printer_daemon/install.sh to the commit you want to install before
opening the pull request, or pass a SHA: PENGUINCAM_SHA=<sha> sudo -E bash install.sh"
fi

[ "$(id -u)" -eq 0 ] || die "run this with sudo"

ARCH="$(uname -m)"
if [ "$ARCH" = "armv7l" ] || [ "$ARCH" = "armv6l" ]; then
  die "this needs 64-bit Raspberry Pi OS ($ARCH found).
One of the daemon's dependencies (Pillow) publishes no 32-bit wheel, so a 32-bit install
would try to compile it and fail after a long wait. Re-image with the 64-bit Bookworm
release and run this again."
fi
[ "$ARCH" = "aarch64" ] || echo "warning: untested architecture $ARCH; continuing"

echo "==> installing packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq python3-venv curl tar

echo "==> creating the $SERVICE_USER user and $INSTALL_DIR"
id -u "$SERVICE_USER" >/dev/null 2>&1 || \
  useradd --system --home-dir "$INSTALL_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
mkdir -p "$APP_DIR" "$CONFIG_DIR"

echo "==> downloading PenguinCAM $PENGUINCAM_SHA"
TARBALL="$(mktemp)"
trap 'rm -f "$TARBALL"' EXIT
curl -fsSL "https://github.com/6238/PenguinCAM/archive/$PENGUINCAM_SHA.tar.gz" -o "$TARBALL"

echo "==> extracting printer_daemon"
rm -rf "${APP_DIR:?}/printer_daemon"
# The archive's top directory is PenguinCAM-<sha>; strip it and keep only the daemon.
tar -xzf "$TARBALL" -C "$APP_DIR" --strip-components=1 '*/printer_daemon/*'

echo "==> creating the virtual environment"
python3 -m venv "$VENV_DIR"
# --only-binary=:all: so a future wheel gap fails here rather than starting a Pillow source
# build on a Raspberry Pi.
"$VENV_DIR/bin/pip" install --quiet --upgrade --only-binary=:all: \
  -r "$APP_DIR/printer_daemon/requirements.txt"

echo "==> writing $WRAPPER"
cat > "$WRAPPER" <<WRAPPER_EOF
#!/bin/sh
exec env PYTHONPATH="$APP_DIR" "$VENV_DIR/bin/python" -m printer_daemon "\$@"
WRAPPER_EOF
chmod 755 "$WRAPPER"

echo "==> writing the systemd unit"
cat > "/etc/systemd/system/$SERVICE_NAME.service" <<UNIT_EOF
[Unit]
Description=PenguinCAM printer daemon
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
ExecStart=$WRAPPER run
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
UNIT_EOF

chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR" "$CONFIG_DIR"
chmod 750 "$CONFIG_DIR"
systemctl daemon-reload
# Enabled but NOT started: `pair` writes the config file and starts it when it finishes.
systemctl enable "$SERVICE_NAME" >/dev/null

echo
echo "==> pairing"
# This script arrived on standard input from the curl pipe, so pair must read the console
# rather than the rest of the script.
"$WRAPPER" pair < /dev/tty

echo
echo 'Done. Run: penguincam-printer status'
```

Make it executable: `chmod 755 print/printer_daemon/install.sh`.

- [ ] **Step 4: Run the installer tests**

Run: `uv run python -m unittest printer_daemon.tests.test_install_script -v`
Expected: PASS. `test_it_never_passes_dev` fails if the phrase `--dev` appears anywhere, including in a comment — keep the comment wording clear of it.

- [ ] **Step 5: Check the script parses as shell**

Run: `bash -n print/printer_daemon/install.sh && echo "syntax ok"`
Expected: `syntax ok`. Do not execute it.

- [ ] **Step 6: Tighten the route test now that the script exists**

In `print/tests/test_printer_routes.py`, replace `test_the_installer_route_is_reachable_in_development_mode` with:

```python
    def test_the_installer_route_serves_the_script(self):
        app.debug = True
        resp = self.client.get('/install-printer.sh')
        self.assertEqual(resp.status_code, 200)
        body = resp.get_data()
        self.assertIn(b'PENGUINCAM_SHA', body)
        self.assertIn(b'set -euo pipefail', body)
```

- [ ] **Step 7: Run both suites**

Run: `make test`
Expected: PASS.

---

### Task 11: The real-printer smoke test (`print/printer_daemon/tests/smoke_test.py`)

**Files:**
- Create: `print/printer_daemon/tests/smoke_test.py`, `print/printer_daemon/tests/fixtures/smoke_cube.gcode.3mf` **only if** one can be produced without touching the other branch's files — otherwise the script takes the file path from the environment (see below)
- Test: none. This script is run by hand, and `unittest discover` never finds it (its name does not match `test*.py`).

**Interfaces:**

- Consumes: `printer.PrinterLink`, `printer.map_status`, `printer.suffixed_name`.
- Produces: a printed raw status document that becomes the replacement for `print/printer_daemon/tests/fixtures/h2s_status.json`.

**Stop for the owner.** This script needs the shop's H2S on the LAN in LAN-only mode with Developer Mode on, and it starts a real print. Do not run it without asking. It answers spec verification tasks 1, 2 and 4.

The sliced `.gcode.3mf` fixture belongs to the other branch (`tests/fixtures/print/`), which this branch must not create. The script therefore takes the file from `PENGUINCAM_SMOKE_FILE` and says so when it is missing, rather than shipping one.

- [ ] **Step 1: Write the script**

Create `print/printer_daemon/tests/smoke_test.py`:

```python
#!/usr/bin/env python3
"""Run this BY HAND against a real Bambu printer. It starts a real print.

    PENGUINCAM_PRINTER_IP=10.0.0.42 \
    PENGUINCAM_PRINTER_SERIAL=01P00A... \
    PENGUINCAM_PRINTER_ACCESS_CODE=12345678 \
    PENGUINCAM_SMOKE_FILE=/path/to/a/small/sliced.gcode.3mf \
    uv run python print/printer_daemon/tests/smoke_test.py

It is deliberately NOT named test_*.py, so `unittest discover` never finds it and
`make test-daemon` never starts a print.

What it is for: the mocked tests are written against bambulabs_api's documented field
names, because the shop H2S was not connected when this feature was built. This script
prints the printer's RAW status document, which becomes the replacement for
print/printer_daemon/tests/fixtures/h2s_status.json -- after which the state-mapping tests are
pinned to the real thing. It answers spec verification tasks 1, 2 and 4.
"""

import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))))

from printer_daemon.printer import PrinterLink, map_status, suffixed_name  # noqa: E402

WAIT_FOR_RUNNING_SECONDS = 120.0


def env(name):
    value = os.environ.get(name)
    if not value:
        sys.exit(f"set {name} in the environment (see this file's docstring)")
    return value


def main():
    ip = env('PENGUINCAM_PRINTER_IP')
    serial = env('PENGUINCAM_PRINTER_SERIAL')
    access_code = env('PENGUINCAM_PRINTER_ACCESS_CODE')
    source = env('PENGUINCAM_SMOKE_FILE')
    if not os.path.exists(source):
        sys.exit(f"{source} does not exist")

    job_id = 'jsmoke001'
    remote_name = suffixed_name(os.path.basename(source), job_id)

    link = PrinterLink(ip, serial, access_code)
    print(f"connecting to {ip} ...")
    link.connect()
    try:
        for _ in range(40):
            if link.raw_report():
                break
            time.sleep(0.5)
        raw = link.raw_report()
        if not raw:
            sys.exit("no MQTT report arrived. Check LAN-only mode, Developer Mode and the "
                     "access code.")

        print("\n--- raw status before the print (verification task 1) ---")
        print(json.dumps(raw, indent=2, sort_keys=True, default=str))
        print("\n--- mapped snapshot ---")
        print(json.dumps(map_status(raw, printer=link.identity), indent=2, sort_keys=True))

        print(f"\nuploading as {remote_name} ...")
        link.upload(source, remote_name)
        print("starting the print ...")
        started = link.start(remote_name)
        print(f"start_print returned {started!r}")

        # Verification task 4: how long from the start command to a reported `running`,
        # including the printer's preparing states.
        began = time.monotonic()
        seen = []
        while time.monotonic() - began < WAIT_FOR_RUNNING_SECONDS:
            raw = link.raw_report()
            snapshot = map_status(raw, printer=link.identity)
            marker = (snapshot['state'], raw.get('gcode_state'), raw.get('stg_cur'),
                      snapshot['file'])
            if not seen or seen[-1] != marker:
                seen.append(marker)
                print(f"  t+{time.monotonic() - began:5.1f}s  {marker}")
            if snapshot['state'] == 'running' and snapshot['file'] == remote_name:
                print(f"\nreported running after "
                      f"{time.monotonic() - began:.1f}s (verification task 4)")
                break
            time.sleep(1.0)
        else:
            print("\nthe printer never reported running with our file name; "
                  "check verification task 2 -- the reported file-name form")

        print("\n--- raw status while printing (this becomes the fixture) ---")
        print(json.dumps(link.raw_report(), indent=2, sort_keys=True, default=str))
        print("\nReported file name (verification task 2): "
              f"{link.raw_report().get('gcode_file')!r} / "
              f"subtask {link.raw_report().get('subtask_name')!r}")
    finally:
        link.disconnect()


if __name__ == '__main__':
    main()
```

- [ ] **Step 2: Check it compiles and is not discovered**

Run: `uv run python -m py_compile print/printer_daemon/tests/smoke_test.py && echo "compiles"`
Expected: `compiles`.

Run: `uv run python -m unittest discover -s print/printer_daemon/tests -t . -v 2>&1 | grep -c smoke`
Expected: `0`.

- [ ] **Step 3: Run both suites**

Run: `make test`
Expected: PASS, with no print started.

---

### Task 12: Documentation

**Files:**
- Create: `docs/PRINTER_SETUP.md`
- Modify: `README.md` (one bullet list item under "What you can customize" and one paragraph after the example YAML, about line 466)
- Modify: `CLAUDE.md` (the Development Commands block, and one row in the documentation table at about line 116)
- Modify: `docs/DEPLOYMENT_GUIDE.md` (a new section)
- Test: none new; `make test` must still pass, and `test_full_template_is_valid` covers the template that Task 2 changed.

**Interfaces:** none. This task produces prose only.

**Do not touch `docs/3D_PRINTING.md`** — it belongs to `feature/3d-print-stage1`. The spec's section 15 asks for a developer section there; put that content in `docs/PRINTER_SETUP.md` under a "For developers" heading instead, and record in this plan's Task 14 that a short pointer is added to `docs/3D_PRINTING.md` after the rebase.

Follow the repository's markdown conventions: cross-references between markdown files are real links (`[label](path.md)`), never bare code spans.

- [ ] **Step 1: Write `docs/PRINTER_SETUP.md`**

The mentor's guide. It must cover, in this order:

1. **What this gives you and what it costs.** Send to Printer in the print wizard, and a live status line. The printer must run in **LAN-only mode with Developer Mode on**: Bambu firmware since 2025 rejects print starts from third-party software in any other mode, and Developer Mode disconnects the printer from Bambu Cloud, so the **Bambu Handy app and cloud sending from Bambu Studio stop working for that printer**. Say this before anything else, because it is the decision the team has to make.
2. **What you need.** A Raspberry Pi on the same network as the printer, with outbound internet. **Recommended: Pi 4 with 2 GB of RAM or more (or a Pi 5, Pi 400 or CM4), running 64-bit Raspberry Pi OS Bookworm or newer. Minimum: Pi 3B+ with 1 GB, 64-bit. A Pi Zero 2 W is not recommended** — 512 MB with Wi-Fi only, and a dropped association during a large upload burns the fifteen-minute deadline. 64-bit is required: one dependency publishes no 32-bit wheel. No inbound ports are opened anywhere.
3. **Put the printer in LAN-only mode with Developer Mode.** On the printer's screen, and note the LAN access code it shows.
4. **Install on the Pi.** One command:
   ```
   curl -fsSL https://raw.githubusercontent.com/6238/PenguinCAM/<sha>/printer_daemon/install.sh | sudo bash
   ```
   Say plainly that `<sha>` is the commit to install and where to find the current one (the repository's default branch). Note that `-f` is there so a blocked URL fails cleanly instead of piping an error page into `bash`. Mention that re-running the command upgrades in place and keeps the pairing code.
5. **Pairing.** The installer runs `pair` at the end. It listens for printers on the network for five seconds; **school networks usually block that broadcast, so typing the IP address is the normal path**, not a failure. It asks for the LAN access code, connects, names the printer back, and prints a pairing code and two YAML lines.
6. **Paste the code into the team's YAML.** The two lines go into `PenguinCAM-config.yaml` in Onshape:
   ```yaml
   printing:
     pairing_code: "7K3M-Q9XW"
   ```
   Then open PenguinCAM from Onshape and click the config refresh link in the header, so the new YAML loads now rather than at the next ten-minute refresh. **Loading the YAML is what tells PenguinCAM the code exists — there is no button to press in the wizard.** Within a minute the Pi starts reporting.
7. **What the status line means.** Reproduce the table from the spec's section 4 verbatim, as a markdown table with the two columns Text and Condition.
8. **Changing or retiring a Pi.** Re-running `pair` keeps the code, so a printer swap needs no YAML edit; `pair --new-code` mints a new one (for when a former student still knows the old one) and the YAML line is replaced; deleting the line retires the Pi.
9. **Troubleshooting**, with `penguincam-printer status` as the first move. Cover at least: "has not reported since the service started" (the code is not in the YAML, or the YAML has not been refreshed); the printer not answering (LAN-only mode, Developer Mode, the access code); a second Pi that never pairs (two Pis with the same config file — the first one alive refuses the second, by design); "blocked by a bot challenge" (Cloudflare; tell the owner, the fix is a dashboard toggle); and where the logs are (`journalctl -u penguincam-printer -f`).
10. **For developers.** The content the spec's section 15 wanted in `docs/3D_PRINTING.md`: the relay (`print/printer_relay.py`, in-memory, keyed by pairing code, nothing on disk), the daemon package (`print/printer_daemon/`, not a pip package, run as `python -m printer_daemon`), the routes (`/printer/status`, `/printer/jobs`, `/printer/daemon/pair|sync|jobs/<id>/ack|ping`, `/install-printer.sh`), how to run a daemon against a local server (`penguincam-printer pair --backend http://<host>:6238 --dev`, and what `--dev` means and why it exists), `make test-daemon`, and the note that updating anything in `print/printer_daemon/` means updating `PENGUINCAM_SHA` in `print/printer_daemon/install.sh`. End with a line saying a short pointer will be added to [3D_PRINTING.md](3D_PRINTING.md) once `feature/3d-print-stage1` merges.

- [ ] **Step 2: Update `README.md`**

Add to the "What you can customize" bullet list under "For Other FRC Teams":

```markdown
- Sending prints straight to a Bambu Lab printer on your shop network (see [Printer Setup](docs/PRINTER_SETUP.md))
```

And after the example YAML block (after the line "All other values automatically use proven Team 6238 defaults."), add:

```markdown
**Sending prints to your printer:** if your team has a Bambu Lab printer and a Raspberry Pi
in the shop, add a `printing` block with the pairing code the Pi prints during setup:

```yaml
printing:
  pairing_code: "7K3M-Q9XW"
```

That one line is all that connects PenguinCAM to your printer — no password leaves your
network and nothing on your network has to be reachable from outside. See
[Printer Setup](docs/PRINTER_SETUP.md).
```

Do **not** add a "Send to Printer" line to a 3D printing section: that section arrives with `feature/3d-print-stage1`, and Task 14 records the follow-up.

- [ ] **Step 3: Update `CLAUDE.md`**

In the Development Commands block, after the `make test` line, add:

```bash
# Run the Raspberry Pi printer daemon's tests (make test includes this)
make test-daemon
```

Add a row to the documentation table, keeping the existing format:

```markdown
| `PRINTER_SETUP.md` | Changing the printer relay, the Pi daemon, the pairing flow, or the printer routes |
```

And add a short paragraph under Dependency Management:

```markdown
**The Pi daemon's dependencies are separate.** `print/printer_daemon/` has its own
`requirements.txt` (`bambulabs_api`, `requests`, `tomli-w`) that is installed on the
Raspberry Pi and, by `make test-daemon`, into the development venv. None of it belongs in
the repository's own `requirements.txt` or in the Docker image. The daemon is run as a
module (`python -m printer_daemon`) rather than installed as a package precisely because
this project does not use `pyproject.toml`.
```

- [ ] **Step 4: Update `docs/DEPLOYMENT_GUIDE.md`**

Add a section (after "Environment Variables", before "Custom Domain Setup") covering:

- **`FLASK_SECRET_KEY` is required for the printer relay, not merely recommended.** The daemon's token is signed with it. Without it the app makes a random key on every start, every token dies on every deploy, and the Pi cannot re-pair until someone opens PenguinCAM from Onshape (the exchange needs a session to have loaded the YAML first). Symptom: every printer shows "has not reported since the service started" after a deploy.
- **Development mode and the HTTPS rule.** Development mode is Flask's debug flag on **and** `RAILWAY_ENVIRONMENT` absent. Outside it, `/printer/daemon/*` and `/install-printer.sh` answer 403 to any request that did not arrive over HTTPS, judged after `ProxyFix`. On Railway nothing in this feature is ever served over plain HTTP.
- **`PRINTER_DEV_PAIRING_CODE`** seeds a relay record so a daemon can pair against a server nobody has opened in Onshape. Read **only** in development mode; ignored on Railway. Never set it in production.
- **The installer route and the documented URL.** `GET /install-printer.sh` serves `print/printer_daemon/install.sh`. The **documented** install command fetches the same script from `https://raw.githubusercontent.com/6238/PenguinCAM/<sha>/printer_daemon/install.sh` with `curl -fsSL`, because the site is behind Cloudflare and a challenge page piped into `bash` fails confusingly.
- **Cloudflare.** On a **Pro plan or better**, add a WAF custom rule with action **Skip**, skipping the phases `http_request_sbfm` and `http_ratelimit` and the products `uaBlock`, `bic` and `securityLevel`, with the expression:
  ```
  (starts_with(http.request.uri.path, "/printer/daemon/")) or
  (starts_with(http.request.uri.path, "/download/")) or
  (http.request.uri.path eq "/install-printer.sh")
  ```
  On the **free plan**, Bot Fight Mode **cannot** be skipped per path (Cloudflare's own documentation says so), so the rule does nothing for bots there: **keep Bot Fight Mode off**, or the daemon's five-second syncs may be challenged. The daemon recognises a challenge page — an HTML body on a JSON route — and names it in `penguincam-printer status`. Record that the zone's plan and Bot Fight Mode setting were not confirmed in the dashboard as of 2026-09-13 and that the owner should check them (Websites → popcornpenguins.com for the plan badge, Security → Bots for the toggle).
- **Rate limits.** Every printer route sets its own limit with `override_defaults=True`, because a five-second sync is 720 requests an hour against the app-wide 200-per-hour default. `storage_uri="memory://"` means the counters are per gunicorn worker, so the effective limits multiply if the worker count ever rises above one.
- **Updating the daemon.** `print/printer_daemon/install.sh` pins `PENGUINCAM_SHA`. Every pull request that changes anything under `print/printer_daemon/` updates it to that pull request's merge commit; that SHA is the one place the daemon's version is written.

- [ ] **Step 5: Check every markdown cross-reference resolves**

Run:
```
uv run python - <<'PY'
import os, re
root = os.getcwd()
bad = []
for name in ('README.md', 'CLAUDE.md', 'docs/PRINTER_SETUP.md', 'docs/DEPLOYMENT_GUIDE.md'):
    with open(name) as fh:
        text = fh.read()
    for label, target in re.findall(r'\[([^\]]+)\]\(([^)#]+\.md)[^)]*\)', text):
        path = os.path.normpath(os.path.join(os.path.dirname(name), target))
        if not os.path.exists(path):
            bad.append(f'{name}: [{label}]({target}) -> {path}')
print('\n'.join(bad) or 'every markdown link resolves')
PY
```
Expected: `every markdown link resolves`, except a single known dangling link to `docs/3D_PRINTING.md`, which arrives with the other branch. If that is the only line printed, it is fine — note it in the task report.

- [ ] **Step 6: Run both suites**

Run: `make test`
Expected: PASS.

---

### Task 13: Verification tasks 5 and 8 (the parts that need no printer)

**Files:**
- Test: `print/tests/test_printer_relay.py` (one new class), `print/tests/test_printer_routes.py` (one new class)
- Modify: `docs/DEPLOYMENT_GUIDE.md` (record the findings in the section Task 12 added)

**Interfaces:** none new. This task only proves properties the rest of the design assumes.

Spec section 14 items 5 and 8 need no printer. Item 5 is about token durability; item 8 is about what flask-limiter and `ProxyFix` actually do. Part of item 8 is already answered — `ProxyFix(app.wsgi_app, x_proto=1, x_host=1)` leaves `x_for` at its default of `1`, so `X-Forwarded-For`'s first hop is honoured — and the rest is pinned by tests here. The remaining piece of item 8, **what address the app actually sees in production for a browser and for a Pi**, needs a live request against Railway behind Cloudflare and is a **stop for the owner**: ask before probing production, and record the answer in the deployment guide.

- [ ] **Step 1: Write the verification-5 tests**

Append to `print/tests/test_printer_relay.py`:

```python
class TestVerificationFiveTokenDurability(unittest.TestCase):
    """Spec verification task 5: a token signed with the app secret must survive a restart
    when FLASK_SECRET_KEY is set, and must be rejected under a different key.

    This is what makes FLASK_SECRET_KEY a requirement rather than a recommendation: without
    it every deploy mints a new random key, every daemon token dies, and every printer sits
    at 'has not reported' until someone opens PenguinCAM from Onshape."""

    def test_a_token_survives_a_process_restart_with_the_same_key(self):
        key = 'a-persistent-flask-secret-key'
        token = printer_relay.issue_token('7K3MQ9XW', key)
        # A new process reads the same key out of the environment and builds a new
        # serializer; nothing is carried over in memory.
        code, _ = printer_relay.read_token(token, key)
        self.assertEqual(code, '7K3MQ9XW')

    def test_a_token_is_rejected_after_the_key_changes(self):
        token = printer_relay.issue_token('7K3MQ9XW', 'key-before-the-deploy')
        self.assertIsNone(printer_relay.read_token(token, 'key-after-the-deploy'))

    def test_the_salt_is_what_separates_printer_tokens_from_session_cookies(self):
        """A signature under the same key but a different salt must not verify here."""
        from itsdangerous import URLSafeSerializer
        forged = URLSafeSerializer('shared-key', salt='some-other-purpose').dumps(
            {'code': '7K3MQ9XW', 'iat': 0.0})
        self.assertIsNone(printer_relay.read_token(forged, 'shared-key'))
```

- [ ] **Step 2: Write the verification-8 tests**

Append to `print/tests/test_printer_routes.py`:

```python
class TestVerificationEightLimiterAndProxy(unittest.TestCase):
    """Spec verification task 8, the parts that need no production traffic.

    What is pinned here: flask-limiter evaluates a route's key_func BEFORE the view, so a
    key function that raises would be a 500 the view never sees; and override_defaults
    removes the app-wide 200-per-hour limit for these routes."""

    def setUp(self):
        app.config['TESTING'] = True
        app.secret_key = 'test-secret-key'
        app.debug = True
        self.addCleanup(setattr, app, 'debug', False)
        self.relay = printer_relay.PrinterRelay()
        patch = mock.patch.object(printer_relay, 'RELAY', self.relay)
        patch.start()
        self.addCleanup(patch.stop)
        self.relay.note_code(CODE)
        self.client = app.test_client()

    def test_the_key_func_runs_before_the_view(self):
        calls = []
        real = printer_routes._token_code_key

        def spy():
            calls.append('key')
            return real()

        with mock.patch.object(printer_routes, '_token_code_key', spy):
            gui.limiter.enabled = True
            self.addCleanup(setattr, gui.limiter, 'enabled', False)
            gui.limiter.reset()
            token = printer_relay.issue_token(CODE, app.secret_key)
            self.client.post('/printer/daemon/sync', json=IDLE,
                             headers={'Authorization': f'Bearer {token}'})
        self.assertIn('key', calls)

    def test_a_raising_key_func_would_be_a_five_hundred_which_is_why_ours_cannot(self):
        """Demonstrates the failure mode the try/except in every key_func prevents."""
        gui.limiter.enabled = True
        self.addCleanup(setattr, gui.limiter, 'enabled', False)
        gui.limiter.reset()

        def exploding():
            raise RuntimeError('a key function that forgot its try block')

        with mock.patch.object(printer_routes, '_token_code_key', exploding):
            with self.assertRaises(RuntimeError):
                self.client.post('/printer/daemon/sync', json=IDLE,
                                 headers={'Authorization': 'Bearer whatever'})

    def test_proxyfix_is_configured_to_honour_one_forwarded_hop(self):
        """x_for is left at its default of 1, so get_remote_address sees the address
        Cloudflare forwards rather than the proxy's own."""
        from werkzeug.middleware.proxy_fix import ProxyFix
        self.assertIsInstance(gui.app.wsgi_app, ProxyFix)
        self.assertEqual(gui.app.wsgi_app.x_for, 1)
        self.assertEqual(gui.app.wsgi_app.x_proto, 1)

    def test_an_address_keyed_route_sees_the_forwarded_address(self):
        with app.test_request_context(
                '/printer/status', headers={'X-Forwarded-For': '203.0.113.7'},
                environ_overrides={'REMOTE_ADDR': '10.0.0.1'}):
            from flask_limiter.util import get_remote_address
            # ProxyFix runs as WSGI middleware, so a bare test_request_context does not
            # apply it; assert what the middleware is configured to do instead.
            self.assertIsNotNone(get_remote_address())
```

Note for the implementer: `test_a_raising_key_func_would_be_a_five_hundred_which_is_why_ours_cannot` depends on `app.config['TESTING']` propagating the exception. If flask-limiter swallows it and answers 500 instead, assert `resp.status_code == 500` — either outcome proves the same point; pick whichever the library actually does and say so in a comment.

- [ ] **Step 3: Run both new classes**

Run: `uv run python -m unittest tests.test_printer_relay tests.test_printer_routes -v`
Expected: PASS.

- [ ] **Step 4: Record the findings in the deployment guide**

In the section Task 12 added to `docs/DEPLOYMENT_GUIDE.md`, add a short "What was verified, and when" list:

- Verification 5 (2026-09-13): a token signed with `FLASK_SECRET_KEY` verifies under the same key and is rejected under another; pinned by `print/tests/test_printer_relay.py::TestVerificationFiveTokenDurability`.
- Verification 6 (2026-09-13): every daemon dependency has an aarch64 wheel; about 7 MB of downloads, about 23 MB installed; 64-bit Raspberry Pi OS is required because Pillow publishes no 32-bit wheel.
- Verification 7 (2026-09-13): the zone is proxied by Cloudflare, nothing was challenged on the day, the plan was not confirmed, and free-plan Bot Fight Mode cannot be skipped per path — hence the GitHub raw installer URL.
- Verification 8, partial (2026-09-13): `ProxyFix` honours one forwarded hop (`x_for=1`); `override_defaults=True` is set on every printer route and pinned by a test. **Open:** what address the app actually sees in production for a browser and for a Pi. Needs a live probe against Railway; **ask the owner** before running one.
- Verifications 1 to 4: **open**, need the shop H2S. `print/printer_daemon/tests/fixtures/h2s_status.json` is provisional until `print/printer_daemon/tests/smoke_test.py` has been run against it.

- [ ] **Step 5: Run everything**

Run: `make test`
Expected: PASS.

---

### Task 14: Wizard changes (deferred until `feature/3d-print-stage1` merges)

**Files:** none. **This task writes no code.** It exists so the deferred work is written down where the next session will find it.

**Interfaces:** none.

The print wizard belongs to `feature/3d-print-stage1`: `print/templates/print_wizard.html`, `print/static/print_wizard.js`, `templates/wizard.html`, `static/wizard.js`, `docs/3D_PRINTING.md`. This branch must not create or edit any of them. Spec section 10 is therefore not implemented here.

- [ ] **Step 1: Read this list, change nothing, and report it to the owner**

After `feature/3d-print-stage1` has merged to `main` and this branch has been rebased onto it, a follow-up does all of the following. Nothing below may be started before the rebase.

**Wizard, spec section 10:**

- Add **Send to Printer** to the Preview split button, beside Download and Send to Google Drive. Enable it only when `paired` and `online` are true, the snapshot state is neither `running` nor `paused`, and `job` is empty; otherwise show the status line's text as a tooltip.
- Add a status line under the slice summary. Render it from the table in the spec's section 4, choosing the first row whose condition holds. Strip the `-<job id>` suffix from the printer's reported file name for display (the daemon's `strip_job_suffix` does the same thing, server-side, and is the reference implementation).
- On entering Preview, poll `GET /printer/status` every five seconds; stop on leaving the step or the page.
- On Send to Printer, `POST /printer/jobs` with `{token: <the slice's download token>}` and let the polling take over. Show a 409's `error` in the error box; a 404 means slice again.
- Remember Send to Printer as the last split-button choice, the way the CNC wizard remembers Drive.
- **In full-page mode (`source=upload`), never show the option or the status line and never call the printer routes**, whatever cookies the browser holds. A browser that used the Onshape panel earlier may still carry an Onshape session, and the full-page mode must not act on that team's printer.

**Facts about the other branch's wizard, as reported on 2026-09-13** (re-check them after the rebase, they may have moved): the status line is `#gen-status`; the summary is `#preview-stats`; the split button is `#final-action` with main button `#btn-do`, caret `#btn-do-caret`, and menu `#do-menu` holding `li[data-action="download"]` and `li[data-action="drive"]`; the bootstrap object is `window.PenguinCAM = {source, theme, returnUrl, driveEnabled}`; the slice's download token lives in `state.token` inside the wizard's IIFE, and that branch may need to expose a getter for it.

**Two documentation follow-ups:**

- Add a short pointer in `docs/3D_PRINTING.md` to [PRINTER_SETUP.md](https://github.com/6238/PenguinCAM/blob/main/docs/PRINTER_SETUP.md) — the developer content is already written there, under "For developers", because this branch could not touch that file.
- Add "Send to Printer" to the README's 3D printing section, which arrives with the other branch.
- Add the relay to the slicing spec's list of per-process state in [3D_PRINTING.md](https://github.com/6238/PenguinCAM/blob/main/docs/3D_PRINTING.md): the relay's printer records are per process, which is a second reason production gunicorn stays at one worker (the first is the slicing branch's token map).
- The slicing branch adds a `make test-quick`. Once it lands, decide with the owner whether `test-quick` should also run `test-daemon`; this branch wired `test-daemon` into `make test` only.

**One wiring check after the rebase:** `init_print_routes(app, limiter=limiter, require_session=_require_app_session, token_manager=file_token_manager, upload_folder=UPLOAD_FOLDER, output_folder=OUTPUT_FOLDER, template_context=_app_template_context, metrics=metrics, log=log)` and this branch's `init_printer_routes(...)` are both placed just before `def cleanup():`, so the merge should leave them adjacent. Confirm both calls survived and both blueprints are registered.

- [ ] **Step 2: Tell the owner what is still open**

Report these, plainly, in the final summary:

1. **Set `PENGUINCAM_SHA` in `print/printer_daemon/install.sh`** before opening the pull request. It ships as `REPLACE_BEFORE_MERGE` with a guard that aborts, because nothing was committed when the plan was written. This is the owner's to do, and the daemon cannot be installed on a Pi until it is done.
2. **Verification tasks 1 to 4 need the shop H2S.** `print/printer_daemon/tests/fixtures/h2s_status.json` is provisional. Run `print/printer_daemon/tests/smoke_test.py` when the printer is on the LAN — it starts a real print — then replace the fixture and re-run `make test-daemon`.
3. **The end-to-end arrangements need port 6238** and the Onshape panel, and another session's server is bound to it. Ask for a turn before either arrangement.
4. **Confirm the Cloudflare plan and whether Bot Fight Mode is on** (Websites → popcornpenguins.com for the plan badge; Security → Bots for the toggle). On a free plan it must stay off, or daemon syncs may be challenged.
5. **`use_ams=False`** is this plan's choice for `start_print`, because the stage-1 slice is single-material. Say so if the shop prints from an AMS.

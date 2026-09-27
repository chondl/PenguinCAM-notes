# 3D Print Stage 1, Subfeature C: Job Pool, Routes and Event Stream Implementation Plan

> **Paths updated 2026-09-13:** the print path moved into the top-level `print/`
> package after this document was written. File paths and imports below were
> rewritten to match; the design and the task order are unchanged. See
> [3D_PRINTING.md](https://github.com/6238/PenguinCAM/blob/main/docs/3D_PRINTING.md) for the current layout.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run slices in a small background pool, expose them through a Flask blueprint with a server-sent event stream, and wire the blueprint into the app with two small touches.

**Architecture:** `print/jobs.py` (no Flask) owns a job table guarded by a lock, per-job condition variables, a `ThreadPoolExecutor` sized by two module constants, and expiry. `print/routes.py` builds the blueprint inside `init_print_routes(...)`, receiving every shared object from `frc_cam_gui_app.py` as arguments so it never imports the app module. The worker slices with `print.slicer.slice_stl` in a scratch directory under the upload folder, moves the archive into the output folder, registers it with the token manager, and removes the scratch directory. The Flask app gains one `init_print_routes(...)` call and a MIME choice by extension in `/download/<token>`.

**Tech Stack:** Python 3.11 stdlib (`threading`, `concurrent.futures`, `secrets`, `time`), Flask 3.0 blueprints, flask-limiter, `unittest` with the Flask test client.

**Spec:** `docs/superpowers/specs/2026-09-13-3d-print-slicing-design.md`, sections 4 (wiring), 6 (routes, job pool, status stream, job files and cleanup, delivery), 8 (error handling), 9 (testing).

## Global Constraints

- `print/jobs.py` and `print/routes.py` never import `frc_cam_gui_app`. `print/jobs.py` imports no Flask.
- Pool constants at the top of `print/jobs.py`: `MAX_RUNNING = 1`, `MAX_QUEUED = 2`, `RECORD_TTL_S = 3600`, `WAIT_S = 5.0`, `SWEEP_INTERVAL_S = 600`. Basis, recorded in the module docstring: one slice of the sample measured 93 MB peak resident and 0.23 s wall clock on the aarch64 agent container (2026-09-13); the production Railway plan's vCPU and memory allotment could not be read from this container (no Railway token), so the pool stays at the spec's default of one until measured on the production plan.
- States: `queued`, `running`, `done`, `failed`. Ids: `secrets.token_urlsafe(32)` (43 characters).
- Queue cap: a submit that would leave more than `MAX_QUEUED` jobs in `queued` raises `QueueFull`.
- Records expire `RECORD_TTL_S` after their last update, whether or not read.
- Subscribers wait on a per-job `threading.Condition` with a `WAIT_S` timeout; a state change notifies all.
- Routes (all under the app, no URL prefix): `GET /print`, `GET /print/part`, `POST /print-job` (gate, `3 per minute`, 202 `{job_id}`, 503 `{error}` when full), `GET /print-job/<id>` (gate, JSON `{id, state, token, summary, part, error, elapsed_s}`, 404), `GET /print-job/<id>/events` (gate, `text/event-stream`, `Cache-Control: no-cache`, `state` events then a terminal `done` or `failed` event, 404).
- `/print` accepts only a same-origin `return` (starts with exactly one `/`, second character not `/` or `\`); otherwise `/app`. Gate failure redirects (302) to the validated return with `verify=1` appended. `source=onshape` sets `Content-Security-Policy: frame-ancestors https://*.onshape.com` and removes `X-Frame-Options`.
- Student-facing messages, verbatim: queue full `The slicer is busy, try again in a minute.`; unknown or expired id `This slice has expired, go back and slice again.`; slice failure: the `SliceError.message`; unexpected worker exception: `The slicer failed unexpectedly.` The `details` string is logged with `log(...)` and never returned to the browser.
- The delivered file name is `sample_part.gcode.3mf`. The archive is moved to `<output_folder>/print_<job_id>.gcode.3mf` before registration.
- `/download/<token>` returns `application/octet-stream` for names ending in `.3mf`, `text/plain` otherwise.
- Metrics: the worker logs `metrics.log_event('print_job', metadata={'outcome': 'done'|'failed', 'duration_s': <float>})`.
- Commit each task on branch `feature/3d-print-stage1` with a message starting `print(c): `. Never touch `main`, never push. Never commit `tools/` or `.superpowers/`.
- Run `uv run python -m unittest discover -s tests --buffer && uv run python -m unittest discover -s print/tests -t . --buffer && uv run python gcode_test.py --quiet` before each commit; `make test` at the end of Task 3.
- Test hygiene: each route test class calls `limiter.reset()` and sets `limiter.enabled = False` in `setUp` (restoring `True` in `tearDown`), except the one test that checks the 429.

Facts about `frc_cam_gui_app.py` (line numbers as of commit `392cc1b`): `_require_app_session()` at 578-590 is a plain function returning `None` when the session is valid, else `(jsonify({'error': 'Session verification required.', 'need_verification': True}), 401)`. `FileTokenManager.register_file(filepath, real_filename)` at 95 returns a token; `file_token_manager` global at 186. `limiter = Limiter(app=app, key_func=get_remote_address, ...)` at 259-265. `UPLOAD_FOLDER`, `OUTPUT_FOLDER` at 316-329. `metrics.log_event(event_type, team_number=None, user_email=None, metadata=None)` (module `metrics`). `log(*args)` from `logging_config`. `_app_template_context(force_defaults=False)` at 462-557 returns the dict that carries `drive_enabled`; the upload page renders with `render_template('wizard.html', source='upload', authenticated=True, onshape_ctx={}, theme='dark', turnstile_sitekey=TURNSTILE_SITE_KEY, **_app_template_context(force_defaults=True))`. The last route ends at 2256; `def cleanup()` begins at 2258; `atexit.register(cleanup)` at 2270-2272. `/download/<token>` at 1385-1422 calls `send_file(file_path, as_attachment=True, download_name=real_filename, mimetype='text/plain')`. Tests set up with `app.config['TESTING'] = True; client = app.test_client(); with client.session_transaction() as sess: sess['app_verified'] = True`.

---

### Task 1: `print/jobs.py`

**Files:**
- Create: `print/jobs.py`
- Test: `print/tests/test_jobs.py`

**Interfaces:**
- Consumes: nothing from the app.
- Produces:
  - constants `MAX_RUNNING`, `MAX_QUEUED`, `RECORD_TTL_S`, `WAIT_S`, `SWEEP_INTERVAL_S`, `TERMINAL = ("done", "failed")`
  - `class QueueFull(Exception)`
  - `class JobFailure(Exception)` with `message`, `details` (same shape as `SliceError`)
  - `class JobPool`:
    - `__init__(self, worker, *, executor=None, max_running=MAX_RUNNING, max_queued=MAX_QUEUED, ttl_s=RECORD_TTL_S, clock=time.time)` where `worker(job_id) -> dict` returns `{"token": str, "summary": dict, "part": dict}` or raises `JobFailure` (or anything else)
    - `submit(self) -> str` (job id), raises `QueueFull`
    - `get(self, job_id) -> dict | None` (a copy: `id, state, created, updated, elapsed_s, token, summary, part, error`)
    - `wait(self, job_id, since_updated, timeout=WAIT_S) -> dict | None` (returns the record once `updated > since_updated` or after `timeout`; `None` if unknown)
    - `follow(self, job_id, wait_s=WAIT_S)` generator of `(event_name, record)`: first `("state", record)`, then `("state", record)` on each change or each `wait_s` timeout, and finally `(record["state"], record)` when terminal; stops silently if the record vanishes
    - `expire(self, now=None) -> int` removes records with `updated + ttl_s <= now`, returns how many
    - `start_sweeper(self, interval_s=SWEEP_INTERVAL_S)` daemon thread calling `expire` every interval
    - `counts(self) -> dict` `{"queued": n, "running": n}`
  - The executor interface used: `executor.submit(fn, *args)` only. Tests pass a synchronous stand-in.

- [ ] **Step 1: Write the failing tests**

`print/tests/test_jobs.py`:

```python
"""Tests for print_jobs.JobPool with synchronous stand-ins for the executor."""
import sys
import threading
import time
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]        # the repository root
sys.path.insert(0, str(REPO))

from print import jobs as print_jobs  # noqa: E402
from print.jobs import JobFailure, JobPool, QueueFull  # noqa: E402


class ImmediateExecutor:
    """Runs the submitted function on the calling thread, like a pool with a free worker."""
    def submit(self, fn, *args):
        fn(*args)


class NeverExecutor:
    """Accepts work and never runs it: every job stays queued."""
    def __init__(self):
        self.pending = []

    def submit(self, fn, *args):
        self.pending.append((fn, args))

    def run_next(self):
        fn, args = self.pending.pop(0)
        fn(*args)


class FakeClock:
    def __init__(self, start=1000.0):
        self.now = start

    def __call__(self):
        return self.now


def good_worker(job_id):
    return {"token": "tok-" + job_id[:4], "summary": {"layer_count": 3}, "part": {"name": "sample_part"}}


class SubmitAndRunTest(unittest.TestCase):
    def test_submit_returns_long_id_and_runs_worker_to_done(self):
        pool = JobPool(good_worker, executor=ImmediateExecutor())
        job_id = pool.submit()
        self.assertGreaterEqual(len(job_id), 32)
        rec = pool.get(job_id)
        self.assertEqual(rec["state"], "done")
        self.assertEqual(rec["token"], "tok-" + job_id[:4])
        self.assertEqual(rec["summary"], {"layer_count": 3})
        self.assertEqual(rec["part"], {"name": "sample_part"})
        self.assertIsNone(rec["error"])

    def test_states_go_queued_running_done_in_order(self):
        seen = []
        holder = {}

        def worker(job_id):
            seen.append(holder["pool"].get(job_id)["state"])
            return good_worker(job_id)

        executor = NeverExecutor()
        pool = JobPool(worker, executor=executor)
        holder["pool"] = pool
        job_id = pool.submit()
        seen.append(pool.get(job_id)["state"])
        executor.run_next()
        seen.append(pool.get(job_id)["state"])
        self.assertEqual(seen, ["queued", "running", "done"])

    def test_unknown_id_is_none(self):
        pool = JobPool(good_worker, executor=ImmediateExecutor())
        self.assertIsNone(pool.get("nope"))
        self.assertIsNone(pool.wait("nope", 0, timeout=0.01))

    def test_get_returns_a_copy_with_elapsed(self):
        clock = FakeClock()
        pool = JobPool(good_worker, executor=NeverExecutor(), clock=clock)
        job_id = pool.submit()
        clock.now += 12.5
        rec = pool.get(job_id)
        self.assertEqual(rec["elapsed_s"], 12.5)
        rec["state"] = "hacked"
        self.assertEqual(pool.get(job_id)["state"], "queued")


class FailureTest(unittest.TestCase):
    def test_job_failure_ends_failed_with_message_only(self):
        def worker(job_id):
            raise JobFailure("The slicer could not process this part.", "exit code 255\nsecret details")
        pool = JobPool(worker, executor=ImmediateExecutor())
        rec = pool.get(pool.submit())
        self.assertEqual(rec["state"], "failed")
        self.assertEqual(rec["error"], "The slicer could not process this part.")
        self.assertNotIn("secret details", str(rec))

    def test_unexpected_exception_ends_failed_with_generic_message(self):
        def worker(job_id):
            raise RuntimeError("boom with a path /tmp/x")
        pool = JobPool(worker, executor=ImmediateExecutor())
        rec = pool.get(pool.submit())
        self.assertEqual(rec["state"], "failed")
        self.assertEqual(rec["error"], "The slicer failed unexpectedly.")
        self.assertNotIn("/tmp/x", str(rec))


class QueueCapTest(unittest.TestCase):
    def test_third_waiting_job_is_refused(self):
        executor = NeverExecutor()
        pool = JobPool(good_worker, executor=executor, max_queued=2)
        pool.submit()
        pool.submit()
        self.assertEqual(pool.counts(), {"queued": 2, "running": 0})
        with self.assertRaises(QueueFull):
            pool.submit()
        executor.run_next()
        pool.submit()   # room again after one finished

    def test_running_jobs_do_not_count_as_queued(self):
        started = threading.Event()
        release = threading.Event()

        def slow_worker(job_id):
            started.set()
            release.wait(5)
            return good_worker(job_id)

        pool = JobPool(slow_worker, max_running=1, max_queued=1)   # real thread pool
        first = pool.submit()
        self.assertTrue(started.wait(2))
        self.assertEqual(pool.get(first)["state"], "running")
        pool.submit()   # one queued behind the running one
        with self.assertRaises(QueueFull):
            pool.submit()
        release.set()
        deadline = time.time() + 5
        while pool.counts()["queued"] or pool.counts()["running"]:
            self.assertLess(time.time(), deadline)
            time.sleep(0.02)


class SubscriberTest(unittest.TestCase):
    def test_wait_returns_early_on_state_change(self):
        executor = NeverExecutor()
        pool = JobPool(good_worker, executor=executor)
        job_id = pool.submit()
        since = pool.get(job_id)["updated"]
        threading.Timer(0.05, executor.run_next).start()
        started = time.monotonic()
        rec = pool.wait(job_id, since, timeout=5)
        self.assertLess(time.monotonic() - started, 2)
        self.assertEqual(rec["state"], "done")

    def test_wait_wakes_on_timeout_with_unchanged_state(self):
        pool = JobPool(good_worker, executor=NeverExecutor())
        job_id = pool.submit()
        since = pool.get(job_id)["updated"]
        started = time.monotonic()
        rec = pool.wait(job_id, since, timeout=0.05)
        self.assertGreaterEqual(time.monotonic() - started, 0.04)
        self.assertEqual(rec["state"], "queued")

    def test_follow_yields_state_then_terminal(self):
        pool = JobPool(good_worker, executor=ImmediateExecutor())
        job_id = pool.submit()
        events = list(pool.follow(job_id, wait_s=0.01))
        self.assertEqual([e for e, _ in events], ["state", "done"])
        self.assertEqual(events[-1][1]["token"], "tok-" + job_id[:4])

    def test_follow_repeats_state_on_cadence_until_change(self):
        executor = NeverExecutor()
        pool = JobPool(good_worker, executor=executor)
        job_id = pool.submit()
        gen = pool.follow(job_id, wait_s=0.02)
        first = next(gen)
        second = next(gen)
        self.assertEqual((first[0], first[1]["state"]), ("state", "queued"))
        self.assertEqual((second[0], second[1]["state"]), ("state", "queued"))
        executor.run_next()
        rest = list(gen)
        self.assertEqual(rest[-1][0], "done")
        self.assertTrue(all(e == "state" for e, _ in rest[:-1]))

    def test_follow_failed_job_ends_with_failed(self):
        def worker(job_id):
            raise JobFailure("The slicer could not process this part.", "x")
        pool = JobPool(worker, executor=ImmediateExecutor())
        events = list(pool.follow(pool.submit(), wait_s=0.01))
        self.assertEqual([e for e, _ in events], ["state", "failed"])
        self.assertEqual(events[-1][1]["error"], "The slicer could not process this part.")

    def test_follow_unknown_id_yields_nothing(self):
        pool = JobPool(good_worker, executor=ImmediateExecutor())
        self.assertEqual(list(pool.follow("nope", wait_s=0.01)), [])


class ExpiryTest(unittest.TestCase):
    def test_records_expire_one_hour_after_last_update_even_if_unread(self):
        clock = FakeClock()
        pool = JobPool(good_worker, executor=ImmediateExecutor(), clock=clock, ttl_s=3600)
        old = pool.submit()
        clock.now += 1800
        young = pool.submit()
        clock.now += 1801
        self.assertEqual(pool.expire(), 1)
        self.assertIsNone(pool.get(old))
        self.assertIsNotNone(pool.get(young))

    def test_follow_stops_when_record_expires(self):
        clock = FakeClock()
        pool = JobPool(good_worker, executor=NeverExecutor(), clock=clock, ttl_s=10)
        job_id = pool.submit()
        gen = pool.follow(job_id, wait_s=0.01)
        next(gen)
        clock.now += 11
        pool.expire()
        self.assertEqual(list(gen), [])

    def test_constants_are_the_documented_defaults(self):
        self.assertEqual(print_jobs.MAX_RUNNING, 1)
        self.assertEqual(print_jobs.MAX_QUEUED, 2)
        self.assertEqual(print_jobs.RECORD_TTL_S, 3600)
        self.assertEqual(print_jobs.WAIT_S, 5.0)
        self.assertEqual(print_jobs.SWEEP_INTERVAL_S, 600)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /repos/popcornpenguins/PenguinCAM && uv run python -m unittest tests.test_print_jobs -v`
Expected: `ModuleNotFoundError: No module named 'print_jobs'`.

- [ ] **Step 3: Write `print/jobs.py`**

```python
"""In-process job pool for print slices. No Flask, no app imports.

A job table in process memory plus a thread pool. The pool size is the number
of Orca processes allowed at once; the queue beyond it is deliberately small,
because queued work nobody will wait for is worse than an honest refusal.

Sizing basis (2026-09-13): one slice of print/sample_part.stl peaked at 93 MB
resident and took 0.23 s wall clock on the aarch64 agent container. The
production Railway plan's vCPU and memory allotment could not be read from the
build container (no Railway token), so MAX_RUNNING stays at the spec's default
of one until it is measured on the production plan. The rule when revisiting:
min(vCPU count, memory / peak resident memory of one slice), never below one.
See docs/DEPLOYMENT_GUIDE.md.
"""
import secrets
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor

MAX_RUNNING = 1          # Orca processes at once
MAX_QUEUED = 2           # jobs waiting beyond the running ones
RECORD_TTL_S = 3600      # a record expires this long after its last update
WAIT_S = 5.0             # subscriber wake-up cadence when nothing changes
SWEEP_INTERVAL_S = 600   # same cadence as the file token manager

TERMINAL = ("done", "failed")
GENERIC_FAILURE = "The slicer failed unexpectedly."


class QueueFull(Exception):
    """The pool is running MAX_RUNNING jobs and MAX_QUEUED more are waiting."""


class JobFailure(Exception):
    """A worker failure with a student-facing message and log-only details."""

    def __init__(self, message, details=""):
        super().__init__(message)
        self.message = message
        self.details = details


class JobPool:
    def __init__(self, worker, *, executor=None, max_running=MAX_RUNNING, max_queued=MAX_QUEUED,
                 ttl_s=RECORD_TTL_S, clock=time.time, log=None):
        self._worker = worker
        self._executor = executor or ThreadPoolExecutor(max_workers=max_running, thread_name_prefix="print-slice")
        self._max_queued = max_queued
        self._ttl_s = ttl_s
        self._clock = clock
        self._log = log or (lambda *args: None)
        self._lock = threading.Lock()
        self._jobs = {}        # id -> record dict
        self._conds = {}       # id -> threading.Condition (shares self._lock)

    # -- public ---------------------------------------------------------

    def submit(self):
        now = self._clock()
        job_id = secrets.token_urlsafe(32)
        with self._lock:
            if sum(1 for r in self._jobs.values() if r["state"] == "queued") >= self._max_queued:
                raise QueueFull()
            self._jobs[job_id] = {"id": job_id, "state": "queued", "created": now, "updated": now,
                                  "token": None, "summary": None, "part": None, "error": None}
            self._conds[job_id] = threading.Condition(self._lock)
        self._executor.submit(self._run, job_id)
        return job_id

    def get(self, job_id):
        with self._lock:
            return self._snapshot(job_id)

    def wait(self, job_id, since_updated, timeout=WAIT_S):
        with self._lock:
            cond = self._conds.get(job_id)
            if cond is None:
                return None
            record = self._jobs[job_id]
            if record["updated"] <= since_updated:
                cond.wait(timeout)
            return self._snapshot(job_id)

    def follow(self, job_id, wait_s=WAIT_S):
        record = self.get(job_id)
        if record is None:
            return
        yield ("state", record)
        while record["state"] not in TERMINAL:
            record = self.wait(job_id, record["updated"], timeout=wait_s)
            if record is None:
                return
            if record["state"] not in TERMINAL:
                yield ("state", record)
        yield (record["state"], record)

    def expire(self, now=None):
        now = self._clock() if now is None else now
        with self._lock:
            dead = [job_id for job_id, r in self._jobs.items() if r["updated"] + self._ttl_s <= now]
            for job_id in dead:
                cond = self._conds.pop(job_id)
                del self._jobs[job_id]
                cond.notify_all()
        return len(dead)

    def start_sweeper(self, interval_s=SWEEP_INTERVAL_S):
        def loop():
            while True:
                time.sleep(interval_s)
                try:
                    self.expire()
                except Exception:   # never let the sweeper die
                    self._log(traceback.format_exc())
        thread = threading.Thread(target=loop, name="print-jobs-sweeper", daemon=True)
        thread.start()
        return thread

    def counts(self):
        with self._lock:
            states = [r["state"] for r in self._jobs.values()]
        return {"queued": states.count("queued"), "running": states.count("running")}

    # -- internals ------------------------------------------------------

    def _snapshot(self, job_id):
        record = self._jobs.get(job_id)
        if record is None:
            return None
        copy = dict(record)
        copy["elapsed_s"] = round(self._clock() - record["created"], 3)
        return copy

    def _update(self, job_id, **fields):
        with self._lock:
            record = self._jobs.get(job_id)
            if record is None:      # expired while running
                return
            record.update(fields)
            record["updated"] = self._clock()
            self._conds[job_id].notify_all()

    def _run(self, job_id):
        self._update(job_id, state="running")
        try:
            result = self._worker(job_id)
        except JobFailure as exc:
            self._log(f"print job {job_id[:8]} failed: {exc.message}\n{exc.details}")
            self._update(job_id, state="failed", error=exc.message)
        except Exception:
            self._log(f"print job {job_id[:8]} crashed:\n{traceback.format_exc()}")
            self._update(job_id, state="failed", error=GENERIC_FAILURE)
        else:
            self._update(job_id, state="done", token=result.get("token"),
                         summary=result.get("summary"), part=result.get("part"))
```

`wait` holds the lock while checking `updated`, then `cond.wait` releases it; a state change between `get` and `wait` is caught by the `updated <= since_updated` check, so no update is missed.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /repos/popcornpenguins/PenguinCAM && uv run python -m unittest tests.test_print_jobs -v`
Expected: 17 tests `OK`, no stray output.

- [ ] **Step 5: Run the quick suite and commit**

Run: `cd /repos/popcornpenguins/PenguinCAM && uv run python -m unittest discover -s tests --buffer && uv run python -m unittest discover -s print/tests -t . --buffer && uv run python gcode_test.py --quiet`
Expected: all pass. Commit `print/jobs.py`, `print/tests/test_jobs.py` with message `print(c): add the print job pool`.

---

### Task 2: `print/routes.py`, a placeholder template, and the two Flask touches

**Files:**
- Create: `print/routes.py`
- Create: `print/templates/print_wizard.html` (placeholder; subfeature D replaces it)
- Modify: `frc_cam_gui_app.py` (the `/download/<token>` MIME line near 1419; one `init_print_routes(...)` call between the last route and `def cleanup()`)
- Test: `print/tests/test_routes.py`

**Interfaces:**
- Consumes: `print.jobs.JobPool`, `QueueFull`, `JobFailure`; `print.slicer.slice_stl`, `SliceError`, `part_info`, `SAMPLE_STL`.
- Produces:
  - `init_print_routes(app, *, limiter, require_session, token_manager, upload_folder, output_folder, template_context, metrics, log, pool=None) -> JobPool` registers blueprint `print` on `app` and returns the pool it uses (creating `JobPool(make_worker(...))` with a sweeper when `pool` is None).
  - Module attribute `print.routes.ctx` (a `types.SimpleNamespace` with `pool`, `token_manager`, `upload_folder`, `output_folder`, `metrics`, `log`, `template_context`, `require_session`), read by the routes at request time so tests can swap `ctx.pool`.
  - `make_worker(token_manager, upload_folder, output_folder, metrics, log) -> callable(job_id) -> dict`
  - `safe_return_path(value) -> str`
  - `DELIVERED_NAME = "sample_part.gcode.3mf"`, `BUSY_MESSAGE`, `EXPIRED_MESSAGE`.
  - Template variables handed to `print_wizard.html`: `source`, `theme`, `return_url`, plus everything from `template_context(force_defaults=...)`. Subfeature D relies on exactly these names.

- [ ] **Step 1: Write the failing tests**

`print/tests/test_routes.py`:

```python
"""Route tests for the print blueprint through the Flask test client. No Orca runs."""
import os
import sys
import unittest
from pathlib import Path
from unittest import mock

REPO = Path(__file__).resolve().parents[2]        # the repository root
sys.path.insert(0, str(REPO))

from frc_cam_gui_app import app, limiter, file_token_manager  # noqa: E402
from print import routes as print_routes  # noqa: E402
from print.jobs import JobFailure, JobPool, QueueFull  # noqa: E402


class ImmediateExecutor:
    def submit(self, fn, *args):
        fn(*args)


def good_worker(job_id):
    return {"token": "tok-" + job_id[:4], "summary": {"print_time_s": 790.0, "filament_g": 3.31,
                                                      "filament_m": 1.09, "layer_count": 60, "warnings": []},
            "part": {"name": "sample_part"}}


class PrintRouteBase(unittest.TestCase):
    def setUp(self):
        app.config["TESTING"] = True
        self.client = app.test_client()
        with self.client.session_transaction() as sess:
            sess["app_verified"] = True
        limiter.reset()
        limiter.enabled = False
        self._real_pool = print_routes.ctx.pool
        print_routes.ctx.pool = JobPool(good_worker, executor=ImmediateExecutor())

    def tearDown(self):
        print_routes.ctx.pool = self._real_pool
        limiter.enabled = True


class PrintPageTest(PrintRouteBase):
    def test_page_renders_with_source_theme_and_return(self):
        resp = self.client.get("/print?source=upload&theme=light&return=/app%3Fx%3D1")
        self.assertEqual(resp.status_code, 200)
        html = resp.get_data(as_text=True)
        self.assertIn('data-source="upload"', html)
        self.assertIn('data-theme="light"', html)
        self.assertIn("/app?x=1", html)

    def test_defaults_when_parameters_missing(self):
        resp = self.client.get("/print")
        html = resp.get_data(as_text=True)
        self.assertIn('data-source="upload"', html)
        self.assertIn('data-theme="dark"', html)
        self.assertIn('data-return="/app"', html)

    def test_foreign_return_is_replaced(self):
        for bad in ("https://evil.example/x", "//evil.example", "/\\evil", "app", ""):
            with self.subTest(bad=bad):
                resp = self.client.get("/print", query_string={"return": bad})
                self.assertIn('data-return="/app"', resp.get_data(as_text=True))
        self.assertEqual(print_routes.safe_return_path("/onshape-panel?d=1&theme=dark"), "/onshape-panel?d=1&theme=dark")

    def test_redirects_to_return_with_verify_when_gate_fails(self):
        bare = app.test_client()
        resp = bare.get("/print?return=/app")
        self.assertEqual(resp.status_code, 302)
        self.assertTrue(resp.headers["Location"].endswith("/app?verify=1"))
        resp = bare.get("/print?return=/onshape-panel%3Fd%3D1")
        self.assertTrue(resp.headers["Location"].endswith("/onshape-panel?d=1&verify=1"))

    def test_onshape_source_sets_frame_ancestors(self):
        resp = self.client.get("/print?source=onshape")
        self.assertEqual(resp.headers.get("Content-Security-Policy"), "frame-ancestors https://*.onshape.com")
        self.assertNotIn("X-Frame-Options", resp.headers)
        resp = self.client.get("/print?source=upload")
        self.assertIsNone(resp.headers.get("Content-Security-Policy"))


class PartRouteTest(PrintRouteBase):
    def test_part_json(self):
        resp = self.client.get("/print/part")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data["part"]["size_mm"], {"x": 40.0, "y": 30.0, "z": 12.0})
        self.assertEqual(data["printer"]["bed_mm"], {"x": 256.0, "y": 256.0})
        self.assertIn("name", data["filament"])

    def test_part_stl_bytes(self):
        resp = self.client.get("/print/part?stl=1")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.mimetype, "model/stl")
        self.assertEqual(resp.data, (REPO / "print" / "sample_part.stl").read_bytes())


class JobRoutesTest(PrintRouteBase):
    def test_submit_returns_202_with_id(self):
        resp = self.client.post("/print-job")
        self.assertEqual(resp.status_code, 202)
        job_id = resp.get_json()["job_id"]
        self.assertGreaterEqual(len(job_id), 32)

    def test_submit_requires_session(self):
        resp = app.test_client().post("/print-job")
        self.assertEqual(resp.status_code, 401)
        self.assertTrue(resp.get_json()["need_verification"])

    def test_submit_503_when_queue_full(self):
        class FullPool:
            def submit(self):
                raise QueueFull()
        print_routes.ctx.pool = FullPool()
        resp = self.client.post("/print-job")
        self.assertEqual(resp.status_code, 503)
        self.assertEqual(resp.get_json()["error"], "The slicer is busy, try again in a minute.")

    def test_job_json_and_404(self):
        job_id = self.client.post("/print-job").get_json()["job_id"]
        resp = self.client.get(f"/print-job/{job_id}")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data["state"], "done")
        self.assertEqual(data["token"], "tok-" + job_id[:4])
        self.assertEqual(data["summary"]["layer_count"], 60)
        self.assertEqual(data["part"], {"name": "sample_part"})
        self.assertIsNone(data["error"])
        self.assertIn("elapsed_s", data)
        resp = self.client.get("/print-job/doesnotexist")
        self.assertEqual(resp.status_code, 404)
        self.assertEqual(resp.get_json()["error"], "This slice has expired, go back and slice again.")

    def test_failed_job_carries_message_not_details(self):
        def bad_worker(job_id):
            raise JobFailure("The slicer could not process this part.", "exit code 255 secret")
        print_routes.ctx.pool = JobPool(bad_worker, executor=ImmediateExecutor())
        job_id = self.client.post("/print-job").get_json()["job_id"]
        data = self.client.get(f"/print-job/{job_id}").get_json()
        self.assertEqual(data["state"], "failed")
        self.assertEqual(data["error"], "The slicer could not process this part.")
        self.assertNotIn("secret", str(data))

    def test_events_stream_state_then_done(self):
        job_id = self.client.post("/print-job").get_json()["job_id"]
        resp = self.client.get(f"/print-job/{job_id}/events")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.mimetype, "text/event-stream")
        self.assertEqual(resp.headers.get("Cache-Control"), "no-cache")
        body = resp.get_data(as_text=True)
        blocks = [b for b in body.split("\n\n") if b.strip()]
        self.assertTrue(blocks[0].startswith("event: state\ndata: "))
        self.assertIn('"elapsed_s"', blocks[0])
        self.assertTrue(blocks[-1].startswith("event: done\ndata: "))
        self.assertIn('"token": "tok-' + job_id[:4], blocks[-1])

    def test_events_404_for_unknown_id(self):
        resp = self.client.get("/print-job/nope/events")
        self.assertEqual(resp.status_code, 404)

    def test_events_require_session(self):
        resp = app.test_client().get("/print-job/nope/events")
        self.assertEqual(resp.status_code, 401)


class RateLimitTest(unittest.TestCase):
    def setUp(self):
        app.config["TESTING"] = True
        self.client = app.test_client()
        with self.client.session_transaction() as sess:
            sess["app_verified"] = True
        limiter.reset()
        limiter.enabled = True
        self._real_pool = print_routes.ctx.pool
        print_routes.ctx.pool = JobPool(good_worker, executor=ImmediateExecutor())

    def tearDown(self):
        print_routes.ctx.pool = self._real_pool
        limiter.reset()

    def test_fourth_submit_in_a_minute_is_429(self):
        codes = [self.client.post("/print-job").status_code for _ in range(4)]
        self.assertEqual(codes, [202, 202, 202, 429])


class WorkerTest(unittest.TestCase):
    def test_worker_moves_archive_registers_token_and_cleans_scratch(self):
        import tempfile
        from print.slicer import SliceResult
        tmp = Path(tempfile.mkdtemp())
        upload, output = tmp / "uploads", tmp / "outputs"
        upload.mkdir()
        output.mkdir()
        registered = {}

        class Tokens:
            def register_file(self, path, name):
                registered["path"], registered["name"] = path, name
                return "tok123"

        events = []

        def fake_slice(stl_path, output_dir, timeout_s=120):
            archive = Path(output_dir) / "sample_part.gcode.3mf"
            archive.write_bytes(b"PK")
            return SliceResult(output_path=archive, print_time_s=1.0, filament_m=0.1, filament_g=0.2, layer_count=3, warnings=["w"])

        class Metrics:
            @staticmethod
            def log_event(name, **kw):
                events.append((name, kw))

        worker = print_routes.make_worker(Tokens(), str(upload), str(output), Metrics(), lambda *a: None)
        with mock.patch.object(print_routes, "slice_stl", fake_slice):
            result = worker("abcdefgh12345678")
        self.assertEqual(result["token"], "tok123")
        self.assertEqual(registered["name"], "sample_part.gcode.3mf")
        self.assertEqual(Path(registered["path"]).parent, output)
        self.assertTrue(Path(registered["path"]).name.endswith(".gcode.3mf"))
        self.assertTrue(Path(registered["path"]).is_file())
        self.assertEqual(result["summary"]["warnings"], ["w"])
        self.assertEqual(result["part"]["part"]["name"], "sample_part")
        self.assertEqual(os.listdir(upload), [])          # scratch removed
        self.assertEqual(events[0][0], "print_job")
        self.assertEqual(events[0][1]["metadata"]["outcome"], "done")

    def test_worker_turns_slice_error_into_job_failure_and_cleans_scratch(self):
        import tempfile
        from print.slicer import SliceError
        tmp = Path(tempfile.mkdtemp())
        upload, output = tmp / "uploads", tmp / "outputs"
        upload.mkdir()
        output.mkdir()
        logged = []

        def fake_slice(stl_path, output_dir, timeout_s=120):
            raise SliceError("The slicer could not process this part.", "exit code 255")

        class Metrics:
            @staticmethod
            def log_event(name, **kw):
                logged.append((name, kw))

        worker = print_routes.make_worker(mock.Mock(), str(upload), str(output), Metrics(), lambda *a: logged.append(a))
        with mock.patch.object(print_routes, "slice_stl", fake_slice):
            with self.assertRaises(JobFailure) as ctx:
                worker("abcdefgh12345678")
        self.assertEqual(ctx.exception.message, "The slicer could not process this part.")
        self.assertEqual(ctx.exception.details, "exit code 255")
        self.assertEqual(os.listdir(upload), [])
        self.assertIn(("print_job", {"metadata": {"outcome": "failed", "duration_s": mock.ANY}}), logged)


class DownloadMimeTest(unittest.TestCase):
    def setUp(self):
        app.config["TESTING"] = True
        self.client = app.test_client()
        limiter.reset()
        limiter.enabled = False

    def tearDown(self):
        limiter.enabled = True

    def test_3mf_downloads_as_binary_and_nc_as_text(self):
        import tempfile
        tmp = Path(tempfile.mkdtemp())
        archive = tmp / "x.gcode.3mf"
        archive.write_bytes(b"PK\x03\x04")
        nc = tmp / "x.nc"
        nc.write_text("G0 X0\n")
        t1 = file_token_manager.register_file(str(archive), "sample_part.gcode.3mf")
        t2 = file_token_manager.register_file(str(nc), "part.nc")
        r1 = self.client.get(f"/download/{t1}")
        self.assertEqual(r1.mimetype, "application/octet-stream")
        self.assertIn("sample_part.gcode.3mf", r1.headers["Content-Disposition"])
        r2 = self.client.get(f"/download/{t2}")
        self.assertEqual(r2.mimetype, "text/plain")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /repos/popcornpenguins/PenguinCAM && uv run python -m unittest tests.test_print_routes -v`
Expected: `ModuleNotFoundError: No module named 'print_routes'`.

- [ ] **Step 3: Write `print/routes.py`**

```python
"""Flask blueprint for the 3D print wizard: page, part info, slice jobs, events.

Never imports frc_cam_gui_app. Everything shared (session gate, token manager,
limiter, folders, metrics, logging, template context) arrives through
init_print_routes(...). See docs/3D_PRINTING.md.
"""
import json
import os
import shutil
import tempfile
import time
import types
from urllib.parse import urlencode

from flask import Blueprint, Response, jsonify, make_response, redirect, render_template, request, send_file

from print.jobs import JobFailure, JobPool, QueueFull
from print.slicer import SAMPLE_STL, SliceError, part_info, slice_stl

DELIVERED_NAME = "sample_part.gcode.3mf"
BUSY_MESSAGE = "The slicer is busy, try again in a minute."
EXPIRED_MESSAGE = "This slice has expired, go back and slice again."
FRAME_ANCESTORS = "frame-ancestors https://*.onshape.com"

print_bp = Blueprint("print", __name__)

# Filled by init_print_routes; routes read it at request time (tests swap ctx.pool).
ctx = types.SimpleNamespace(pool=None, token_manager=None, upload_folder=None, output_folder=None,
                            metrics=None, log=None, template_context=None, require_session=None)


def safe_return_path(value):
    """Only a same-origin path is allowed as the return target; anything else is /app."""
    if isinstance(value, str) and len(value) >= 1 and value[0] == "/" and (len(value) == 1 or value[1] not in "/\\"):
        return value
    return "/app"


def _with_verify(path):
    return path + ("&" if "?" in path else "?") + "verify=1"


def make_worker(token_manager, upload_folder, output_folder, metrics, log):
    """Worker for JobPool: slice the sample part, deliver the archive, clean up."""

    def run(job_id):
        started = time.monotonic()
        scratch = tempfile.mkdtemp(prefix=f"print_{job_id[:8]}_", dir=upload_folder)
        outcome = "failed"
        try:
            result = slice_stl(SAMPLE_STL, scratch)
            final_path = os.path.join(output_folder, f"print_{job_id}.gcode.3mf")
            shutil.move(str(result.output_path), final_path)
            token = token_manager.register_file(final_path, DELIVERED_NAME)
            outcome = "done"
            return {"token": token, "summary": result.summary(), "part": part_info()}
        except SliceError as exc:
            raise JobFailure(exc.message, exc.details) from exc
        finally:
            shutil.rmtree(scratch, ignore_errors=True)
            metrics.log_event("print_job", metadata={"outcome": outcome,
                                                      "duration_s": round(time.monotonic() - started, 3)})

    return run


def _sse(event, record):
    return f"event: {event}\ndata: {json.dumps(record)}\n\n"


@print_bp.route("/print")
def print_page():
    source = request.args.get("source", "upload")
    if source not in ("upload", "onshape"):
        source = "upload"
    theme = request.args.get("theme", "dark")
    if theme not in ("dark", "light"):
        theme = "dark"
    return_url = safe_return_path(request.args.get("return", "/app"))
    if ctx.require_session():
        return redirect(_with_verify(return_url))
    context = ctx.template_context(force_defaults=(source == "upload"))
    resp = make_response(render_template("print_wizard.html", source=source, theme=theme,
                                         return_url=return_url, **context))
    if source == "onshape":
        resp.headers["Content-Security-Policy"] = FRAME_ANCESTORS
        resp.headers.pop("X-Frame-Options", None)
    return resp


@print_bp.route("/print/part")
def print_part():
    if request.args.get("stl") == "1":
        return send_file(str(SAMPLE_STL), mimetype="model/stl", download_name=SAMPLE_STL.name)
    return jsonify(part_info())


@print_bp.route("/print-job", methods=["POST"])
def print_job_submit():
    gate = ctx.require_session()
    if gate:
        return gate
    try:
        job_id = ctx.pool.submit()
    except QueueFull:
        return jsonify({"error": BUSY_MESSAGE}), 503
    ctx.log(f"🖨️ Print job {job_id[:8]} queued")
    return jsonify({"job_id": job_id}), 202


@print_bp.route("/print-job/<job_id>")
def print_job_status(job_id):
    gate = ctx.require_session()
    if gate:
        return gate
    record = ctx.pool.get(job_id)
    if record is None:
        return jsonify({"error": EXPIRED_MESSAGE}), 404
    return jsonify(record)


@print_bp.route("/print-job/<job_id>/events")
def print_job_events(job_id):
    gate = ctx.require_session()
    if gate:
        return gate
    if ctx.pool.get(job_id) is None:
        return jsonify({"error": EXPIRED_MESSAGE}), 404
    pool = ctx.pool

    def stream():
        for event, record in pool.follow(job_id):
            yield _sse(event, record)

    return Response(stream(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


def init_print_routes(app, *, limiter, require_session, token_manager, upload_folder, output_folder,
                      template_context, metrics, log, pool=None):
    """Register the print blueprint. Called once by frc_cam_gui_app after the
    limiter and temp folders exist. Returns the job pool in use."""
    ctx.require_session = require_session
    ctx.token_manager = token_manager
    ctx.upload_folder = upload_folder
    ctx.output_folder = output_folder
    ctx.template_context = template_context
    ctx.metrics = metrics
    ctx.log = log
    if pool is None:
        pool = JobPool(make_worker(token_manager, upload_folder, output_folder, metrics, log), log=log)
        pool.start_sweeper()
    ctx.pool = pool
    limiter.limit("3 per minute")(print_job_submit)
    app.register_blueprint(print_bp)
    return pool
```

`limiter.limit("3 per minute")(print_job_submit)` applies the decorator to the view function before the blueprint is registered, which is how flask-limiter attaches a per-route limit without a decorator at definition time (the limiter object does not exist when this module is imported). If flask-limiter 4 does not pick the limit up this way (the `RateLimitTest` fails with four 202s), use the blueprint-level form instead: `limiter.limit("3 per minute", methods=["POST"])(print_bp)` is too broad; the supported alternative is to define the view inside `init_print_routes` with `@limiter.limit("3 per minute")` and `@print_bp.route(...)`, and say so in the report.

- [ ] **Step 4: Placeholder template**

Create `print/templates/print_wizard.html` (subfeature D replaces it with the real page):

```html
<!DOCTYPE html>
<html lang="en" data-theme="{{ theme }}">
<head>
    <meta charset="utf-8">
    <title>PenguinCAM — 3D Printing</title>
    <link rel="stylesheet" href="{{ url_for('static', filename='wizard.css') }}">
</head>
<body data-source="{{ source }}" data-return="{{ return_url }}">
<div id="wizard">
    <header id="wiz-header"><div class="brand">PenguinCAM · 3D Printing</div></header>
    <p>Print wizard placeholder. Drive enabled: {{ 'yes' if drive_enabled else 'no' }}.</p>
</div>
</body>
</html>
```

- [ ] **Step 5: The two touches to `frc_cam_gui_app.py`**

In `/download/<token>`, replace `mimetype='text/plain'` with a choice by extension:

```python
        mimetype = 'application/octet-stream' if real_filename.lower().endswith('.3mf') else 'text/plain'
        return send_file(
            file_path,
            as_attachment=True,
            download_name=real_filename,  # User sees the real filename
            mimetype=mimetype
        )
```

Between the last route and `def cleanup()` insert:

```python
# 3D print wizard: separate blueprint, shares the gate, token manager, limiter and folders.
from print.routes import init_print_routes  # noqa: E402  (after the app globals it needs)
init_print_routes(app, limiter=limiter, require_session=_require_app_session,
                  token_manager=file_token_manager, upload_folder=UPLOAD_FOLDER,
                  output_folder=OUTPUT_FOLDER, template_context=_app_template_context,
                  metrics=metrics, log=log)
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd /repos/popcornpenguins/PenguinCAM && uv run python -m unittest tests.test_print_routes -v`
Expected: 18 tests `OK`. If `test_redirects_to_return_with_verify_when_gate_fails` sees a 401 JSON instead of 302, the page route is returning the gate's response; it must call `require_session()` only to decide and then redirect.

- [ ] **Step 7: Run the quick suite and commit**

Run: `cd /repos/popcornpenguins/PenguinCAM && uv run python -m unittest discover -s tests --buffer && uv run python -m unittest discover -s print/tests -t . --buffer && uv run python gcode_test.py --quiet`
Expected: all pass, including the pre-existing route tests (the app still imports). Commit `print/routes.py`, `print/templates/print_wizard.html`, `frc_cam_gui_app.py`, `print/tests/test_routes.py` with message `print(c): print blueprint, event stream and app wiring`.

---

### Task 3: Real end-to-end job through the pool (integration)

**Files:**
- Modify: `print/tests/orca_integration_test.py` (append one class)

**Interfaces:**
- Consumes: the real app, real pool, real Orca.
- Produces: nothing new.

- [ ] **Step 1: Append the test**

```python
class RealJobRouteTest(unittest.TestCase):
    """POST /print-job with the real pool and Orca, then read the result and download it."""

    def test_job_runs_to_done_and_download_is_a_zip(self):
        from frc_cam_gui_app import app, limiter
        app.config["TESTING"] = True
        limiter.reset()
        client = app.test_client()
        with client.session_transaction() as sess:
            sess["app_verified"] = True
        job_id = client.post("/print-job").get_json()["job_id"]
        deadline = time.monotonic() + 130
        while True:
            data = client.get(f"/print-job/{job_id}").get_json()
            if data["state"] in ("done", "failed"):
                break
            self.assertLess(time.monotonic(), deadline, "job did not finish")
            time.sleep(0.2)
        self.assertEqual(data["state"], "done", data)
        self.assertGreater(data["summary"]["layer_count"], 0)
        resp = client.get(f"/download/{data['token']}")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.mimetype, "application/octet-stream")
        self.assertIn("sample_part.gcode.3mf", resp.headers["Content-Disposition"])
        self.assertTrue(resp.data.startswith(b"PK"))
```

(`time` and `unittest` are already imported in that module.)

- [ ] **Step 2: Run the full suite and commit**

Run: `cd /repos/popcornpenguins/PenguinCAM && make test`
Expected: everything passes, including the new class. Commit `print/tests/orca_integration_test.py` with message `print(c): end-to-end job through the real pool`.

---

## Self-review

- Spec coverage: job table, executor, constants at the top with the sizing basis (Task 1); ids ≥ 32 characters (Task 1); states, expiry, per-job condition with five-second wake (Task 1); queue cap raising and 503 (Tasks 1, 2); routes, gate, rate limit, 202/503/404, event stream with `state` then terminal, `Cache-Control: no-cache`, `elapsed_s` (Task 2); `return` validation and `verify=1` redirect, CSP for the panel (Task 2); scratch dir under upload folder, move into output folder, register as `sample_part.gcode.3mf`, `finally` cleanup (Task 2 worker); metrics event with outcome (Task 2); `init_print_routes` signature and placement, MIME by extension (Task 2); tests listed in spec section 9 for `print/tests/test_jobs.py` and `print/tests/test_routes.py` (Tasks 1, 2); real end-to-end through the pool (Task 3).
- Placeholders: none.
- Names: `JobPool`, `QueueFull`, `JobFailure`, `follow`, `wait`, `get`, `submit`, `expire`, `counts`, `start_sweeper` (Task 1) match Task 2's use; `ctx`, `make_worker`, `safe_return_path`, `init_print_routes` (Task 2) match the tests; template variables `source`, `theme`, `return_url`, `drive_enabled` are the contract for subfeature D.

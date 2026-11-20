# Printer delivery port: the port agent's report

Returned Thu 2026-11-19 18:12 PT. These are the port agent's own claims, saved by the
coordinator; the review in `delivery-port-review-1.md` checks them.

## What was ported

- Relay in `delivery/relay/` (package `penguin_delivery_relay`): the job and status logic
  and the HTTP routes as a Flask app built by `create_app`.
- Daemon in `delivery/daemon/` (package `penguin_delivery_daemon`): the package, tests,
  fixtures, `install.sh`, the hardware smoke script, `make daemon-tarball`.
- One uv workspace with two member projects, so the daemon installs alone with its three
  pinned dependencies.
- `make -C delivery together` sends a sample file through relay and daemon to the printer
  stand-in and prints each state change.
- Kept on purpose: the names installed on a Raspberry Pi (`penguincam-printer` command and
  service, `penguincam` user, `/etc/penguincam-printer`, the token salt).

## The interface the relay offers its caller

| Was in PenguinCAM | Now |
|---|---|
| Pairing code from the team configuration in the Flask session | The caller's `identify(request)` returns `Team(pairing_code, team_number, user)` or `None` (401) |
| File-token manager and download route | The caller's `find_sliced_file(token, team)` returns a `SlicedFile` with a `path` or a `stream`; the relay serves it at `/printer/download/<token>` |
| flask-limiter | The relay's own fixed-window limiter on its clock, answering 429 with `Retry-After` |
| App debug flags, log function, metrics, ProxyFix | Arguments `dev=`, `dev_pairing_code=`, `log=`, `on_event=`, `trusted_proxy_hops=` |

`errors.py` maps every failure the caller can see to an error report: 19 codes,
`delivery.*`, each with a test.

Upstream: versions are pinned only in `daemon/pyproject.toml`; every call into
`bambulabs_api` sits in `printer.py`, enforced by a test.

## Claimed test figures

475 fast tests, 0.75 s wall time, no socket and no real sleep; 10 of 10 random-order runs
and 10 of 10 runs on 4 workers passed; slowest test 0.05 s. Branch coverage 93% in total
(97 to 100% on relay and daemon modules; `together/__main__` 28%). Known faults are
pinned by tests marked `known_fault`.

## The port agent's list for hardening

**What the caller learns today**
- Download, upload and unexpected failures reach the caller only as the daemon's one-line
  text; the adapter matches those strings, which is fragile.
- A relay restart during a job loses the job; the caller sees no job and no result.
- A successful `last_result` is cleared by the next sync that names the job, so a caller
  polling slower than every 5 s may never see "ok".

**Progress that exists but is not passed on**
- The printer snapshot has percent, layer, total layers and minutes left; the daemon logs
  each stage. None becomes a progress report. The hand-out of a job to the daemon is not
  logged by the relay.

**Cannot be cancelled:** a pending or handed-out job, a running print, the 60 s start wait.

**Left behind**
- A stream copy whose job sits in a record nobody touches stays on disk until the relay's
  next request. A file passed by path must be kept up to 18 minutes.
- If the daemon dies, its download stays in `/var/tmp/penguincam-printer` until the next
  job overwrites it.
- The download token is in the URL path, so any access log records it.

**Blind waits:** the 60 s start poll, 5 s syncs, the 30 s exchange retry, backoff capped
at 60 s.

**Fragile**
- The two known faults (wrong status field for the start check; unchecked upload result).
- The 401 when a key changes needs a caller poll before the daemon can re-pair.
- A JSON list posted to `/printer/jobs` or `/printer/daemon/pair` gives a 500;
  `find_sliced_file` raising gives a 500.
- Daemon messages still mention PenguinCAM, Onshape and `docs/PRINTER_SETUP.md`; the
  default backend URL is still PenguinCAM's.
- The status fixture holds only the fields the hardware test notes recorded.

## Not done

- `install.sh` cannot be run here; `SOURCE_REPOSITORY` and `DAEMON_SHA` are placeholders.
- The together run sends a placeholder text file; it should switch to the sliced file
  example now in `contracts/examples/`.

# Review 4 (the last) of printer delivery, hardening phase

Written Thu 2026-11-19 22:30 PT. Reviewed: the uncommitted changes under `delivery/` in
`/repos/popcornpenguins/penguin-slicer`, over the committed port `7e1e2e1`. Judged against
[review.md](../briefs/review.md), [delivery-hardening.md](../briefs/delivery-hardening.md),
[upstream.md](../briefs/upstream.md) and the coordinator's seven rulings in the dispatch.
The builders' result and fix files were not read.

## Verdict

**FIX, 6 defects** (3 that touch the rulings, 1 that depends on the real printer's timing,
2 small). **Overall judgement: fit to commit as hardened, with the six items below carried
to the owner as open.** The reasons:

- The suite is solid: 40 of 40 fast runs, 10 of 10 simulated-printer runs and 5 of 5
  upstream checks passed; all 14 hand mutations on the new code were caught; both
  regressions I put back failed inside the per-test limit; no run hung.
- At-most-once for one file held under every campaign I ran (faults on both links,
  restarts, cancels, stop-following, resends).
- None of the six defects loses a job silently or starts one file twice. Three of them
  (defects 1, 2 and 4) need a particular behaviour of the real H2S that nobody has
  recorded yet, so the session at the real printer decides how much they matter; each is
  on the checklist at the end of this file.
- What keeps this from a plain `PASS`: defect 1 lets a start command go out on a report
  that does not say the printer is free, which is exactly what ruling 4 exists to prevent,
  and defect 3 tells the caller two untrue sentences during a wait that ruling 4 says is
  cancellable.

Scratch files of this review (tests, mutation script, logs) are in
`/tmp/claude-1000/-repos-popcornpenguins/c507b106-b789-4d12-a830-1dcc19de2171/scratchpad/r4/`.
No file in the repository was changed.

## 1. Flakes (dispatch item g)

Every run was pytest started directly from `delivery/.venv/bin/python`, under
`timeout -k 5 240` and an address-space limit of 2 GB, with the working directory
`delivery/`.

| Suite | Runs | Failures | Wall time per run |
|---|---|---|---|
| Fast suite, random order, 2 workers, seeds `4100 + 7919 * run` (12019 to 320860) | 40 | 0 | 2.9 s to 3.7 s, median 3.1 s |
| Simulated-printer suite (`-m simulator`, 31 tests) | 10 | 0 | 12.9 s to 14.2 s |
| Upstream check (`-m "upstream or simulator"`, 49 tests) | 5 | 0 | 12.4 s to 14.3 s |

The fast suite is 986 tests and 147 subtests. Its 11 warnings are all paho's
`ssl.PROTOCOL_TLS is deprecated`, raised inside the upstream tests.

Hunt for causes that have not bitten: no `time.sleep(` in `relay/tests`, `daemon/tests`,
`tests` or `conftest.py` outside the upstream and hardware files. Clocks, sleeps and jitter
are injected (`Shop` in `tests/link_faults.py` runs the real `RunLoop` and `RelayClient`
on two fake clocks). Nothing found.

One thing to know when running by hand: `testpaths` only applies when pytest starts in
`delivery/`. Started from another directory with `--rootdir` and `-c`, pytest collects the
current directory instead. `make -C delivery ...` is not affected.

## 2. Speed

Fast suite alone, one worker: 4.4 s. Tests over 0.2 s:

| Test | Time |
|---|---|
| `tests/test_link_faults.py::test_random_faults_never_print_twice_and_always_tell_the_truth` | 0.52 s |
| `tests/test_link_faults.py::test_the_link_down_from_just_after_the_start_ends_done_not_failed[60]` | 0.32 s |
| `tests/test_link_faults.py::test_a_printer_off_for_a_day_shows_its_true_age_then_ends_with_the_outcome_unknown` | 0.21 s |

All three simulate hours of faults second by second; none waits on the wall clock. Not a
defect. The simulated-printer suite takes about 13.5 s, not the "few seconds" the comment
in `pyproject.toml` says; the guide explains where the time goes (TLS connects and
certificates). Not a defect, but the comment is out of date.

## 3. Coverage and mutation

Branch coverage, measured with the coverage data file in the scratch folder:

| Module | Cover | Uncovered failure paths |
|---|---|---|
| `daemon/.../__main__.py` | 97% | 99-100 (`pwd` import fails), 322-323, 393-397 |
| `daemon/.../config.py` | 97% | 109-110 (cleanup after a failed write) |
| `daemon/.../printer.py` | 96% | 504-505 (malformed log record), 732-733, 740, 768-769 (stand-in shapes) |
| `daemon/.../relay_client.py` | 99% | none |
| `daemon/.../run_loop.py` | 99% | 491 (printer link with no `delete`); 529 and 718 cannot be reached (`_await_start` always raises) |
| `relay/.../deliveries.py` | 98% | 182, 233, 238 |
| `relay/.../relay.py` | 99% | 499 |
| `relay/.../routes.py` | 99% | 597 (the start gate's own refusal: rate limit, HTTPS or token) |
| `relay/.../errors.py`, `limits.py`, `sliced_files.py`, `app.py`, `caller.py`, `paths.py` | 100% | none |

Hand mutations, each applied alone to a scratch copy of `delivery/` and run against the
fast suite (the scratch copy itself has 1 failing test and 2 errors from the files it
lacks, `uv.lock` and `contracts/`; those are subtracted):

| Mutation | Caught by |
|---|---|
| M1 `_fresh` ignores the report's age | 10 tests |
| M2 no fresh-report wait just before the start command | 6 tests (run took 65 s, see section 8f) |
| M3 the start wait never asks whether the relay still holds the job | 5 tests |
| M4 stop-following allowed while the report is fresh | 3 tests |
| M5 no 24-hour `delivery.outcome_unknown` | 6 tests |
| M6 an unknown main state reads as no print | 3 tests and 6 subtests |
| M7 a followed print under an unrecognised state is judged like any other | 1 test |
| M8 final reports kept one minute, not 24 hours | 19 tests |
| M9 a paused printer counts as free for a new start | 3 subtests |
| M10 the start gate grants a second daemon process | 6 tests |
| M11 an unrecognised state does not make a followed print stale | 1 test |
| M12 a wait for a person reads as an end | 42 tests |
| M13 cancel allowed after the grant | 2 tests |
| M14 an unreachable printer counts towards the start timeout | 8 tests |

None survived. The two regressions of my own are in section 8f.

## 4. Error reports, route by route (dispatch item h)

Read from `routes.py`, `relay.py`, `errors.py` and exercised through the routes in the
scratch tests.

| Route | Failures | Error report? |
|---|---|---|
| `GET /printer/status` | 401, 429 | yes, both |
| `POST /printer/jobs` | 401 (no team, identity unreadable), 404, 409 (every refusal of `_refusal`, too old), 429, 500 (caller's function raised) | yes, each with its own code |
| `GET /printer/jobs/<id>` and `/events` | 401, 404, 429; in the stream, a dropped job is an `event: error` frame | yes |
| `POST .../cancel` | 404, 409 `delivery.cancel_too_late`, 409 `delivery.already_finished`, 401, 429 | yes; one sentence is untrue in one stage (defect 3) |
| `POST .../stop-following` | 404, 409 `delivery.still_reporting`, `delivery.not_started`, `delivery.already_finished`, 401, 429 | yes; one sentence is untrue in one stage (defect 3) |
| Any route | body over 64 kB (413), an escaped exception (500) | yes: `delivery.request_too_large`, `delivery.relay_failed` |
| Daemon routes | 401 `repair`, 403, 404, 429, 400 | plain JSON for the daemon, which is their audience; the 400 carries a report |

`errors.fill` drops every optional part whose figure is missing: my test rendered all 41
codes with no figures, with `None`, with empty strings and with the word `unknown`, and no
sentence showed a missing figure, a brace or a doubled space.

Secrets: one delivery through timeouts, a 500, a lost acknowledgement and a corrupt
download; neither the daemon's log nor the relay's log held the token, the pairing code
(plain or dashed), the relay's secret key or a download token.

The daemon as a plain Python program: the Unix-only names that remain (`pwd`, `os.chown`,
`/etc/...`, `/var/tmp/...`) are behind the legacy-install path and imported lazily; file
replacement is `os.replace`. I did not go deeper than that reading and the existing
`test_daemon_portability.py`, which passed in all 40 runs.

Refused requests on the four delivery job routes write no log line (defect 6).

## 5. Upstream

| Point of upstream.md section 1 | Verdict |
|---|---|
| One pin | `daemon/pyproject.toml`; a test fails if another daemon source file names a pinned version |
| One command | `make upgrade-printer-library VERSION=x.y.z` (`scripts/upgrade_printer_library.py`); not run by me, read only |
| Upstream check | 49 tests, 5 of 5 runs passed. It pins `on_message_handler`, `pushall`, the merged status document, the state and stage tables, the start payload, the upload's replies, the listing, `unwrap` |
| One seam | `printer.py`; a test fails if another module imports the library |
| Guide section | "Taking a new upstream version", with steps, what to read in the diff, what to do when the check fails, and the record of 2.6.6 to 2.6.5 and back |

What the upstream check leaves unprotected: whether the real H2S sends whole or partial
status documents (it matters for defect 1), and everything else on the checklist at the
end. No defect here.

## 6. Separation and the guide (dispatch item i)

Imports stay inside the component and its declared dependencies (tests enforce it for
both halves). The guide's tables of states, stages, printer values and all 41 error codes
are present and match the code (tests compare the printer table and the code list). The
upstream section is enough to take a new version of the printer library.

What a newcomer cannot do from the guide alone is defect 5.

## 8. Hostile cases of my own

### (a) Ruling 4: the fresh-report rule

- **Can a delivery wait for ever for a healthy idle printer that reports rarely?** No. A
  report older than 15 s makes the daemon ask the printer for a whole report every 10 s;
  the simulated-printer test `test_a_stale_idle_document_is_never_trusted_for_the_start`
  shows the answer arriving and the start going out. The caller sees the stage
  `waiting_for_printer`, "Waiting for the printer to answer". A printer that never answers
  ends the job unstarted after 10 minutes with `delivery.printer_unreachable_at_start`.
  The cost on a quiet printer is a pause of up to about 5 s before the start (the wait
  polls every 5 s and is not woken by the arriving document).
- **Before the gate the wait is cancellable. After the gate it is not, and the caller is
  told two untrue things.** Defect 3.
- **Can a start still go out while a print is going on?** Yes, in one way: a fresh status
  document that carries no main state reads as "no print". Defect 1. In no other ordering
  I tried: stale busy reports, quiet streams, outages on the timers, a restart at each
  exchange, stop-following followed by a resend (the resend is refused as unreachable,
  then as busy with the first file's name).
- A remaining window by design: a report up to 15 s old counts as fresh, so a print
  started at the printer's screen inside those 15 s while the printer's own announcement
  of it is lost would not be seen. Noted, not counted.

### (b) The first seconds after an accepted start

With `IDLE` now always "no print", the daemon's start wait simply goes on while the printer
still says `IDLE` and names another file or none: correct, and no second start can follow,
because the job slot stays held ("Another print is already on its way").

Two orderings end a job wrongly:

- the printer names our file while its main state is still the previous print's end.
  Defect 2;
- the printer takes more than 60 s of fresh reports to name the file. Defect 4.

### (c) Classification

Every main state in the table, the library's `UNKNOWN`, eleven values outside it (`SLICING`,
`INIT`, `OFFLINE`, a leading space, numbers, a boolean, a list, a mapping), and fourteen
combinations of state, stage, error code and HMS entries, printed and read by hand. Lower
case states are accepted (`running`). An unknown main state is unrecognised as a whole and
never free. An unknown stage under a going state is going, with the raw value kept. `IDLE`
with an error code or a serious HMS entry is "ended badly", which is free for a new send
(ruling 5). The one wrong reading is the document with no main state (defect 1).

### (d) At-most-once for one file, no overlap for two

Campaigns through `Shop` (the real run loop and relay client, the relay app, fake clocks):
link faults on each exchange, the printer off or quiet at each stage, stop-following while
the daemon still waits, a resend while unreachable and after the printer returns. One
start command per file in every case. Two files overlapped only in the slow-start case
(defect 4) and the no-main-state case (defect 1).

### (e) Recovery

Stop-following a job whose printer went off just after the start: the job ends `failed`,
`delivery.outcome_unknown`, sentence "cannot tell whether the print is still running or has
finished"; the daemon leaves its wait at the next 30 s check; a resend is refused while the
printer is unreachable and refused as busy, naming the first file, once it returns. Nothing
more was reported for the first job (same sequence number 1,000 s later).

### (f) No test can hang, and my two regressions

| Regression put back in the scratch copy | Result |
|---|---|
| R1 the start wait never counts time (waits for ever) | 8 tests failed; whole run 4.6 s |
| R2 the wait for a free printer has no end | 6 tests failed; whole run 4.6 s |

Both failed inside the per-test limit, through the bounded sleeps. Mutation M2 (section 3)
is the slow case: the run took 65 s instead of 3 s, with one worker at full CPU and about
350 MB when I looked 47 s in, and it ended by itself with 6 failed tests. I did not record
which tests were slow or which layer ended them; the run time fits two tests reaching the
30 s per-test limit. That is bounded and far below the earlier 2 GB, so ruling 7 holds,
but a mutation of this kind costs a minute, not seconds.

## 9. Cancellation and cleanup

Covered by the existing tests that M13 and the cancel mutations hit, and by my post-gate
case (defect 3). After a cancel before the gate the file is removed from the printer and
the slot is free; I did not re-verify the file system by hand beyond the fast suite's own
assertions.

## 10. Progress is honest (dispatch item f)

- Late subscriber to a finished job: one frame, the final report, then the stream ends.
- Nothing after a final state: an hour of further syncs left the report identical.
- After 25 hours the job route answers `404 delivery.job_unknown` (ruling 6: kept 24 hours).
- Daemon silent mid-print for 300 s: `stale: true`, `stale_age_s: 304`, state still
  `running`; the marker goes when the link returns.
- The stage shown in the post-gate wait is honest (`waiting_for_printer`); the refusals
  beside it are not (defect 3).

## Defects

1. **A status document with no main state is read as "no print", and a start command goes
   out on it.** `classify` in `printer.py`: with no `gcode_state` (missing, `None` or
   empty) and no `stg_cur`, the class is "no print". Evidence: `map_status({'mc_percent':
   43, 'mc_remaining_time': 12, 'layer_num': 5, 'subtask_name': 'someone_elses_print'})`
   gives `state: idle`; with that as the printer's fresh report, a send was accepted (202)
   and the daemon sent the start command, its recorded evidence being that very snapshot
   (file `someone_elses_print`, 43 percent). This breaks ruling 4 (a start only on a report
   showing no print) and the sense of ruling 2 (an unknown main state is never free). The
   printer library merges partial documents, and asks for a whole one on connect, so the
   exposure is a daemon that has just started or reconnected and hears a partial document
   before the whole one. Fixed when a document with no main state is "unrecognised as a
   whole" for a new start (the guide's table row changes with it) and a test sends such a
   document during someone else's print and sees no start.

2. **Our file named under the previous print's end state ends the delivery job in its
   first seconds.** `_acknowledge_if_the_printer_has_it` in `run_loop.py` and
   `print_report` in `deliveries.py` accept `finished` or `error` with our name at once.
   Evidence: with the printer reporting our name under a lingering `FINISH` for 6 s after
   the start, the job went to `done` in its first second; under a lingering `FAILED`, or
   `IDLE` with the last print's error code, it went to `failed` with
   `delivery.printer_error_at_start`; the printer then printed the part. This breaks ruling
   1 if the H2S changes `subtask_name` before `gcode_state`; every invented scenario
   changes both in one document, so nothing tests it. Fixed when an end state naming our
   file counts only after a going state has been seen for it (with a rule for the daemon
   that restarts after the print really ended), with a test for each lingering state.

3. **After the start gate, while the daemon waits for a fresh report, the caller can
   neither cancel nor stop following, and both refusals are untrue.** Evidence (printer
   quiet from the download on, gate granted): the report says `running`,
   `waiting_for_printer`, not stale; cancel answers `409 delivery.cancel_too_late`, "This
   print has already been started on the printer"; stop-following answers `409
   delivery.still_reporting`, "The printer is still reporting this print, so it is
   running"; no start command had been sent. It lasts at most 10 minutes, then the job ends
   `delivery.printer_unreachable_at_start`. Ruling 4 calls this wait cancellable. Fixed
   when the wait for a fresh report happens before the gate is asked (with only an
   immediate re-check after it), or when cancel is honoured in this stage, and neither
   sentence can be shown before a start command was sent.

4. **A printer slow to show the print gets a second start command.** After 60 s of fresh
   reports that do not name the file the job ends `delivery.start_timeout`; the printer
   then counts as free. Evidence: with the printer taking 90 s to name the file, the first
   job failed at 60 s, a resend was accepted at once, and a second start command went to
   the printer 20 s before the first print showed. The remedy sentence does say to look at
   the printer first. Whether the H2S can take that long is unknown. Fixed when the
   measured time is on record and either the wait is set well above it or a printer that
   was sent a start command is not offered another for a set time.

5. **The guide has no way to try printer delivery by hand on one machine.** `make
   together` works (it printed `PASS` in 0.4 s) but is described only in the Makefile's
   comments; the guide does not say how to run a relay, pair a daemon against it
   (`pair --backend ... --dev`), or point a daemon at the simulated printer, which has no
   command of its own and whose ports the daemon's configuration cannot set. Fixed when
   the guide has a short "Try it on one machine" section and the simulated printer can be
   started and reached by a hand-run daemon, or the guide says plainly that only the
   suites drive it.

6. **Refused requests on the delivery job routes write no log line.** `caller_team` in
   `routes.py` returns a 401 or 429 without `request_line`. Evidence: with nobody signed
   in, `GET /printer/jobs/<id>`, `/events`, `POST .../cancel` and `.../stop-following`
   each answered 401 with an error report and logged nothing. The guide says every caller
   request has a line. Fixed when those refusals are logged like the others.

## Open at commit

Each item stands alone. "Likely" is my estimate from the code and the simulated printer;
the real H2S decides items 1, 2 and 4.

1. **A start command can go out on a printer report that does not say the printer is
   free.** If the daemon has just started or reconnected while someone else's print runs,
   and the first thing it hears is a partial status report without the printer's main
   state, it treats the printer as idle and starts the new file. To a user: a start sent
   to a busy printer (what the H2S does with it is unknown). Unlikely if the H2S always
   sends whole reports, possible if it sends partial ones. Fixing it is a small change in
   one function of the daemon plus one row of the guide's table and a test.

2. **A print can be reported as finished, or as failed, in its first seconds.** If the H2S
   shows the new file's name while its state still reads as the previous print's end, the
   delivery job ends `done` or `failed` at once although the part is about to print. To a
   user: a wrong final answer; a resend is refused as busy, so nothing is printed twice.
   Unknown likelihood until the first seconds of a real start are recorded. Fixing it
   means a rule in the daemon and in the relay that an end only counts after the print was
   seen going, with care for a daemon restarted after a real end.

3. **For up to 10 minutes after the start is granted, a user cannot cancel or stop
   following a job that has not started, and is told it has.** This happens when the
   printer stops reporting between the upload and the start. To a user: "already started
   on the printer" and "still reporting, so it is running" while the page shows "Waiting
   for the printer to answer"; then the job ends unstarted by itself. Likely whenever the
   printer's network drops at that moment. Fixing it means moving the daemon's wait for a
   fresh report to before it asks the relay for the start.

4. **If the H2S takes longer than a minute to show a print it has accepted, the job is
   reported as not started and a resend starts a second file.** To a user: a failure
   message for a print that is beginning, and possibly two start commands. Unlikely if the
   H2S shows the print within seconds, as its one recorded report suggests. Fixing it is a
   changed constant or a short hold on the printer after a start command, once the real
   time is measured.

5. **A newcomer cannot try the whole chain by hand from the guide.** The automated run
   (`make together`) exists but is not described, and the simulated printer can only be
   driven by its suite. To a user: nothing; to a new developer: reading the Makefile and
   the tests to get started. Fixing it is a guide section and, if wanted, a small command
   to start the simulated printer.

6. **Rejected requests about a delivery job are not logged.** A page that is signed out or
   rate limited while it polls a job leaves no trace in the relay's log. To a user:
   nothing directly; support cannot see why a page stopped updating. Certain to happen
   when sessions expire. Fixing it is a few log calls in one function.

Also open, by design and not counted as defects: a report up to 15 s old counts as fresh,
so a print started at the screen inside that window, whose announcement is lost, is not
seen before the start command; and the relay accepts a send on a snapshot whose printer
report is old (the daemon then waits for a fresh one, so nothing starts on it).

## For the session at the real printer

Run `python -m penguin_delivery_daemon record` throughout. Each line is something only the
real Bambu H2S can settle.

- [ ] Does the H2S send whole status documents every time, or partial ones (changes
      only)? After the daemon connects, what is the first document it receives, and how
      long until the answer to its request for a whole one? (open item 1)
- [ ] The documents between the start command and the first `PREPARE` or `RUNNING`, one
      by one: does `subtask_name` change in the same document as `gcode_state`, or before
      it? Do it once after a finished print, once after a print stopped on the screen, and
      once from power-on. (open item 2)
- [ ] Do `print_error` and the HMS entries of the last print clear when a new print
      starts, and in which document? (open item 2)
- [ ] How many seconds from the start command to the first document naming the file, for
      a small file and for the largest file the team prints. (open item 4; the limit is
      60 s)
- [ ] What the H2S does with a start command while it is printing, paused, or showing an
      error. (open items 1 and 4)
- [ ] How often an idle H2S sends status documents on its own, and whether it answers a
      request for a whole report every 10 s without complaint for 10 minutes. (ruling 4)
- [ ] Whether a paused H2S keeps sending status documents, and whether `print_error` is
      set during a pause by hand, filament run-out and an open door.
- [ ] Every `gcode_state` value it sends across a whole print, a stop and a pause: any
      value outside `IDLE`, `PREPARE`, `RUNNING`, `PAUSE`, `FINISH`, `FAILED` refuses every
      send until it is added to the table.
- [ ] What an idle H2S reports for `stg_cur` at power-on, after a finish and after a stop.
- [ ] Whether the H2S accepts a start from its finished and failed states with nothing
      cleared on the screen, and how long `FAILED` and `print_error` stay after a stop.
- [ ] What it reports after being switched off mid-print and on again.
- [ ] The codes for a stop on the screen, filament run-out and an open door (assumed
      `PRINT_ERROR_0300400C`, `PRINT_ERROR_07008011`, `PRINT_ERROR_0500400E`).
- [ ] The TLS version on port 990, that a whole file arrives, the format of the `LIST`
      lines and the size listed.
- [ ] That a cancel during the upload removes the partial file from the printer's list.
- [ ] That `remaining_min` is minutes and the stages appear in order.
- [ ] Unplug the printer's network between the end of the upload and the start, for two
      minutes, then plug it back: what the page shows and whether cancel works. (open
      item 3)
- [ ] The printer's certificate: decide whether to pin it at `pair`.
- [ ] On the Windows computer: `pair`, `run`, `status` and `record` with the same commands
      as elsewhere, the home directory under `%LOCALAPPDATA%\PenguinDelivery`, and a
      sliced file whose name has a character Windows forbids.

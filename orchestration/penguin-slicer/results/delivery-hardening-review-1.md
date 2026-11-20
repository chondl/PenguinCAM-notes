# Review: printer delivery, hardening phase, round 1

**Verdict: FIX, 11 defects.** Two are serious (1 and 2), three are medium (3 to 5), six
are low.

The invariant that a sliced file is started on the printer at most once held under every
sequence I could build: restarts of the daemon and of the relay at each exchange, two
daemons restarting every few seconds, lost and duplicated gate requests and
acknowledgements, a stale failed acknowledgement replayed after the print, and a cancel
racing the start on both sides of the gate. The fast suite is fast, opens no socket, never
sleeps, and passed 20 of 20 random orders. The defects are on the other side of the
owner's concern: a delivery job whose print is in fact running is reported as finally
failed after a link that "seems down, then recovers", and old figures are shown as fresh
after the printer reconnects.

Reviewed Thu 11-19, 19:38 to 19:51 PT, against the uncommitted tree on top of `7e1e2e1`.
I did not read `results/delivery-hardening.md`. No file in the repository was changed.
My scratch tests and their outputs are in
`/tmp/claude-1000/-repos-popcornpenguins/c507b106-b789-4d12-a830-1dcc19de2171/scratchpad/rev/`
(`tests/test_review_hostile.py`, `tests/test_review_sim.py`, `tests/test_review_sim2.py`,
`mutate.py`, `plug/revspy.py`); they run with
`uv run --project delivery pytest -q -s -p no:randomly --rootdir delivery -c delivery/pyproject.toml <file>`
from `delivery/`.

## 1. Flakes

- 20 runs of the fast suite, `-n 2`, seeds 101, 202, ... 2020 (`flake20.sh`): **20 of 20
  passed**, 829 tests and 19 subtests each, 2.95 s to 4.36 s.
- A pytest plugin of mine (`plug/revspy.py`) wrapped `socket.socket`, `time.sleep` and
  `Thread.start` for a whole fast run: **0 sockets made by any test, 0 seconds of real
  sleep**, 10 threads in 3 tests, all joined or ended on an event
  (`test_relay_routes.py:339-343`, `test_relay_deliveries.py:228-234`,
  `test_daemon_printer.py:400-403`).
- Causes that have not bitten: none found in the fast suite. No fixed port, no shared
  path (every test uses `tmp_path` or `mkdtemp`), Hypothesis runs with `derandomize=True,
  database=None`. `relay.wait_for_report` is exercised with a real `Condition.wait(30)`
  but the test cannot miss its wake-up (the sequence is compared before waiting).
- The printer library's log handler is a module-level singleton
  (`printer._LIBRARY_LOG`), shared by every test in a worker; its `forward` is overwritten
  by each `connect()`. No test depends on the previous value. Not a defect today.

## 2. Speed (dispatch item e)

- Fast suite, serial: 4.9 s reported, 5.2 s wall. Test bodies sum to 3.82 s
  (`--durations=0`), of which **`tests/test_link_faults.py` is 3.51 s**. That file is what
  slowed the suite from 0.7 s: the 80-cell matrix of exchange by fault (0.02 to 0.04 s
  each, a whole delivery job on fake clocks), the restart and cancel cases, and the
  Hypothesis test (0.96 s, 40 examples of up to 3,600 simulated seconds). Everything else
  in the suite sums to 0.3 s. It is simulated time, not waiting: no real sleep, no socket.
- Over 0.2 s: one test, `test_random_faults_never_print_twice_and_always_tell_the_truth`
  (0.96 s). Next: `test_the_printer_dropping_off_mid_print...` 0.11 s,
  `test_the_whole_daemon_imports_with_the_unix_only_modules_missing` 0.09 s.
- The 15 tests marked `upstream` in `daemon/tests/upstream/` also run in the fast suite
  (the Makefile's `FAST` excludes only `real_time` and `simulator`), so `make test` imports
  the real library, paho and Pillow. They open no socket. Not a defect, but the comment in
  `printer.py` that the fast suite is honest without the library now depends on their
  `importorskip`.
- Simulated-printer suite, 10 runs: **10 of 10 passed**, 18 tests, 21.7 s to 23.4 s.
  Upstream check, 10 runs: **10 of 10 passed**, 33 tests, 20.9 s to 23.3 s. Each test costs
  1.1 s to 1.4 s of real time. The certificate costs 0.08 s to 0.15 s (timed), so most of
  it is the library's MQTT client connecting and stopping. One test waits one real second
  inside paho's reconnect delay (`test_the_wrong_access_code_...`, 2.1 s). Every wait in
  the suite's own code is on an event with a 10 s ceiling. Deterministic in these runs,
  including while my mutation runs loaded the machine.

## 3. Coverage

Measured with `coverage run -m pytest -m "not real_time and not simulator"`, branch
coverage:

| Module | Cover | Uncovered failure paths |
|---|---|---|
| `daemon/__main__.py` | 97% | 391-395 `status` with an unreadable configuration file |
| `daemon/config.py` | 97% | 106-107 unlink of the temporary file failing |
| `daemon/paths.py` | 100% | |
| `daemon/printer.py` | 93% | 530 cancel surfacing as an exception from the library, 558-559 the listing raising, 438-449 the real library (covered by the simulated-printer suite) |
| `daemon/relay_client.py` | 99% | |
| `daemon/run_loop.py` | 97% | 440 a file that could not be removed from the printer, 550 cancel during the pause between download attempts, 624 the printer already printing our file when `_start` runs, 691 our file named by an idle printer |
| `relay/deliveries.py` | 97% | 155 (the guard of mutation M6 below: unreachable) |
| `relay/errors.py`, `limits.py`, `sliced_files.py`, `app.py`, `caller.py` | 100% | |
| `relay/relay.py`, `routes.py` | 99% | |

Ten failure tests sampled. Seven assert what the caller sees (code, state, started count
and bytes): broken download fetched again, download broken every time, cancel while the
daemon is unreachable, relay restart mid-job, two daemons at the gate, short file with a
226, start ignored. Three assert less than their names say; see defect 10.

Mutation by hand, 18 mutations, each in a fresh scratch copy (`mutate.py`, output in
`mutate.txt`): **17 caught.** Caught: gate ignoring a cancel, gate granting a second
daemon, restarted daemon ignoring `start_granted`, cancel accepted after the grant,
checksum not checked, no backoff, a 226 trusted alone, daemon never stale, quiet printer
never stale, a start that raised treated as refused, busy check before the start removed,
queued acknowledgement dropped, no wait between upload attempts, partial file not removed
on cancel, hand-out deadline removed, vanish removed, and the log deadlock (below). Not
caught: M6, removing `if self.final: return False` from `Delivery._change`; every caller
of `_change` is already guarded, so the line is unreachable and the mutation is
equivalent.

## 4. Error reports

Every route a caller can reach answers with an error report, including the backstop for
an escaped exception (`routes.py:253-260`); each code in `errors.CODES` is in the guide's
table. Two faults:

- The sentences of four daemon-reported codes read "unknown" where a figure belongs
  (defect 3).
- The daemon's `run` command escapes as a traceback on a configuration file that is not
  UTF-8 (defect 8).

## 5. Upstream

- **One pin:** `bambulabs_api==2.6.6` only in `daemon/pyproject.toml`; a test forbids it
  elsewhere. But the library requires `paho-mqtt>=2.0.0` and `pillow>=11.0.0` unpinned
  (its METADATA), and the shop computer installs with `pip`, not from `uv.lock` (defect 9).
- **Upgrade command:** `scripts/upgrade_printer_library.py` moves the pin, re-locks, syncs,
  runs the check. It does not apply patches; it stops if one exists. No record in the guide
  of the "prove it once" run to another version and back. I did not run it: it rewrites
  `pyproject.toml` and `uv.lock` in the repository.
- **Upstream check:** 15 tests on the installed library plus the simulated-printer suite.
  Unprotected: the library keeping its last status document across a disconnect (which
  defect 4 rests on), and the format of the printer's `LIST` lines (see "For the hardware
  session").
- **Seam:** only `printer.py` imports the library (test-enforced; my import census agrees).
- **Guide section:** present, with steps and what to do when the check fails.

## 6. Separation

Imports are the standard library, declared dependencies, and werkzeug (through Flask).
Contract examples are checked in `tests/test_contracts.py`. The guide's "Running the
daemon" is short and has the three commands and the recording command.

## 8. Hostile cases (dispatch items a, b, f)

Each hostile case of the brief has a named test, except those listed in defect 10 and
under item (f). My own cases, all on the suite's `Shop` harness or the simulated printer:

| Case | Result |
|---|---|
| A. Printer silent 90 s after an accepted start, then reports our file | **Defect 1** |
| B. Relay link down 17 min from just after the start | **Defect 1** |
| C. Daemon killed after the gate said start, before the start command | Never started, `delivery.start_timeout`; the job is lost but reported, as the guide says |
| D. Sentences of the daemon's failure codes | **Defect 3** |
| E. Printer idle but still naming our file, 48 h | **Defect 6** |
| F. Printer unreachable mid-print | **Defect 4** |
| G. Six faults on every exchange, then every log, report and event searched for the pairing code, the daemon's token and the download token | None found (the status answer returns the caller's own code to the caller, by design) |
| H1. Cancel just before the gate request arrives | `cancelling`, never started, file removed, ends `cancelled` |
| H2. Cancel while the start command is in flight | `409 delivery.cancel_too_late`, started once, ends `done` |
| I. Relay restarted mid-print, caller asks for the stream | `404 delivery.job_unknown` |
| J. Send pressed twice | Second refused `delivery.job_in_flight`, started once |
| K. Two daemons, each replaced every 7 and 11 s | Started once, `done` |
| L. Gate and acknowledgement lost, duplicated and reset, then a stale failed acknowledgement and a stale gate replayed | Started once, both stale requests `404`, stays `done` |
| M. Printer off between upload and start, back 400 s later | Never started, `delivery.start_timeout`, file left on the printer |
| N. Daemon vanishes while it holds the job | `stale` after 20 s, age grows on the same sequence |
| S1. Printer's MQTT connection dropped 5 min, reconnects, sends nothing | **Defect 4** |
| S2, S5. Size of an upload's evidence | **Defect 2** |
| S3, S4. Uploads under TLS 1.3 | **Defect 5** |

**(f) The simulated printer.** It speaks real MQTT 3.1.1 over TLS and implicit FTPS with a
protected data connection, and the real library drives it; it found two real faults, so it
is worth trusting for what it plays. Its limits: the `LIST` line format and every status
sequence are invented (the guide says so); documents carry no `sequence_id`; it never
drops a connection by scenario. Its nine scenarios do not play: the printer off then on,
a drop and reconnect mid-upload, mid-start or mid-print, a stalled upload, a busy, paused
or faulted printer when the job arrives, percent going backwards, unknown stage codes.
Those are tested only against fakes in the fast suite, which is how the reconnect fault of
defect 4 got through.

## 9. Cancellation and cleanup

In every case above I looked at the stand-in printer's files, the downloads folder and the
slot after the end: cancel (H1) leaves no file on the printer and none in `downloads/`; a
killed daemon (C) leaves `downloads/` empty and the slot free; the same sliced file can be
sent again. The one thing that does not stop is the daemon itself (defect 7).

## 10. Progress (dispatch item c)

Late subscribers get the latest report at once (`routes.py:401-417`). Nothing is emitted
after a final state: `assert_truthful` holds in every case above, and every writer is
guarded. `cancelled` comes only from the daemon's acknowledgement, the queue, or the
15-minute deadline with no start grant. The `stale` marker works for a silent daemon (N).
Faults: defects 1, 4 and 6. One observation, not a defect: while a report is stale, each
sync clears and re-sets the marker, so the sequence rises by 2 every 5 s and the stream
sends a new event each time; a reader never sees the un-stale version.

## Dispatch items d, g, h, i

- **(d) Retries:** bounded and backed off everywhere I read and drove: sync and pair 5 s
  doubling to 60 s, less up to a quarter from the injected `rand`; download and upload
  3 attempts; gate 10 min; acknowledgements retried for ever at up to 60 s; `Retry-After`
  clamped to 300 s. `assert_no_tight_loop` held; mutation M8 (no backoff) was caught.
- **(g) Plain Python program:** no Unix-only import or call on any path outside the legacy
  service install (`pwd` is imported inside the one function that install uses); `os.replace`
  not `os.rename`; names made safe for Windows; one home directory chosen in `paths.py`.
  Faults: defects 7 and 8. `record` samples the merged status every 0.5 s rather than
  saving each document as sent; adequate for replay, but not literally "every document".
- **(h) Secrets:** none found in any log, error report or progress report (case G, the
  library's warning lines read, `_one_line` and `errors.redact` read). The access code is
  never sent to the relay.
- **(i) The deadlock:** really fixed. `_LibraryLog` no longer overrides
  `logging.Handler.release`; putting the override back (mutation M4) fails
  `test_the_library_log_can_be_written_from_another_thread_after_this_one`. The TLS 1.3
  upload: defect 5.

## For the hardware session

Two things nothing here can settle, both able to fail every delivery job at the real H2S:

- Which TLS version the H2S speaks on port 990 (defect 5).
- Whether the H2S's `LIST` lines match `printer._LIST_RE`. The H2S answers 426 after a
  whole file, so the listing is the only proof; if no line matches, every upload fails with
  "the printer did not confirm that the file arrived" (`printer.py:548-550`).

## Defects

1. **A delivery job whose print is running is reported as finally `failed`, and never
   corrected.** Two routes, both a link that seems down and then recovers.
   (A) The printer accepts the start, is unreachable for 90 s, then reports our file
   running: the daemon gives up at 60 s (`run_loop._await_start`, which counts time the
   printer is unreachable) and the delivery job ends `failed`, `delivery.start_timeout`.
   (B) The relay link is down 17 min from just after the start: the relay's 15-minute
   deadline ends the delivery job `failed`, `delivery.job_not_confirmed`, and the daemon's
   queued "ok" then gets `404`. In both, later syncs name the job's file; the relay clears
   `last_result` (`relay.py:513-522`) but the delivery job stays `failed` through the whole
   print and after it finishes. Evidence: cases A and B, `started` has one file, printer
   `running` then `finished`, delivery `failed` at sequence 4 throughout.
   Fixed when: a test for each route ends with the delivery job `done`; for example the
   start wait does not run out while the printer is unreachable, and a delivery job that
   ended on a start-stage failure follows the print again once a snapshot names its file.

2. **An upload keeps the text of the whole file in memory several times over, and a failed
   upload sends megabytes to the relay.** `_LibraryLog` captures every record of the upload
   thread, and the library logs each 32 kB block's `repr` at debug level
   (`ftp_client.py:105-106`). Evidence: a successful 8 MB upload peaked at 105 MB of traced
   memory (S5); a failed 2 MB upload produced a `detail` of 6,022,698 characters (S2),
   which goes into the acknowledgement, the error report, every status answer and every
   stream event. A 40 MB sliced file would need about 500 MB on the shop computer.
   Fixed when: the captured evidence is bounded in size and count (the block lines
   dropped), `detail` is capped on the daemon and on the relay, and a test with a
   multi-megabyte file asserts both bounds.

3. **Four error reports say "unknown" where the figure belongs.** A daemon-reported code
   is built with no fields (`errors.error_report` with `code`), so the caller reads: "The
   printer did not show the print as started within unknown seconds", "could not reach the
   printer for unknown minutes", "was busy with another print, unknown, unknown percent
   done", "started a different file, unknown, instead"; `delivery.printer_error_at_start`
   loses the known meaning of its HMS code. Evidence: case D, and cases A, C and M on the
   whole path. No test asserts these sentences.
   Fixed when: each of the five has a test asserting its full sentence, with no "unknown".

4. **Old figures are shown as fresh.** (a) The library keeps its last status document
   across a disconnect; `PrinterLink.snapshot` measures age from the last change of what it
   reads, and the change from "unreachable" back to the old document counts as new.
   Evidence, S1: after 5 minutes disconnected and a reconnect on which the printer sent
   nothing, the snapshot is `running`, 0 percent, 17 min remaining, `report_age_s: 0`.
   (b) While the printer is unreachable during a print, the report carries the last
   percent, layer and minutes with no `stale` marker for 55 s (case F).
   Fixed when: the age is that of the last document received, surviving a disconnect, and
   an unreachable printer during a print is marked stale without the 60 s wait; a
   simulated-printer scenario that drops and reconnects asserts it.

5. **The TLS 1.3 upload fault is open, and the simulator says it would stop every
   delivery.** With `"tls": "1.3"`, 11 of 12 uploads of 1 MB lost 16 kB to 49 kB of their
   end (S3). All 11 were caught by the listing, none was accepted and none started, and a
   whole delivery job ended `delivery.upload_failed` after three attempts. So it is not a
   wrong-print risk while the listing answers, but if the H2S behaves this way nothing can
   be printed. It would become a wrong start only if the listing also failed while the
   reply was 226 (`printer.py:545-546` then trusts the reply). The first hardware test's
   whole file with a 426 suggests the H2S does not lose the end today; that is one upload,
   not proof. The library's own option closes it in the simulator: with
   `ftp_client.ftps.unwrap = True`, 12 of 12 arrived whole (S4).
   Fixed when: a `"tls": "1.3"` scenario delivers a whole job in `make test-sim`, or the
   H2S's TLS version is recorded and the guide says which case is unprotected.

6. **A delivery job in `printing` never ends when the printer is idle but still names the
   file.** `Delivery.print_report` treats any state but `finished`, `error` and
   `unreachable` as progress. Evidence, case E: 48 h of syncs from an idle printer, the
   delivery job still `running`, 40 percent, no `stale`.
   Fixed when: a test shows that case reaching a final state with an error report.

7. **`run` cannot be stopped while a delivery job is in flight.** `cmd_run` ends with
   `loop.executor.shutdown(wait=True)` (`__main__.py:373`) and nothing tells the job
   thread to stop, so Ctrl-C waits out the job's waits (up to 10 min each for the printer
   and the gate) while syncs have stopped, and the job thread can still start the print
   afterwards. By reading; the tests count `shutdown` calls on a fake executor.
   Fixed when: stopping ends the job's waits promptly, never starts the file, and a test on
   a real thread shows it.

8. **Messages and a traceback on a hand-run daemon.** `config.py:137` and
   `__main__.py:309` tell the person to run `sudo penguincam-printer pair`, which does not
   exist on Windows or for a hand-run daemon. A `config.toml` saved as UTF-16 makes `run`
   escape with `UnicodeDecodeError` (probe: `ESCAPED: UnicodeDecodeError`), because
   `wait_for_config` catches only `OSError` and `TOMLDecodeError`.
   Fixed when: the messages name `python -m penguin_delivery_daemon pair`, and an
   undecodable file is waited on with a plain message, each with a test.

9. **Upstream pieces missing.** `paho-mqtt` and Pillow float for the daemon installed with
   `pip` on the shop computer, while `printer.py` sets an attribute on the library's paho
   client and the upstream check ran only against the locked versions. The upgrade command
   does not apply patches. The guide records no upgrade to another version and back.
   Fixed when: what the shop computer installs is the set the upstream check ran on, and
   the other two are built or recorded as decided.

10. **Tests that assert less than they say.**
    `test_the_printer_dropping_off_mid_print_marks_it_stale_and_it_recovers` never asserts
    `stale` (and the stand-in printer sends no `report_age_s`);
    `test_a_status_document_that_is_not_json_does_not_stop_the_stream` ends on
    `assertGreaterEqual(expected, 1)`, which cannot fail;
    `test_the_relays_own_wait_wakes_on_a_change_and_times_out_otherwise` never reaches the
    timeout; `test_the_link_down_for_hours_mid_job...` accepts `done` or `failed`.
    Fixed when: each asserts what its name says or is renamed.

11. **The guide does not say the relay must run as one process.** All state, the start
    gate included, is in one process's memory. With two workers a job fails safe (the gate
    answers `unknown`), but fails. Fixed when: the guide states it.

# Review: printer delivery, hardening phase, round 2

**Verdict: FIX, 6 defects.** One is serious (1), two are medium (2 and 3), three are low.

The first review's most serious defect is fixed, and the fix did not overshoot into a
second start: across every probe and a 400-case random campaign of my own, no sliced file
was started twice, and no print that ran to its end was reported `failed` because of
silence, for silences up to 48 h on either link. What remains is on the other side and at
the edges of the rule "only evidence ends a delivery job": one kind of evidence is read
wrongly (a printer fault a person clears at the printer ends the delivery job `failed`
while the print goes on), one acknowledgement path leaves the printer's queue blocked for
ever with every part healthy, and a delivery job past the start gate cannot be given up
by the caller.

Reviewed Thu 11-19, 20:23 to 20:42 PT, against the uncommitted tree on top of `7e1e2e1`.
I read [the first review](delivery-hardening-review-1.md) and neither of the builders'
result files. No file in the repository was changed. My scratch tests, scripts and their
outputs are in
`/tmp/claude-1000/-repos-popcornpenguins/c507b106-b789-4d12-a830-1dcc19de2171/scratchpad/rev2/`
(`tests/test_r2_forever.py`, `tests/test_r2_more.py`, `tests/test_r2_campaign.py`,
`mutate.py`, `runs.py`, `runs/*-summary.txt`, `coverage.txt`); the tests run with
`uv run --project delivery pytest -q -s -p no:randomly --rootdir delivery -c delivery/pyproject.toml <file>`.

One mistake of mine to know about: my first repeat run started pytest with `/` as its
current directory, so pytest began collecting the whole file system instead of the fast
suite. I stopped it after about two minutes, before it ran any test; it was collection
only, and `git status` of the repository is unchanged. Every figure below comes from runs
started in `delivery/`.

## 1. Flakes (dispatch items g and h)

| Suite | Runs | Failures | Wall time per run |
|---|---|---|---|
| Fast suite, `-n 2`, random order, seeds 7131, 7262, ... 12240 | 40 | **0** | 2.93 s to 5.23 s, median 3.62 s |
| Simulated-printer suite (`-m simulator`) | 20 | **0** | 9.72 s to 11.70 s, median 11.01 s |
| Upstream check (`-m "upstream or simulator"`) | 10 | **0** | 9.23 s to 11.25 s |

880 tests and 19 subtests in the fast suite, 21 in the simulated-printer suite, 39 in the
upstream check. Another agent's test runs shared the machine throughout, so these passed
under load. The only warnings are paho's `ssl.PROTOCOL_TLS` deprecation (11 and 22).

Causes that have not bitten:

- Real waits in the fast suite are four, each on an event with a ceiling and each joined
  (`test_relay_deliveries.py:228-234`, `test_relay_routes.py:332-343`,
  `test_daemon_printer.py:400-403`, `test_daemon_run_loop.py:864-869`). None found
  without a join, no fixed port, no shared path.
- The simulated printer's serialised socket: writes to an MQTT connection and reads of a
  whole packet share one lock per connection (`simulator/printer.py:269-281, 349-381`),
  and the wait for the next packet is outside the lock. The read under the lock blocks
  until a whole packet has arrived, so a client that sent half a packet would hold up
  status documents; over loopback with paho that did not happen in 30 runs. Not a defect.
- A regression can hang the fast suite for ever: defect 4.

## 2. Speed

Fast suite, serial: 3.5 s. Over 0.2 s: two tests,
`test_random_faults_never_print_twice_and_always_tell_the_truth` (0.62 s) and
`test_the_link_down_from_just_after_the_start_ends_done_not_failed[60]` (0.30 s). All of
it is simulated time. The simulated-printer suite halved since the first review (11 s
against 22 s).

## 3. Coverage and mutation

Branch coverage of the fast suite, measured with the data file in my scratch folder:

| Module | Cover | Uncovered failure paths |
|---|---|---|
| `daemon/__main__.py` | 97% | 393-397 `status` with an unreadable configuration file |
| `daemon/config.py` | 97% | 109-110 unlink of the temporary file failing |
| `daemon/paths.py` | 100% | |
| `daemon/printer.py` | 96% | 596 a cancel surfacing as an exception from the library, 624-625 the listing raising |
| `daemon/relay_client.py` | 99% | |
| `daemon/run_loop.py` | 97% | 489 a file that could not be removed from the printer, 525 a job that arrives already cancelled, 605 cancel in the pause between download attempts, 683 the printer already printing our file when the start is due, 801 our file named by an idle printer |
| `relay/deliveries.py` | 97% | 158 (unreachable guard, as in the first review) |
| `relay/relay.py`, `routes.py` | 99% | |
| `relay/errors.py`, `limits.py`, `sliced_files.py`, `app.py`, `caller.py` | 100% | |

Mutation by hand, 14 mutations, each in a fresh scratch copy (`mutate.py`):

| Mutation | Result |
|---|---|
| M1 an unreachable printer counts towards a vanished print | caught |
| M2 the 15-minute deadline ends a job past the start gate again | caught |
| M3 the start wait counts time the printer is unreachable or quiet | caught |
| M4 a daemon failure outranks the printer naming the file | caught |
| M5 the TLS close of the upload (`unwrap`) switched off | caught by `TestTls13` |
| M6 idle with our file named counts as a print under way | caught |
| M7 the report age restarts when the old document returns | caught |
| M8 orphaned live delivery jobs never swept | caught |
| M9 the printer naming the file no longer moves `starting` to `printing` | caught |
| M10 `report_for_code` does not cut `detail` | not caught; equivalent, the routes cut it first |
| M11 upload evidence lines unbounded | caught |
| M12 no stop check before the start command | caught |
| M13 a 226 trusted over a short listing | **the suite hangs for ever** instead of failing: defect 4 |
| M14 the start gate grants a second daemon process | caught |

## 4. Error reports

Not audited again route by route. Checked from the first review: the daemon's failure
sentences carry their figures (probe A2: "The printer did not show the print as started
within 60 seconds."), a configuration file in UTF-16 is waited on
(`config.py:141`), and no message names `sudo penguincam-printer` any more. New fault:
`delivery.print_failed` is produced for a print that has not failed (defect 1).

## 5. Upstream

One pin for `bambulabs_api`, with `paho-mqtt==2.2.0` and `pillow==13.0.0` now pinned
beside it in `daemon/pyproject.toml`. The guide records the upgrade to 2.6.5 and back,
with the two upstream check tests that failed on 2.6.5. The upgrade command stops when
patches are kept for another version and says what to do; no patch exists. Upstream check
10 of 10. Unprotected still: the format of the printer's `LIST` lines (hardware only).
The guide dates that record "Fri 11-20", which is the UTC date; in Pacific time it was
Thu 11-19.

## 6. Separation

Not audited again; nothing I read imports from outside the component.

## 8. Hostile cases: both sides of the silence rule (dispatch items a and b)

All on the suite's `Shop` harness with the real `RunLoop`, `RelayClient` and relay.

**(a) A running print is never finally failed by silence.** Held in every case:

| Case | Result |
|---|---|
| A. Start accepted, printer unreachable 48 h, then back with the print finished | `running`, `starting`, `stale` for 48 h, then `done`; started once |
| D. Daemon gone 48 h from the start command, caller polling | `running`, `starting`, `stale`, age 172,900 s; `done` when the daemon returned |
| E. Daemon gone 48 h mid-print | `running`, `printing`, `stale`, age 172,830 s; then `done` |
| F. Relay link down 30 h during a 26 h print, caller polling | `stale`, age 108,000 s; then `done`; 2,048 requests tried in 30 h |
| F2. Same, nobody polling | `done` on the first sync after the link returned |
| Campaign: 400 random cases, printer outages, link outages and daemon kills placed inside the job's waits, plus a cut of either link the moment the start command went out | 392 `done`, 8 `failed` before any start; 0 started twice, 0 ran to the end and reported `failed`, 0 not final |

**(b) States a delivery job can sit in for ever.**

| State it sits in | What the caller sees | Cancel or abandon | Blocks the next delivery job | Relay memory and disk |
|---|---|---|---|---|
| `starting`, start granted, printer never speaks again (A) | `running`, `stale`, honest | **no**: `409 delivery.cancel_too_late` | yes, but the printer is unreachable, so none could go | 1 record, 1 delivery job, constant over 48 h |
| `starting`, start granted, daemon never returns (D) | `running`, `stale`, age growing | **no**: `409` | yes; none could go without a daemon | constant; no sliced file held |
| `printing`, printer switched off mid-print, never back (C) | `running`, `stale`, last figures | **no**: `409` | yes while unreachable | constant |
| `printing`, daemon never returns (E) | `running`, `stale`, age growing | **no**: `409` | job slot free; a send is refused only because no printer reports | constant |
| Printer back idle, file forgotten (A2, C) | `failed` within 60 s (`delivery.start_timeout`) or 120 s (`delivery.print_vanished`) | ended | no | swept an hour later |
| Printer back idle, still naming our file (C2) | `failed`, `delivery.print_vanished`, after 120 s of reports | ended | no | swept |
| Start accepted, then nothing, printer reporting (A2, B) | `failed`, `delivery.start_timeout`, after 60 s of fresh reports | ended | no | swept |
| Any of the silent states, nobody asking for 24 h (D2) | first answer still `running` and `stale`, then `404 delivery.job_unknown` | gone | no | record and delivery job dropped |
| Ok acknowledgement answered by a 404 page that is not the relay's (G) | `done` | n/a | **yes, for ever, with everything healthy**: defect 2 | job slot held for ever |

So: no delivery job hangs silently, and none grows the relay's memory or disk. Three
things are wrong: the last row (defect 2); the "no" column (defect 3); and with a caller
that keeps polling, the silent rows never reach the 24 h drop, because each status poll
touches the record (D ran 48 h and would run for ever).

Two things I looked at and do not count as defects:

- B. Start accepted, the printer reports idle for 60 s, the daemon gives up with
  `delivery.start_timeout`, and 30 s later the printer runs the file to its end: the
  delivery job stays `failed`. That ending is by evidence (60 s of the printer's own
  fresh reports), which the rule allows, and the remedy says the part may be printing.
  Whether 60 s is enough for a real H2S is a hardware question (below).
- C. For the 120 s before `delivery.print_vanished`, the report shows `printing` with the
  last figures and no `stale` marker while the printer reports idle. By design, and short.

## 8b. Other dispatch items

- **(c) At most once.** Held everywhere: the campaign above; mutation M14; a 404 page at
  the start gate (G2: the daemon removed the file, was offered the job again, uploaded
  again, started once, `done`); Ctrl-C at every stage (below).
- **(d) Caps.** `detail` 2,000 characters on both halves and the daemon's reason 200 to
  300, with a 5 MB failure detail and a 1 MB message on the daemon (probe I2: reason 200,
  detail 2,000, longest log line 261) and 3 MB of everything in an acknowledgement on the
  relay (probe I: report 2,453 bytes, a 3 MB code replaced by a 19-character one). Not
  capped: the sync's snapshot (defect 5).
- **(e) Status age across reconnects.** `TestReconnect` drops the MQTT connection for
  5 minutes and asserts the old figures return with an age of at least 300 s; mutation M7
  is caught. One limit, not a defect: the age is that of the last MQTT message of any
  kind (`bambulabs_api/mqtt_client.py:185-195` calls the hook for every message), so a
  printer that answered the version request but not the status request would make old
  figures look fresh.
- **(f) TLS.** `tls12` and `tls13` scenarios each deliver a whole 1 MB job; `tls13` four
  times in a row with no upload retried. With `unwrap` off (M5) `TestTls13` fails, so the
  simulated printer still shows the fault; with the size check weakened (M13) a short
  file would be started, so the size check is still the guard (and see defect 4 for how
  that mutation shows up).
- **(i) Ctrl-C during each stage, on a real thread** (`test_r2_more.py`, J1 to J8):
  downloading, the pause between download attempts, uploading, the pause between upload
  attempts, the start gate unreachable, the start wait with the printer reporting, the
  start wait with the printer unreachable, and an ok acknowledgement queued. Each stopped
  in under 0.05 s, started nothing after the stop, acknowledged nothing, left nothing in
  the downloads folder, and removed the partial file from the printer during an upload.
- **(j) Cancellation, cleanup, progress.** Nothing is sent after a final state in any
  probe; counts of records and delivery jobs return to their floor.

## For the hardware session

- What the H2S reports while it waits for a person (filament out, door open): defect 1
  turns on it.
- How long the H2S takes to name the file after the start command; `delivery.start_timeout`
  is final after 60 s of reports (case B).
- What the H2S reports after it is switched off mid-print and on again; if it offers to
  resume, the delivery job will already be `failed`, `delivery.print_vanished`, after
  120 s of idle reports.
- The two from the first review still stand: the TLS version on port 990 and the format of
  the `LIST` lines.

## Defects

1. **A printer fault that a person clears ends the delivery job `failed` while the print
   goes on.** Real defect: it misleads a user. `printer.map_status` turns any non-zero
   `print_error`, and any HMS entry of severity 1 or 2, into state `error` whatever
   `gcode_state` says (`printer.py:270-286`), and the relay ends the delivery job on the
   first snapshot in state `error` (`deliveries.py:274-283`). Evidence, probe H: a
   document with `gcode_state: PAUSE`, `stg_cur: 6` and `print_error` 0x07008011 gives
   `failed`, "The print failed partway through: the filament ran out."; the print then
   resumes, reaches `FINISH`, and the delivery job stays `failed`. The same for
   `gcode_state: RUNNING` with a `print_error` that clears, and for a severity 2 HMS entry
   that clears. The suite's "error that clears" tests use only an entry of severity 4.
   This is the brief's hostile case "a printer error code appears and clears". The
   mapping is older than the hardening and marked provisional in the code; I believe
   Bambu printers do set `print_error` while paused for filament, but only the H2S can
   confirm it.
   Fixed when: a delivery job ends on a printer error only when the printer's own report
   says the print is over (`gcode_state` `FAILED`, or the print gone), a paused or running
   print with an error code stays `running` with the code shown, and a test for each of
   the three documents above ends `done`.

2. **An ok acknowledgement answered by a 404 that is not the relay's blocks the printer's
   queue for ever.** Real defect: a hang with every part healthy. `RelayClient.ack` reads
   any 404 as "the relay no longer holds the job" before looking at the body
   (`relay_client.py:203`), the daemon then remembers the job as finished and ignores
   every re-offer, and since the fix nothing but the daemon's acknowledgement frees the
   job slot of a job past the start gate. Evidence, probe G: one `404 text/html` page for
   the acknowledgement; the print runs and the delivery job reaches `done` from the
   printer's reports, yet 2 h later the job slot is still `handed_out` and every send is
   refused "A job is already on its way to the printer"; cancel answers
   `409 delivery.cancel_too_late`, then `404`. Only restarting the daemon clears it. A
   hosting platform's "application not found" page is such a 404.
   Fixed when: the job slot is released when its delivery job reaches a final state by any
   route, the daemon treats a 404 as final only when it is the relay's own JSON answer,
   and a test with a 404 page on the acknowledgement ends with the next send accepted.

3. **A delivery job past the start gate cannot be given up by the caller.** Real defect by
   the coordinator's rule. In cases A, C, D and E the caller's only answer for 48 h is
   `409 delivery.cancel_too_late` ("stop it at the printer"), including when the printer
   is switched off or the shop computer is gone and nothing is printing. The report is
   honest (`stale`, with its age), and the queue is blocked only while no delivery could
   happen anyway, which is why this is medium and not serious. The one exit is the 24 h
   drop, and a caller that keeps polling never reaches it.
   Fixed when: the caller can end such a delivery job by its own decision (a distinct
   final state or code saying the caller gave it up and the print may be running), the
   start gate stays shut for it, the job slot is freed, and tests cover the four cases; or
   the coordinator records that the refusal is intended and the guide says how such a job
   ends.

4. **A regression in the start path makes the fast suite hang for ever instead of
   failing.** Real defect: it hides a failure. The start wait now has no end while the
   printer is silent, and the tests drive it on a fake clock with an inline job, so a
   change that reaches the start wait with a printer that never speaks spins at 100% CPU
   with no output. Evidence: mutation M13 (trust a 226 over a short listing) leaves
   `TestTheRealLinkAgainstTheLibraryFake::test_a_short_file_with_a_226_is_caught_and_never_started`
   running until killed (I stopped it after 3 minutes).
   Fixed when: the tests' fake sleeps fail the test after a stated amount of simulated
   time, and M13 fails with a message in seconds.

5. **The relay keeps, serves and logs a daemon's snapshot of any size.** Real defect, low:
   a leak any paired daemon can cause. Evidence, probe I: one sync with a 15 MB body is
   accepted, every later status answer is 18 MB, and the request log line carries the
   3 MB job name (`routes.py:498-505`, `relay.py:521`). The guide says nothing in a status
   answer or log line grows with the size of a sliced file, which is true of sliced files
   only.
   Fixed when: the sync body has a size limit, the snapshot's strings are cut where they
   are stored and logged, and a test asserts the status answer's size after an oversized
   sync.

6. **Two tests exercise less than they say.** Low: they hide gaps.
   `test_random_faults_never_print_twice_and_always_tell_the_truth` sets the printer on or
   off only between ticks, and the job runs inline inside one tick, so its printer outages
   and its "cut the printer just after the start" never happen during the job's waits
   (`test_link_faults.py:451-455`; the cut takes effect after the daemon has already seen
   the print). And the stand-in printer sends no `report_age_s`, so on the whole path the
   `stale` age of a printer off for 48 h reads 3 or 4 s (probes A and C); the age is right
   in the unit tests and with the real `PrinterLink`.
   Fixed when: the property test places its outages with timers inside the waits (my
   campaign does, and passes), and the stand-in printer reports an age that a whole-path
   test asserts.

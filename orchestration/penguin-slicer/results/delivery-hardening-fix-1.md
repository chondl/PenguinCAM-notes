# Fix: printer delivery, hardening phase, round 1

Worked from [the review](delivery-hardening-review-1.md), against the uncommitted tree
under `delivery/` in `/repos/popcornpenguins/penguin-slicer`, Fri 11-20. Every one of the
11 defects is fixed; one defect of the same kind found beside a listed one is fixed too
(the simulator's MQTT server read and wrote one TLS socket from two threads, which lost a
status document in 2 of 13 runs of `make test-sim`). No git command that writes was run.

## Figures

| | Before (review) | Now |
|---|---|---|
| Fast suite, tests | 829 + 19 subtests | 880 + 19 subtests |
| Fast suite, serial wall time (`make test`) | 5.2 s | 3.7 s |
| `tests/test_link_faults.py` alone | 3.51 s of test bodies | 2.3 s for 122 tests (was 99) |
| Fast suite, 20 runs, random order, `-n 2`, seeds 101 to 2020 | 20 of 20 | 20 of 20, 880 tests each, 2.4 s to 4.2 s (the slower ones while the simulated-printer runs shared the machine) |
| Simulated-printer suite (`make test-sim`) | 18 tests, 21.7 s to 23.4 s | 21 tests, 9.1 s to 11.2 s; 20 of 20 runs passed after the flake fix |
| Upstream check (`make test-upstream`) | 33 tests, 20.9 s to 23.3 s | 39 tests, 10.7 s |

Branch coverage per module (`make coverage`); none fell:

| Module | Before | Now |
|---|---|---|
| `daemon/__main__.py` | 97% | 97% |
| `daemon/config.py` | 97% | 97% |
| `daemon/paths.py` | 100% | 100% |
| `daemon/printer.py` | 93% | 96% |
| `daemon/relay_client.py` | 99% | 99% |
| `daemon/run_loop.py` | 97% | 97% |
| `relay/deliveries.py` | 97% | 97% |
| `relay/errors.py` | 100% | 100% |
| `relay/relay.py`, `routes.py` | 99% | 99% |
| `relay/app.py`, `caller.py`, `limits.py`, `sliced_files.py` | 100% | 100% |
| Total | 85% | 86% |

## Speed

**The fast suite.** `tests/test_link_faults.py` spent its time on HTTP, not on simulated
time: `Shop.drive(..., until=shop.final)` asked the caller's route for the report once per
simulated second through Flask's test client, and `Shop.online` asked the status route
once per second. A profile of the 80-cell matrix: 14,029 test-client requests, 10,061 of
them that one poll, 3.3 s of the 5.6 s. `Shop.final` now reads the relay in the same
process every second and fetches the report through the route only when it changed, so
`assert_truthful` still checks every distinct report a caller polling each second would
see; `Shop.online` polls the relay and checks the route once at the end. The property
test no longer calls the route each second either. Nothing the tests assert was
weakened; the file now holds 23 more tests and runs in 2.3 s.

**The simulated-printer suite.** Each test cost about 1.2 s, and most of it was
`PrinterLink.disconnect` in the cleanup: the library's `mqtt_stop` is paho's
`loop_stop`, which waits out the network thread's one-second `select`. `disconnect` now
sends the MQTT DISCONNECT first (paho's own `disconnect()`), which wakes the thread at
once; that is also a cleaner goodbye to a real printer. What is left per test is the
certificate (0.1 s), the TLS handshakes, and in `TestAccessAndAddress` and `TestReconnect`
one second of paho's reconnect delay each, which is the library's behaviour under test.
The upstream check pins `pushall` and the paho `disconnect` call.

## Defects

### 1. A running print reported as finally failed after a link that seems down: fixed

Every place where a timer alone ended a delivery job, and what it is now:

| Where | Before | Now |
|---|---|---|
| Daemon, `run_loop._await_start` | 60 s from the start command, unreachable time included, then `delivery.start_timeout` | Counts only time in which the printer is reachable and its report is fresh (a document within `FRESH_REPORT_SECONDS`, 15 s); while it is unreachable or quiet, nothing is counted, the printer is asked for a whole report (`PrinterLink.request_report`, the library's `pushall`) every 10 s, and the wait has no end. Evidence: 60 s of fresh reports naming another file or none |
| Relay, `_expire`, handed-out deadline (15 min) | Ended any collected job, granted or not, as `delivery.job_not_confirmed` | Applies only to a job whose start was never granted; the gate answers `unknown` from then on, so the file can never be started (evidence: the gate never passed). A job past the gate keeps its slot until the daemon acknowledges or the printer's report names its file |
| Relay, `Delivery.refresh`, 6 h of silence | Final `delivery.job_expired` | Removed. Silence gives `stale` and a job still `running`; `delivery.job_expired` is no longer a code |
| Relay, `PRINT_VANISH_SECONDS` | 120 s of the file not named | Kept: it counts only snapshots of a reachable printer (an unreachable one never counts), so it is the printer's own report |
| Relay, pending deadline (3 min) | `delivery.job_not_picked_up` | Kept: the daemon never collected it, so the gate was never passed |
| Daemon, printer wait (10 min) and gate wait (10 min) | Final | Kept: both are before the gate, so the file is never started |

Two further pieces make a job that "seems down, then recovers" follow the print again:

- the relay moves a delivery job from `starting` to `printing` as soon as a sync's
  snapshot names its file (running, paused, finished or error), even before the daemon's
  acknowledgement arrives (`relay._follow_prints`, `Delivery.printer_has_it`);
- a daemon's start-stage failure that arrives after that is outranked by the printer's
  report: the delivery job goes on following the print (`relay._finish`).

A job nothing is heard from stays `running` and stale for as long as its printer's record
lives (a day after anyone last touched it); then the sweep drops it and a caller gets
`delivery.job_unknown`, never a failure.

Tests (each failed when the old deadline or the old start wait was put back, 8 failures
in all, including the property test):

- route A: `TestSilenceNeverEndsTheStart` in `daemon/tests/test_daemon_run_loop.py` (90 s
  unreachable then our file: success; an hour unreachable: still waiting, nothing acked; a
  silent stream for 10 min: not counted, the printer asked every 10 s; only fresh reports
  count towards the timeout), and on the whole path
  `test_the_printer_silent_after_an_accepted_start_then_printing_ends_done` in
  `tests/test_link_faults.py` (stale and `starting` 70 s into the silence, `done` at the
  end);
- route B: `test_a_job_past_the_gate_is_never_ended_by_the_deadline` and
  `test_a_start_failure_after_the_printer_named_the_file_does_not_end_the_print` in
  `relay/tests/test_relay_deliveries.py`, and on the whole path
  `test_the_link_down_from_just_after_the_start_ends_done_not_failed[17]` and `[60]`
  (link down 17 and 60 min from just after the start command: stale at 16 min, `done`);
- silence: `test_a_print_nothing_is_heard_about_for_days_stays_running_and_stale` (48 h,
  then the finished report: `done`), `test_a_silent_job_whose_printer_record_went_is_dropped_not_failed`;
- before the gate: `test_the_link_down_for_hours_before_the_gate_never_starts_the_file`
  (`delivery.job_not_confirmed`, never started, the upload removed) and
  `test_an_unconfirmed_job_fails_at_the_deadline_and_can_never_start` (the gate is `404`
  afterwards);
- property: `test_random_faults_never_print_twice_and_always_tell_the_truth` now also cuts
  the link or the printer for up to 25 minutes from just after the start command, with the
  added invariant that a print that ran to its end never ends `failed`.

`delivery.job_not_confirmed` now says what is true of it: "The computer next to the
printer collected the print and was then not heard from for 15 minutes, so the print was
given up before it started." It is retryable (it cannot be printing), with no stage.

### 2. Upload evidence proportional to the file: fixed

- `printer._LibraryLog` keeps at most `CAPTURE_LINES` (20) lines of at most 300
  characters, of INFO and above, then one line saying more were dropped. The library's
  logger is set to INFO, so its per-block debug records (with the block's bytes) and its
  whole-document debug records are never made.
- `detail` is cut to 2,000 characters where every error report is built: on the daemon in
  `RunLoop._ack` (sent and queued alike), on the relay in `errors.report_for_code` (and
  the ack route cuts what it reads). A daemon's one line of reason is cut to 300. The cut
  says how many characters went.
- Tests: `test_a_multi_megabyte_upload_keeps_small_bounded_evidence` (8 MB file, a
  library that logs every block's bytes at debug and an error per block: peak traced memory
  under 2 MB, evidence bounded, no block line kept; the old code kept 4 MB of lines),
  `test_a_huge_detail_is_cut_before_it_is_sent_or_queued` (5 MB detail on the daemon), and
  on the relay `test_a_huge_detail_from_the_daemon_is_cut_everywhere_it_travels` (3 MB
  reason, detail and field: the report, the status answer, every log line and every metrics
  event under 10 kB).

### 3. Sentences reading "unknown": fixed

The daemon sends the figures beside the code in a new `fields` member of the
acknowledgement (`seconds`, `minutes`, `name`, `percent`, `error`); the relay keeps only
those names with short plain values (`errors.daemon_fields`) and fills the sentence, and
for `error` adds the known meaning. Tests: `TestFailureFigures` in
`daemon/tests/test_daemon_run_loop.py` (what each failure sends), and in
`relay/tests/test_relay_errors.py` the five full sentences directly and through the ack
route (`test_a_daemon_failure_reads_with_its_figures`,
`test_the_figures_reach_the_report_through_the_ack_route`, 10 cases); on the whole path
`test_the_daemons_failure_sentences_carry_their_figures` and
`test_a_start_the_printer_ignores_has_its_seconds_in_the_sentence`. A busy printer that
reports no percent still reads "unknown percent done": the printer always reports
`mc_percent` while printing, and inventing a figure would be worse.

### 4. Old figures shown as fresh: fixed

- (a) `PrinterLink` hears every status document through the library's own
  `on_message_handler` and measures `report_age_s` from the last one received; the age
  survives a disconnect because the library keeps its last document. Without the hook (a
  stand-in), the age is from the last change, and an unreachable spell is no change.
  Tests: `test_old_figures_keep_their_old_age_across_a_disconnect`,
  `test_the_age_is_that_of_the_last_document_the_library_says_arrived`, and the simulated
  printer's `TestReconnect.test_a_reconnect_with_no_new_document_keeps_the_old_age` (the
  printer drops MQTT mid-print, the library reconnects, the printer answers its pushall
  with nothing: `running`, the old percent, age 300 s). The test harness now listens
  through `PrinterLink.on_document` instead of replacing the library's hook.
- (b) The relay marks a delivery job stale on the first sync that finds the printer
  unreachable, from the start gate on, with the printer's true age
  (`Delivery.printer_word`, `_stale_age`). The daemon's word without the printer's no
  longer clears and re-sets the marker on every sync (the reviewer's +2-per-sync
  observation). Tests:
  `test_an_unreachable_printer_during_a_print_is_stale_at_once_with_its_true_age`,
  `test_a_printer_that_cannot_be_reached_after_the_start_marks_the_start_stale`,
  `test_the_daemons_word_without_the_printers_keeps_the_marker_steady`, and the whole-path
  `test_the_printer_dropping_off_mid_print_marks_it_stale_and_it_recovers` (now asserts
  it).

### 5. Uploads losing their end under TLS 1.3: fixed in the simulator; the H2S's version stays on the checklist

`PrinterLink._make` sets the library's own `ftp_client.ftps.unwrap = True` (one line,
inside the one module that talks to the library; no patch). The size check stays the
guard. Scenarios `tls12` and `tls13` play a whole job each; `TestTls13` delivers four 1 MB
files and asserts each arrived whole at the first attempt (no retry in the log). With
`unwrap` set back to False, `TestTls13` fails (`delivery.upload_failed`). The upstream
check's `test_the_ftps_client_has_the_unwrap_option_and_uses_it_in_storbinary` pins the
option. The simulator's FTPS server now answers the client's TLS close, as a
well-behaved server does; before, every upload under `unwrap` ended in an EOF error line
and a `None` reply, which the listing then accepted.

### 6. A job in `printing` never ending when the printer is idle but still names the file: fixed

`Delivery.print_report` follows only running, paused, finished and error; idle with our
file named counts towards `delivery.print_vanished` like no file at all. Test:
`test_a_printer_idle_but_still_naming_the_file_ends_the_job_as_vanished`.

### 7. `run` cannot be stopped with a job in flight: fixed

`RunLoop.stop()` sets an event; the default `sleep` is a wait on it, every wait of the job
thread checks it, transfers stop on it, and the last check is just before the start
command. A stopped job ends unacknowledged (the relay offers it to the next run), a
partial upload is removed, and the file is never started. `cmd_run` calls `stop()` before
`executor.shutdown(wait=True)`; `run_forever` returns once stopped. Tests in
`TestStoppingWithAJobInFlight`: a real one-worker thread waiting for an unreachable printer
ends within the event's ceiling once stopped, with nothing uploaded, started or acked; a
stop at the gate never sends the start; a stop during the upload removes the partial
file; `run_forever` returns.

### 8. Messages naming `sudo penguincam-printer pair`, and a traceback on a UTF-16 file: fixed

`config.PAIR_COMMAND` (`python -m penguin_delivery_daemon pair`) is named in both
messages; `wait_for_config` catches `UnicodeDecodeError` and says to save the file as
UTF-8 or run pair again. Tests: `test_a_file_saved_as_utf_16_is_waited_out_with_a_plain_message`,
`test_a_missing_file_names_the_command_that_works_on_every_system`, and the updated
`test_a_config_with_no_pairing_code_is_waited_for_not_exited_on`. (`status` already caught
it: `UnicodeDecodeError` is a `ValueError`.)

### 9. Upstream pieces missing: fixed, and the patch step recorded as decided

- `paho-mqtt==2.2.0` and `pillow==13.0.0` are pinned in `daemon/pyproject.toml` beside
  the library, to what `uv.lock` resolved, so pip on the shop computer installs the set
  the upstream check runs on. The upgrade command frees those two pins, re-locks, pins them
  to what was resolved, re-locks and installs. Tests:
  `test_the_pins_the_shop_computer_installs_are_the_locked_versions`,
  `test_the_librarys_own_dependencies_are_floated_then_pinned_to_the_lock`.
- Patches: none is needed (defect 5's gap closed with the library's own option), so
  applying patches is not built and the command still stops if one appears. Recorded in
  the guide.
- Proved once, in a scratch copy of `delivery/` with `contracts/` beside it
  (`/tmp/claude-1000/-repos-popcornpenguins/c507b106-b789-4d12-a830-1dcc19de2171/scratchpad/fix/upgrade/`,
  logs `to-2.6.5.log` and `to-2.6.6.log`): to 2.6.5, `uv.lock` changed only the library,
  and the upstream check failed on exactly the missing `unwrap` option (two tests, 37
  passed); back to 2.6.6, the check passed (39) and `pyproject.toml` and `uv.lock` came out
  byte for byte as they were. Written into the guide's "Taking a new upstream version". The
  first attempt failed at collection because the scratch copy had no `contracts/` beside
  it; the command itself is fine.

### 10. Tests that asserted less than they said: fixed

- `test_the_printer_dropping_off_mid_print_marks_it_stale_and_it_recovers` asserts
  `stale` after the drop and its clearing after the return.
- `test_a_status_document_that_is_not_json_does_not_stop_the_stream` waits (on the event)
  for the document after the garbage, so a stopped stream fails it.
- `test_the_relays_own_wait_wakes_on_a_change_and_times_out_otherwise` is renamed
  `..._wakes_on_a_change`, and `test_the_relays_own_wait_times_out_with_the_unchanged_report`
  reaches the timeout (zero, so no real waiting).
- `test_the_link_down_for_hours_mid_job...` is split into a cut before the gate (`failed`,
  `delivery.job_not_confirmed`, never started) and cuts just after the start (`done`).

### 11. The relay must run as one process: fixed

The guide's "Delivery jobs" section says so, and what two workers would do.

### Same kind, found beside: the simulator's TLS socket used from two threads

The test thread published status documents on an MQTT connection whose own thread was
blocked reading the same TLS socket; 2 of 13 runs lost a document
(`status document {'gcode_state': 'RUNNING', 'stg_cur': 1} never arrived`). Each
connection now has an I/O lock: its thread waits for readability without the lock, then
reads the whole packet and answers under it, and every publish writes under it. 20 of 20
runs passed afterwards.

## Changes to the guide (`delivery/README.md`)

"Only evidence ends a delivery job; silence never does", the stale rules, the job slot's
deadline, one relay process, error reports staying small, the code table
(`job_not_confirmed`, `start_timeout`, `print_vanished`; `job_expired` gone), the
daemon's start wait and stopping, the simulated printer's TLS scenarios, reconnect and
timing, the upstream check's new reliances, the `paho-mqtt` and Pillow pins, and the
upgrade record. The scenarios' README lists `tls` and `pushall`.

## For the hardware session

Add to the owner's checklist:

- Which TLS version the H2S speaks on port 990, and whether its FTPS server answers the
  client's TLS close after a `STOR` (with `unwrap` the library waits for it, up to the
  60 s socket timeout; the listing decides either way, but a slow close would show).
- Whether the H2S's `LIST` lines match `printer._LIST_RE` (unchanged from the review).
- How often an idle H2S sends status documents, and that it answers `pushall`: the start
  wait now counts only reports younger than 15 s, and asks for one every 10 s while they
  are older. An idle printer that neither reports nor answers would make the start wait
  last until it does (honest, stale, never a false failure, but slow).
- That after a dropped connection the library reconnects on its own and the age of the
  status in the support log keeps counting from the printer's last document.

## What I could not do

Nothing in the list was left. Not done because outside it: the observation that a busy
printer with no percent still reads "unknown percent done" (see defect 3).

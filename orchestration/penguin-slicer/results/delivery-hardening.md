# Printer delivery hardening: the hardening agent's report

Worked Thu 11-19 18:32 to 19:38 PT, in `/repos/popcornpenguins/penguin-slicer/delivery`
only. No git command was run; nothing was pushed. Scratch scripts and run logs are in
`/tmp/claude-1000/-repos-popcornpenguins/c507b106-b789-4d12-a830-1dcc19de2171/scratchpad/hardening/`.
The guide is [delivery/README.md](../../../../penguin-slicer/delivery/README.md) (outside
this repository; the path is the checkout's).

**Status: DONE_WITH_CONCERNS.** All nine requirements are built and tested, the three
review items come first below, every hostile case has a test or is named as not handled
(two are: a certificate the daemon does not expect, and a real stalled socket), the fast
suite passed 20 of 20 random-order runs on two workers, and the guide lists every code,
stage and state. The concerns are the items under "What I could not do", chiefly that
every printer sequence is invented until the owner records real ones.

## The three items from review round 2, first

1. **The version test no longer reads files as UTF-8.**
   `daemon/tests/test_daemon_install.py`: `files_stating_a_version` walks the daemon's
   source, skips what is not source (hidden files such as `.DS_Store`, `__pycache__`,
   compiled files, editors' swap, backup and lock files), and searches every other file
   as bytes, so a binary file can neither fail the check nor hide a version.
   `test_a_stray_binary_or_editor_file_neither_fails_nor_hides_the_check` copies the
   daemon, adds a binary `.DS_Store`, a `.swp`, a `~` backup and a `#…#` file holding the
   probe version (all ignored), then a binary fixture holding it (caught).
2. **A caller function that returns the wrong type is an error report.** `identify`
   returning anything but a `Team` reads as unpaired on a status poll and is
   `delivery.identity_unreadable` on a send; `find_sliced_file` returning anything but a
   well-formed `SlicedFile` (a string, a dict, a number, a bad `sliced_at`, `path` or
   `filename`, a stream yielding text) is `500 delivery.sliced_file_unreadable` as JSON.
   A Flask error handler turns any other exception that escapes a route into
   `500 delivery.relay_failed` JSON (token-redacted), never a bare page.
   Tests: `relay/tests/test_relay_deliveries.py::TestWrongTypes` (13 cases).
3. **The relay sweeps its spool directory after a restart.** `create_app` calls
   `SlicedFileStore.sweep()`: every file named as the store names its copies
   (`j<hex>-*.gcode.3mf`) that it does not hold is removed; nothing else in the directory
   is touched. The first-use race the review saw (two private temporary directories) is
   closed by a lock. Tests: `TestRestartsAndCleanup` in the same file.

Also from the review: `tests/test_contracts.py` now reads the error report's fields,
types and `where` keys from `contracts/error-report.md` itself; the example is checked
only for having the required fields, so another strand may change its values freely. A
new test checks every delivery progress report against `contracts/progress-report.md`'s
table the same way.

## What changed, by requirement

**1. The known faults.** All eight `known_fault` tests flipped and the marker is gone.
The snapshot now carries `job_name` (the H2S's `subtask_name`), and `file` prefers it; the
start check (`printer.reports_file`) matches the uploaded name without `.gcode.3mf`. The
upload is judged by the size the printer's FTP listing gives the file: a 426 after a whole
file is a success, a 226 for a short file and a swallowed failure are `UploadFailed`. The
library's logger is taken over: lines during an upload become its evidence; warnings
elsewhere become one "printer library said:" line; nothing reaches the console as an
error. `delivery.start_timeout` and the rest are now codes carried from the daemon.

**2. Errors.** `errors.py` is now a table of 36 codes (`CODES`), each a sentence, a remedy,
retryability, a stage and an action. The daemon acknowledges every failure with its code
and `detail`; the relay's own refusals keep their text (for older daemons the text rules
still map to codes). New: `daemon_silent` (renamed from `printer_offline`, which measured
the daemon), `printer_busy` now names the file and its percent, `printer_unreachable_at_start`,
`printer_busy_at_start`, `download_failed`, `download_corrupt`, `upload_failed`,
`start_other_file`, `print_failed` (with the printer's code in `detail` and a meaning
where one is known), `print_stopped`, `print_vanished`, `job_expired`, `cancelled`,
`cancel_too_late`, `already_finished`, `job_unknown`, `relay_failed`. An unknown code is
reported as `job_failed` with the code in `detail`.

**3. Progress.** New `relay/penguin_delivery_relay/deliveries.py`: a delivery job with the
contract's states and six stages, from `waiting_for_daemon` to `printing` (table below).
The daemon sends its stage with each sync (at most once a second while it moves; the sync
limit went from 60 to 120 a minute), with bytes for the download and the upload. The
print's `printer_stage` comes from `stg_cur` through `PRINTER_STAGES` (all 36 library
codes). Reports reach the caller from `GET /printer/jobs/<id>`, the `delivery` field of
the status, and a server-sent event stream `GET /printer/jobs/<id>/events` (the latest
at once, then each new one, ending after a final state). A daemon quiet for 20 s, or a
printer report unchanged for 60 s mid-print, makes the report `stale` with `stale_age_s`.

**4. Cancellation.** `POST /printer/jobs/<id>/cancel`. The decisive piece is a **start
gate** on the relay (`POST /printer/daemon/jobs/<id>/start`): the daemon starts a file
only on its yes, given once, to one daemon process. A cancel before the gate stops the
daemon on its next sync (download and upload check between blocks; a partial file is
deleted from the printer); after the gate it is refused with `delivery.cancel_too_late`.
A daemon that cannot reach the relay cannot pass the gate, so a cancel made meanwhile
takes effect when it returns, and it never starts the file.

**5. Cleanup and restarts.** A restarted daemon recovers from the relay (the job, with
`start_granted` and `cancel`) and from the printer's report: it never starts a file whose
start was granted, acknowledges one already printing, and redoes one not started. Its
old downloads are removed at start. **Decided for a relay restart: nothing survives but
the secret key** (state stays in memory, as in the port); every party ends defined: the
caller gets `404 delivery.job_unknown` (saying the service may have restarted), the
daemon's gate and acknowledgement answer unknown so it never starts the file, a started
print goes on, and the spool is swept. Expired records and final delivery jobs (after an
hour) are swept at most once a minute.

**6. Supportable from the server.** One structured line per request and per transition
(`printer-delivery request=sync printer=3f2a9c1e status=200 ...`,
`printer-delivery event=transition job=... state=... stage=... code=...`), status polls
included. `printer` is a hash of the pairing code; the pairing line that printed the code
in the port is gone. The daemon's log is in plain words and has nothing error-looking on a
clean run (tested), names network failures plainly, says "the relay is answering again",
and says what it waits for.

**7. Upstream.** `make test-upstream`: 15 tests against the installed `bambulabs_api`
(`daemon/tests/upstream/`, each first line says what it protects) plus the simulated
printer's suite. `make upgrade-printer-library VERSION=x.y.z`
(`scripts/upgrade_printer_library.py`) moves the one pin, re-locks, reports what changed
in `uv.lock`, stops on any kept patch, and runs the check. No patch was needed: two gaps
were closed from outside in `printer.py` (the misleading log lines; paho re-raising a
callback's exception, which would end the library's network thread on one status
document that is not JSON, now suppressed on the library's client). **Proved once:** `make upgrade-printer-library VERSION=2.6.5` re-locked
(`uv.lock: bambulabs-api 2.6.6 -> 2.6.5`), installed, and the upstream check passed (33
tests); `VERSION=2.6.6` brought it back, and `uv.lock` is byte for byte what it was
(logs `upgrade-down.txt`, `upgrade-up.txt` in the scratch folder). 2.6.5 passing tells
that nothing the daemon relies on changed between those two versions, nothing more.

**8. The simulated printer.** `delivery/simulator/printer.py`: MQTT 3.1.1 over TLS and
implicit FTPS on loopback ports the system picks, a throwaway `openssl` certificate,
scripted by `simulator/scenarios/*.json` (nine, all invented around the one real document,
each saying so; a `recording` key plays back what `record` captured). `make test-sim`
runs the real `PrinterLink` and the real library against it; its waits are on the
library's message callback. It found two real faults the fakes could not: **a deadlock**
(the daemon's log handler had a method named `release`, overriding `logging.Handler`'s,
so the library's MQTT thread hung on its second log line: fixed, with a fast regression
test), and **TLS 1.3 data loss** (see "What a session at the H2S must confirm").
The daemon gained `record`.

**9. A plain Python program.** `paths.py` is the one module that chooses the home
directory (`--home`; `%LOCALAPPDATA%\PenguinDelivery` on Windows, `~/.penguin-delivery`
elsewhere), with `config.toml`, `downloads/`, `recordings/` in it. `pwd` is imported only
inside the function used for a Linux install made by the old installer; `pair` touches the
service user and systemd only for that install. File names from the relay are made safe
for Windows (`printer.safe_file_name`). `install.sh` and its unit are untouched and the
guide says they are not maintained. Tests: `daemon/tests/test_daemon_portability.py`
(every platform choice with the platform injected; the whole daemon imported in a fresh
interpreter with `pwd`, `grp`, `fcntl`, `termios`, `resource` and `syslog` unimportable;
the source scanned for `os.rename`, `os.geteuid` and the like; `/etc` and `/var` only as
the old installer's constants).

## Error codes, stages and states

The full table with "comes from" is in the guide; here code, retryable, stage.

| Code | Retryable | `where.stage` |
|---|---|---|
| `delivery.no_session` | no | send |
| `delivery.identity_unreadable` | no | send |
| `delivery.sliced_file_unreadable` | yes | send |
| `delivery.not_paired` | no | send |
| `delivery.sliced_file_missing` | no | send (`action` slice_again) |
| `delivery.sliced_file_too_old` | no | send (`action` slice_again) |
| `delivery.daemon_never_reported` | yes | send |
| `delivery.no_printer_status` | yes | send |
| `delivery.daemon_silent` | yes | send |
| `delivery.printer_busy` | yes | send |
| `delivery.printer_paused` | yes | send |
| `delivery.printer_unreachable` | yes | send |
| `delivery.printer_error` | yes | send |
| `delivery.job_in_flight` | yes | send |
| `delivery.rate_limited` | yes | |
| `delivery.relay_failed` | yes | |
| `delivery.job_unknown` | no | |
| `delivery.cancel_too_late` | no | starting |
| `delivery.already_finished` | no | |
| `delivery.job_not_picked_up` | yes | waiting_for_daemon |
| `delivery.job_not_confirmed` | no | starting |
| `delivery.cancelled` | yes | |
| `delivery.printer_unreachable_at_start` | yes | waiting_for_printer |
| `delivery.printer_busy_at_start` | yes | waiting_for_printer |
| `delivery.printer_error_at_start` | yes | starting |
| `delivery.download_failed` | yes | downloading |
| `delivery.download_corrupt` | yes | downloading |
| `delivery.upload_failed` | yes | uploading |
| `delivery.start_refused` | yes | starting |
| `delivery.start_timeout` | no | starting |
| `delivery.start_other_file` | no | starting |
| `delivery.job_failed` | yes | |
| `delivery.print_failed` | yes | printing |
| `delivery.print_stopped` | yes | printing |
| `delivery.print_vanished` | no | printing |
| `delivery.job_expired` | no | printing |

Every code builds a report of the contract's shape
(`tests/test_contracts.py::test_every_code_printer_delivery_knows_builds_a_contract_report`),
the guide's table lists exactly these 36 (`test_relay_errors.py::test_the_guide_lists_exactly...`),
and each is named by at least one test that produces it.

| Stage, in order | State |
|---|---|
| `waiting_for_daemon` | queued, then running once handed out |
| `waiting_for_printer` | running |
| `downloading` | running |
| `uploading` | running |
| `starting` | running |
| `printing` | running, then done or failed |

States: `queued`, `running`, `done` (final), `failed` (final, with `error`), `cancelled`
(final). The relay's job slot underneath keeps the port's `pending` and `handed_out`.

## Test figures

| Run | Result |
|---|---|
| `make test` (fast suite, 1 worker) | 829 passed (and 19 subtests), 5.4 s wall; the slowest test is the Hypothesis run, 1.15 s; next 0.15 s |
| Fast suite 20 times, random order (`-p randomly`, 20 fixed seeds), 2 workers (`flake20.sh`) | **20 of 20 passed**, 829 tests each, 2.9 s to 6.7 s (`flake20-final.txt`); an earlier 20 at 824 tests also all passed |
| `make test-parallel` | 829 passed, 3.1 s |
| `make test-sim` | 18 passed, 23 s (each test starts its own simulated printer and certificate; about 1 s of it is the library's MQTT thread stopping) |
| `make test-upstream` | 33 passed (15 upstream, 18 simulator), 23 s |
| `make test-together` (real threads) | 2 passed, 1.8 s |
| Growth | 538 tests at the start of this strand, 829 now in the fast suite, 18 in the simulator suite |

Branch coverage per module under the fast suite (`coverage run -m pytest -m "not real_time
and not simulator"`, the component's settings):

| Module | Cover | Not covered, and why |
|---|---|---|
| `relay/.../app.py`, `caller.py`, `errors.py`, `limits.py`, `sliced_files.py` | 100% | |
| `relay/.../relay.py` | 99% | three branches for a job slot with no delivery job beside it (no route makes one), one for a delivery job whose report did not change on a status read |
| `relay/.../routes.py` | 99% | an event with no `on_event`; the start gate's rate-limit refusal |
| `relay/.../deliveries.py` | 97% | a change to a final delivery job, a daemon `fraction` sent without bytes, a progress report for a job still queued |
| `daemon/.../paths.py` | 100% | |
| `daemon/.../relay_client.py` | 99% | one branch exit |
| `daemon/.../run_loop.py` | 97% | the `_wait` loop's early cancel return, two `_remove_from_printer` paths on a printer stand-in with no `delete`, the gate's give-up after a cancel during the wait |
| `daemon/.../__main__.py` | 97% | the `pwd` import (only on a service install), `status` with an unreadable config, `record`'s default file name |
| `daemon/.../config.py` | 97% | inherited, unchanged |
| `daemon/.../printer.py` | 93% | the real library's construction and ports (covered by `make test-sim`, where `printer.py` is 71% on its own), the library-log handler's malformed-record fallback |
| `simulator/printer.py` | 9% here, 88% under `make test-sim` | |
| `together/__main__.py` | 28% | the run itself, covered by `make test-together` |

Mutations by hand, each caught: the start gate ignoring a cancel (2 tests fail); the gate
granting a second daemon process (1 fails); the handler method named `release` (the
regression test hangs-then-fails in 5 s). The two-daemon end-to-end test does not catch
the second mutation, because the first daemon's acknowledgement clears the job before the
second asks; the daemon now also refuses to start a file the printer already reports.

## Every hostile case and its test

`LF` is `tests/test_link_faults.py`, `JF` `daemon/tests/test_daemon_job_flow.py`, `RD`
`relay/tests/test_relay_deliveries.py`, `SIM` `simulator/tests/test_simulated_printer.py`.
"The matrix" is `LF::test_every_exchange_survives_every_fault`: 16 faults × 5 exchanges
(pair, sync, ack, start gate, download; the sync is also the status upload and the job
fetch), each run to `done`, started once, reports truthful, no tight loop.

**Relay and daemon link**

| Case | Test |
|---|---|
| Times out; answer after the timeout; reset before / after; DNS; TLS | the matrix (`timeout`, `late`, `reset_before`, `reset_after`, `dns`, `tls`) |
| Reset during the answer | the matrix's download faults (`stop_partway`) |
| 500, 502, 503, 429 with and without a hint | the matrix |
| A web page instead of JSON, truncated JSON, the wrong shape | the matrix (`html`, `truncated`, `wrong_shape`); `test_daemon_relay_client.py::test_json_of_the_wrong_shape_is_a_relay_error_on_every_route` |
| Download stops partway, stalls, wrong length, wrong content | `LF::test_a_broken_download_is_caught_and_fetched_again` (4), `..._broken_every_time_fails_truthfully...` (4); `test_daemon_relay_client.py::test_a_download_of_the_wrong_length_or_content_is_corrupt...` |
| Link down for seconds, minutes, hours | `LF::test_the_link_down_for_seconds_or_minutes_then_back_still_delivers` (5 s, 90 s, 900 s), `..._down_for_hours_mid_job_never_starts...` (3 h) |
| Flapping every few seconds; very slow but alive | `LF::test_a_link_that_flaps_every_few_seconds_still_delivers`, `LF::test_a_very_slow_but_alive_link_delivers` |
| The same request twice; a lost acknowledgement repeated | the matrix (`duplicate`); `LF::test_a_lost_acknowledgement_is_repeated_and_counted_once`; `JF::TestQueuedAcknowledgements` |
| Two daemons claim the same pairing | `LF::test_two_daemons_claiming_the_same_pairing_start_the_file_once` (the second runs the whole job while the first waits at the gate); `RD::test_the_start_is_granted_to_one_daemon_process_only` |
| The daemon's clock wrong by hours | `LF::test_a_daemon_clock_wrong_by_hours_changes_nothing` |
| The relay restarts between exchanges | `LF::test_the_relay_restarting_mid_job...` (after the send, before the download, before the gate, before the ack, after the start) |
| The daemon restarts between exchanges | `LF::test_the_daemon_restarting_mid_job...` (before pick-up, at the download, mid-upload, at the gate, after the start, at the ack) |
| Backoff with jitter, no tight loop | `JF::test_the_backoff_between_attempts_doubles_and_is_jittered`, `JF::test_repeated_failures_double_the_wait_to_the_cap`, `test_daemon_run_loop.py::TestSync::test_a_network_error_backs_off_doubling_to_a_cap`; every `LF` test asserts at most 1.5 requests a second |
| Random faults on both links | `LF::test_random_faults_never_print_twice_and_always_tell_the_truth` (Hypothesis, 40 examples, derandomised: link faults per exchange, link outage, printer outages, a daemon restart, jitter) |

**Daemon and printer link**

| Case | Test |
|---|---|
| Printer off when the job arrives, on later | `JF::test_off_when_the_job_arrives_and_on_later_the_job_goes_through`, `LF::test_the_printer_off_when_the_job_arrives_and_on_later`; off too long: `JF::test_off_for_longer_than_the_wait_fails_with_the_minutes` |
| Drops off mid-upload, mid-start, mid-print, returns | `JF::test_the_printer_dropping_off_mid_upload_waits_for_it_to_return`, `JF::test_the_printer_dropping_off_mid_start_is_never_sent_a_second_start`, `LF::test_the_printer_dropping_off_mid_print_marks_it_stale_and_it_recovers`, `RD::test_an_unreachable_printer_during_a_print_does_not_fail_it` |
| Status stream silent with the socket open | `SIM::test_a_silent_stream_shows_its_age_while_the_socket_stays_open`, `RD::test_a_printer_whose_report_stopped_changing_marks_the_print_stale` |
| Reconnects with stale status | `JF::test_reconnecting_with_stale_status_of_our_own_print_is_still_recognised` |
| Upload refused, stalls, cut at each quarter | `SIM::TestUploadRefused`, `SIM::TestUploadCut`, `JF::test_cut_at_each_quarter_then_returns_the_upload_is_retried_and_succeeds`, `JF::test_refused_three_times_fails_and_removes_the_partial_file`; a stall: only `UPLOAD_SOCKET_TIMEOUT` set on ftplib and pinned by the upstream check (no socket test of a real stall) |
| Failure reported though the file arrived (426); success though short | `SIM::test_the_426_after_a_whole_file_is_a_success_with_no_error_in_the_log`, `SIM::TestUploadShort`, `test_daemon_printer.py` (`..._426_...`, `..._226_for_a_short_file...`) |
| Start accepted and nothing happens; refused; a different file; another print started between upload and start | `SIM::TestStartIgnored`, `JF::test_refused_is_start_refused`, `SIM::TestOtherFile`, `JF::test_someone_starts_another_print_between_upload_and_start` |
| Busy, paused, error, door open, out of filament, mid calibration, updating firmware | `JF::test_busy_paused_error_door_filament_calibration_and_firmware` (7 subtests; door, filament and firmware from stage codes, which are provisional) |
| An error code appears and clears; one that ends the print | `SIM::test_an_error_that_clears_then_one_that_ends_the_print`, `RD::test_an_error_that_clears_is_not_a_failure...`, `RD::test_an_error_code_that_ends_the_print_fails_it_with_the_meaning`, `RD::test_an_unknown_error_code_is_still_a_truthful_report...` |
| Pause and resume; a stop at the printer | `SIM::TestStoppedAtPrinter`, `RD::test_a_pause_and_resume_at_the_printer_keeps_the_job_running`, `RD::test_a_stop_at_the_printer_is_reported_as_stopped` |
| Percent backwards or jumping; missing fields; not JSON; unknown fields and stage codes | `RD::test_percent_going_backwards...`, `RD::test_fields_missing_from_the_snapshot...`, `SIM::test_a_status_document_that_is_not_json_does_not_stop_the_stream`, `test_daemon_printer.py::test_unknown_fields_are_ignored`, `..._every_stage_code_has_a_name_and_an_unknown_one_is_named_honestly` |
| Wrong access code | `SIM::test_the_wrong_access_code_reads_as_unreachable_and_the_job_says_so`, `test_daemon_printer.py::test_a_refused_upload_is_an_upload_failure_naming_the_cause` |
| A certificate the daemon does not expect | **Not handled**: `SIM::test_any_certificate_is_accepted_which_is_the_librarys_policy` pins that the library verifies nothing; see below |
| A printer at a new address | `SIM::test_a_printer_at_a_new_address_reads_as_unreachable` (reads as unreachable; finding the new address is `pair` again, by hand) |

## What a session at the real H2S must confirm

- [ ] `python -m penguin_delivery_daemon record` while one print runs start to finish,
      and once with a print stopped on the screen; put the files in
      `simulator/scenarios/` as its README says and run `make test-sim`.
- [ ] The upload: does the H2S speak TLS 1.3 on FTPS, and does a whole file arrive? The
      simulator loses the end of a file under TLS 1.3 (the library closes the data
      connection with session tickets unread; the reset drops the tail); the listing
      check catches it, but if the H2S does this, every upload fails three times.
- [ ] The listing: the H2S's `LIST` line format and size for an uploaded file (the
      daemon parses `-rw… 1 owner group SIZE Mon DD HH:MM NAME`).
- [ ] A print shows `stage` changes in order (heating, levelling, cleaning, printing) and
      `remaining_min` is minutes.
- [ ] The code the H2S reports for a stop on its screen (assumed `PRINT_ERROR_0300400C`)
      and for running out of filament (assumed `PRINT_ERROR_07008011`).
- [ ] A cancel during the upload removes the partial file from the printer's list.
- [ ] The printer's certificate: decide whether to pin it at `pair` (the library accepts
      any).

## On the Windows computer

- [ ] `py -m pip install .\delivery\daemon` works in a fresh Python 3.11+.
- [ ] `py -m penguin_delivery_daemon pair` writes `%LOCALAPPDATA%\PenguinDelivery\config.toml`
      and prints the run command.
- [ ] `py -m penguin_delivery_daemon run` connects, logs "paired with the relay" and the
      idle line, and Ctrl-C stops it cleanly.
- [ ] `status` and `record --seconds 10` run.
- [ ] Discovery (UDP 2021) under the Windows firewall: allowed, or the typed address path.
- [ ] A job whose file name holds `:` or `?` uploads under a safe name.

## What I could not do, and why

- **No real printer and no Windows machine.** Everything is proven against the simulated
  printer, whose sequences are invented, and on Linux with the platform injected; the two
  checklists above are what is left.
- **A printer certificate the daemon does not expect is not detected.** The library turns
  verification off on MQTT and FTPS. Closing it means pinning the certificate seen at
  `pair` and checking it on every connection, through library internals; that is a
  policy decision for the owner (and probably a library patch), not done.
- **A printer at a new address** is reported (unreachable, then
  `delivery.printer_unreachable_at_start`), not followed: finding it again is `pair`.
- **An upload that stalls on a real socket** is not tested: the 60 s socket timeout is
  set on ftplib and the upstream check pins where the library reads it, but no test holds
  a socket open without reading.
- **TLS 1.3 on the simulated printer** loses the end of an upload by timing, so no test
  relies on it; the simulator speaks TLS 1.2 by default.
- **The relay keeps nothing across a restart** (decided, documented): a restart mid-job
  loses the delivery job; every party ends defined and the caller is told.
- **Left as they were:** the `penguincam-printer/1.0.0` User-Agent and the default relay
  URL (PenguinCAM's hosted service), so installed daemons keep working; `status` prints
  the pairing code to the person who ran it (output, not a log), as before; `install.sh`
  and its tests, untouched as the brief says.
- **The fast suite is slower**: 5.4 s against 0.7 s at the port, almost all of it the
  fault matrix and the Hypothesis run; still seconds, no test over 1.2 s.
- **Provisional mappings** the hardware session must settle: the printer error meanings
  and the stop code, `remaining_min` as minutes, door-open and filament-out as stage codes
  rather than HMS entries, and the `fraction` split before the print.

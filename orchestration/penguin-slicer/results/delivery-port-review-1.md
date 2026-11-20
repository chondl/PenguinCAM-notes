# Printer delivery, port phase, review round 1

**Verdict: FIX, 12 defects.** Three are new in the port and can lose a job or break a
team's status line (defects 1 to 3). The rest are gaps in tests, in the guide, or
behaviour inherited from the print branch that the port should at least pin.

Reviewed Thu 11-19 18:10 PT against the working tree of
`/repos/popcornpenguins/penguin-slicer/delivery` (untracked, not yet committed). No file
in the repository was changed. Scratch files (probes, mutated copies, logs) are in
`/tmp/claude-1000/-repos-popcornpenguins/c507b106-b789-4d12-a830-1dcc19de2171/scratchpad/delivery-review-1/`.
The builder's result file was not read.

Answers to the three questions in the dispatch:

- **Does the fake clock or an injected transport hide real timing behaviour?** Yes, one
  that matters: the relay holds the sliced file and claims the job in two separate steps,
  and any other request that lands between them drops the file. No test reaches it
  because Flask's test client runs one request at a time. Real threads hit it in 3 of 150
  sends (defect 1). Four more untested timing behaviours are inherited from the print
  branch and listed under check 1 for the hardening phase.
- **Do the `known_fault` tests pin the faulty behaviour?** Yes for all five: each fails
  when its fault is fixed in a scratch copy. But two more tests pin fault 1 without the
  marker, the daemon's fake printer makes 13 unrelated tests fail when fault 2 is fixed,
  and the guide's description of fault 2 does not match the pinned library (defect 5).
- **Can `identify` or `find_sliced_file` leak one team's job or sliced file to another?**
  Not through the relay itself: six isolation probes pass. But the relay cannot know who
  owns a send token, so everything rests on the caller's `find_sliced_file` checking the
  `team` it is given. The guide does not say so, and no test checks which team the relay
  passes: a mutation that passes a different team survives the whole suite (defect 4).

## 1. Flakes

`flake20.sh` ran the fast suite 20 times with `-n 2 -p randomly --randomly-seed=<seed>`,
seeds 101, 202, ... 2020: **20 of 20 passed**, 475 tests each, no failure to report.
The real-time together tests (`-m real_time`, outside the fast suite) passed 5 of 5.

Causes that have not bitten yet, from reading the code and tests:

| Finding | Where | Risk |
|---|---|---|
| The window between `files.add` and `claim_job` | `relay/penguin_delivery_relay/routes.py` lines 209 to 215 | Real; defect 1 |
| `test_only_one_of_many_simultaneous_sends_wins` runs 8 real threads on a `threading.Barrier(8)` with no timeout | `relay/tests/test_relay_routes.py` line 197 | A thread that dies before the barrier hangs the suite for ever. Threads are joined. Low |
| `test_it_parses_as_shell` starts a real `bash -n` with a 10 s wall-clock timeout and skips when bash is missing | `daemon/tests/test_daemon_install.py` line 36 | A skip hides the check; low |
| `test_the_default_executor_is_one_worker_thread_and_downloads_go_to_tmp` makes a real `ThreadPoolExecutor` and reads `_max_workers` | `daemon/tests/test_daemon_run_loop.py` line 700 | Private attribute of the standard library; low |
| Module-level `H2S`, `IDLE`, `JOB` shared by every test; copies are shallow (`dict(IDLE)` shares the nested `printer` dictionary) | `daemon/tests/daemon_fakes.py` | No test mutates the nested value today |

No real sleep, no wall-clock read, no fixed port, no shared temporary path, no use of the
current directory, the home directory or the environment was found in the fast suite
(`grep` for `time.sleep`, `time.time(`, `time.monotonic`, `os.environ`, `expanduser`,
`getcwd`, `127.0.0.1`: hits only in `hardware_smoke.py`, never collected, and one
`monkeypatch.setenv('TMPDIR', tmp_path)`).

Timing behaviour that exists in the code and that no fast test covers, inherited from the
print branch (not counted as port defects, listed for the hardening phase):

- The job runs on a real worker thread only in the two real-time tests, and only on the
  path where everything works. Every failure path is tested with `InlineExecutor` or
  `StepExecutor`, so the loop thread and the job thread never run at once.
- `PrinterLink.upload` has no timeout. An FTPS transfer that hangs holds the daemon's one
  job slot for ever: the relay expires the job after 15 minutes, and every later job is
  logged as "offered while ... is still running" until someone restarts the daemon.
  `cmd_run` then calls `executor.shutdown(wait=True)`, which also waits for ever.
- The relay's clock is `time.time`. A backwards step of the server's clock freezes every
  rate-limit window (`now - window[0] >= window[1]` stays false) and delays every job
  deadline by the size of the step. `limits.py` is new in the port.
- The in-process transport hands the daemon a whole body at once; only the two real-time
  tests stream a download over a socket.

## 2. Speed

| Run | Wall time reported by pytest |
|---|---|
| Fast suite, 2 workers, 20 runs | 0.52 s to 0.68 s |
| Fast suite, 1 worker, under coverage | 1.07 s |

Ten slowest (1 worker, under coverage): 0.03 s `test_ping_and_ack_each_have_sixty_a_minute`;
0.02 s each for `test_rate_limited`,
`test_the_status_limit_is_per_team_and_carries_an_error_report`,
`test_sixty_syncs_a_minute_then_429_with_retry_after`,
`test_each_code_has_its_own_daemon_budget`, `test_ping_and_ack_share_no_budget_with_sync`;
0.01 s each for `test_the_exchange_limit_is_shared_by_every_address`,
`test_two_apps_share_no_state`,
`test_the_daemon_imports_only_itself_the_standard_library_and_its_pins`,
`test_only_printer_py_talks_to_the_printer_library`. **Nothing is over 0.2 s.**
Outside the fast suite, the two real-time tests take 0.9 s and 0.4 s.

## 3. Coverage

Measured with `coverage run -m pytest -m "not real_time" -p no:randomly` and the
component's own settings (`branch = true`), data file kept in the scratch folder.

| Module | Cover | Uncovered |
|---|---|---|
| `relay/.../relay.py`, `errors.py`, `limits.py`, `caller.py`, `app.py` | 100% | none |
| `relay/.../routes.py` | 99% | `71->exit` (an event with no `on_event`) |
| `relay/.../sliced_files.py` | 97% | 92-93 |
| `daemon/.../run_loop.py` | 99% | 57, `272->275`, 347 |
| `daemon/.../relay_client.py` | 99% | `170->172` |
| `daemon/.../config.py` | 97% | `86->93`, 106-107 |
| `daemon/.../printer.py` | 97% | 205-206, 300-302 |
| `daemon/.../__main__.py` | 99% | 285-286, 424 |
| `together/__main__.py` | 28% | the run itself (covered only by the real-time tests) |
| `together/stand_in.py` | 90% | 29, 32, 35 |

Uncovered branches that are failure paths:

- `sliced_files.py` 92-93: deleting the relay's copy of a sliced file fails.
- `run_loop.py` `272->275`: a job that raises after it was already acknowledged.
- `run_loop.py` 347: the printer reports the job's file in a state that is neither
  accepted nor an error (for example `idle`).
- `config.py` 106-107: removing the half-written config file fails.
- `__main__.py` 285-286: `chmod` of the download directory fails.
- `printer.py` 205-206: the real `import bambulabs_api`. The fast suite never imports
  the library, so nothing checks the fake against it (see check 5).
- `printer.py` 300-302: binding the real discovery socket.

Coverage says nothing about defects 1 to 3: every line involved is covered.

**Ten failure-path tests sampled.** Nine assert what the caller sees:
`test_a_download_failure_is_acknowledged_with_one_line`,
`test_an_upload_failure_is_acknowledged_and_the_file_is_still_removed`,
`test_a_printer_that_never_reports_running_times_out_at_sixty_seconds` (also the elapsed
time and each poll), `test_a_404_on_the_acknowledgement_is_final_not_retried`,
`test_no_identity_is_401_with_an_error_report`,
`test_a_file_sliced_more_than_forty_minutes_ago_must_be_sliced_again`,
`test_an_expired_job_takes_its_download_with_it`,
`test_a_refused_send_of_a_stream_leaves_no_copy_behind`,
`test_run_forever_keeps_going_after_an_unexpected_error`. One is weak:
`test_only_one_of_many_simultaneous_sends_wins` asserts only the eight status codes, not
that the winning job can be downloaded, which is exactly what defect 1 breaks.

**Mutation by hand** (`mutate.sh`, each in its own scratch copy; the unmutated copy passes
475):

| Mutation | Caught by |
|---|---|
| `relay.begin_exchange`: second-Pi refusal inverted | `test_the_exchange_answers_a_token_then_refuses_the_second_pi` |
| `relay.finish_job`: accept an ack for any job id | `test_ack_for_an_unknown_job_is_not_found_and_changes_nothing` |
| `routes.printer_download`: no housekeeping before serving | `test_an_expired_job_takes_its_download_with_it` |
| `run_loop._one_line`: download token not redacted | `test_a_download_token_never_reaches_the_acknowledgement` |
| `run_loop._ack`: job remembered after a failed ack | `test_a_transient_acknowledgement_failure_is_retried_on_the_re_offer` |
| `routes.printer_status`: limit keyed by address | `test_the_status_limit_is_per_team_and_carries_an_error_report` |
| `run_loop.handle_job`: job slot never freed | `test_a_job_is_downloaded_uploaded_started_and_acknowledged` |
| `relay._expire`: records never dropped | `test_a_dropped_record_takes_its_job_with_it_without_an_expiry_event` |
| **`routes.printer_jobs`: `find_sliced_file` asked with a different team** | **nothing: 475 passed** |

One more attempt (an unsigned code accepted from the query string) also passed, but no
test could be expected to send that query, so it is not counted.

## 4. Error reports

Failures the caller's page can see, and what carries them:

| Failure | Error report | Test that produces it |
|---|---|---|
| The 19 codes in the guide's table | yes, `error_report` beside the original text | one each in `relay/tests/test_relay_errors.py`, shape checked by `assert_contract_shape`; all 19 read |
| `find_sliced_file` raises | **no: 500, HTML page** | none (defect 3) |
| The stream of a `SlicedFile` fails while copied | **no: 500, HTML page** | store level only (defect 3) |
| A daemon acknowledges with an `error` that is not a string | **no: the team's status route answers 500** | none (defect 2) |
| A send body that is JSON but not an object | **no: 500** | none (defect 8) |
| `identify` raises | `delivery.not_paired`, whose sentence is false here | yes, but only the code is asserted (defect 11) |

Sentences and remedies read true and useful, with two exceptions: defect 11, and
`delivery.job_failed` for "download answered 404", whose remedy "Send the print again"
cannot help when the caller's file is gone (defect 6). `detail` keeps the original text
with the download token cut out; the same text beside it in `last_result.reason` is not
cut (defect 7).

Failures towards the daemon and the mentor are not error reports, as in the print branch:
daemon routes answer `{"error": ...}`, and `penguincam-printer` prints `error: ...` and
exits 1 or 2. Read in `daemon/penguin_delivery_daemon/__main__.py` lines 343 to 347:
`status` catches only `FileNotFoundError`, so a config file that is unreadable or not
valid TOML ends in a traceback. Hardening scope.

## 5. Upstream

| Point | Port phase |
|---|---|
| One pin | Met: `daemon/pyproject.toml` states the three versions, `install.sh` reads them from it, a test forbids them elsewhere. The test skips every `.json` file, and `daemon/tests/fixtures/h2s_status.json` names `bambulabs_api 2.6.6` (defect 12) |
| One command to move the pin | Not there; the guide says it comes with hardening. Nothing in the code makes it harder |
| Upstream check suite | Not there. `FakeBambuPrinter` carries the library's method names and return values by hand, and no test compares it with the installed library, though the library is in the development environment |
| One seam | Met: only `printer.py` imports the library, enforced by `test_only_printer_py_talks_to_the_printer_library` |
| Guide section | "Upstream" exists; "Taking a new upstream version" does not (hardening) |

The guide's claim for known fault 2 was checked against the pinned library
(`.venv/.../bambulabs_api/ftp_client.py` lines 87 to 99, `client.py` lines 340 to 347):
see defect 5.

## 6. Separation

- Imports: the daemon imports only itself, the standard library and its three pins
  (enforced by a test); the relay imports Flask, werkzeug and itsdangerous; nothing
  imports the slice service. Met.
- **Contracts' example files: no test in printer delivery reads anything under
  `contracts/examples/`** (`grep -rn "contracts\|examples"` over the component finds two
  docstrings). Defect 9.
- The guide lets a newcomer run the component alone: `make -C delivery together
  ARGS=--in-process` printed every state change and `PASS` in 0.4 s.
- `make test-parallel` runs 4 workers; the standing rules cap this machine at 2
  (defect 10).

## 7. Faithful

`diff` of the print branch against the port:

- `printer_relay.py` to `relay.py`: wording, the process-wide singleton removed, one new
  read (`held_job_id`). No logic changed.
- The five daemon modules: imports renamed, comments, and an injected `clock` in
  `discover`. No logic changed.
- `printer_routes.py` to `routes.py`: rewritten around `identify` and
  `find_sliced_file`. The order of checks on every route is the same as in the print
  branch (limit, HTTPS, token). Changes found, all named in the guide's "What was cut"
  table unless marked:
  - the forty-minute check applies only when the caller gives `sliced_at`;
  - the relay now serves the sliced file itself, only while it holds the job
    (**not stated**: in the print branch the download lived for an hour, so a second
    download after the acknowledgement worked; now it answers 404);
  - a stream is copied in full before the send is accepted or refused (**not stated** as
    a cost: ten refused sends a minute each copy the whole file);
  - **new and unstated: the window of defect 1**, which the print branch could not have
    because its files were never pruned by job.
- Tests: every test name of the print branch's `test_relay_client.py` is present in the
  port, and the port has more tests in every file (routes 56 to 68, relay state 68 to 83,
  run loop 42 to 57). `test_slice_daemon_contract.py` came across in part: the material
  test is in `test_daemon_printer.py`; the two tests that tied the plate number and the
  extension to the slicer's constants are replaced by literals (`'plate_number': 1`),
  tied to nothing in `contracts/` (defect 9).
- No module the component needs was left behind.

## Defects

1. **An accepted send can lose its sliced file.** `POST /printer/jobs` holds the file
   (`ctx.files.add`, `routes.py` line 209) and then claims the job (line 210). Every other
   request ends with `housekeeping()`, which drops every held file whose job the relay
   does not hold, and in that window this job is not held yet. The send still answers
   `202`; the daemon's download answers 404 and the job fails as `delivery.job_failed`.
   Any request triggers it: a status poll or a sync of any team.
   Evidence: probe
   `test_another_request_between_add_and_claim_does_not_lose_the_sliced_file` fails
   (`404 == 200`); probe
   `test_sends_racing_with_status_polls_on_real_threads_always_leave_a_download` lost
   3 of 150 sends with two polling threads. New in the port.
   Fixed when: holding the file and claiming the job cannot be separated by another
   request's housekeeping, a test drives a request into that window and the download
   still answers 200, and the eight-thread test also downloads the winner's file.

2. **One acknowledgement can break a team's status route for ten minutes.** The ack route
   stores `body.get('error')` whatever its type; the status route then calls
   `error_report(reason)`, and `pattern.fullmatch` raises `TypeError` on a number, a list
   or an object. Every poll answers 500 until `last_result` ages out.
   Evidence: probe
   `test_a_daemon_ack_with_a_non_string_error_does_not_break_the_status_route`:
   `TypeError: expected string or bytes-like object, got 'int'` at `errors.py` line 126.
   New in the port (the print branch passed the value through).
   Fixed when: a reason of any JSON type yields a 200 status with an error report, and a
   test acknowledges with a number, a list and an object.

3. **A caller function that fails reaches the page as a bare 500.** `find_sliced_file`
   raising, a send token the caller's function cannot handle, and a stream that fails
   while it is copied all answer `500 text/html`, with no error report. `identify` is
   guarded; these are not. Evidence: three probes
   (`..._find_sliced_file_that_raises_...`, `..._token_that_is_not_a_string_...`,
   `..._stream_that_fails_while_copied_...`) fail with `500 text/html`.
   Fixed when: each answers JSON with an error report whose code is in the guide, the
   exception text is kept in `detail` and the log, and each has a test.

4. **Nothing guards the one place a sliced file could cross teams.** The relay passes
   `team` to `find_sliced_file` and trusts the answer. The guide never says the caller
   must refuse a token that belongs to another team, the tests' `Caller.find_sliced_file`
   ignores `team`, and passing a different team survives all 475 tests. No test has two
   teams on one relay through the routes.
   Evidence: mutation `m2`, `475 passed`. The six two-team probes pass against today's
   code, so no leak exists now.
   Fixed when: the guide states the duty in the interface section, a test asserts the
   exact `Team` handed to `find_sliced_file`, and tests with two teams cover the status,
   the sync, the acknowledgement and the download (the probes can be taken as they are).

5. **The known faults are not cleanly fenced.**
   (a) `test_the_real_h2s_report_maps_to_running_with_the_archive_path_as_file` and
   `test_subtask_name_is_used_only_when_gcode_file_is_empty` in
   `daemon/tests/test_daemon_printer.py` pin fault 1 and carry no `known_fault` marker.
   (b) `FakePrinter.upload` returns `None` on success, unlike `PrinterLink.upload`, so
   checking the upload result (the fix for fault 2) fails 13 tests that have nothing to
   do with the fault.
   (c) The guide says the library "catches every FTPS failure and returns None". In
   `bambulabs_api` 2.6.6 only the transfer is inside the `try`; `connect` and `login` are
   outside it, so a refused connection or a wrong access code raises
   ("Exception occurred during file upload"), which the daemon already reports.
   Evidence: `faults.sh`: fixing fault 1 fails 5 tests (3 marked, 2 unmarked); fixing
   fault 2 fails 14 (1 marked). The marked tests do pin today's behaviour.
   Fixed when: every test that pins a fault is marked, the fake returns what the real
   link returns, and the guide's sentence matches the library.

6. **A send is accepted for a file that is not there.** A `SlicedFile` whose `path` does
   not exist answers `202`; the job fails seconds later as `delivery.job_failed`,
   `retryable: true`, remedy "Send the print again", which cannot help.
   Evidence: probe `test_a_path_sliced_file_that_does_not_exist_is_refused_at_the_send`.
   Fixed when: the send is refused with `delivery.sliced_file_missing`, or the later
   failure maps to a code whose remedy is to slice again.

7. **The download token can reach the caller's page and the log.** `detail` is redacted,
   but `last_result.reason` beside it and the relay's "acknowledged:" log line carry the
   daemon's text as sent. The daemon redacts before it sends, so this needs a daemon that
   does not. Evidence: probe
   `test_a_raw_reason_shown_to_the_caller_carries_no_download_token`.
   Fixed when: the relay redacts the reason where it stores it.

8. **A JSON body that is not an object is a 500** on `/printer/jobs`,
   `/printer/daemon/pair` and `/printer/daemon/jobs/<id>/ack`
   (`'list' object has no attribute 'get'`). Inherited from the print branch, not pinned.
   Evidence: five probe cases. Fixed when: each answers as an empty body does today, with
   a test.

9. **No test ties printer delivery to `contracts/`.** Nothing reads
   `contracts/examples/error-report.json` or `sliced-file.json`; the plate number and the
   `.gcode.3mf` extension are literals in the tests.
   Fixed when: a test checks the error-report example against the shape printer delivery
   emits, and one runs the sliced-file example's name through `suffixed_name` and both
   `strip_job_suffix` functions and checks plate 1 against the contract.

10. **`make test-parallel` uses 4 workers**, twice the cap in the standing rules, and the
    guide repeats it. Fixed when: the target and the guide say 2.

11. **A false sentence when `identify` raises.** The send is answered with
    `delivery.not_paired`: "No printer is paired with this team yet. Ask a mentor to pair
    the shop printer". The team may be paired; the caller could not read who was asking.
    Fixed when: this case has its own code and sentence (or `delivery.no_session`), and
    the test asserts the sentence.

12. **The one-pin test exempts every `.json` file**, and
    `daemon/tests/fixtures/h2s_status.json` names `bambulabs_api 2.6.6`. After an upgrade
    the fixture will name a version the component no longer uses.
    Fixed when: the fixture says "the pinned bambulabs_api" and the exemption is gone.

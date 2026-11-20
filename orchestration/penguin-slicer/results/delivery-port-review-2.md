# Printer delivery, port phase, review round 2

**Verdict: FIX, 1 defect.** All 12 defects of
[review round 1](delivery-port-review-1.md) are fixed at their cause, and each fix has a
test that fails when the fix is taken out. The hold-then-claim handling of sliced files
held up under every concurrency probe. The one defect is new, small, and was introduced by
the fix for round 1's defect 12: the fast suite now fails when any file that is not UTF-8
text sits in `delivery/daemon/` (a macOS `.DS_Store`, for example).

Reviewed Thu 11-19 18:30 PT against the working tree of
`/repos/popcornpenguins/penguin-slicer/delivery` (untracked, not yet committed). No file in
the repository was changed. Scratch files (scripts, probes, mutated copies, logs) are in
`/tmp/claude-1000/-repos-popcornpenguins/c507b106-b789-4d12-a830-1dcc19de2171/scratchpad/delivery-review-2/`.
Neither builder's result file was read.

One thing the coordinator should know that is outside printer delivery: another strand
changed `contracts/examples/error-report.json` at Thu 11-19 18:24 PT, during this review
(the example is now `slice.orca_too_close`). Printer delivery's fast suite passes against
both versions of the example: the 20 flake runs ended before the change, and the coverage
run, both `make` runs and every mutation run came after it.

## The 12 defects of round 1

Each row: what the code does now (read in the file named), and the mutation that takes the
fix out again in a scratch copy, with the tests that then fail (`mutate.sh`, `mutate2.sh`;
the unmutated copy passes 538).

| # | Round 1 defect | Fixed how | Fix removed, tests that fail |
|---|---|---|---|
| 1 | An accepted send can lose its sliced file | `sliced_files.py`: `add` marks the entry as waiting for its claim, `prune` skips such entries, the send ends the wait with `confirm` or `discard` in a `finally` (`routes.py` lines 239 to 256) | `prune` no longer skips: 2 fail, among them `test_another_request_between_holding_the_file_and_claiming_the_job_keeps_it`. Never `confirm`: 4 fail. Never `discard`: 4 fail. The eight-thread test now downloads the winner's bytes |
| 2 | A non-string ack reason breaks the status route | `errors.reason_text` turns any JSON value into one string where the ack route stores it; `error_report` also accepts a non-string | Reason stored as it arrived: 4 fail. `error_report` conversion removed: 3 fail |
| 3 | A caller function that fails is a bare 500 | `find_sliced_file` raising and a stream failing while copied answer `500` JSON with `delivery.sliced_file_unreadable`; a token that is not a non-empty string is never handed to the caller | Each `except` narrowed: 2 fail and 1 fails. Any truthy token handed over: 4 fail. Exception text dropped from `detail`: 3 fail |
| 4 | Nothing guards the team handed to `find_sliced_file` | Guide and `caller.py` state the caller's duty in bold; `test_relay_two_teams.py` (7 tests) and `caller.asked` pin the exact `Team` | A different team handed over: 7 fail |
| 5 | Known faults not cleanly fenced | All 8 pinning tests carry `known_fault`; `FakePrinter.upload` returns `'226 Transfer complete.'` as the real link does; the guide's sentence matches the library (read `ftp_client.py` lines 87 to 99: only the transfer is inside the `try`) | Fault 1 fixed: 5 fail, all marked. Fault 2 fixed: 1 fails, marked. No unmarked test fails |
| 6 | A send accepted for a file that is not there | `routes.py` line 233 refuses a `path` that is not a file with `delivery.sliced_file_missing` | Check removed: 1 fails |
| 7 | The download token can reach the page and the log | `reason_text` redacts where the reason is stored, so `last_result.reason`, the log line and the event carry no token | No redaction: 3 fail |
| 8 | A JSON body that is not an object is a 500 | `json_object()` on all four routes | Any truthy body returned: 7 fail |
| 9 | No test ties printer delivery to `contracts/` | `delivery/tests/test_contracts.py`: the error report's fields against `error-report.md` and the example, the sliced-file example's name through `suffixed_name` and both `strip_job_suffix` functions, plate 1 against `sliced-file.md` | Read; 7 tests, all pass |
| 10 | `make test-parallel` uses 4 workers | `Makefile` line 27 and the guide say 2 | Read |
| 11 | A false sentence when `identify` raises | Own code `delivery.identity_unreadable`, `401`, sentence and remedy asserted word for word | Falls through to `not_paired`: 2 fail |
| 12 | The one-pin test exempts `.json` files | The exemption is gone and the fixture says "the bambulabs_api pinned in delivery/daemon/pyproject.toml"; `grep` finds `2.6.6` only in `daemon/pyproject.toml` | Fixed, but the new test reads every file as UTF-8 text: the defect below |

All 19 probes written in round 1 now pass against the working tree (`19 passed`),
including the real-thread race that lost 3 of 150 sends in round 1: 0 of 150 now.

## 1. Flakes

`flake20.sh`: the fast suite 20 times with `-n 2 -p randomly --randomly-seed=<seed>`, seeds
7, 1913, 26011, 31337, 4242, 55501, 60606, 777, 8086, 90210, 11235, 123457, 1300013, 14142,
15926, 161803, 17, 180, 19937, 271828: **20 of 20 passed**, 538 tests each, no failure to
report. The real-time together tests (`make test-together`, outside the fast suite) passed
5 of 5.

Hold-then-claim under concurrency, probes in `probes/test_probes2.py`, all passing:

| Probe | Result |
|---|---|
| The daemon syncs, downloads and acknowledges after `claim_job` returned and before the send calls `confirm` (driven deterministically) | Download 200 with the right bytes, ack 200, nothing held and nothing in the spool once the send answered |
| 200 rounds on real threads: one send, a daemon thread that syncs, downloads and acknowledges as fast as it can, a status poller | 0 lost, 0 wrong bytes, 0 files or waiting entries left |
| 60 rounds on real threads: six sends of streams at once with a status poller | Every round exactly one `202`, its file downloadable, one file held, one in the spool, no waiting entry |
| A refused send | No entry, no waiting mark, empty spool |

Causes that have not bitten yet:

| Finding | Where | Risk |
|---|---|---|
| The one-pin test opens every file under `daemon/` as UTF-8 | `daemon/tests/test_daemon_install.py` line 155 | Real: the defect below |
| `tests/test_contracts.py` indexes the shared example by every field printer delivery emits (`ERROR_REPORT[field]`), so it needs the example to keep `where`, `where.stage` and `action` | `tests/test_contracts.py` lines 52 to 55 | Another strand that replaces the example with an equally valid one lacking `action` breaks printer delivery's fast suite with a `KeyError`. The example did change during this review and still has those fields. Low |
| With no `spool_dir`, two first sends at once each make a private temporary directory; one stays behind empty | `sliced_files.py` `_spool`, probe: 97 directories for 50 stores | One empty directory per process at most. Low |
| `test_it_parses_as_shell` skips when bash is missing | `daemon/tests/test_daemon_install.py` line 40 | A skip hides the check. Low, unchanged from round 1 |

The eight-thread test's barrier now aborts when a thread fails, so it cannot hang. `grep`
for `time.sleep`, `time.time(`, `time.monotonic`, `os.environ`, `expanduser`, `getcwd`,
`127.0.0.1`, `skip`, `xfail` over the component: hits only in defaults that every test
overrides, in `hardware_smoke.py` (never collected), in `together/__main__.py` (real-time
tests only), one `monkeypatch.setenv('TMPDIR', tmp_path)` and the bash skip above.

## 2. Speed

| Run | Wall time reported by pytest |
|---|---|
| Fast suite, 2 workers, 20 runs | 0.68 s to 2.12 s (the slow runs while the machine was shared) |
| `make test`, 1 worker | 0.86 s |
| Fast suite, 1 worker, under coverage | 2.16 s |

Slowest (1 worker, under coverage): 0.04 s
`test_ping_and_ack_each_have_sixty_a_minute`; 0.03 s
`test_the_status_limit_is_per_team_and_carries_an_error_report` and `test_rate_limited`;
0.02 s each for seven more (four rate-limit tests, three of `test_daemon_cli.py`); the
eight-thread test takes 0.01 s. **Nothing is over 0.2 s.** The two real-time tests take
1.4 s together.

## 3. Coverage

Measured with `coverage run -m pytest -m "not real_time" -p no:randomly` and the
component's own settings (`branch = true`), data file in the scratch folder.

| Module | Cover | Uncovered |
|---|---|---|
| `relay/.../relay.py`, `errors.py`, `limits.py`, `caller.py`, `app.py`, `sliced_files.py` | 100% | none |
| `relay/.../routes.py` | 99% | `74->exit` (an event with no `on_event`) |
| `daemon/.../run_loop.py` | 99% | 57, `272->275`, 347 |
| `daemon/.../relay_client.py` | 99% | `170->172` |
| `daemon/.../config.py` | 97% | `86->93`, 106-107 |
| `daemon/.../printer.py` | 97% | 205-206, 300-302 |
| `daemon/.../__main__.py` | 99% | 285-286, 424 |
| `together/__main__.py` | 28% | the run itself (covered by the real-time tests) |
| `together/stand_in.py` | 90% | 29, 32, 35 |

Uncovered failure paths are the daemon's, unchanged from round 1 and inherited:
`run_loop.py` `272->275` (a job that raises after it was acknowledged) and 347 (the
printer reports the file in a state that is neither accepted nor an error), `config.py`
106-107, `__main__.py` 285-286, `printer.py` 205-206 (the real `import bambulabs_api`) and
300-302. Every new line of the fixes is covered, and the relay has no uncovered failure
path.

**Ten failure-path tests sampled** (all new or changed in this round). Nine assert what the
caller sees: `test_an_identify_that_raises_is_refused_as_unreadable_not_as_unpaired`
(status, text, code, sentence, remedy, detail, log, and that the caller was not asked),
`test_a_find_sliced_file_that_raises_is_an_error_report_not_a_500_page`,
`test_a_stream_that_fails_while_copied_is_an_error_report_and_leaves_nothing` (also the
spool and the job), `test_a_path_that_is_not_a_file_is_refused_at_the_send`,
`test_another_request_between_holding_the_file_and_claiming_the_job_keeps_it` (downloads
the bytes), `test_only_one_of_many_simultaneous_sends_wins` (downloads the winner's bytes,
counts held files), `test_an_ack_error_of_any_json_type_leaves_the_status_route_working`,
`test_the_reason_is_stored_logged_and_reported_without_the_download_token`,
`test_a_send_of_another_teams_token_is_refused_and_holds_nothing`. One asserts little:
`test_a_claim_that_raises_leaves_no_file_behind` checks only the status 500 and the
cleanup, which is its purpose (the relay's own state failing, simulated).

**Mutation by hand: 23 mutations, 23 caught.** The 17 that take a round 1 fix out are in
the table above. Six more on other checks: the forty-minute boundary moved (1 fails), no
housekeeping before a download (1), a vanished caller file not checked at the download
(2), a rate-limited caller route without its error report (2), a refused claim without its
error report (10), `exception_text` keeping every line of an exception (1).

## 4. Error reports

The guide's table and `errors.py` name the same 21 codes (`diff` of the two lists: equal).
The two new ones:

| Code | Sentence and remedy | Verdict |
|---|---|---|
| `delivery.identity_unreadable` (401, not retryable) | "The printer service could not read which team sent this print." / "Sign in again, then send the print once more." | True; the remedy helps when the cause is a stale sign-in, which is the case the code was written for. `detail` and the log name the exception. Tested in `test_relay_errors.py` and `test_relay_routes.py` |
| `delivery.sliced_file_unreadable` (500 JSON, retryable) | "The printer service could not read the sliced file for this print." / "Send the print again in a moment, and slice the plate again if it fails twice." | True and useful; a second send asks the caller for the file afresh. `detail` names the exception, one line, at most 200 characters, download tokens cut out. Tested for both causes |

Neither new text can be shadowed by an earlier rule, and neither shadows a later one
(`test_every_rule_is_reachable_and_produces_the_contract_shape`).

Failures that still escape as a bare `500 text/html`, found with probes
(`probes/test_probes2.py`, 10 failing cases). All need a caller function that returns the
wrong type rather than one that raises, so they are a programming error in the caller that
shows on its first request; they are **not counted as defects** and are listed for the
hardening phase:

- `find_sliced_file` returns something that is not a `SlicedFile` (a path string, a
  dictionary, a number): `AttributeError` at `routes.py` line 233.
- `SlicedFile.sliced_at` is not a number: `TypeError` at line 236.
- `identify` returns something that is not a `Team`: `AttributeError` in `team_code`, on
  the status route as well as the send.

Other observations, not defects:

- The line logged when `identify` raises (`routes.py` line 132) prints the exception as it
  is, every line of it, where the response uses `exception_text` (one line, 200
  characters, tokens cut out).
- The exception text of the caller's function is also in the `error` text beside the error
  report, which is the text a page showed before error reports existed. A page should show
  `error_report.message`.
- Failures towards the daemon and the mentor are still not error reports, as in the print
  branch (round 1, hardening scope).
- The relay never sweeps its spool directory: after a restart with a job in flight, the
  relay's copy of that sliced file stays on disk for ever (read in `sliced_files.py`: no
  code looks at the directory's contents). New in the port, belongs to the hardening
  check on cleanup after a crash.

## 5. Upstream

| Point | Port phase |
|---|---|
| One pin | Met. `2.6.6` appears in `daemon/pyproject.toml` and nowhere else in the component outside `uv.lock`; the fixture no longer names it; the test covers every file (and over-reaches: the defect below) |
| One command to move the pin | Not there; the guide's "Taking a new upstream version" gives the steps by hand. Nothing in the code makes it harder |
| Upstream check suite | Not there. The guide now says plainly that the fakes carry the library's behaviour as written down and that the hardware smoke test is the only one that runs the real library |
| One seam | Met: only `printer.py` imports the library, enforced by a test |
| Guide section | Present, seven steps, names every call and status field the seam relies on |

## 6. Separation

- Imports: the daemon imports itself, the standard library and its three pins (test); the
  relay imports Flask, itsdangerous and werkzeug (Flask's own dependency, not declared in
  `relay/pyproject.toml`); nothing imports the slice service.
- Contracts' example files are read by `tests/test_contracts.py` (see the coupling noted
  under check 1).
- A newcomer can run the component alone: `make -C delivery test` (538 passed in 0.86 s),
  `make -C delivery test-parallel` (538 passed, 2 workers), `make -C delivery together
  ARGS=--in-process` printed every state change and `PASS`.

## 7. Faithful

- `diff` of the print branch's six daemon modules and `printer_relay.py` against the port:
  imports renamed, comments, the injected `clock` in `discover`, the singleton removed and
  one new read (`held_job_id`). No logic changed, in this round or the last.
- `routes.py` against the print branch's `printer_routes.py`, route by route: the order of
  checks is the same (limit, HTTPS, token; limit, identity, code). Every difference in
  behaviour is one that round 1 asked for, and the module's docstring and the guide name
  them: an error report beside each failure, `401 identity_unreadable` where `identify`
  raises on a send (was `409 No printer paired`), `404` for a `path` that is not a file
  (was `202`), `404` for a token that is not a non-empty string, a body that is not an
  object answering as an empty body (was `500`), the ack reason stored as one redacted
  string. A falsy ack reason is still stored as none, and a sync body that is not an
  object still reads as no snapshot.
- The guide's "What was cut" table now states the two changes round 1 found unstated: the
  download lives only while the job is held, and a stream is copied before the send is
  decided.
- No test of the print branch was dropped in this round: the suite grew from 475 to 538.
- One stale comment: `printer.py` lines 45 to 49 say the sliced-file contract will pin the
  plate number "once it is written"; it is written and `test_contracts.py` pins it.

## Defects

1. **A file that is not UTF-8 text anywhere under `delivery/daemon/` fails the fast
   suite.** `test_no_other_file_of_the_daemon_states_an_upstream_version`
   (`daemon/tests/test_daemon_install.py` lines 155 to 173) walks the whole folder and
   opens every file with `encoding='utf-8'`, skipping only `__pycache__`. macOS Finder
   writes a binary `.DS_Store` into any folder it shows (the repository's `.gitignore`
   already lists it), and an editor's swap file or a compiled file outside `__pycache__`
   does the same. So `make test` passes or fails with what the machine left in the
   folder, with a message that names neither the file's purpose nor the rule. Introduced
   by the fix for round 1's defect 12.
   Evidence: `dsstore.sh` copies the component, adds a 15-byte `daemon/.DS_Store` and runs
   the fast suite: `1 failed, 537 passed`, `UnicodeDecodeError: 'utf-8' codec can't decode
   byte 0xff in position 8` in that test.
   Fixed when: the test still covers every tracked text file of the daemon, fixtures
   included, and a file that is not text (or not part of the daemon's source) can neither
   fail it nor be silently trusted to hide a version; and a test puts such a file in a
   copy of the folder and shows the check still passes.

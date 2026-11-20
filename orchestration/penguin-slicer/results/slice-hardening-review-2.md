# Review: slice service, hardening phase, round 2

**Verdict: FIX, 6 defects.** Two matter to a student or to whoever supports one (1 and 2);
four are small.

Reviewed Thu 11-19 20:13 to 20:36 PT against [review.md](../briefs/review.md),
[standing-rules.md](../briefs/standing-rules.md),
[slice-hardening.md](../briefs/slice-hardening.md) and [upstream.md](../briefs/upstream.md),
with the coordinator's ruling in place of requirement 7: the memory estimate refuses
nothing, the memory watchdog is the guard, and `slice.out_of_memory` after a kill needs a
watchdog stop or a rise in the kernel's out-of-memory kill count. The work under review is
the uncommitted change under `slice/` and `contracts/` in
`/repos/popcornpenguins/penguin-slicer` (committed port: `c2c9a3c`). I read
[slice-hardening-review-1.md](slice-hardening-review-1.md); I did not read the builders'
result files. No file in the repository was changed.

What holds: the 14 defects of round 1 are fixed as far as I could reach them. With the real
Orca, a watchdog stop, a cancel, a timeout, an outside SIGKILL and a crash each end in
their own truthful error report, with no Orca process and no file left. The fast suite
passed 40 of 40 runs in random order on 2 workers (5.6 s wall serial, 4.3 s on 2 workers),
and the tests that race a process's exit passed 100 of 100. What does not hold: the watchdog reads Orca's memory four times a
second, and the pinned Orca's peak is a spike shorter than that, so the watchdog misses it
more often than not.

The probes are scratch files in
`/tmp/claude-1000/-repos-popcornpenguins/c507b106-b789-4d12-a830-1dcc19de2171/scratchpad/slice-hreview-2/`:
`probe_real.py` with `real.sh`, `real_batch.sh` and `real_vary.sh` (real Orca through the
HTTP face, one Orca at a time), `probe_serve.py` (the HTTP face as a real server),
`fast/test_probe.py`, `fast/test_probe2.py` and `fast/test_probe3.py` (the stand-in for
Orca), `mutate.py`, `flakes.sh`, `races.sh`.

## Check 1: flakes

- `flakes.sh`: 40 runs of `pytest -q -n 2 --randomly-seed=<fresh>` on `slice/tests`.
  **40 passed, 0 failed**, 729 tests each, 3.01 to 3.83 s as pytest reports it. Seeds are
  in `flakes.log`.
- `races.sh`: the six files whose tests wait on a real process (`test_orca_runner.py`,
  `test_cli.py`, `test_web.py`, `test_jobs.py`, `test_errors.py`, `test_service.py`), 100
  runs on 2 workers, a fresh seed each. **100 passed, 0 failed**, 309 tests each, 2.1 to
  3.4 s. Seeds are in `races.log`.
- The test that flaked in round 1, `test_orca_does_not_outlive_a_service_that_is_killed`:
  its helper `alive()` now treats any `OSError` from the `/proc` read as "gone", and its
  cleanup kills the stand-in only while it still holds its lock, so a reused process id is
  never hit. It ran in all 140 runs above.
- Hunt for causes that have not bitten: no `sleep(` in `tests/`; no fixed port; no path
  outside `tmp_path`; the timeout's timer is replaced for every test (`conftest.py`,
  `timers`), and so are the kernel's out-of-memory kill count and the watchdog's reader
  (`machine`), so no test reads this machine's memory while the stand-in runs. One test
  reads the real `/proc` (`test_the_reader_reads_this_machines_process_table`); it asserts
  only that this process group has memory, which cannot vary.
- Two tests cannot fail, only hang: defect 3.
- One stand-in child process from an older run (`pytest-661`,
  `test_a_child_orca_leaves_behin0`, process 102887) was alive on the machine before I
  started and is not mine. None of my 140 runs left a process. The two mutation runs that
  hung (defect 3) left five, which I stopped.

## Check 2: speed

`make test` (serial): 729 passed, **5.6 s wall** (5.30 s as pytest reports it).
`make test-parallel` (2 workers): **4.3 s wall** (3.0 to 3.8 s as pytest reports it in the
40 runs). No test waits on the clock. Over 0.2 s, measured under coverage:
`test_a_good_file_with_bytes_changed` 0.31 s and `test_any_coordinates_in_one_triangle`
0.28 s (Hypothesis), `test_a_dense_part_at_the_triangle_limit_is_read` 0.30 s (150,000
triangles). Next: `TestMeasurePlate::test_measure_reports_a_row_through_the_slice` 0.17 s,
then everything under 0.13 s. Not a defect.

The real-Orca suite: 27 passed in 10.8 s.

## Check 3: coverage and mutation

Branch coverage measured by me (`coverage run`, data file in scratch): **100 % of 1,833
statements and 466 branches in all 13 modules**; the one exclusion is
`slicer._child_setup`, which runs between fork and exec.

Hand mutations in scratch copies (`mutate.py`), the fast suite on each:

| Mutation | Result |
|---|---|
| N1 the watchdog never stops Orca | **the suite hung** past 120 s (defect 3) |
| N2 a rise in the kernel's count no longer means out of memory | 3 tests fail |
| N3 any SIGKILL is out of memory again | 6 tests fail |
| N4 a watchdog stop is reported as a cancel | 6 tests fail |
| N5 a stop set after Orca's own exit counts as a stop | **not noticed** (defect 4) |
| N6 the last stop reason wins over the first | **not noticed** (defect 4) |
| N7 exit 127 is the plate's fault again | 4 tests fail |
| N8 Orca's words for no layers are ignored | 8 tests fail |
| N9 one copy out of memory is told to remove copies | 1 test fails |
| N10 SIGTERM no longer stops `serve` and `slice` cleanly | 2 tests fail |
| N11 a surface that encloses nothing is accepted | 3 tests fail |
| N12 exit 137 of a wrapper is a plain failure | 2 tests fail |
| N13 the watchdog sums every process on the machine | 2 tests fail |
| N14 the watchdog's reported peak is its last sample, not its highest | not noticed (harmless: the stop comes at the first sample over the ceiling) |
| N15 a sliced file gone from the disk is a bare error | 2 tests fail |
| N16 Flask's own errors are not error reports | 5 tests fail |
| N17 the watchdog keeps sampling after its own stop | 1 test fails |
| N18 a text file over 84 bytes is "cut off" again | 5 tests fail |
| N19 a cancel no longer wins over a slice that finishes | 1 test fails |
| N20 the ceiling setting is ignored | **the suite hung** past 120 s (defect 3) |

Ten failure-path tests sampled (`TestSignals`, `TestMemoryWatchdog`, `TestOrcaExits`,
`TestEveryAnswerIsAnErrorReport`, `test_serve_stopped_by_a_signal_shuts_its_pool_down`):
each asserts the code, the sentence or the detail the caller sees, and the state of the
process; none only executes a line.

## Check 4: error reports

The 43 codes in `errors.CODES` equal the 43 code rows in `slice/README.md`. The codes new
since round 1, judged on sentence, remedy and truth:

| Code | Sentence and remedy | Verdict |
|---|---|---|
| `slice.orca_killed` | "Something on the print server stopped the slicer before it finished." / "Slice again; if it fails again, ask a mentor to check the print server." Retryable. | True and useful. Seen with the real Orca killed from outside, early and late in a slice. |
| `slice.no_layers` | "The slicer found no layers to print: a part's surface may have holes, or a part may be too thin to slice." / "Repair the part in CAD so it is a closed solid, check its size and thickness, export it again and slice again." | True; the remedy can help. Orca's wording is pinned in the real-Orca suite. |
| `slice.print_empty` | "The slicer found nothing it can print with these settings: a part may be thinner than the nozzle can print." / "Check the part's size and units, make thin features thicker than the nozzle, and slice again." | True; the remedy can help. |
| `slice.file_gone` | "The sliced file is no longer on the print server." / "Send the slice again." HTTP 410. | True. |
| `slice.bad_request` | "The print server does not offer GET /nothing." / "Ask a mentor to check the program that sent this request; the print server does not offer it." | True for 404 and 405, the only statuses I could make Flask raise. |
| `slice.out_of_memory` after a watchdog stop | "This plate is too large to slice: the slicer needed more than the 300 MB of memory the print server allows." / "Remove some copies or the largest part and print them in a second job."; on one copy "Split the part in CAD into smaller pieces, or simplify it, and slice again." with no action | True when it is given. Not always given when it is true: defect 1. |

Failures that do not reach the caller as a truthful error report, or do not reach the log:

- A plate job refused when it arrives leaves no log line (defect 2).
- A full disk while an upload is saved: "The slicer failed unexpectedly." (defect 5).
- A PDF, a JPEG or UTF-16 text sent as an STL: "cut off before its end"; an ASCII STL in
  capitals or with a byte-order mark: "is not an STL file" (defect 6).
- Not from the app, so not counted: a request line that is not HTTP, or a 70,000-byte
  path, is answered in HTML by Python's own development server before Flask sees it.
  `serve --work <a file>` ends at start with a `FileExistsError` traceback, which an
  operator can read.

## Check 5: upstream

- **One pin:** `ORCA_VERSION="2.4.2"` and three `SHA_` lines in `scripts/install-orca.sh`;
  tests read it through `helpers.pinned_orca_version()`.
- **One seam:** Orca is started only in `slicer.py`.
- **Upgrade command:** `make upgrade-orca VERSION=x.y.z`. Round 1's defect 12 is fixed in
  the code: the new release is installed and verified in `tools/orca.next` by a staged copy
  of the installer before the pin or `tools/orca` is touched, the old one is kept as
  `tools/orca.previous` until the upstream check passes, and the guide has "Going back". I
  read the script and its tests; I did not run a real upgrade (it rewrites repository
  files).
- **Upstream check:** 27 tests, each with a "Protects:" line, all passing, now including
  Orca's two wordings for nothing to slice, exit 127, and a watchdog stop at 100 MB. Left
  unprotected: how fast the real Orca's memory rises against the watchdog's cadence
  (defect 1; the 100 MB test stops a slice that passes 200 MB, which no cadence could
  miss), and a real kernel out-of-memory kill (not possible here: the cgroup is not ours).
- **Patches:** one proposed, unbuilt patch note; the command stops when a patch file
  exists instead of applying it, and the guide now says so "for the owner to accept".
- **Guide section:** present, with the steps, what to read in the diff and how to go back.
  It records no run of the upgrade command to another version and back. I cannot see
  whether the builder's result file records one; the coordinator should confirm it, since
  [upstream.md](../briefs/upstream.md) asks for the proof or a statement of what was
  verified instead.

## Check 6: separation

`tests/test_independence.py` passes; `tests/test_contracts.py` checks the contracts'
examples and tables; the real-Orca suite reproduces the example error report. The guide
lets a newcomer install, test and run the slice service alone.

## Check 8: hostile cases

Every case in the hardening brief has a test (round 1 found the same; the corpus now also
holds an HTML error page and coincident triangles, and mutations N11 and N18 fail on
them).

**The watchdog with the real Orca** (`real.sh`, `real_vary.sh`; hubs from
`scripts/measure_plate.py`). "Watchdog peak" is the highest sample the watchdog took;
"Orca's peak" is the kernel's `ru_maxrss`.

| Plate | Ceiling | Outcome | Watchdog peak (kB) | Orca's peak (kB) |
|---|---|---|---|---|
| 12 hubs of 20,000 triangles | 900 MB | done in 5.1 s | 388,096 | 455,084 |
| the same | 300 MB | `slice.out_of_memory` at 4.6 s of a 4.8 s slice | 422,072 | 460,780 |
| the same, four runs | 420 MB (430,080 kB) | done, four times | 371,588 to 412,628 | 440,244 to 455,688 |
| the same, six runs | 400 MB (409,600 kB) | **done four times, `slice.out_of_memory` twice** | 380,448 to 444,380 | 437,260 to 452,084 |
| 25 hubs of 20,000 triangles | 900 MB | done in 10.0 s | 625,088 | 835,068 |
| the same | 700 MB (716,800 kB) | **done** | 678,916 | 844,292 |

- A stop is clean and truthful. At 300 MB: state `failed`, "This plate is too large to
  slice: the slicer needed more than the 300 MB of memory the print server allows.",
  detail "stopped by the slice service (memory) with SIGTERM after 4.591 s: Orca's
  processes reached 422,072 kB resident, over the ceiling of 307,200 kB
  (PENGUIN_SLICE_MAX_PEAK_MB=300); Orca's own peak 460,780 kB", the log line with
  `error_code`, `orca_reason` "stopped at the memory ceiling" and `peak_rss_kb`; no Orca
  process at the moment of the final report; the job's folder gone; `GET .../file` answers
  409 with the same error report.
- A plate under the ceiling is not stopped: 25 hubs peak at 835,068 kB under 921,600 kB
  and are delivered.
- Child processes: the reader sums Orca's process group, and the installed wrapper
  `exec`s Orca, so there is one process. A child that left the group would be missed by
  the reader and by the cleanup alike; the pinned Orca starts none.
- A fast spike between samples is missed, on every plate I ran: defect 1. My own trace of
  the 25-hub slice every 20 ms shows why: resident memory 664,412 kB at 9.44 s, 835,944 kB
  at 9.53 s, 653,672 kB at 9.55 s. The kernel's high-water mark for the process (`VmHWM`)
  held 844,292 kB from then on, equal to `ru_maxrss`.
- I found no way for the watchdog to stop a slice wrongly: it reads only Orca's group, and
  a reading taken as Orca exits is dropped when the exit is noticed first.

**Which ending is reported** (real Orca, 12 hubs, through the HTTP face):

| What happened | Error report | Orca left | Files left |
|---|---|---|---|
| `DELETE` at "Generating walls" | state `cancelled`; log `cancelling` then `cancelled` | none | none |
| SIGKILL from outside at "Generating walls" | `slice.orca_killed`, retryable, "ended by signal 9 (SIGKILL), not sent by the slice service; the kernel's oom_kill count did not change" | none | none |
| SIGKILL from outside while exporting (resident memory near its peak) | the same | none | none |
| SIGSEGV | `slice.orca_crashed`, "ended by signal 11 (SIGSEGV), not sent by the slice service" | none | none |
| Timeout (timer at 1.5 s) | `slice.timeout`, "stopped by the slice service (timeout) with SIGTERM after 1.509 s" | none | none |
| Watchdog stop (ceiling 300 MB) | `slice.out_of_memory`, as above | none | none |

**Two endings close together** (the stand-in, `fast/test_probe.py`):

| Case | What the caller sees | Verdict |
|---|---|---|
| The watchdog trips, Orca ignores SIGTERM, a `DELETE` arrives in the grace time | `DELETE` answers `cancelling`; the final report is `failed`, `slice.out_of_memory`; the log line carries both `error_code` and `cancel_reason` | True (memory came first). The guide says a running job "is reported `cancelled`"; it should say "or `failed`, if it had already failed". Not a defect. |
| A `DELETE` arrives, Orca ignores SIGTERM, the watchdog reads over the ceiling in the grace time | `cancelled` | Right. |
| Orca crashes, finishes, is killed from outside or refuses the plate, and the timeout fires before the slice service has noticed the exit | `slice.timeout`, "stopped by the slice service (timeout) with SIGTERM", for all four; the sliced file Orca finished is thrown away | Defect 4. |
| The same with a watchdog reading delivered after the exit | `slice.out_of_memory`, "stopped ... with SIGTERM" | Defect 4. |

**My own bad files** (`fast/test_probe.py`, checks only):

| File | Answer | Verdict |
|---|---|---|
| STEP text, OBJ text, gzip of an STL | `slice.part_unreadable`, "is not an STL file" | true |
| PDF (1,075 bytes), JPEG (2,060 bytes), UTF-16 HTML error page (446 bytes) | "The file for Box is cut off before its end." | false sentence, defect 6 |
| ASCII STL in capitals; ASCII STL with a byte-order mark | "The file for Box is not an STL file." | false sentence, defect 6 |
| binary STL whose header starts "solid" | read | right |
| box with one triangle wound the other way; hollow box (a cavity wound inwards); box 5 m below the plate | read, no warning | right |
| box plus 4 bytes; box minus 1 byte | "extra data after its last triangle"; "cut off before its end" | true |
| box 0.11 mm | read, warning "is only 0.11 x 0.11 x 0.11 mm; if it was drawn in inches..." | right (Orca then gives `slice.print_empty`) |
| box 480 x 1 x 1 mm | `slice.part_too_large` with both sizes | true |
| box 400 x 5 x 5 mm placed square | `slice.placement_off_plate` | true (it fits only on the diagonal) |
| a solid plus an equal inside-out solid | "a surface folded onto itself that encloses nothing" | not what it is; too contrived to count |

Part names as input (`fast/test_probe3.py`): a newline, 100,000 characters, `../../etc/passwd`
and a right-to-left override all give a safe delivered file name of at most 64 characters.
A part named `bad_alloc` whose slice fails with empty layers is reported
`slice.out_of_memory`, because Orca's reason carries the part's name and the pattern for an
allocation failure is searched in it. Too contrived to count; searching Orca's output
without its warnings would close it.

**The HTTP face** (`fast/test_probe.py`, `probe_serve.py`): a JSON body, raw bytes,
multipart with no boundary or cut short, a `plate_job` that is a list, `null`, or nested
100,000 deep, an upload named `..`, an `stl` of `.` or `/etc/passwd`, an unknown job on
every route, `PATCH`, `POST` on the file route, a 5,000-character job id, a zero byte in
the job id, a removed work folder: each answers with an error report whose sentence is
true and a status from the guide's list. Two that are off:

- A `plate_job` field of 600 kB, or 1,200 form fields: 413, "This plate job is too large to
  receive.", detail "over 188,550,676 bytes". The sentence is true; the detail is not (the
  limit met is Werkzeug's 500 kB for form fields, or 1,000 parts). No honest client
  reaches it. Not counted.
- `GET /slices/<job>/events` for a job whose record expires between the route's check and
  the stream's start: 200 with an empty stream. A window of microseconds. Not counted.

As a real server with the stand-in hanging: a stream client that vanished did not disturb
the job; SIGTERM ended `serve` with exit 0, the log lines `cancelling` and `cancelled`
(reason `shutdown`), no stand-in process and an empty work folder.

**The command line** (`fast/test_probe2.py`): SIGINT, SIGTERM, SIGINT twice, and SIGINT
then SIGTERM against an Orca that ignores SIGTERM each print the `slice.cancelled` error
report and exit 1 with the output folder empty (the last after the 5 s grace time). A
missing plate job, a folder as the plate job, and an `--out` that is a file, under a file,
or under `/proc` each print an error report. SIGHUP is not handled: the process dies, the
scratch folder stays until the next slice into the same `--out`. Not counted.

## Check 9: cancellation and cleanup

Verified in the process table and on disk, real Orca: the six rows of "Which ending is
reported" above. After each, the job's folder was gone and no process named the work
folder at the moment the final report was read; the slot was free (each probe's pool shut
down at once). Round 1's rerun of the same plate job after a cancel and a timeout I did
not repeat; the fast suite's tests for it pass.

## Check 10: progress

Real Orca, 12 hubs: `building_plate` (no fraction), `slicing` (no fraction, 0.07 s before
Orca's first message), then Orca's own stages with fractions 0.01, 0.03, 0.06, 0.07,
0.16, 0.25, 0.34, 0.48, 0.66, 0.7, 0.75, 0.94, 0.97, 1.0, then `reading_result` (no
fraction) and `done`. Every fraction is Orca's `total_percent / 100`. `expected_s` was
7.3 for a slice of 5.1 s, and 14.2 for the 25 hubs' slice of 10.0 s; it is an expectation
and is named one. Nothing followed a final report in any run; `cancelled` came only with
no Orca left.

## Defects, most serious first

1. **The watchdog misses Orca's peak, so one plate job gets two answers and the ceiling
   is not held.** The pinned Orca's memory peaks in spikes of under 0.1 s near the end of
   a slice; the watchdog reads the current resident memory every 0.25 s. Evidence, table
   in check 8: the same 12 hubs at a ceiling of 400 MB were delivered four times and
   refused twice with "This plate is too large to slice" (not retryable, action
   `lower_quantities`), while Orca's peak was over the ceiling in all six runs (437,260 to
   452,084 kB against 409,600 kB); 25 hubs at a ceiling of 700 MB were delivered with a
   peak of 844,292 kB, 124 MB over, the watchdog having seen 678,916 kB. In every run that
   was not stopped the watchdog's peak was 9 to 25 % under Orca's. The guide says a plate
   "can still pass the ceiling briefly"; the contract says the slice service "stops Orca"
   when memory passes the ceiling. In effect the ceiling is soft by about a fifth, and a
   plate within that band is refused or delivered by chance, with a report that tells the
   student not to retry. **A real defect:** it misleads a student near the ceiling and
   lets Orca use more than the setting allows. **Fixed when:** the watchdog reads the
   kernel's high-water mark of each process in the group (`VmHWM` in
   `/proc/<pid>/status`, which equalled `ru_maxrss` in my trace) instead of the current
   figure, so no spike before a sample is missed; the coordinator rules what happens when
   `ru_maxrss` at exit is over the ceiling though no sample was (deliver, or refuse); six
   runs of one plate at a ceiling 5 % under its peak give one verdict; a real-Orca test
   pins that; the guide and the contract state what is guaranteed.

2. **A plate job refused when it arrives leaves nothing in the server log.** Three
   refusals through the HTTP face (an HTML error page as the STL, an empty STL, a
   `plate_job` that is not JSON) answered 422, 422 and 400 and produced no log line
   (`fast/test_probe2.py`, `test_log_of_refused_plate_jobs`). `web.py`'s `submit` catches
   every exception and answers without calling `log`; only a job that was queued is
   logged. The bad STL, the owner's named case, is always refused at this point, so the
   server log cannot answer "why was my slice refused". The same path hides the server's
   own failure: a full disk while an upload is saved answers 500 with no log line.
   **A real defect:** it hides a failure from the one place support looks. **Fixed
   when:** every refused submission writes one log line with the error code, the detail,
   and the part names and file sizes it had; a test asserts it for a refused part and for
   a failed save.

3. **The watchdog's tests hang the suite instead of failing, and leave processes.** With the
   watchdog's stop removed (N1) or the ceiling setting ignored (N20) the fast suite ran
   past 120 s and left pytest workers and stand-in Orcas behind.
   `TestMemoryWatchdog::test_orca_past_the_ceiling_is_stopped_and_reported_out_of_memory`,
   `test_the_ceiling_is_the_setting` and the `over_the_memory_ceiling` scene of
   `test_errors.py` run a stand-in that waits for a signal and call the slice without the
   `bounded` helper their neighbours use. This is round 1's defect 13 again, in the tests
   written since. **A real defect:** a regression in the watchdog would hang the suite.
   **Fixed when:** each fails within `FAILSAFE_S` under N1 and N20 and kills its stand-in.

4. **A stop that arrives just after Orca ended by itself is reported as the stop.**
   `run_process` decides `stopped` from whether its waiter thread has noted the exit, not
   from how Orca ended. With that note held back (`fast/test_probe.py`,
   `test_timeout_as_orca_ends_on_its_own`): an Orca that crashed, one that was killed from
   outside, one that refused the plate ("Some objects are too close together") and one
   that finished and wrote its sliced file were each reported `slice.timeout`, "stopped by
   the slice service (timeout) with SIGTERM"; the finished sliced file was discarded. The
   same holds for a watchdog reading (`slice.out_of_memory`, "stopped ... with SIGTERM").
   Mutations N5 and N6 survive, so no test fixes the order of a stop and an exit, or which
   of two stops is reported. **A real defect, but a rare one:** the window is the time
   between Orca's death and one thread waking, well under a millisecond without my delay,
   and for the timeout it must fall at second 240. **Fixed when:** a stop counts only if
   Orca was still running when it was signalled (a `waitid` with `WNOHANG` and `WNOWAIT`
   before the SIGTERM, or the exit status compared with the signal sent), with tests for
   the four cases and for a cancel after a watchdog stop.

5. **A full disk while an upload is saved is "The slicer failed unexpectedly."**
   `FileStorage.save` raising `OSError(28, "No space left on device")` answers 500
   `slice.unexpected` with the remedy "Slice again; if it fails again, ask a mentor to
   check the print server." The same cause during a slice is `slice.scratch_unwritable`,
   "The print server could not write the slicer's working files.", with the remedy naming
   free disk space. The slicer had not started. **A small real defect:** a wrong sentence
   for a failure the brief names. **Fixed when:** an `OSError` while saving an upload is
   `slice.scratch_unwritable`, with a test.

6. **Three kinds of file get a sentence that is false.** A PDF, a JPEG and a UTF-16 text
   file of 84 bytes or more are told "The file for Box is cut off before its end" (their
   bytes 80 to 84 read as a triangle count in the hundreds of millions). An ASCII STL
   written in capitals, or one that starts with a byte-order mark, is told "is not an STL
   file" instead of "is a text STL; the slicer needs a binary STL". The remedy ("Export
   the part again and send a new slice") still helps in every case, and Onshape sends
   none of these. **A small real defect:** a false sentence, harmless remedy. **Fixed
   when:** a file whose header count implies more bytes than `MAX_PART_BYTES` and whose
   size is far from it is "not an STL file"; the ASCII test ignores case and a byte-order
   mark; the corpus holds one of each.

## Not defects, for the record

- A cancel that arrives after a watchdog stop or a timeout ends `failed`, not
  `cancelled`, although `DELETE` answered `cancelling`. True; one sentence in the guide
  would cover it.
- The 413 detail for an oversized form field, the empty stream for a job that expires
  under it, SIGHUP on the command line, the traceback of `serve --work <a file>`, and HTML
  answers from Python's development server below Flask.
- A part named `bad_alloc`; a solid paired with an equal inside-out solid.
- Mutation N14 (the reported watchdog peak) is not pinned by a test.
- Whether a run of the upgrade command to another version and back is recorded: not in
  the guide; to be confirmed against the builder's result file.

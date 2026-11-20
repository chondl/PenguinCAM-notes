# Review: slice service, hardening phase, round 1

**Verdict: FIX, 14 defects.**

Reviewed Thu 11-19 19:27 to 19:42 PT against [review.md](../briefs/review.md),
[standing-rules.md](../briefs/standing-rules.md), [slice-hardening.md](../briefs/slice-hardening.md)
and [upstream.md](../briefs/upstream.md). The work under review is the uncommitted change
under `slice/` and `contracts/` in `/repos/popcornpenguins/penguin-slicer` (committed port:
`c2c9a3c`). The builder's result file was not read. No file in the repository was changed.

The machinery the owner asked about holds up under the real Orca: a cancel, a timeout and a
death of the slice service each left no Orca process and (after the next start) no file; the
progress fraction is always Orca's own figure; all 14 hand mutations were noticed by the fast
suite. The defects are mostly in what the student is told: several real failures still end in
a sentence that is false or a remedy that cannot help, including the owner's own named case
at real size.

The probes are scratch scripts in
`/tmp/claude-1000/-repos-popcornpenguins/c507b106-b789-4d12-a830-1dcc19de2171/scratchpad/slice-review/`:
`probe_real.py` (real Orca through the HTTP face), `probe_cli.py`, `probe_files.py`,
`probe_tower.py`, `probe_fast.py` (stand-ins for Orca), `mutate.py`, `probe_upgrade.py`,
`flakes.sh`. Real Orca was run one process at a time.

## Check 1: flakes

`flakes.sh`: 20 runs of `pytest -q -n 2 --randomly-seed=<fresh>` on `slice/tests`.
**19 passed, 1 failed** (664 tests each, 3.5 to 5.7 s as pytest reports it).

- Run 15, `--randomly-seed=1867250752`:
  `tests/test_orca_runner.py::test_orca_does_not_outlive_a_service_that_is_killed` failed
  with `ProcessLookupError: [Errno 3] No such process` raised from
  `Path("/proc/<pid>/stat").read_text()` inside the test helper `alive()` (line 72), called
  from the test's `finally`. `alive()` catches `FileNotFoundError` only; a process that exits
  between `os.kill(pid, 0)` and the read gives `ProcessLookupError`. Defect 5.

Hunt for causes that have not bitten: no `sleep(` anywhere in `tests/`; clocks are injected
(`FakeClock`, `ManualTimers` as an autouse fixture); every thread is joined or bounded by
`FAILSAFE_S = 10`, which is reached only by a failing test; no fixed port; every path is
under `tmp_path`; Hypothesis runs `derandomize=True, database=None`; the delivered file name
reads the wall clock only when `local_time` is absent, and every test that compares a name
passes `local_time` or `now=`. Two things wait on real processes rather than the clock (the
stand-in Orca, about 60 tests), which is sound. One test cannot fail, only hang: defect 13.

## Check 2: speed

Serial `pytest -q -p no:randomly`: 664 passed in 5.1 to 5.8 s; with 2 workers 3.5 to 5.7 s.
Collection alone: 0.32 s. Time inside test phases, by file (`--durations=0`):

| File | Seconds | What costs it |
|---|---|---|
| `test_bad_stls.py` | 1.81 | one 150,000-triangle part (0.92 s call + 0.07 s setup); five Hypothesis tests of 300 examples (0.55 s) |
| `test_orca_runner.py` | 0.85 | a real child process (the stand-in Orca) per test |
| `test_errors.py` | 0.58 | the same, 15 uses |
| `test_limits.py` | 0.40 | `measure("mechanism")` builds four real meshes (0.27 s) |
| `test_service.py` | 0.36 | the stand-in Orca, 14 uses |
| `test_web.py` | 0.23 | the stand-in Orca, 8 uses |
| all others | 0.29 | |

The remaining 1.2 s or so is interpreter start and imports (numpy, shapely, flask,
hypothesis). So the growth from 1 s is three things: the stand-in Orca is now a real process
(20 to 110 ms each), the dense part, and Hypothesis. **No test waits on real time.** Over
0.2 s: `test_a_dense_part_at_the_triangle_limit_is_read` (0.92 s) and
`TestMeasurePlate::test_measure_reports_a_row_through_the_slice` (0.27 s). Not listed as a
defect: the suite finishes in seconds and nothing sleeps.

The real-Orca suite (`make test-upstream`): 23 passed in 8.27 s.

## Check 3: coverage and mutation

`make coverage` (data file redirected to scratch): **100 % statements and 100 % branches in
all 13 modules** (1,690 statements, 428 branches). One exclusion, `slicer._child_setup`
(runs between fork and exec), which is justified and is protected by the test of defect 5.

Ten failure-path tests sampled (`TestSignals`, `TestCancelAndTimeout`, `TestOrcaExits`,
`TestAbandoned`, `TestSubscribers`, `test_each_bad_file_gets_a_true_answer`): each asserts
the code, the sentence or the detail the caller sees, and the process or file state; none
only executes a line.

Hand mutations in scratch copies (`mutate.py`), fast suite on each:

| Mutation | Noticed by |
|---|---|
| M1 SIGKILL no longer means out of memory | 7 tests |
| M2 no kill of what Orca left behind | `test_a_child_orca_leaves_behind_is_killed` |
| M3 STL path confinement off | 2 tests |
| M4 NaN and infinite coordinates accepted | 4 tests |
| M5 a cancel no longer wins over a finished slice | 1 test |
| M6 progress accepted after a final state | 1 test |
| M7 scratch not removed | 7 tests |
| M8 sliced file not verified | 1 test |
| M9 abandoned jobs never cancelled | 2 tests |
| M10 a percent out of range becomes a fraction | 2 tests |
| M11 no escalation to SIGKILL after the grace time | the suite hung over 90 s (defect 13) |
| M12 stale scratch of a dead process kept | 2 tests |
| M13 uploads of a failed job kept | 4 tests |
| M14 empty layers with supports on still offers supports | 3 tests |

No mutation survived.

## Check 4: error reports

The 40 codes of `errors.CODES` equal the codes in `slice/README.md` (plus the three warning
codes); `test_every_code_is_expected` and `test_failure_produces_its_code` produce each on
purpose. Failures that do not reach the caller as a truthful error report:

- Orca's reasons "No layers were detected" and "The print is empty": generic sentence,
  remedy that cannot help (defect 1).
- The memory cap's sentence and remedy (defect 2).
- An outside SIGKILL reported as out of memory (defect 3).
- Orca that cannot load its libraries, exit 127: "Try another orientation" (defect 4).
- A file that is not an STL, 84 bytes or longer: "cut off before its end" (defect 6).
- HTTP 404, 405 and two 500s: HTML, not an error report (defect 7).
- An STL path with a NUL byte or 5,000 characters: `slice.unexpected`, status 500 (defect 8).
- Two coincident triangles: "No part is fully on the plate" (defect 9).
- Ctrl-C on the command line: a Python traceback (defect 14).

## Check 5: upstream

- **One pin:** yes. `ORCA_VERSION="2.4.2"` and three `SHA_` lines in
  `scripts/install-orca.sh`; tests read it through `helpers.pinned_orca_version()`. Other
  mentions of 2.4.2 are prose (`README.md` lines 120 and 220, `patches/orca/README.md`).
- **One seam:** yes. Orca is started only in `slicer.py`; `flatten_orca_profiles.py` reads
  Orca's profile tree through `slicer.orca_bin()`.
- **Upgrade command:** `make upgrade-orca VERSION=x.y.z` exists. On a scratch copy:
  `9.9.9` stops with "could not read release v9.9.9 from GitHub: HTTPError: HTTP Error 404"
  and `'2.4.2; rm'` with "is not a version such as 2.5.1", pin untouched in both.
  `probe_upgrade.py` (reads only): the command's own digests for 2.4.2 equal the pinned
  lines; 2.4.1 and 2.4.0 can be pinned; 2.3.2 and 2.3.1 have no aarch64 asset; 2.3.0 has no
  digest. I did not run a real upgrade: it rewrites repository files. What happens when a
  step fails after the pin is rewritten: defect 12.
- **Upstream check:** 23 tests, each with a "Protects:" line, all passing. Left
  unprotected: Orca's wording for a mesh with no layers and for an empty print (defect 1);
  exit 127 (defect 4); that the percent rises (the docstring of
  `test_progress_messages_are_the_ones_the_stage_table_knows` says "the percent rising", the
  assertion checks only the range and the last value; my capture of a 12-copy plate did rise:
  1, 2, 3, 6, 7, 16, 25, 34, 48, 66, 70, 75, 93, 94, 97, 100); a kernel out-of-memory kill
  (only `RLIMIT_AS` is exercised; the cgroup here is root-owned, so I could not produce one
  either).
- **Patches:** `patches/orca/README.md` holds one proposed, unbuilt patch note. The upgrade
  command stops when a patch file exists instead of applying it; [upstream.md](../briefs/upstream.md)
  asks for applying. Reasonable while no source build exists, but it is a stated deviation
  for the owner to accept (in defect 12).
- **Guide section:** "Taking a new upstream version" is there with the steps, what to read
  in the diff and what to do when the upstream check fails. It records no run of the upgrade
  command to another version and back (in defect 12).

## Check 6: separation

`src/penguin_slice` and `scripts/` import only the standard library, numpy, shapely, flask
and each other; `tests/test_independence.py` enforces it. `tests/test_contracts.py` checks
the contract examples; the real-Orca suite reproduces `contracts/examples/error-report.json`
and `sliced-file.json`. `README.md` lets a newcomer install, test and run the component alone.

## Check 8: hostile cases

Every case in the hardening brief has a test: the corpus of 25 files
(`test_each_bad_file_gets_a_true_answer`, plus `test_the_corpus_is_what_its_script_writes`),
the dense part at and over the limit, five Hypothesis tests, the stand-in's 22 modes in
`test_orca_runner.py`, and the job cases in `test_jobs.py`. Removing the handling fails them
(check 3). The weak spot is `text.stl`: it is 52 bytes, so it never reaches the branch a
longer non-STL file takes (defect 6).

My own cases, checks only (`probe_files.py`):

| File | Answer | Verdict |
|---|---|---|
| HTML error page, 224 bytes | `slice.part_unreadable` "cut off before its end" | false sentence, defect 6 |
| gzip of an STL | the same | defect 6 |
| header says 4,294,967,295 triangles | "cut off before its end" | true enough |
| UTF-16 text, 62 bytes | "not an STL file" | true |
| box plus one trailing byte | "extra data after its last triangle" | true |
| coordinates 1e30, and at the float32 maximum | `slice.part_too_large` with the size | true |
| box 1,000 km from the origin | "too small (0.0 x 0.0 x 0.0 mm)" | true as read (float32) |
| 100 mm solid cube | `slice.plate_too_large` "about 1,158 MB" | false figure, defect 2 |
| open 100 mm box | the same | defect 2 |

Those that pass the checks, real Orca (`probe_files.py real`, ceiling raised where needed):

| File | Answer | Verdict |
|---|---|---|
| box with one NaN normal | sliced, 41 layers | right |
| box floating 50 mm up, wound inwards | sliced, warning `slice.part_inside_out` | right |
| box doubled (every edge used four times) | sliced, warning `slice.part_not_watertight` | right |
| 100 mm solid cube | sliced, peak 275,644 kB | defect 2 |
| open 100 mm box; box with half its triangles; tilted flat sheet | `slice.orca_failed`, Orca said "No layers were detected. You might want to repair your STL file(s) or check their size or thickness and retry." | defect 1 |
| cube 0.15 mm; needle 0.15 x 0.15 x 80 mm | `slice.orca_failed`, Orca said "The print is empty. The model is not printable with current print settings." | defect 1 |
| two coincident tilted triangles | `slice.nothing_on_plate` "No part is fully on the plate." | defect 9 |

None produced a traceback, a hang, a leaked process or a leaked file.

## Check 9: cancellation and cleanup, with the real Orca

Process table read from `/proc` (any process whose command line names the work folder and
Orca); disk read with a recursive listing. Plates of 20 or 25 hubs of 20,000 triangles
(9 to 15 s of Orca).

| Case | Orca process afterwards | Files afterwards | Slot, rerun |
|---|---|---|---|
| Cancel (`DELETE`) at "Generating walls" | none at the instant the report said `cancelled` (10 ms after the call) | work folder empty | same plate job rerun: done, file fetched |
| Timeout (timer at 1.5 s) | none | work folder empty | rerun: done; report `slice.timeout`, "stopped by the slice service (timeout) with SIGTERM after 1.516 s" |
| Slice service killed with SIGKILL | none 0.3 s later | 13 entries (uploads, plate, scratch, FIFO) until the next start on the same `--work`, then none | old job answers 404 `slice.unknown_job` |
| Slice service stopped with SIGTERM | none 0.3 s later | the same 13 entries until the next start | no shutdown ran: defect 11 |
| Orca killed from outside with SIGKILL | none | work folder empty | report says out of memory: defect 3 |
| Command line, Ctrl-C | none | `--out` empty | traceback: defect 14 |
| Command line, SIGTERM | none | 9 scratch entries until the next slice into the same `--out`, then none | |
| Four of five stream clients vanish (real sockets) | | | the fifth saw every report to `done` |
| 20 stream clients vanish, stand-in Orca hanging | | job folder removed | subscribers 20, then 0 within 0.5 s; sweep at 119 s nothing, at 121 s cancelled |

A done job's folder (uploads and sliced file) stays for `RECORD_TTL_S`, also across
`shutdown()`, and goes at the next start; that matches the module's description.

## Check 10: progress

- With the real Orca every fraction equals Orca's `total_percent / 100`; `building_plate`
  and `reading_result` carry none; the final report carries none.
- A garbled pipe (`probe_fast.py`: not JSON, 150, -3, "40", NaN, a non-string message,
  invalid UTF-8, a 300,000-byte line, a last line with no newline) gave only stages with no
  fraction or with the figure Orca wrote; a message the table does not know kept the
  current stage. Nothing was invented. A fraction goes down when Orca's figure goes down.
- A silent pipe: one second into a stand-in that says nothing, the report still reads
  `"stage": "building_plate", "stage_label": "Building the plate"` (defect 10).
- A late subscriber got the latest report first (sequence 3 of a running job); nothing
  followed a final report (M6, and every real run); `cancelled` came only with no Orca left.
- Memory limit on the real Orca, `ulimit -v`: 1,000,000 kB and 600,000 kB give
  `slice.out_of_memory` with `std::bad_alloc` in the detail, which is truthful; 250,000 kB
  gives defect 4. Cancel, timeout, crash and `RLIMIT_AS` are told apart correctly; an
  outside SIGKILL and a kernel memory kill are not (defect 3).

## Defects, most serious first

1. **Orca's two commonest reasons for a broken mesh end in the generic sentence.**
   Orca prints "No layers were detected. You might want to repair your STL file(s) or check
   their size or thickness and retry." (open 100 mm box, box with half its triangles, tilted
   flat sheet) and "The print is empty. The model is not printable with current print
   settings." (0.15 mm cube, 0.15 mm needle). The error report is `slice.orca_failed`, "The
   slicer could not slice this plate.", remedy "Try another orientation or other print
   settings, and slice again.", which cannot help. Orca's words are in `detail` only by way of
   the output tail; they are not in `reason`, so the log's `orca_reason` holds only the
   general `error_string`. Neither wording appears in `src/`, `tests/` or `tests_orca/`. This
   is the same shape of failure as the owner's Eiffel Tower complaint. **Fixed when:** each
   reason has its own code, a true sentence and a remedy that helps (repair in CAD, check the
   size); the reason reaches `orca_reason`; the stand-in has a mode for each; a real-Orca
   test pins each wording.

2. **The memory cap states a figure that is wrong by a factor of four, and refuses the
   owner's named case before its real diagnosis.** (a) One 100 mm solid cube: refused with
   "This plate needs about 1,158 MB of memory to slice; the print server allows 900 MB."
   With the ceiling raised it slices with a peak of 275,644 kB. (b) The corpus' tower
   stand-in scaled 6 times (120 mm, not watertight, so its volume is taken as its bounding
   box, 1,746 cm3): refused with "needs about 1,893 MB", remedy "Remove some copies or the
   largest part and print them in a second job." on a plate of one part; with the ceiling
   raised Orca gives the `slice.empty_layers` report the hardening was written to deliver.
   Any part that is not watertight and has a bounding box over about 740 cm3 meets this.
   (c) The model also estimates low inside the limits: 25 hubs of 20,000 triangles, estimate
   792 MB, measured `peak_rss_kb` 861,952 (842 MB), although `limits.py` says it "never
   estimates below a measured peak"; the reference plate uses 12,000-triangle hubs and the
   model ignores triangle count. The model's form comes from the research file, so the
   remedy is the owner's decision. **Fixed when:** a solid block that slices in under 300 MB
   is not refused for memory; a part that is not watertight is not refused on its bounding
   box before its mesh finding is reported; the remedy on a one-part plate does not say to
   remove copies; the sentence in `limits.py` and the guide matches the measurements.

3. **A SIGKILL from anywhere is reported as out of memory, against the evidence the slice
   service holds.** Real Orca killed with `kill -9` from outside at a peak of 198,276 kB:
   `slice.out_of_memory`, "This plate is too large to slice", not retryable, action
   `lower_quantities`. The detail reads "ended by signal 9 (SIGKILL), not sent by the slice
   service" with no mention of the kernel's `oom_kill` count, which the slice service read
   before and after and which did not rise. `test_killed_by_the_kernel_for_memory` pins this.
   No real kernel memory kill has been observed by anyone (not possible on this machine).
   **Fixed when:** with the count known and unchanged the report is `slice.orca_killed`
   (retryable); with the count risen, or unknown, it is `slice.out_of_memory` and the detail
   says which; tests cover the three.

4. **An Orca that cannot load is reported as the plate's fault.** Under a 250,000 kB limit
   Orca exits 127 with "error while loading shared libraries: libharfbuzz-icu.so.0: failed to
   map segment from shared object"; the report is `slice.orca_failed`, "Try another
   orientation or other print settings". A host library missing after an upgrade gives the
   same exit. **Fixed when:** exit 126 or 127 with no `result.json` is
   `slice.orca_unstartable` (or `slice.out_of_memory` when the loader says it could not map
   or allocate), with a test in each suite.

5. **A flaky test.** `test_orca_does_not_outlive_a_service_that_is_killed`, 1 failure in 20
   runs, `--randomly-seed=1867250752`; cause in check 1. **Fixed when:** `alive()` treats
   every `OSError` from the `/proc` read as "not alive", and 100 runs with 2 workers pass.

6. **A file that is not an STL is called cut off.** Any non-STL file of 84 bytes or more
   that is not PNG, zip or ASCII STL (an HTML or JSON error body, the likeliest bad file from
   Onshape; a gzip) gets "The file for Part is cut off before its end." The corpus' `text.stl`
   is 52 bytes and does not reach this. **Fixed when:** such a file is answered "is not an STL
   file", and the corpus holds a text file longer than 84 bytes whose test fails without the
   change.

7. **Four HTTP answers are not error reports.** `GET /nothing`: 404 HTML. `PUT /slices` and
   `GET /slices`: 405 HTML. `GET /slices/<job>/file` after the file left the disk: 500 HTML,
   `FileNotFoundError` traceback in the log. `POST /slices` with the work folder not
   writable: 500 HTML, `PermissionError` from `make_scratch`, which sits outside the `try`.
   **Fixed when:** every status of 400 or above from the app is an error report, with tests
   for these four.

8. **A malformed STL path is "The slicer failed unexpectedly".** `"stl": "box.stl\u0000x"`
   gives `slice.unexpected`, `ValueError: embedded null byte`, status 500; a 5,000-character
   name gives `slice.unexpected`, `OSError: [Errno 36] File name too long`. Both are bad
   plate jobs. **Fixed when:** both are `slice.bad_plate_job` (or `slice.part_missing`) with
   status 400 or 422, on the command line too.

9. **A surface with no volume passes as watertight.** Two coincident tilted triangles: every
   edge is used twice, so `analyse` says watertight; Orca answers -50 and the student reads
   "No part is fully on the plate. Move the copies onto the plate, or press Arrange". **Fixed
   when:** a mesh whose enclosed volume is zero is refused as `slice.part_no_volume` before
   Orca, with a corpus file.

10. **With Orca's pipe silent the stage is false.** The report stays at "Building the plate"
    for as long as Orca runs. With the pinned Orca the first message comes after about 0.4 s,
    so this bites when Orca stalls while loading or a new Orca changes `--pipe`. **Fixed
    when:** the slice service reports a stage of its own, with no fraction, at the moment it
    starts Orca.

11. **SIGTERM skips the shutdown the command line documents.** `serve` exits -15 at once:
    no `cancelled` report to subscribers, no log line for the running job, 13 files left
    until the next start. Orca does die. `__main__.py` says "on the way out it cancels every
    job and waits until every Orca is gone", which holds for Ctrl-C only; SIGTERM is what a
    container host sends. **Fixed when:** SIGTERM takes the same path as Ctrl-C, with a test.

12. **A failed upgrade can leave no Orca and a moved pin.** `upgrade_orca.py` rewrites the
    pin before installing; `install-orca.sh` runs `rm -rf "$DEST"` before the download and
    again on a failed download or checksum (lines 63 to 76). A network failure in the middle
    leaves `ORCA_VERSION` at the new release and `tools/orca` gone; the guide does not say
    how to get back. Also: the command stops on a patch instead of applying it, and the guide
    records no run to another version and back (2.4.1 and 2.4.0 are available to the
    command). **Fixed when:** the new release is downloaded and verified beside the installed
    one before anything is replaced, or the guide gives the way back and a test covers the
    failed download; the proof run is recorded; the owner has accepted the patch deviation.

13. **One test hangs instead of failing.** With the escalation to SIGKILL removed (M11),
    `test_orca_that_ignores_sigterm_gets_sigkill` never returns; the suite ran past 90 s and
    left a stand-in process that ignores SIGTERM. **Fixed when:** the test has the same
    fail-safe as its neighbours and fails within `FAILSAFE_S`.

14. **Ctrl-C on the command line prints a traceback.** `python -m penguin_slice slice`
    interrupted during a real slice: exit -2 and a `KeyboardInterrupt` traceback on stderr.
    Orca and the scratch folder are gone, so only the shape is wrong. **Fixed when:** it
    prints the `slice.cancelled` error report and exits non-zero.

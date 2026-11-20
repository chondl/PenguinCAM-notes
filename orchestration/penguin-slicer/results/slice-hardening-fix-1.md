# Fix round 1: slice service, hardening phase

Worked Thu 11-19 19:42 to 20:15 PT from
[slice-hardening-review-1.md](slice-hardening-review-1.md) (14 defects), the coordinator's
ruling on defects 2, 3 and 5, [fix.md](../briefs/fix.md),
[standing-rules.md](../briefs/standing-rules.md),
[slice-hardening.md](../briefs/slice-hardening.md) and [upstream.md](../briefs/upstream.md).
Every change is uncommitted, under `slice/` and `contracts/` in
`/repos/popcornpenguins/penguin-slicer`. Real Orca was run one process at a time, never
beside another real Orca.

## Summary

All 14 defects are fixed; three by another route than the review proposed, at the
coordinator's ruling or with the reason below (2, 3 and 4). Two defects of the same kind
were found beside listed ones and fixed (under 5 and 7). Defect 12 has one part only the
owner can close: accepting that the upgrade command stops on a patch instead of applying it.

| Figure | Before (review) | After |
|---|---|---|
| Fast suite tests | 664 | 729 |
| Fast suite, serial, pytest's figure / wall | 5.1 to 5.8 s | 4.9 s / 5.1 s |
| Fast suite, 2 workers, pytest's figure / wall | 3.5 to 5.7 s | 3.2 to 4.2 s (100 runs; median 3.45) / 3.8 s |
| Random-order runs on 2 workers | 19 of 20 passed | 100 of 100 passed (`make test-flakes RUNS=100`) |
| Branch coverage | 100 % in 13 modules | 100 % in 13 modules (1,833 statements, 466 branches) |
| Real-Orca suite (`make test-upstream`) | 23 tests, 8.3 s | 27 tests, 10.4 s, all passing on 2.4.2 |

New real-Orca tests: the memory watchdog at a 100 MB ceiling, Orca's two wordings for a
plate with nothing to slice, Orca without its libraries (exit 127). Changed: the progress
test now checks the percent rises (the review's gap) and that `slicing` comes first.

## Per defect

### 1. Orca's two commonest reasons for a broken mesh: fixed

Orca prints both on stdout, with return code -100 and only the general `error_string` in
`result.json` (confirmed with the pinned 2.4.2 on a tilted sheet, a box with half its
triangles and a 0.15 mm cube). `slicer.ORCA_OUTPUT_REASONS` reads each line into its own
code: `slice.no_layers` ("The slicer found no layers to print: a part's surface may have
holes, or a part may be too thin to slice.", remedy "Repair the part in CAD so it is a
closed solid, check its size and thickness, export it again and slice again.") and
`slice.print_empty` ("The slicer found nothing it can print with these settings: a part may
be thinner than the nozzle can print.", remedy "Check the part's size and units, make thin
features thicker than the nozzle, and slice again."). Neither has an action. The line
leads `reason` (so the log's `orca_reason`) and the detail (`orca said: ...`). On a plate
with one part, `where.part` names it (`plate_job._fit_to_plate`).

Tests: stand-in modes `no_layers` and `print_empty`;
`test_orca_runner.py::TestOrcaExits::test_orcas_words_for_nothing_to_slice_get_their_own_report`,
`test_errors.py::test_failure_produces_its_code[slice.no_layers]` and `[slice.print_empty]`,
`test_orcas_reason_for_nothing_to_slice_names_the_only_part`,
`test_with_two_parts_orcas_reason_names_none`; real Orca
`tests_orca/test_orca.py::test_orcas_words_for_a_plate_with_nothing_to_slice[half_box]`
and `[tiny_cube]` pin both wordings and the return code.

### 2. The memory cap: fixed by the coordinator's redesign

- **The watchdog is the guard.** `slicer.run_process(memory_ceiling_kb=...)` starts a
  thread that samples the resident memory of Orca's whole process group at once and then
  every `MEMORY_SAMPLE_S` (0.25 s; between samples it waits on Orca's exit, an event), via
  `slicer.MEMORY_READER` (`group_rss_kb`: the sum of `rss` from `/proc/<pid>/stat` over
  the processes whose process group is Orca's). A sample over the ceiling sets the Stop
  with reason `memory`; Orca is stopped as a cancel stops it (SIGTERM to the group, SIGKILL
  after the grace time) and the slice fails with `slice.out_of_memory`: "This plate is too
  large to slice: the slicer needed more than the 900 MB of memory the print server
  allows.", detail `stopped by the slice service (memory) with SIGTERM after 0.263 s:
  Orca's processes reached 111,832 kB resident, over the ceiling of 102,400 kB
  (PENGUIN_SLICE_MAX_PEAK_MB=100); Orca's own peak 111,960 kB` (the real-Orca test's
  words). The ceiling is the existing setting, 900 MB by default, carried in
  `PlateJob.memory_ceiling_mb` (the HTTP face's `environ` reaches it) into
  `slice_plate(memory_ceiling_mb=...)`; the sample part's `slice_stl` uses the default.
- **The estimate refuses nothing.** `slice.plate_too_large` and its sentence are gone from
  `errors.CODES`, `limits.py`, the guide and `contracts/plate-job.md`. The estimate stays
  in `PlateJob.estimated_peak_mb` and in every log line of the job beside
  `memory_ceiling_mb`. I did not add a warning when it is over the ceiling: on the
  reviewer's numbers it would be a false alarm on most solid parts (the 100 mm cube is
  over by 29 % and peaks at 30 % of the ceiling). It does not feed the expected time,
  which has its own time model (`limits.estimate_seconds`), unchanged.
- **The guide says the model is rough**, with the reviewer's counterexamples (the solid
  cube, 1,158 MB estimated, 269 MB measured; the scaled tower stand-in, 1,893 MB on a
  bounding box; 25 hubs of 20,000 triangles, 792 estimated, 842 measured), and that
  refitting it belongs with the choice of hosting (`slice/README.md`, "Plate limits";
  `limits.py`'s comment; `contracts/plate-job.md`, "Memory").
- **On a plate of one copy** the out-of-memory remedy is "Split the part in CAD into
  smaller pieces, or simplify it, and slice again." with no action (a `SliceError` may now
  carry its own remedy and drop the code's action; `plate_job._fit_to_plate` sets them).
- `scripts/measure_plate.py` lost its own `/proc` watchdog: it slices under the slice
  service's watchdog with `MEASURE_STOP_MB` (3 GB) and records a stop there as `over`.
- The other plate limits (copies, triangles and bytes per part, part size against the plate
  and the printer) are unchanged.

Tests, fast suite: `test_orca_runner.py::TestMemoryWatchdog` (stopped past the ceiling with
three samples of one process group and the detail above; the ceiling read from the
setting; a run under the ceiling keeps its sampled peak; a reader that finds no process
table stops nothing; `group_rss_kb` on a made-up process table with another group, an
entry that vanished and a cut-off one; on this machine's own process table), the stand-in
`hang` with an injected reader; `test_errors.py::test_failure_produces_its_code[slice.out_of_memory]`
(two copies: remedy and `lower_quantities`),
`test_out_of_memory_on_a_plate_of_one_copy_does_not_say_remove_copies`;
`test_service.py::TestRead::test_a_memory_estimate_over_the_ceiling_refuses_nothing` and
`test_a_solid_block_the_old_estimate_refused_is_read` (the 100 mm cube);
`test_limits.py::TestMeasurePlate::test_measure_stops_a_slice_over_the_stop_rule`. Real
Orca: `test_the_memory_watchdog_stops_a_real_orca_at_the_ceiling` (6 hubs of 20,000
triangles under a 100 MB ceiling: stopped after 0.26 s at 111,832 kB, no Orca left).

Limits of the watchdog, in the guide: it samples, so a jump inside 0.25 s can pass the
ceiling briefly; where the kernel's own limit is below the ceiling the kernel acts first
(then defect 3's rule decides).

### 3. A SIGKILL from anywhere was out of memory: fixed

`slice.out_of_memory` after a kill now needs the kernel's `oom_kill` count (cgroup
`memory.events`) to have risen; a kill with the count unchanged or unreadable is
`slice.orca_killed` (retryable, the server remedy), and the detail says which:
"...not sent by the slice service; the kernel's oom_kill count rose by 1 / did not change /
could not be read". This follows the coordinator's ruling, which differs from the review's
"unknown means out of memory". Orca's own `bad_alloc` stays out of memory (the review found
it truthful). The same rule covers a wrapper that reports SIGKILL as exit 137.

Tests: `TestSignals::test_killed_by_the_kernel_for_memory` (count 3 then 4),
`test_a_sigkill_from_outside_without_the_kernels_count_is_a_kill[3-3]`, `[None-None]`,
`[3-None]`, `test_the_three_are_distinct`; `test_slicer.py::TestPlateSlice::test_a_sigkill_with_the_kernels_count_risen_is_out_of_memory`
and the updated `test_a_signal_we_did_not_send_is_read_truthfully[-9-slice.orca_killed]`,
`test_wrapper_that_does_not_exec_reports_the_signal_as_status`. The fast suite no longer
reads this machine's `oom_kill` count at all (an autouse fixture holds it at 0): other
agents' processes move it, which would have been a flake.

### 4. An Orca that cannot load: fixed, as `slice.orca_unstartable` only

Exit 126 or 127 with no `result.json` is `slice.orca_unstartable` ("The slicer could not
be started.", "Ask a mentor to check the print server; the slicer will not start on it."),
detail `exit code 127: Orca did not start (the wrapper or the loader failed)` and the
loader's words. I did not route "failed to map segment" to `slice.out_of_memory` as the
review allowed: that loader failure appears only under an address-space limit (250 MB)
too small for any plate, so "this plate is too large" would be false, and the coordinator
restricted out of memory to the watchdog and the kernel's count. Exit 127 with Orca's own
`result.json` is still read as Orca's failure.

Tests: stand-in mode `exit_127`,
`TestOrcaExits::test_an_orca_that_cannot_load_is_not_the_plates_fault`;
`test_slicer.py::test_an_orca_the_shell_or_loader_could_not_start[126]`, `[127]`,
`test_exit_127_with_orcas_own_result_is_orcas_failure`; real Orca
`test_an_orca_that_cannot_load_its_libraries_is_unstartable` (the real binary run without
its library path: exit 127, "error while loading shared libraries: libpangoft2-1.0.so.0").

### 5. The flaky test: fixed, and the same pattern hunted

Cause as the review found: `alive()` read `/proc/<pid>/stat` after `os.kill(pid, 0)` and
caught only `FileNotFoundError`; a process exiting in between gives `ProcessLookupError`.
It now treats every `OSError` from that read as "not alive".

The hunt for reads of `/proc` or the process table racing an exit, in `tests/`,
`tests_orca/`, `scripts/` and the package:

- `test_orca_does_not_outlive_a_service_that_is_killed`'s `finally` did
  `if alive(orca): os.kill(orca, SIGKILL)`: the process can exit between the two
  (`ProcessLookupError`), and once reaped its pid can be reused by another process. It now
  calls `kill_fake`, which kills only while the stand-in still holds its lock file (the
  kernel drops the lock at exit, so a reused pid is never hit) and ignores an exit in
  between. Same kind, fixed.
- `tests_orca/test_orca.py::orca_processes_in` globbed `/proc/*/cwd` and resolved each;
  now it lists `/proc` and `readlink`s each entry, skipping any `OSError`.
- `scripts/measure_plate.py`'s own watchdog read `/proc/<pid>/status` (it caught
  `OSError`, so it was safe); it is gone, replaced by the slice service's.
- The new `slicer.group_rss_kb` skips any entry it cannot read or parse.
- `service._process_start` (stale scratch) already caught every `OSError`; unchanged.

Proof: `make test-flakes RUNS=100` (2 workers, a fresh random seed each run): 100 of 100
passed, Thu 11-19 20:00 to 20:08 PT (the three exit-status tests of defect 4 joined during
the loop; the last runs had all 729 tests).

### 6. A file that is not an STL was "cut off": fixed

`mesh._not_binary` now answers "The file for Part is not an STL file." for a gzip archive
(`1f 8b`) and for text of any length (every byte of the first 4,096 printable ASCII, tab,
newline, carriage return or a byte above 127; a binary STL's coordinates always hold zero
or control bytes), before the length rules. Detail: `224 bytes of text, starting
b'<!DOCTYPE html>...'`. Corpus: `html_error_page.stl` (155 bytes) and `gzip.stl` (a
gzipped box, 152 bytes), written by `make_bad_stls.py`; both said "cut off before its end" before the
change. Tests: `test_bad_stls.py::test_each_bad_file_gets_a_true_answer[html_error_page.stl]`,
`[gzip.stl]`; `test_mesh.py::test_damaged_or_empty_refused_with_a_true_sentence[html]`,
`[json]`, `[gzip]`, `[short-binary]`.

### 7. HTTP answers that were not error reports: fixed

`web.create_app` now registers a handler for every `HTTPException` (404 and 405 become
`slice.bad_request`, "The print server does not offer GET /nothing.", with Flask's status
kept) and for any other exception (500, `slice.unexpected`, the traceback in a
`slice_http_error` log line, not in the answer). `make_scratch` is inside a `try`: a work
folder that cannot be written is 500 `slice.scratch_unwritable`. A sliced file gone from
the disk is 410 `slice.file_gone`, "The sliced file is no longer on the print server.".
`werkzeug` (Flask's own HTTP layer) joins `flask` on `web.py`'s import allowlist. Two new
codes, both in `errors.CODES`, the guide and `test_errors.py`.

Tests: `test_web.py::TestEveryAnswerIsAnErrorReport` (GET /nothing, PUT /slices, GET
/slices, POST /slices/jx; the file gone; the work folder not writable; a bug in a route);
`test_errors.py::test_failure_produces_its_code[slice.bad_request]`, `[slice.file_gone]`.
Same kind found beside: a 500 from any route, not only the two the review named.

### 8. A malformed STL path was "failed unexpectedly": fixed

A part's `stl` with a NUL character, over 1,024 characters, or a piece between slashes
over 255 bytes refuses the plate job at its field check: `slice.bad_plate_job`, "This
plate job could not be read: part 'box' has an stl that is not a usable file name (got
...).", 400 from the HTTP face, exit 1 with the report on the command line (both go through
`read_plate_job`). `contracts/plate-job.md`'s Part table states the rule. Tests:
`test_service.py::TestRead::test_an_stl_that_is_no_usable_file_name_is_a_bad_plate_job`
(NUL, 5,000 characters, a 256-byte piece, 128 two-byte characters) and
`test_a_long_stl_within_the_limits_is_only_missing` (255 bytes: `slice.part_missing`).

### 9. A surface with no volume passed as watertight: fixed

`mesh.analyse` adds `encloses_nothing`: watertight, but every vertex lies in the plane of
the largest triangle, or the enclosed volume is nil. `read_binary_stl` refuses it as
`slice.part_no_volume`, "Part is a surface folded onto itself that encloses nothing, so
there is nothing to print." Corpus: `coincident_triangles.stl`. Tests:
`test_each_bad_file_gets_a_true_answer[coincident_triangles.stl]`,
`test_mesh.py::TestAnalyse::test_coincident_triangles_enclose_nothing[same]` and
`[opposite]` (the review's case had both triangles wound the same way, so the volume test
alone would not catch it; the plane test does).

### 10. A silent pipe left the stage false: fixed

`run_process` sends the stage `slicing` ("Slicing the plate", no fraction) the moment Orca
has started, before the pump thread starts, so no message of Orca's can be overtaken by
it. `jobs.STAGES` and the guide's stage table list it between `building_plate` and
`loading`. Tests: `TestProgress::test_the_stage_is_slicing_from_the_moment_orca_starts`
(the stand-in `hang` cancelled at that stage), the updated stage lists in `TestProgress`
and `test_service.py::TestSlice::test_cancel_and_progress_reach_orca`; real Orca
`test_progress_messages_are_the_ones_the_stage_table_knows` checks it comes first.

### 11. SIGTERM skipped the shutdown: fixed

`serve` installs a SIGTERM (and SIGINT) handler that raises `KeyboardInterrupt` while the
app runs, so both leave through the same `finally`: `JobPool.shutdown()` cancels every job
(subscribers get `cancelled`, each job logs its line) and waits for every Orca. The old
handlers come back afterwards. Test:
`test_cli.py::test_serve_stopped_by_a_signal_shuts_its_pool_down[SIGTERM]` and `[SIGINT]`,
a real signal to the test process while the fake server waits.

### 12. A failed upgrade could leave no Orca and a moved pin: fixed; one point for the owner

`upgrade_orca.upgrade` now installs the new release beside the installed one: a staged copy
of `install-orca.sh` holding the new pin (`scripts/.install-orca.next.sh`, removed whatever
happens) installs into `tools/orca.next` and verifies the download. A failed download or
checksum removes `tools/orca.next` and stops with "the install of 2.5.1 failed; nothing was
changed (the pin is still 2.4.2 and tools/orca is untouched)". Only then is the pin
rewritten and `tools/orca` moved to `tools/orca.previous`; a failed regeneration or
upstream check stops with the way back ("Orca 2.5.1 is installed and pinned; 2.4.2 is kept
at tools/orca.previous. To go back: make upgrade-orca VERSION=2.4.2"); a pass removes
`tools/orca.previous`. The guide's "Taking a new upstream version" has the order and a
"Going back" paragraph. Tests: `test_upgrade_orca.py::test_upgrade_installs_beside_then_pins_regenerates_and_checks`,
`test_a_failed_download_changes_nothing`,
`test_a_failed_check_after_the_swap_says_how_to_go_back[regenerate profiles and catalog]`
and `[upstream check]`, `test_a_first_install_has_nothing_to_keep`.

Proof run, Thu 11-19 20:09 to 20:11 PT, with `PENGUIN_SLICE_ORCA_CACHE` in scratch:

- `make upgrade-orca VERSION=2.4.1`: GitHub's digests read, 2.4.1 downloaded, verified and
  installed into `tools/orca.next` (its host libraries unpacked there), the pin moved,
  `tools/orca` swapped, the profiles regenerated (only `catalog/index.json` changed: its
  `skipped` list is empty for 2.4.1), and the upstream check ran: 26 passed, 1 failed,
  `test_checked_in_profiles_and_catalog_match_the_installed_orca` on that empty `skipped`
  list. The command stopped with "upstream check failed (exit 2). Orca 2.4.1 is installed
  and pinned; 2.4.2 is kept at .../tools/orca.previous. To go back: make upgrade-orca
  VERSION=2.4.2". That is the upstream check doing its job: a test that assumes the
  catalog skips some profiles names the assumption that changed.
- `make upgrade-orca VERSION=2.4.2`: back in 50 s, upstream check 27 passed. The pin's four
  lines are byte for byte what they were, `git status` shows no change under
  `src/penguin_slice/profiles/`, `tools/` holds only `orca` (2.4.2), and no staged script
  is left in `scripts/`. The fast suite passed after it.

For the owner: the command stops when `patches/orca/` holds a patch instead of applying
it, because patching Orca means a source build the brief forbids on this machine. The guide
now names this as a deviation for the owner to accept.

### 13. A test hung instead of failing: fixed

`test_orca_that_ignores_sigterm_gets_sigkill`, and the same kind beside it,
`test_timeout_of_an_orca_that_ignores_sigterm`, run the slice in a thread bounded by
`FAILSAFE_S` (`bounded()`) and kill the stand-in in `finally` if it lives. With the
review's mutation M11 (every SIGKILL to the group dropped) both now fail in 10 s each
with "Orca ignoring SIGTERM was never killed" and leave no process (checked with a
scratch pytest plugin applying M11).

### 14. Ctrl-C on the command line printed a traceback: fixed

`slice` runs with a Stop and a SIGINT and SIGTERM handler that sets it, so an interrupt
stops Orca like a cancel: Orca and the scratch folder are gone, the `slice.cancelled` error
report is printed on stderr (detail `stopped by the slice service (interrupted by SIGINT)
with SIGTERM after ... s`), exit 1. SIGTERM, which the review saw leave 9 scratch entries,
takes the same path. Test: `test_cli.py::test_slice_interrupted_prints_the_cancelled_report[SIGINT]`
and `[SIGTERM]` (a real signal at the stand-in's first message; the output folder ends
empty).

## Speed

- **The 150,000-triangle part** (0.85 s, the slowest test by far): kept at the real cap,
  since it is what shows a part at the cap is read and checked in reasonable time, and made
  cheap by making the reader itself faster. `mesh._unique_rows` (one `lexsort`) and
  `mesh._unique_pairs` (edges as one integer key) replace `np.unique(axis=0)`, whose sort of
  structured rows took 0.39 s of the 0.89 s. Same output, same order:
  `test_mesh.py::test_the_fast_unique_rows_and_pairs_are_numpys` compares them with numpy's
  on five random arrays. The test now takes 0.29 s, and so does reading such a part in
  production. What is left is three shapely convex hulls of 150,000 points.
- **The stand-in Orca as a real process**: 20 to 30 ms each here, about 70 uses. It is what
  proves the signal, process group, pipe and FIFO handling, so it stays a real process. It
  no longer reads this machine's `oom_kill` count or scans `/proc` on every run (the
  autouse `machine` fixture), which keeps those runs independent of the machine as well as
  cheap.
- The Hypothesis tests (five of 300 examples, 0.5 s together) are unchanged: fewer examples
  would prove less.

The suite is now 729 tests (65 more) in 3.8 s wall on 2 workers and 5.1 s serial, against
the review's 664 tests in 3.5 to 5.7 s and 5.1 to 5.8 s. Nothing in it sleeps or waits on
the wall clock: the watchdog's samples in the fast suite wait on an event, or on Orca's
exit, never on the cadence.

## Changed files

`slice/src/penguin_slice/`: `slicer.py`, `limits.py`, `service.py`, `plate_job.py`,
`errors.py`, `mesh.py`, `web.py`, `jobs.py`, `__main__.py`. `slice/scripts/`:
`measure_plate.py`, `upgrade_orca.py`. `slice/tests/`: `conftest.py`, `fake_orca.py`,
`service_until_killed.py`, `test_orca_runner.py`, `test_errors.py`, `test_service.py`,
`test_slicer.py`, `test_mesh.py`, `test_bad_stls.py`, `test_web.py`, `test_cli.py`,
`test_limits.py`, `test_plate_job.py`, `test_contracts.py`, `test_independence.py`,
`test_upgrade_orca.py`, `fixtures/make_bad_stls.py` and three new corpus files.
`slice/tests_orca/test_orca.py`. `slice/README.md`. `contracts/plate-job.md`.

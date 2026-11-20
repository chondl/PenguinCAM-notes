# Slice service, port phase: verification review, round 2

**Verdict: FIX, 2 defects.** Both are small and neither loses work. All 14 defects of
[round 1](slice-port-review-1.md) are fixed at their cause, each with a test that fails
when the fix is taken out (30 of 30 fix-reverting mutations caught). Defect 1 below was
introduced by the fix for round 1's defect 5; defect 2 was already there in round 1 and
that review missed it. The coordinator may judge that both belong to hardening: the
reasons for and against are given with each.

Reviewed Thu 11-19, finished 18:40 PT, in `/repos/popcornpenguins/penguin-slicer/slice`,
on an aarch64 Linux container with 4 CPUs and 5 GB. No file in the repository was changed
by this review (no file under `slice/` or `contracts/` is newer than the review's first
scratch file; coverage data and bytecode were written to the scratch folder). The
builders' reports were not read. Scratch scripts and their output are in
`/tmp/claude-1000/-repos-popcornpenguins/c507b106-b789-4d12-a830-1dcc19de2171/scratchpad/slice-review-2/`
(`flakes.sh`, `runmut.py`, `probes.py`, `diffs.sh`, `flakes.out`, `mut.out`).

## The 14 defects of round 1

"Mutation" names a line of `mut.out`: the fix removed in a scratch copy, then the fast
suite run. Every one failed a test. "Probe" names a line printed by `probes.py`, which
goes through `slice_plate_job` and `error_report` as a caller does.

| # | Round 1 defect | State | Evidence |
|---|---|---|---|
| 1 | Good slice thrown away on an unexpected shape of Orca's side files | Fixed | Probes D, D2, N8: the sliced file is delivered, warnings `[]` or the one real warning. Probes G, O: `slice.unreadable_output`. Mutations `d01a` to `d01e` caught |
| 2 | Success reported with a folder as the path | Fixed | `os.replace` in `service.py` 225. Probe H: `slice.output_unwritable`, the folder untouched, scratch removed. Mutation `d02` caught |
| 3 | -100: untrue sentence, contradicting remedy, no reason in the detail | Fixed, except the sentence, which is the accepted `known_fault` | Real Orca: `test_orca_general_failure_keeps_orcas_words` passes, detail carries `orca error_string: Failed slicing the model...`, remedy no longer "Turn Supports on", no action. `contracts/examples/error-report.json` is now the real -101 report and `tests_orca` compares it with a real run. Mutations `d03a`, `d03b` caught |
| 4 | Four codes with a blank detail | Fixed | Probes P, S; every code in `test_errors.EXPECTED` (29 of 29) states a piece of its detail. Mutations `d04a` to `d04f` caught |
| 5 | Orca killed by a signal reported as a fault of the part | Fixed for the case round 1 showed; too wide (defect 1 below) | Probe E, a real `kill -9` of the wrapper: `slice.orca_killed`, retryable. The installed wrapper ends in `exec`, so the signal reaches Python as a negative status. Mutations `d05a`, `d05b`, `x01` caught |
| 6 | 10^400 reported as a server bug | Fixed | Probe A: `slice.bad_plate_job`. Mutation `d06` caught |
| 7 | File system failures reported as "failed unexpectedly" | Fixed | Probes B, C, N1 (read-only output folder), and the vanished STL test: `slice.output_unwritable`, `slice.part_unreadable`, `slice.part_missing`. Mutations `d07a` to `d07d` caught |
| 8 | Orca output that is not UTF-8 fails the slice | Fixed | Probe F through the real `subprocess.run`. Mutation `d08` caught |
| 9 | Remedy, action and retryable untested; two codes produced by the test | Fixed | `test_errors.EXPECTED` writes all six fields out per code; `slice.unexpected` is produced through `slice_plate_job`; `slice.job_failed` is gone. Mutations `d09a` to `d09c` caught |
| 10 | Nothing tests that a failed job wakes a subscriber | Fixed | `test_failure_wakes_a_subscriber_waiting_without_a_timeout`, both failure kinds. Mutations `d10a`, `d10b` caught (the test then takes its 10 s fail-safe, as designed) |
| 11 | Type of an override value untested | Fixed | Mutation `d11` caught |
| 12 | Version in six files, Orca's files read in four modules | Fixed | `grep 2.4.2`: `scripts/install-orca.sh` 15 is the only statement; the catalog's `orca_version` is generated and tested against the pin; two fixture files are recordings. `ORCA_RETURN_CODES` is the only table; `result.json`, `plate_1.json`, `slice_info.config` and the G-code header are read in `slicer.py` only |
| 13 | `test-flakes` reused ten seeds, `test-parallel` used four workers | Fixed | `make test-flakes RUNS=2` printed seeds 4085751242 and 1610397259, a third run 2990258068; `WORKERS ?= 2` |
| 14 | Sentences untrue outside the earlier application | Fixed | Probes R, S, T; no "Onshape", "team" or "PenguinCAM" in any sentence; "A part was left off the plate." has its full stop. Mutations `d14a`, `d14b` caught |

## Check 1: flakes. No failure in 29 runs; no cause found that could bite

- 20 runs with `-n 2`, seeds 11, 222, 3333, 44444, 555555, 6, 77, 888, 9999, 101010,
  1212, 131313, 14, 1515, 16161, 171, 18181818, 1919, 20, 2121: every run `445 passed`,
  0.81 to 1.14 s. 6 serial runs, seeds 5, 55, 555, 5555, 2026, 1120: every run
  `445 passed`, 0.87 to 1.06 s. 3 more runs through `make test-flakes` with drawn seeds.
- Real sleeps: none. The sweeper's `sleep` is injected.
- Wall clock: `JobPool` has an injected clock. `delivered_file_name` reads
  `datetime.now` only when `local_time` is missing; the one test that lets it
  (`test_fallback_without_now_uses_the_current_utc_minute`) asserts only the pattern.
- Threads: every thread in `tests/test_jobs.py` is joined or its executor shut down with
  `wait=True`. The new subscriber test is ordered by events and by the pool's own lock
  (the subscriber signals from inside `Condition.wait` while still holding the lock), not
  by time; `FAILSAFE_S = 10` is reached only when the test is failing.
- Fixed ports, network: none. Shared paths: none, every test writes under `tmp_path`.
- Module-level state: `load_catalog` is cached per process and read-only. Tests that
  change `limits` or `Path.read_bytes` use `monkeypatch`, which restores them.
- Current directory, home directory, environment: one `monkeypatch.chdir`. The autouse
  fixture points `PENGUIN_SLICE_ORCA` at a file that cannot run. The unreadable-STL test
  replaces `Path.read_bytes` instead of using file permissions, so it does not depend on
  the user. `tests/test_install_orca.py` still needs the host's `bash`, `awk` and
  `sha256sum`.
- Directory order: every `iterdir` in the tests is sorted or compared with a list of at
  most one name.

## Check 2: speed. Passes

`make test`: 445 tests, 0.9 to 1.2 s inside pytest. The ten slowest are all 0.02 s (the
tests that start the fake Orca). Nothing is over 0.2 s.

## Check 3: coverage. Passes

**Measured** (`coverage run`, data file in the scratch folder): every module is at 100%
of statements and branches, 908 statements and 196 branches, none missed. No failure
branch is uncovered. `scripts/` is not measured; its scripts have tests.

**Ten failure-path tests sampled**

| Test | Asserts what the caller sees? |
|---|---|
| `test_errors` `test_failure_produces_its_code` (29 codes) | Yes: code, sentence, stage, retryable, action, remedy and a piece of the detail, all written in the test |
| `test_service` `test_folder_with_the_sliced_files_name_is_not_success` | Yes: code, the name in the detail, the folder left empty, scratch removed |
| `test_service` `test_stl_that_vanishes_after_the_check` | Yes: code, sentence, `where`, empty output folder |
| `test_service` `test_stl_file_that_cannot_be_opened` | Yes: code, sentence, `where`, the whole detail |
| `test_service` `test_orca_output_that_is_not_utf8_is_kept_not_fatal` | Yes: through a real child process; code and the replaced text in the detail |
| `test_slicer` `test_orca_stopped_by_a_signal_is_not_a_fault_of_the_part` | Yes: code, sentence, signal name, the last 19 lines kept |
| `test_slicer` `test_result_json_of_any_shape_gives_no_warnings_and_keeps_the_slice` | Yes: the summary comes back with its numbers and no warnings |
| `test_slicer` `test_corrupt_entry_in_a_readable_zip_is_unreadable_output` | Yes: code and sentence, for each entry read |
| `test_jobs` `test_failure_wakes_a_subscriber_waiting_without_a_timeout` | Yes: the subscriber's answer is `failed` with a later `updated` |
| `test_service` `test_fields_refused` (27 cases) | Mostly: sentence, code, and that the detail starts with the right subject (`copy 0 is`, `part 'box' is`); round 1's "a detail naming the wrong field passes" is narrowed, not closed |

**Mutations by hand** (`runmut.py`; the unmutated copy passes 445). Besides the 30
fix-reverting mutations above, 17 on other important checks, all caught:

| Mutation | Caught by |
|---|---|
| `x02` name guard gives no `where` | `test_where_names_the_part_and_copy` |
| `x03` a `JobFailure` no longer reports its cause | `test_job_failure_reports_the_failure_that_caused_it` |
| `x04` scratch folder not removed | `test_slices_into_the_output_folder_and_removes_scratch` |
| `x05` `error_string` not stripped | `test_details_without_a_usable_error_string` |
| `x06` detail not held to its line count | `test_nonzero_exit_raises_with_code_and_last_lines` |
| `x07` Orca's code dropped from the detail | `test_failure_produces_its_code[slice.timeout]` |
| `x08` a mesh refusal names no part | `test_where_names_the_part_and_copy` |
| `x09` missing Orca reported as `slice.unexpected` | `test_failure_produces_its_code[slice.orca_missing]` |
| `x10` a plate job file that is not JSON escapes | `test_unreadable_plate_job_file` |
| `x11` a placement refusal names no copy | `test_where_names_the_part_and_copy` |
| `x12` a missing STL names no part | `test_missing_stl_file` |
| `x13` a killed Orca's output dropped | `test_failure_produces_its_code[slice.orca_killed]` |
| `x14` timeout loses its code | `test_failure_produces_its_code[slice.timeout]` |
| `x15` Orca inherits stdin | `test_slice_creates_output_dir_and_isolated_environment` |
| `x16` the command line catches only `ValueError` | `test_failure_prints_the_error_report_and_exits_one` |
| `x17` an unstartable Orca escapes as `OSError` | the same |
| `x01` the sample part's slice ignores a signal | `test_sample_part_stopped_by_a_signal` |

No mutation survived.

## Check 4: error reports

No failure escapes as a traceback: the command line turns every `Exception` into an
error report and exits 1, and every probe came back as a report or a success. Every
`raise` in the package (37, listed with `grep`) carries its own code, sentence and
detail, or is `QueueFull` or the missing-Orca `RuntimeError`, both of which `error_report`
recognises. The one exception is `stl_bounds`' `ValueError`, carried over and reached only
by `part_info` for the sample part, never by a plate job.

| Code | Conforms | Sentence true and useful | Remedy can help | Detail kept | Test |
|---|---|---|---|---|---|
| The 13 checking codes (`slice.bad_plate_job` to `slice.placement_too_close`) | yes | yes | yes | yes | yes |
| `slice.busy` | yes | yes | yes | yes | yes (the service still does not use the job queue) |
| `slice.orca_missing`, `slice.orca_unstartable`, `slice.timeout` | yes | yes | yes | yes (timeout: stdout only, as before) | yes |
| `slice.orca_killed` (new) | yes | yes for signal 9; **no for a crash** (defect 1) | not for a crash | yes | yes, and a real kill in probe E |
| `slice.orca_too_close` | yes | yes | yes | yes, Orca's words | yes, and with the real Orca |
| `slice.empty_layers` | yes | no: the accepted `known_fault`, pinned in both suites | yes | yes, Orca's words | yes, and with the real Orca |
| `slice.crosses_edge`, `slice.nothing_on_plate` | yes | not verified against Orca, as in round 1 | yes | yes | fake `result.json` only |
| `slice.orca_failed`, `slice.no_output`, `slice.unreadable_output`, `slice.no_gcode`, `slice.left_off_plate` | yes | yes | yes | yes | yes |
| `slice.output_unwritable` (new) | yes | yes | yes | yes | yes; probes B, H, N1 |
| `slice.unexpected` | yes | yes for a bug; **no for the input of defect 2** | no in that case | yes | yes, through `slice_plate_job` |

The reworked exceptions: `PlateJobRefused`, `MeshError`, `ProfileError`, `OverrideError`
and `SliceError` each carry `message`, `details` and `error_code`; `error_report` no
longer matches on sentences. `ProfileError` has no `where` and `error_report` allows for
that. A `JobFailure` with a cause reports the cause; without one it is `slice.unexpected`
with its own words kept in the detail. `slice.job_failed` is gone from the code, the
guide and the tests; nothing else referred to it.

New probes that passed: a read-only output folder (N1), an STL path with a lone surrogate
(N2), a printer that is a list (N4), `infill` true (N5), an STL that is a folder (N7), a
`result.json` that is not UTF-8 after a good slice (N8), a real 0.3 s timeout on a wrapper
that execs, with no process left (N10), a plate job file that is not UTF-8 through the
command line (N12), Orca's archive being a folder (N14), a sliced file with no numbers and
no `result.json` (N15: delivered, numbers null).

## Check 5: upstream

| Point | State |
|---|---|
| One pin | `ORCA_VERSION` and the three checksums in `scripts/install-orca.sh`. Tests read it with `helpers.pinned_orca_version`. Nothing else states it |
| Upgrade command | None. Not a defect in this phase |
| Upstream check suite | `make test-orca`, 10 tests, 1.25 s, run here once and serially: 10 passed. Not yet named `test-upstream`; not a defect in this phase |
| Single seam | `slicer.py` runs Orca and reads everything Orca writes. Three things that write for Orca stay outside it and do not make an upgrade harder: the plate 3MF (`plate_3mf.py`), the four Orca setting names of the overrides (`print_config.py`), and the profile flattening script |
| Guide section "Taking a new upstream version" | None; not a defect in this phase |

Newly protected since round 1: return code -100 and `error_string` from a real run; the
G-code header names the pinned release, so a different binary under an old `VERSION`
stamp fails.

Still unprotected, for the hardening brief: return codes -52 and -50 from the real Orca;
the shape of `result.json` after a good slice with a warning; what Orca prints while
slicing; `tests/fake_orca.py` against the real output; Orca still receives the caller's
`HOME`.

## Check 6: separation. Passes

- `tests/test_independence.py`: imports are the standard library, numpy, shapely and the
  package; `pyproject.toml` declares numpy and shapely.
- `tests/test_contracts.py` checks `plate-job.md` and `sliced-file.md` against the code,
  and the three example files the slice service produces or consumes. The guide's list of
  codes is compared with `errors.CODES`, in order.
- The guide's command-line example, run as written with the real Orca, printed exactly
  `contracts/examples/sliced-file.json` and left only the sliced file (172,933 bytes) in
  the output folder.
- `contracts/error-report.md` still gives `enable_supports` as its example of an action;
  the slice service no longer produces that action. An illustration, not a defect.

## Check 7: faithful. Passes

`diffs.sh` compares each module with the print branch. Beyond round 1's list, the
differences are the fixes round 1 asked for and nothing else:

- `slicer.py`: the error codes on each `SliceError`; `_killed`; `error_string` in the
  detail; `result.json` read through one function; damaged zip entries; decoding with
  replacement; `plate_object_names` moved in from `plate_3mf.py` with its shape check.
- `mesh.py`, `print_config.py`: details and error codes on the exceptions; the checks
  themselves are unchanged line for line.
- `plate_3mf.py`: the vanished-STL case, the full stop, `where` on the name guard.
- `jobs.py`, `plate.py`, `plate_job.py`, `limits.py`, profiles, sample part: as in
  round 1.
- Tests: every ported test file has at least as many tests as the print branch's, except
  `test_print_config` (19 to 12, for the reason round 1 gave); real-Orca tests went from
  8 in round 1 to 10.

One behaviour changed further than round 1's evidence supported: defect 1.

## Defects

1. **An Orca that crashes is reported as stopped by the print server.** Introduced by the
   fix for round 1's defect 5. `slicer.slice_plate` and `slice_stl` send every negative
   status to `_killed`, so a segmentation fault or an abort inside Orca (signals 11, 6)
   gives `slice.orca_killed`: "The print server stopped the slicer before it finished.",
   remedy "Slice again; if it is stopped again, slice fewer copies at once.", retryable.
   Evidence: probe E2 (a wrapper that sends itself signal 11) printed exactly that. The
   server stopped nothing; a part that crashes Orca will crash it on every retry, and
   fewer copies will not help. Before the fix the same case said "The slicer could not
   process this part." and was not retryable, which was nearer the truth.
   `test_orca_stopped_by_a_signal_is_not_a_fault_of_the_part` pins signals 15 and 99 to
   the same sentence. For deferring it: round 1's "fixed when" said "a negative status",
   and the fix does what was asked. Against: the code is new, and a code's meaning is not
   supposed to change once released. Fixed when: signals that mean Orca itself failed (at
   least SIGSEGV, SIGABRT, SIGBUS, SIGFPE, SIGILL) are not called a stop by the server and
   are not retryable, with a test; SIGKILL and SIGTERM stay as they are.
2. **A plate job file nested too deeply for Python is reported as a server bug.** Made by
   the port, missed in round 1; the same class as round 1's defect 6. `service._load`
   catches `OSError` and `ValueError`; a file of 100,000 nested brackets makes
   `json.loads` raise `RecursionError`. Evidence: probe N6 gave `slice.unexpected`, "The
   slicer failed unexpectedly.", remedy "Slice again; if it fails again, ask a mentor to
   check the print server." The remedy cannot help and the mentor would look in the wrong
   place. Reached only through a plate job file (the command line), not a JSON value.
   Fixed when: it is `slice.bad_plate_job`, with a test.

## Not defects in this phase, for the hardening brief

- A part name is put into sentences as it is; a name with a line break gives a sentence
  of two lines (probe N3).
- A multi-line `error_string` makes the detail longer than the 20 lines the comment in
  `_failure_details` promises (probe N9: 23 lines). Nothing is lost.
- A custom wrapper named by `PENGUIN_SLICE_ORCA` that does not `exec` Orca leaves Orca
  running after a timeout (probe N11) and turns a kill into exit status 137, which is
  reported as `slice.orca_failed` (probe E3). Both wrappers `scripts/install-orca.sh`
  writes do `exec`.
- A write failure inside the scratch folder (a full disk while the plate 3MF or the
  process file is written) is `slice.unexpected`, not `slice.output_unwritable`.
- Carried from round 1 and unchanged: the job queue's record holds a sentence, not an
  error report, and has no `cancelled` state, `sequence` or progress; `make coverage` has
  no threshold; a terminated service process leaves its scratch folder; on a timeout only
  Orca's stdout is kept; `DEFAULT_ORCA_BIN` holds only for a checkout.

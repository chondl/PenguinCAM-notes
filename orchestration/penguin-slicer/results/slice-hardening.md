# Slice service hardening: the hardening agent's report

Finished Thu 11-19 19:27 PT, in `/repos/popcornpenguins/penguin-slicer/slice` and the
slice service's contracts, on an aarch64 Linux machine with 4 CPUs and 5 GB. Nothing was
committed; the coordinator commits. These are the agent's own claims; the review checks
them. Scratch scripts and raw measurements are in
`/tmp/claude-1000/-repos-popcornpenguins/c507b106-b789-4d12-a830-1dcc19de2171/scratchpad/hardening/`.

**Status: DONE_WITH_CONCERNS.** Every requirement is built and tested; the stop condition
holds (fast suite 664 tests, 20 of 20 random-order runs on 2 workers passed, 100% branch
coverage per module, upstream check 23 of 23 passed, the guide lists every code and every
stage). The concerns are in "What I could not do".

## The two review items first

1. **Signals.** A negative exit status is now read four ways, each its own error report:
   SIGKILL the service did not send, or `bad_alloc` in Orca's output, is
   `slice.out_of_memory` ("This plate is too large to slice: the slicer ran out of
   memory.", action `lower_quantities`, not retryable; the detail says whether the
   cgroup's `oom_kill` count rose); SIGSEGV, SIGABRT, SIGBUS, SIGFPE, SIGILL, SIGTRAP,
   SIGSYS are `slice.orca_crashed` (not retryable); any other signal is
   `slice.orca_killed` ("Something on the print server stopped the slicer...",
   retryable); a stop by the service itself is `slice.timeout` or `slice.cancelled`. A
   wrapper that does not `exec` (exit 128 + N, no `result.json`, no Orca line) is read as
   signal N. Tests: `test_orca_runner.py::TestSignals` (real child processes that kill or
   crash themselves), `test_slicer.py::test_a_signal_we_did_not_send_is_read_truthfully`
   (nine signals), `test_errors.py::test_the_three_ways_orca_can_end_on_a_signal_are_distinct`.
2. **Deep nesting.** `RecursionError` from `json.loads` is `slice.bad_plate_job`, in the
   file reader, the HTTP face's form field, Orca's `result.json` and `plate_1.json`, and
   in the sentence that quotes a bad value. Tests:
   `test_service.py::test_plate_job_file_nested_too_deeply_for_python`,
   `test_a_value_nested_too_deeply_to_print_is_still_a_refusal`,
   `test_web.py::test_plate_job_that_is_not_json`, `test_slicer.py` result.json case `"[" * 100_000`.

## What changed, by requirement

1. **Errors.** Orca's `error_string` and every `sliced_plates[].warning_message` are read
   before cleanup and kept in the detail (and as `reason` in the log). -100 no longer
   says "no flat face": it maps to `slice.orca_failed` ("The slicer could not slice this
   plate.") unless Orca's warning is the empty-layer one, which becomes
   `slice.empty_layers` (supports off: names the copy and the height, action
   `enable_supports`) or `slice.empty_layers_with_supports` (no action, repair in CAD).
   Unknown codes keep Orca's words. Every sentence that said "this part" for a plate, or
   "This request could not be read", now says what is true. The contract example
   (`contracts/examples/error-report.json`) is now the real Orca's empty-layer report,
   whose action `enable_supports` is the one `error-report.md` names.
2. **Part checks** at arrival (`mesh.analyse`): refuse empty, not an STL, ASCII, cut off,
   padded, no triangles, not finite, too detailed, too small or flat, no surface, loose
   triangles, fits no orientation; warn (in `part_warnings`, a new sliced-file summary
   field) for holes, inside-out, inch-sized. Self-intersection is not looked for. The
   decision and its evidence are in the guide, "Checks on every part".
3. **Progress** from Orca's own `--pipe` messages, mapped to stages with Orca's
   `total_percent` as the fraction (below). Output read as it arrives, bounded.
4. **Cancellation**: process group, SIGTERM, 5 s grace, SIGKILL, leftovers killed, reaped
   last; `cancelled` only after. Queued, running, finished, unknown, twice, and at the
   instant of finishing all have defined answers (guide, "Cancelling").
5. **Cleanup**: abandoned jobs cancelled after 120 s (a returning subscriber resets it);
   scratch removed on every path; stale scratch of a dead process (named with pid and
   start time) removed at start of the HTTP face and before every CLI slice; job files
   removed on failure, cancel and expiry; `PR_SET_PDEATHSIG` so Orca dies with the
   service; `JobPool.shutdown`.
6. **Log**: one JSON line per transition with job, profiles, overrides, supports, the two
   estimates, parts (triangles, size, volume, watertight, shells, open edges, warnings),
   copies (name, orientation, angle, x, y), outcome, error code and detail, Orca's reason,
   peak memory, Orca's and the job's wall time. Never the payload.
7. **Plate limits**: `MAX_JOB_TRIANGLES` removed; `slice.plate_too_large` from the memory
   model, ceiling `PENGUIN_SLICE_MAX_PEAK_MB` (900). `measure_plate.py` rewritten: eight
   reference plates, Orca's own `wait4` peak, a 3 GB watchdog, `--fit` (least squares and
   the upper envelope a cap needs).
8. **Upstream**: below.
9. **HTTP face**: `web.create_app` (submit, progress, event stream, cancel, file), and
   `python -m penguin_slice serve`. Error answers are error reports with HTTP statuses.

New codes: `slice.profile_unreadable`, `slice.part_not_binary`, `slice.part_no_volume`,
`slice.part_too_large`, `slice.plate_too_large`, `slice.scratch_unwritable`,
`slice.cancelled`, `slice.out_of_memory`, `slice.orca_crashed`,
`slice.empty_layers_with_supports`, `slice.unknown_job`, `slice.not_ready`. Removed:
`slice.job_too_detailed`. Changed meaning: `slice.empty_layers` (now only Orca's real
empty-layer refusal with supports off), `slice.orca_killed` (only a signal from someone
else). Check order changed: profiles before parts (the part fit test needs the printer).

## What Orca reports while slicing (requirement 3)

Pinned 2.4.2, headless. Stdout: almost nothing (`run found error, return -100, exit...`
on failure; a harmless Wayland "socket path exceeds 108 bytes" line when the scratch path
is long). `--debug 3`+ writes a log file, not stdout. `--pipe <fifo>` sends one JSON line
per stage, `{"message","plate_count","plate_index","plate_percent","total_percent"}`:
load 1, 2; prepare 3; slicing begins 6, mesh 7; walls 16; infill 25, 34; support
necessity 48; overhangs 66; toolpath 70; G-code 75; finished 93; thumbnails 94; export 97;
done 100. Mapped to 10 stages plus the service's `queued`, `building_plate`,
`reading_result`; fraction = Orca's percent, none invented. On failure the pipe stops at
the failing stage. A "floating regions" critical warning reaches only the debug log
(patch note in `slice/patches/orca/README.md`, proposed, not made).

## Error codes

| Code | Stage | Retryable | Action |
|---|---|---|---|
| `slice.bad_plate_job` | checking | no | |
| `slice.too_many_copies` | checking | no | lower_quantities |
| `slice.unknown_printer` | checking | no | |
| `slice.profiles_not_offered` | checking | no | choose_profiles |
| `slice.bad_overrides` | checking | no | choose_profiles |
| `slice.profile_unreadable` | checking | no | |
| `slice.part_missing` | checking | no | refresh_parts |
| `slice.part_unreadable` | checking | no | refresh_parts |
| `slice.part_not_binary` | checking | no | |
| `slice.part_too_detailed` | checking | no | |
| `slice.part_too_small` | checking | no | |
| `slice.part_no_volume` | checking | no | |
| `slice.part_too_large` | checking | no | |
| `slice.plate_too_large` | checking | no | lower_quantities |
| `slice.placement_off_plate` | checking | no | arrange |
| `slice.placement_too_tall` | checking | no | choose_orientation |
| `slice.placement_too_close` | checking | no | arrange |
| `slice.busy` | queued | yes | |
| `slice.scratch_unwritable` | building | yes | |
| `slice.orca_missing` | slicing | no | |
| `slice.orca_unstartable` | slicing | no | |
| `slice.timeout` | slicing | yes | lower_quantities |
| `slice.cancelled` | slicing | yes | |
| `slice.out_of_memory` | slicing | no | lower_quantities |
| `slice.orca_crashed` | slicing | no | |
| `slice.orca_killed` | slicing | yes | |
| `slice.orca_too_close` | slicing | no | arrange |
| `slice.crosses_edge` | slicing | no | arrange |
| `slice.empty_layers` | slicing | no | enable_supports |
| `slice.empty_layers_with_supports` | slicing | no | |
| `slice.nothing_on_plate` | slicing | no | arrange |
| `slice.orca_failed` | slicing | no | |
| `slice.no_output` | slicing | yes | |
| `slice.unreadable_output` | slicing | yes | |
| `slice.no_gcode` | slicing | yes | |
| `slice.left_off_plate` | slicing | no | arrange |
| `slice.output_unwritable` | saving | no | |
| `slice.unknown_job` | fetching | no | |
| `slice.not_ready` | fetching | yes | |
| `slice.unexpected` | slicing | no | |

Warnings (not failures): `slice.part_not_watertight`, `slice.part_inside_out`,
`slice.part_maybe_inches`. Sentences and remedies: `slice/README.md` and
`tests/test_errors.py::EXPECTED`, which produces every code through the code that raises it.

## Measurements (requirement 7)

Peak RSS of Orca (wait4), one at a time, default set (H2S 0.6, PETG, 0.24 mm). The
machine's cgroup stood at about 3.4 GB in use (mostly page cache) throughout; no plate
came near the 3 GB stop rule (highest 915 MB).

| Plate | Copies | Triangles | cm3 | Supports | Peak MB | Model MB | s | File MB |
|---|---|---|---|---|---|---|---|---|
| mechanism | 9 | 42,780 | 268.5 | off | 312 | 461 | 2.6 | 1.1 |
| mechanism | 9 | 42,780 | 268.5 | on | 309 | 646 | 2.8 | 1.1 |
| full-small (25 hubs) | 25 | 299,200 | 554.6 | off | 781 | 791 | 9.9 | 5.4 |
| organic-1 | 1 | 100,000 | 466.1 | off | 345 | 632 | 3.0 | 3.9 |
| organic-1 | 1 | 100,000 | 466.1 | on | 381 | 885 | 3.3 | 4.2 |
| organic-2 | 2 | 200,000 | 932.2 | off | 591 | 1,094 | 5.4 | 6.7 |
| organic-3 | 3 | 300,000 | 1,398.2 | off | 825 | 1,556 | 8.1 | 9.4 |
| organic-3 | 3 | 300,000 | 1,398.2 | on | 915 | 2,179 | 10.7 | 10.1 |

Fit over these and the research's nine bunny and hub plates: least squares base 73 MB,
11.4 MB per copy, 0.79 MB per cm3, supports x1.29 (under-estimates the bunny by up to
24%); upper envelope, adopted: base 170, 3 per copy, 0.985 per cm3, supports x1.4. It
never under-estimates a measured plate; it over-estimates the smooth organic body 1.8 to
2.4 times, so at 900 MB it refuses two such bodies that would take 591 MB. The 25-hub plate
(791 estimated, 781 measured) still passes. The bunny costs about twice the MB per cm3 of
the smooth body: volume alone cannot fit both, which is the model's main weakness.
Not measured: CPU time per slice, slices at once and disk (the rest of section 6.9's
list). Orca under a memory limit: with 1 GB of address space it prints `std::bad_alloc`
and returns -100 (reported `slice.out_of_memory`, in the upstream check); under 500 MB it
aborts with SIGABRT and "terminate called recursively" (reported `slice.orca_crashed`,
since nothing says memory).

## Upstream (requirement 8)

- **One pin**: `scripts/install-orca.sh` (version and three checksums), unchanged in place.
- **Real download path, once**: run into a trial folder (`PENGUIN_SLICE_ORCA_DEST`):
  135 MB AppImage downloaded and verified, hostlibs bootstrapped from Ubuntu, smoke test
  passed, `2.4.2 linux-aarch64`. GitHub's own digests for v2.4.2 equal the pinned
  checksums.
- **One command**: `make upgrade-orca VERSION=x.y.z` (`scripts/upgrade_orca.py`, 13 fast
  tests): GitHub digests, patch stop, re-pin, install, regenerate, `make test-upstream`.
- **Proved**: up to v2.5.1 (released Sat 11-14): pinned, downloaded, verified, installed;
  regeneration stopped with "machine profile 'Bambu Lab H2S 0.6 nozzle' not found". 2.5.1
  ships the BBL vendor profiles packed in an opaque `BBL.opc` file (not a zip); only
  `filament/` and `cli_config.json` are loose. Taking 2.5.x needs the flattening script to
  read that format (or Orca's own export), which is work for the owner to schedule. Back
  to 2.4.2 with the same command: installed, regenerated, upstream check 22 of 22 passed
  (23 now), and `git diff` showed no change to the profiles or the pin.
- **Upstream check**: `make test-upstream` (`tests_orca/`, 23 tests, 8.9 s), each
  docstring "Protects: ...": options, -101, -52, -50, -100 with the empty-layer wording,
  supports on, result.json after a good slice with a warning, the warn-only parts slicing,
  the `--pipe` messages, the fake's lines against the real, cancel, timeout, memory,
  placement kept, catalog, the example through the CLI and the HTTP face.
- **Seam**: everything that runs Orca or reads its output is in `slicer.py`.
- **Patches**: none; one proposed in `slice/patches/orca/README.md`.

## Test figures

Fast suite: 664 tests, 5.7 s serial, 3.4 to 4.4 s on 2 workers; slowest test 0.97 s (a
150,000-triangle part read and analysed). 20 of 20 runs passed in random order on 2
workers, seeds 2893348534, 2651515611, 2448004832, 1306718301, 1259425578, 579292073,
1418056078, 2582803799, 3392339531, 1239735691, 1319034187, 340788183, 3290929204,
920888684, 1683438882, 3539741588, 1563076333, 558549628, 162005436, 3751750929. Branch
coverage 100% on every module (1,690 statements, 428 branches); `make coverage` now fails
under 100%. One `pragma: no cover`: `slicer._child_setup`, which runs in the forked child
(the PDEATHSIG test fails without it). Real-Orca: 23 passed in 8.9 s; slowest progress
2.8 s, memory limit 2.1 s, timeout 0.5 s, catalog 0.3 s, cancel 0.2 s, the rest under
0.12 s. No test sleeps; timers are injected, deaths are awaited on a flock the fake holds.

## Every hostile case and its test

Files (`tests/test_bad_stls.py`, corpus in `tests/fixtures/bad_stls/` from
`make_bad_stls.py`, checked byte for byte): every file in `OUTCOMES` through
`test_each_bad_file_gets_a_true_answer` (empty, one byte, cut mid-triangle, count larger,
smaller, zero, ASCII, PNG, 3MF, text, NaN, infinite, absurd 1e30, all degenerate, single
triangle, flat sheet, open box, slivers and lattice, inverted normals, self-intersecting,
two shells, larger than the plate, taller than the printer, inch file, a thousandth of a
mm); dense at and over the cap: `test_a_dense_part_at_the_triangle_limit_is_read`,
`..._just_over_the_limit_is_refused`; Hypothesis (derandomized, no database, 300 examples
each): `test_random_bytes`, `test_random_bytes_behind_a_header`,
`test_a_good_file_with_bytes_changed`, `test_a_good_file_cut_or_padded`,
`test_any_coordinates_in_one_triangle`. The slivers and lattice part reproduces Orca's
empty-layers refusal with supports off: `tests_orca::test_empty_layers_with_supports_off`.

Orca misbehaving (`tests/test_orca_runner.py` on `fake_orca.py`, real child processes):
killed for memory `test_killed_by_the_kernel_for_memory` (and the real Orca under RLIMIT_AS,
`tests_orca::test_out_of_memory_under_an_address_space_limit`); crash `test_crash[segv,
abort]`; non-zero with no result.json, not-JSON result.json, exit 0 with no file,
truncated and corrupt file: `test_each_exit_is_a_truthful_report[exit_bare, bad_result,
no_output, truncated, corrupt]`; hang until timeout `test_timeout`; ignoring SIGTERM
`test_orca_that_ignores_sigterm_gets_sigkill`, `test_timeout_of_an_orca_that_ignores_sigterm`;
child left behind `test_a_child_orca_leaves_behind_is_killed`; megabytes of output
`test_megabytes_of_output_neither_block_nor_stay_in_memory`, `test_a_very_long_line_is_cut`;
invalid UTF-8 `test_invalid_utf8_is_replaced_not_fatal`; binary missing, not executable,
wrong architecture `test_missing_binary`, `test_not_executable`, `test_wrong_architecture`;
scratch unwritable `test_slicer.py::test_scratch_that_cannot_be_written`; disk full
`test_service.py::test_disk_full_while_the_plate_is_written`; profile missing or not JSON
`test_errors.py` `slice.profile_unreadable`, `test_service.py::test_a_missing_catalog_is_a_server_profile_problem`;
override outside its values `test_errors.py` `slice.bad_overrides`.

Jobs (`tests/test_jobs.py`, `tests/test_web.py`): two at once with one slot
`test_two_jobs_at_once_with_one_slot_run_one_after_the_other`; queue full
`test_queue_full`, `test_queue_full_is_503`; cancel while queued `test_cancel_a_queued_job`;
cancel at the instant it finishes `test_cancel_at_the_instant_the_job_finishes_wins_and_discards_the_file`;
cancel twice `test_cancel_twice`; late subscriber `test_late_subscriber_gets_the_latest_report_at_once`;
disconnect and return `test_a_subscriber_that_returns_resets_the_grace_time`; many at once
`test_many_subscribers_each_see_the_end`; service stopping `test_orca_does_not_outlive_a_service_that_is_killed`
(SIGKILL of a real service process) and `test_shutdown_cancels_every_job_and_waits_for_the_workers`;
finishing after the record expired `test_a_job_whose_record_is_gone_when_it_finishes_discards_its_file`.

## What I could not do, and why

- **Orca 2.5.x**: not taken; its packed `BBL.opc` profiles break the flattening script
  (above). 2.4.2 stays pinned.
- **Floating-region reason**: only in Orca's debug log; reported as `slice.orca_failed`
  with Orca's general words. Fix needs `--debug 3` log parsing or an Orca patch (note
  written, owner's decision).
- **Memory model**: rests on synthetic organic bodies plus the research's bunny figures;
  no real team plates exist here. CPU time, concurrent slices and disk were not measured.
- **Self-intersection** is not detected (Orca sliced the test case with a warning).
- **Time model** for `expected_s` is fitted by hand, within about 2x.
- **RLIMIT_AS at 500 MB** gives a crash report, not out-of-memory, because Orca's words
  ("terminate called recursively") do not say memory.
- `_child_setup` uses `preexec_fn` (ctypes `prctl`), which CPython documents as unsafe
  with threads; no deadlock was seen in any run.

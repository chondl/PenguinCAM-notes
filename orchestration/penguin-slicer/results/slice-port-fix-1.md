# Slice service, port phase: fixes for review round 1

Worked from [slice-port-review-1.md](slice-port-review-1.md), finished Thu 11-19 18:29 PT,
in `/repos/popcornpenguins/penguin-slicer/slice` and the slice service's files under
`contracts/`. No git command that writes was run.

**Status: all 14 defects answered. 13 are fixed. Defect 3 is fixed except its sentence,
which is pinned by a `known_fault` test for hardening, as the dispatch asked.**

## Stop condition

- Fast suite: 445 tests, up from 420. `make test-flakes RUNS=20 WORKERS=2` ran 20 runs in
  random order on 2 workers, each with a fresh seed (4072233216, 2656951375, ...,
  3540251114). Every run passed 445, in 0.83 to 1.14 s.
- Branch coverage: still 100% for every module (908 statements, 196 branches, none
  missed). `errors.py` now has fewer branches because the message matching is gone.
- Real Orca (`make test-orca`, serial): 10 passed in 1.87 s, up from 8.
- Mutations. The four that survived the review (m06, m07, m11, m14) are now caught. I
  also undid five of my fixes one at a time in scratch copies (r01 warnings, r02 move,
  r05 signal, r06 overflow, r08 decoding), and each one fails at least one new test. The
  unmutated copy passes 445. Scripts are in
  `/tmp/claude-1000/-repos-popcornpenguins/c507b106-b789-4d12-a830-1dcc19de2171/scratchpad/slice-fix/`.

How the tests came first: I wrote the tests for each module in a batch before or beside
its fix, not one red test per defect. The red runs that prove each new test bites are the
mutation and revert runs above.

## A change that runs through several fixes

Every exception the slice service raises now carries its error code (`error_code`) and,
when known, `where`. `errors.error_report` reads those fields. It no longer works out the
code from the exception's sentence or a template. This change is what lets the sentences
in defect 14 change safely, and it removes the second table of Orca's codes (defect 12).

## Per defect

1. **Fixed.** `slicer._warnings` gives an empty list for a `result.json` of any shape,
   and the sliced file is delivered. `read_result_json` returns `{}` for anything that is
   not a JSON object. A damaged zip entry is now `slice.unreadable_output`: this covers
   the G-code header and `slice_info.config` (zlib, CRC, EOF and unsupported compression
   errors) and `plate_1.json`. A `bbox_objects` that is null, a string or a list of
   non-objects is also `slice.unreadable_output`. Tests:
   `test_slicer` `test_result_json_of_any_shape_gives_no_warnings_and_keeps_the_slice`
   (8 shapes), `test_warnings_beside_entries_of_other_shapes_are_kept` and
   `test_corrupt_entry_in_a_readable_zip_is_unreadable_output`; `test_plate_3mf`
   `test_unreadable_plate_json` (now 8 cases) and `test_corrupt_entry_in_a_readable_zip`.
   The helper is `helpers.corrupt_entry`.
2. **Fixed.** `os.replace` within the output folder replaces `shutil.move`. A file of the
   same name is replaced. A folder of that name fails the slice with the new code
   `slice.output_unwritable`, and the folder is left as it was. Test: `test_service`
   `test_folder_with_the_sliced_files_name_is_not_success`.
3. **Partly fixed, as directed.**
   - Fixed: the detail now holds Orca's `error_string` (`orca error_string: ...`), read
     from `result.json` before cleanup, for every Orca return code.
   - Fixed: the remedy no longer contradicts the sentence ("Try another orientation or
     other print settings, and slice again.", no action). `enable_supports` is gone
     because no code can tell today that supports would help.
   - Fixed: the real Orca now produces -100. `tests_orca`
     `test_orca_general_failure_keeps_orcas_words` slices the gap part and checks the
     code, Orca's words, the remedy and that there is no action.
   - Fixed: `contracts/examples/error-report.json` is now the report the real Orca's -101
     gives (G-code conflicts). `test_errors` `test_contract_example_is_a_report_the_service_produces`
     compares every field except the detail with the code. `tests_orca`
     `test_overlapping_copies_are_refused_by_orca` compares every field, plus the
     detail's first three lines, with a real run.
   - The guide's table no longer calls -100 "an empty layer". It has a paragraph naming
     the known fault.
   - **Not fixed: the sentence** "A part has no flat face on the plate; choose another
     Lay flat." It is pinned by `test_errors` `test_known_fault_orca_minus_100_is_always_called_no_flat_face`
     and `tests_orca` `test_known_fault_orca_general_failure_says_no_flat_face`. The
     `known_fault` marker is registered in `pyproject.toml`.
4. **Fixed.** Each report now carries the measured value and the file:
   - `slice.part_unreadable`: the byte count against the length the header implies, a
     "0 triangles" header, or how many coordinates are not finite.
   - `slice.part_too_detailed`: the bytes or triangles against the cap.
   - `slice.part_too_small`: the three sides in mm.
   - `slice.bad_overrides`: which override and its value, an unknown key, or a non-object.

   `test_errors` `test_failure_produces_its_code` now checks a piece of the evidence for
   all 29 codes, and `test_detail_carries_the_evidence` is folded into it. Exact details
   are checked in `test_mesh`, `test_service` and `test_print_config`
   `test_override_outside_list_refused`.
5. **Fixed** (carried over; small and safe). A negative return status from
   `slice_plate` or `slice_stl` is the new code `slice.orca_killed`: "The print server
   stopped the slicer before it finished.", retryable, action `lower_quantities`, and the
   detail names the signal ("killed by signal 9 (SIGKILL)"). Tests: `test_slicer`
   `test_orca_stopped_by_a_signal_is_not_a_fault_of_the_part` (-9, -15, -99) and
   `test_sample_part_stopped_by_a_signal`; `test_errors` `[slice.orca_killed]`.
6. **Fixed.** `service._is_number` treats an integer that overflows a float as not a
   number, so it is `slice.bad_plate_job`. Tests: `test_service` `test_fields_refused`
   (two new cases), `test_large_integer_coordinate_is_a_refusal_not_a_bug`, and
   `test_large_but_finite_integer_is_a_number`, which checks that 10^300 still reaches
   the placement check.
7. **Fixed.** Each failure now has a true sentence and a remedy that can help:
   - B, an output folder that cannot be made, or a scratch folder that cannot be made in
     it: `slice.output_unwritable`, "The print server could not save the sliced file.",
     stage `saving`.
   - C, an STL that cannot be opened: `slice.part_unreadable`, "The file for {name}
     could not be opened.", with the OS error.
   - Q, an STL that vanishes after the check: `slice.part_missing`, "The file for {name}
     is missing.", raised from the plate writer.

   Tests: `test_service` `test_output_folder_that_is_a_file`,
   `test_stl_file_that_cannot_be_opened` (replaces `Path.read_bytes` for that one file,
   so it holds under root) and `test_stl_that_vanishes_after_the_check`; `test_plate_3mf`
   `test_stl_gone_after_the_check_is_a_missing_part`.
8. **Fixed** (carried over; small and safe). Orca's output is decoded as UTF-8 with
   `errors="replace"`. Tests: `test_service` `test_orca_output_that_is_not_utf8_is_kept_not_fatal`,
   which uses a real child process (the new fake Orca mode `garbled` prints Latin-1),
   and `test_slicer` `test_orca_output_is_decoded_as_utf8_with_replacement`.
9. **Fixed.** `test_errors.EXPECTED` writes out each code's sentence, stage, retryable
   flag, action, remedy and a piece of its detail; nothing is read from `CODES`.
   `slice.unexpected` is now produced through `slice_plate_job`, with a defect injected
   into `plate_job.write_plate_3mf`.
   - `slice.job_failed` is **removed**: nothing raises a `JobFailure` without a cause.
   - A causeless `JobFailure` is now `slice.unexpected` and keeps its words
     (`test_job_failure_without_a_cause_is_unexpected_and_keeps_its_words`).
   - The guide's table and `CODES` match, which `test_contracts` checks.
10. **Fixed.** `test_jobs` `test_failure_wakes_a_subscriber_waiting_without_a_timeout`
    covers both a `JobFailure` and an unexpected exception. The subscriber waits with no
    timeout. A `Condition` subclass signals from inside `wait`, while it still holds the
    lock, so the worker cannot fail before the subscriber is waiting; the test has no
    race. Mutation m11 fails both cases.
11. **Fixed.** `test_print_config` `test_override_outside_list_refused` now refuses
    `infill` 20.0 and `walls` 3.0, and checks the exact detail of each case.
12. **Fixed.**
    - Version: `ORCA_VERSION` in `scripts/install-orca.sh` is the one statement. The
      tests read it with `helpers.pinned_orca_version()`: `test_install_orca`,
      `test_print_config` (the catalog's `orca_version` must equal it) and `tests_orca`.
    - `tests_orca` now also checks that the G-code header says `generated by OrcaSlicer
      <pin>`, so an old stamp cannot hide a different binary.
    - The guide, `contracts/sliced-file.md`, `fake_orca.py` and `slicer.py` no longer
      state the version.
    - Return codes: `slicer.ORCA_RETURN_CODES` (return code to error code and sentence)
      is the only table, and `errors._ORCA_CODES` is gone.
    - What Orca writes: `plate_object_names`, `PLATE_JSON_ENTRY` and the reading of
      `result.json` (`read_result_json`, `orca_return_code`, `orca_error_string`) moved
      into `slicer.py`. `plate_3mf.py`, `plate_job.py`, `scripts/measure_plate.py` and
      the tests now import them from there.
    - Left as they are: `tests/fixtures/plate_1_header.gcode` and `slice_info.config`
      are recordings of Orca's output and contain "2.4.2" as recorded data. Orca's
      profile setting names stay in `print_config.py` and `plate.py`; see the hardening
      list.
13. **Fixed.**
    - `WORKERS ?= 2` and `RUNS ?= 10` in the Makefile.
    - `test-parallel` uses `-n $(WORKERS)`.
    - `test-flakes` runs `RUNS` times on `WORKERS` workers, each run with a seed drawn
      from `/dev/urandom` and printed before the run and again on failure.
    - The guide's Tests table says so.
14. **Fixed** (carried over; small and safe). The new sentences:
    - "The file for {name} could not be read as a part."
    - "A copy on the plate names a part this request does not include."
    - "The file for {name} is missing."
    - "The printer '{name}' is not one the slicer knows."
    - "A part was left off the plate." (with its full stop), with `where` naming the
      first missing copy.

    Tests: `test_errors` (every sentence), `test_mesh`, `test_print_config`,
    `test_plate_3mf` `test_where_names_the_first_missing_copy_or_nothing`.

## Same kind, found beside a listed defect, also fixed

- `slice.left_off_plate` now has a `where` (the copy), and `slice.part_too_detailed`
  from the byte cap now has its `where` and detail.
- A non-UTF-8 `result.json` is read with replacement, not treated as missing.

## For the hardening pass

- **Known fault, pinned:** the sentence for Orca's -100. The real gap part's
  `error_string` is "Failed slicing the model. Please verify the slicing of all plates on
  Orca Slicer before uploading.", so Orca's own words do not name the empty layer or its
  height either. Telling empty layers apart will need Orca's printed output or another
  source.
- `contracts/error-report.md` (not the slice service's file) still gives
  `enable_supports` as its example of an `action`. No code produces that action today. Its
  example code `slice.empty_layers` does exist.
- Orca's profile setting names (`sparse_infill_density`, `wall_loops`, `enable_support`,
  `support_type`, `brim_type` in `print_config.py`; `printable_area` and
  `printable_height` in `plate.py`) are still outside `slicer.py`. They are profile
  fields rather than files Orca writes, and belong to the upstream check's "profile
  fields" item.
- The stage `saving` is new, for `slice.output_unwritable`.
- The "not defects in this phase" items of the review still stand: no coverage
  threshold, a scratch folder left on SIGTERM, stderr dropped on a timeout, Orca still
  given the caller's `HOME`.

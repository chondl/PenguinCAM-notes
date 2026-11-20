# Slice service, hardening phase: fix round 3

Written Thu 2026-11-19, 21:50 PT, against
[slice-hardening-review-3.md](slice-hardening-review-3.md) and the coordinator's rulings in
the dispatch. Work: the uncommitted changes under `slice/` and `contracts/` in
`/repos/popcornpenguins/penguin-slicer`. Nothing committed.

**Status: every defect fixed or answered as ruled.** Every new test was run against the
reviewer's copy of the package before the fixes (`r3/repo/slice/src`, which differs from
the fixed tree in exactly the files this round changed): 64 of the new tests failed there;
the 5 that passed are guards of unchanged behaviour (a file not yet complete still fails
as the stop) and one unrelated name match.

## Per defect

### 1. A stop after Orca has written the complete sliced file: fixed

`slicer.settle` now keeps a complete sliced file after a timeout or a watchdog stop
(`KEEPING_STOPS`), whether Orca had exited or was killed by the stop's SIGTERM in the
moment after writing it. A cancel (the student's, an abandoned job's, a shutdown's) still
discards it.

**Complete**, defined once in `slicer._result` and used for a normal success and after a
stop alike:

1. the file is there under its final name (Orca writes `plate.gcode.3mf.tmp` and renames
   it once written; the real-Orca suite pins that the final name is absent at "Exporting
   3mf");
2. it opens as a zip: that needs the end-of-central-directory record and the central
   directory, the last bytes a zip writer writes, so a file cut anywhere fails;
3. the G-code header reads (`read_summary`);
4. it has `Metadata/plate_1.gcode` and, for a plate, `Metadata/plate_1.json`
   (`slicer.PLATE_ENTRIES`, checked by `verify_archive(archive, entries)`);
5. every entry decompresses and matches its CRC-32 (`testzip`).

Then, as for any plate, `run_plate_job`'s name guard checks every copy is in
`plate_1.json`. A normal success now also requires `plate_1.json` at step 4; before, its
absence failed one step later in the name guard with the same code
(`slice.unreadable_output`).

The success carries `SliceResult.stop_note`, carried to `SlicedFile.stop_note`, the job's
result and its `done` log line: "stopped by the slice service (timeout) with SIGTERM after
2.36 s, after Orca had written the complete sliced file (it opens, its directory is
intact, it has Metadata/plate_1.gcode and Metadata/plate_1.json, and every entry reads
back with its checksum): the sliced file is delivered", plus "; Orca had not written
result.json, so any warnings of its own are not known" when that is so (with the real Orca
`result.json` was there in some runs and not in others). For a watchdog stop the
`memory_note` now says "the watchdog stopped Orca only after it had written the complete
sliced file" instead of "Orca finished before the watchdog stopped it".
`contracts/sliced-file.md` says a complete file survives such a stop and that `warnings`
can then be empty.

Tests:

- Stand-in at each point, `tests/test_orca_runner.py::TestAStopAfterTheSlicedFileIsWritten`
  with three new `fake_orca.py` modes that write and then wait for a signal:
  `tmp_then_hang` (complete, under the `.tmp` name only: fails as `slice.timeout` /
  `slice.out_of_memory`), `half_then_hang` (half written under the final name: fails as
  the stop), `written_then_hang` (complete under the final name: delivered with the
  `stop_note`), each for a timeout and a watchdog stop; and a cancel at
  `written_then_hang` (`SliceCancelled`).
- `TestSettle`: a complete file after a stop that killed Orca (timeout, memory), the note
  with and without `result.json`, the memory note's wording, and an incomplete file in four
  ways (half, no `plate_1.json`, a bad checksum, absent) for each stop, each failing as the
  stop; a cancel with a complete file; a normal success missing `plate_1.json`.
- The HTTP face: `test_web.py::...test_a_stop_after_the_file_is_complete_delivers_it_with_the_stop_in_the_log`
  (`done`, `stop_note` in the result and the log line, the file served).
- The real Orca, `tests_orca/test_orca.py`, the reviewer's forcing made exact: at the
  message, the test freezes Orca with SIGSTOP (so it can neither go on nor exit by
  itself), asks the stop, and sends SIGCONT just after the stop's SIGTERM (a stopped
  process takes no SIGTERM: without that the first try escalated to SIGKILL after 5 s).
  `test_a_stop_after_orca_wrote_its_sliced_file_delivers_it[timeout|memory]`: at "All
  done, Success", delivered with the `stop_note`, 6 objects, no process left.
  `test_a_stop_while_orca_writes_its_sliced_file_is_the_stop`: at "Exporting 3mf",
  `slice.timeout`, no `plate.gcode.3mf`. The reviewer's own unfrozen way (stop at "All
  done, Success", `fix3/probe_real.py`): before the fix `slice.timeout` and
  `slice.out_of_memory` with `plate.gcode.3mf` on disk; after it, both delivered, 83
  layers.

### 2. An outside kill or a crash just before a stop: fixed

`slicer.run_process` now reports a stop in `OrcaExit.stopped` only when it is what ended
Orca. When the slice service sent only SIGTERM (not escalated) and Orca ended on another
signal, or when Orca was already ending as the stop was asked, the reason goes to
`OrcaExit.overtaken`, `settle` reports Orca's own ending (`slice.orca_killed`,
`slice.orca_crashed`, or `slice.out_of_memory` on the kernel's count), and the stop is
named only in the detail's second line: "the slice service had asked it to stop (timeout)
and sent SIGTERM, which is not what ended it", or "it was already ending when the slice
service asked it to stop (timeout)".

"Already ending" is `slicer.orca_dying(pid)`, read from `/proc/<pid>/status` and `stat`
just before the SIGTERM (`DYING_PROBE`, injectable): a zombie, `PF_EXITING`,
`CoreDumping: 1`, SIGKILL pending, or a pending signal it neither handles, ignores nor
blocks whose default action ends a process. It is what tells someone else's SIGTERM from
the service's own. Its limit, stated plainly: between the kernel dequeuing the pending
SIGKILL and setting the exit flag there are a few instructions in which a reader sees
neither; a stop asked in exactly that instant after an outside SIGTERM is still reported
as the stop. An outside SIGKILL or a crash does not depend on the probe: the signal Orca
ended on decides.

A cancel overtaken this way ends the job `failed` with the kill or the crash, which the
guide's "Cancelling" paragraph now says. A stop the service escalated to SIGKILL is the
stop, as before. Per the ruling's wording, a stop followed by someone else's SIGKILL in
the grace time (Orca ignoring the SIGTERM) is now `slice.orca_killed`; the reviewer's
scratch probe had called the old answer (the stop) right, but it is exactly "sent only
SIGTERM, ended on another signal".

Tests, `test_orca_runner.py::TestAnOutsideSignalThenAStop`: the reviewer's five pairs and
the sixth (SIGKILL and SIGSEGV, each then a timeout, a watchdog stop, a cancel), held in
the moment before the kernel has torn Orca down so the stop is really sent; the same with
the real probe and no holding (code only, deterministic either way); someone else's
SIGKILL in the grace time; an outside SIGTERM with the probe saying "ending" (three
reasons); an Orca exiting by itself while the stop is asked (its own `slice.orca_too_close`
kept, or its file delivered); an escalated stop is still `slice.timeout`.
`TestOrcaDying`: eleven process states on a written process table, an unreadable entry,
this process. Real Orca: `test_an_outside_kill_just_before_a_timeout_is_reported_as_the_kill`
(`slice.orca_killed`; the probe saw the pending SIGKILL: "it was already ending").

### 3. An abandoned job that finishes as the sweeper cancels it: intended, as ruled

No behaviour changed. The state is `cancelled`; the `cancelling` and `cancelled` log lines
carry `"cancel_reason": "abandoned"`, and the `cancelled` line now also carries
`file_discarded` (the finished sliced file's name) whenever a cancel threw away a finished
slice, so the log says exactly what happened. The guide's "Cleanup" paragraph says it in
the ruling's words (nobody is waiting for the file; it ends `cancelled` like a student's
cancel; a subscriber who comes back finds `cancelled`), and the `jobs.py` docstring the
same. Test:
`test_jobs.py::TestAbandoned::test_an_abandoned_job_that_finishes_as_it_is_cancelled_ends_cancelled_like_a_callers_cancel`.

### 4. A log sink that raises: fixed

`jobs.SafeLog` is the one place a sink's failure is caught: it counts it and goes on.
`JobPool` wraps its log in it (not twice), `web.create_app` wraps its log in it and hands
the same one to the pool it makes, so refusals and job lines are counted together;
`JobPool.log_failures()` reads the count. The HTTP face has no health answer, so none was
added; the guide says where the count is. Tests, `test_jobs.py::TestALogThatFails`: five
jobs through a sink that always raises, with `max_queued=2`, all `done`, the queue empty,
15 failures counted (the reviewer's wedge); a failed job still cleaned up; a cancel and a
sweep still work; the sweeper survives a failing sink while it reports a failing sweep;
a healthy sink counts nothing; a SafeLog is not wrapped twice. `test_web.py`: a refusal
and a full slice through a sink that raises, the answers unchanged, 4 counted.

### 5. A part name with no length limit: fixed

A part `name` over 200 characters (`service.MAX_PART_NAME_CHARS`) refuses the plate job
with `slice.bad_plate_job`: "This plate job could not be read: part 'box' has a name of
300,000 characters, longer than the 200 a part name may have." Stated in
`contracts/plate-job.md` (Part table) and the guide's code table.

Of the same kind, found beside it and fixed: a `printer`, `filament` or `process` name was
echoed whole into the sentence ("The printer '...' is not one the slicer knows.") and the
detail; one over 200 characters (`MAX_PROFILE_NAME_CHARS`) now refuses in step 1, and a
non-string one is shown through `print_config._shown` (cut to 120 characters). That
helper also stops a deeply nested `printer`, `filament`, `process` or override value from
raising `RecursionError` out of the check, which made a 500 `slice.unexpected`. A bug's
own words in `slice.unexpected` (and the HTTP face's `slice_http_error` log line) are cut
at 2,000 characters (`jobs.exception_text`). The other caller texts were already capped
(keys 64, `stl` 1,024, every `_short` 120, upload field names 60, paths 80, the refusal
line's parts and uploads 100 each).

Tests, `test_service.py`: a 300,000-character name refused with that sentence, 200
accepted, each profile name over the limit, a printer that is a 100,000-element list or
nested 100,000 deep, filament and process that are not names, and one test sending twelve
hostile 300,000-character values (name, stl, part key, ref, orientation, x, an unknown
field at each level, printer, an override key and value): none is `slice.unexpected`,
every sentence under 300 characters, every detail under 2,000. `test_errors.py`: the cut of
a bug's words.

### 6. "Has holes" for a surface with no hole: fixed

With no open edge, `slice.part_not_watertight` now says "Box has faces laid on top of each
other (18 edges shared by more than two faces, 1 separate pieces); if the slice fails or
looks wrong, repair it in CAD." (`mesh.OVERLAID_FACES_MESSAGE`); with open edges it keeps
"has holes in its surface". The code is unchanged. Tests, `test_mesh.py::TestWarnings`:
every face doubled, and a box over its mirror image (the reviewer's two files), and a part
with both open and overused edges keeping the holes wording. Guide's checks table and
`contracts/plate-job.md` updated.

### 7. An interrupt while `Stop`'s lock is held: fixed

`python -m penguin_slice slice` now installs `__main__._stop_on_signals(stop)`: the
SIGINT/SIGTERM handler only writes the signal's number to a non-blocking pipe (no lock,
nothing that can wait); a relay thread reads the pipe and calls `stop.set()`, and ends when
the block ends. `Stop` is unchanged. `serve`'s handler only raises and was not touched.
Tests, `test_cli.py`: the reviewer's `stop_lock.py` as a test, for SIGINT and SIGTERM (the
lock held on the main thread, the signal sent, the handler returns, the stop is set once
the lock is free, with the right reason); the relay ends with its block and the old
handlers are back. The existing Ctrl-C test still passes through the relay.

### The guide's watchdog paragraph

Rewritten as ruled: over the ceiling a slice may be stopped or may finish and be delivered
with a note, depending on timing, and the same plate job sent twice can get the two
answers; it is never silent, and the peak reported is the true peak. It gives both
measurements: the builder's (12 hubs, 5 % under, 6 of 6 stopped) and the reviewer's (6
hubs, under the peak 9 of 12 stopped and 3 delivered with the note, over it 12 of 12
delivered with no note, every reported peak at or above the free slices'). "How a slice
ends" is now a numbered list carrying defects 1 and 2.

## Files changed this round

`slice/src/penguin_slice/`: `slicer.py`, `jobs.py`, `web.py`, `service.py`,
`print_config.py`, `errors.py`, `mesh.py`, `__main__.py`. `slice/tests/`: `fake_orca.py`,
`test_orca_runner.py`, `test_jobs.py`, `test_web.py`, `test_service.py`, `test_errors.py`,
`test_mesh.py`, `test_cli.py`, `test_slicer.py` (its stand-in for Orca writes
`plate_1.json` for a plate, as Orca does). `slice/tests_orca/test_orca.py`.
`slice/README.md`. `contracts/plate-job.md`, `contracts/sliced-file.md`. My probes:
`/tmp/claude-1000/-repos-popcornpenguins/c507b106-b789-4d12-a830-1dcc19de2171/scratchpad/fix3/`.

## Test figures

- **Fast suite:** 858 tests (781 before this round). `make -C slice test-flakes RUNS=40`
  (2 workers, a new random seed each run): **40 of 40 passed**, wall time 3.82 s at best,
  4.08 s median, 4.44 s at worst (log `fix3/flakes40.log`).
- **Coverage:** `make -C slice coverage`: 100 % of statements and of 512 branches (482
  before) in all 13 modules; it has not fallen.
- **Real-Orca suite:** `make -C slice test-upstream`, once, one Orca at a time: **32 passed
  in 20.9 s** (28 before). The four new ones: a stop at "All done, Success" for a timeout
  2.29 s and a watchdog stop 2.35 s, a timeout at "Exporting 3mf" 2.11 s, an outside
  SIGKILL then a timeout 0.21 s (log `fix3/upstream.log`). No Orca and no stand-in was
  left afterwards.

## What I could not do

- `orca_dying` has an instant of a few instructions in which a dying process shows
  neither its pending SIGKILL nor its exit flag (see defect 2); no reader of `/proc` can
  close it. It matters only when someone else's SIGTERM and a stop land in the same
  instant. The fast suite therefore injects the probe for that case and tests the probe
  itself on a written process table, so no test depends on the timing.
- The HTTP face has no health answer, so the log failure count is in
  `JobPool.log_failures()` only. No endpoint was added, as the ruling did not ask for one.

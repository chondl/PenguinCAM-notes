# Fix round 2: slice service, hardening phase

Worked from [slice-hardening-review-2.md](slice-hardening-review-2.md) under
[fix.md](../briefs/fix.md), [standing-rules.md](../briefs/standing-rules.md),
[slice-hardening.md](../briefs/slice-hardening.md), [upstream.md](../briefs/upstream.md)
and the coordinator's rulings in the dispatch line. Finished Thu 11-19 21:05 PT. All six
defects are fixed. The work is uncommitted changes under `slice/` and `contracts/` in
`/repos/popcornpenguins/penguin-slicer`.

Before I started, the stray stand-in child from an earlier test run (process 102887,
`pytest-661/.../test_a_child_orca_leaves_behin0`) was still alive. I stopped it with
`kill 102887`. No run of mine left a process behind.

## Figures

| | Round 2 review | Now |
|---|---|---|
| Fast suite | 729 tests, 5.6 s wall serial | 781 tests, 5.2 s wall serial (4.95 s as pytest reports it) |
| 20 runs, random order, 2 workers (`make test-flakes RUNS=20`) | | **20 of 20 passed**, 3.30 to 3.80 s each |
| `test_orca_runner.py` + `test_web.py`, 40 runs on 2 workers | | 40 of 40 passed |
| Branch coverage (`make coverage`) | 100 %, 1,833 statements, 466 branches | **100 %**, 1,911 statements, 482 branches, all 13 modules |
| Real-Orca suite (`make test-upstream`) | 27 passed, 10.8 s | 28 passed, 12.8 s |

## Hand mutations

Each mutation was made in a scratch copy of `slice/` and the fast suite was run on 2
workers. The script is `/tmp/claude-1000/-repos-popcornpenguins/c507b106-b789-4d12-a830-1dcc19de2171/scratchpad/fix2/mutate.py`
and its log is `mutate.log` in the same folder. "Left" means stand-in processes still
alive after the run.

| Mutation | Result |
|---|---|
| N1 the watchdog never stops Orca | 7 fail, **53.7 s**, none left (once: hung past 120 s) |
| N20 the ceiling setting is ignored | 5 fail, **13.5 s**, none left (once: hung) |
| N5 a stop asked after Orca's exit counts (round 2's code) | 9 fail (once: not noticed) |
| N5b no "still running" check before the stop | 9 fail |
| N6 the last stop reason wins | 3 fail (once: not noticed) |
| N21 the watchdog reads only resident memory | 4 fail |
| N31 the reader ignores `VmHWM` | 1 fails |
| N22 a finished sliced file does not win over a stop | 3 fail |
| N23 the reported peak is the watchdog's alone | 3 fail |
| N24 no note for a delivered slice over the ceiling | 2 fail |
| N25 a refusal at `POST /slices` is not logged | 10 fail |
| N32 a Werkzeug HTTP error at `POST /slices` is not logged | 1 fails |
| N26 a full disk while an upload is saved is `slice.unexpected` | 1 fails |
| N27 / N28 / N29 the ASCII test is case-sensitive / blind to a byte-order mark / the count rule is gone | 1 fails each |
| N34 the waiter's note is not set when its wait fails | 1 fails in 13.5 s (bounded) |
| N33 the cleanup reaps Orca before the waiter has noted the exit | not noticed: N34's guard covers it alone (see defect 3) |

## Per defect

### 1. The watchdog missed Orca's peak: fixed

**How.** `slicer.group_memory_kb` replaces `group_rss_kb`. For every process in Orca's
group it reads `/proc/<pid>/status` and returns the group's summed `VmRSS` and summed
`VmHWM` (the kernel's high-water mark). The watchdog compares the higher of the two with
the ceiling, so a spike between two samples shows up at the next sample. As the
coordinator ruled:

- If Orca finishes by itself before the watchdog stops it, `slicer.settle` delivers the
  sliced file, even when the peak read at exit is over the ceiling.
- In that case `SliceResult.memory_note` holds the measured peak, where it was read, the
  ceiling, and the words "Orca finished before the watchdog stopped it: the sliced file is
  delivered". The note goes through `service.SlicedFile` into the pool's result
  (`memory_note`) and into the `done` log line.
- The reported peak is now `OrcaExit.peak_kb`, the higher of the watchdog's high-water
  reading and the kernel's `ru_maxrss` at exit. It is used for `peak_rss_kb` in the log,
  the result, the error detail and the note, so it is never under Orca's own peak. The
  detail names both readings, for example: "Orca's processes reached a peak of 456,292 kB
  (the watchdog's high-water reading 456,292 kB, Orca's ru_maxrss at exit 456,292 kB),
  over the ceiling of 436,224 kB (PENGUIN_SLICE_MAX_PEAK_MB=426)".
- The guide has a new paragraph, "What the ceiling guarantees", with the coordinator's
  sentence: the ceiling protects the server from a slice that keeps growing and is not a
  promise that no delivered slice ever touched it. `contracts/plate-job.md`, "Memory",
  says the same.

**Real Orca, one process at a time.** The plate was 12 hubs of 20,000 triangles, through
the HTTP face (`fix2/real_runs.py`, results in `fix2/real_at426.jsonl`).

| Run | Ceiling | Outcome | High-water reading (kB) | ru_maxrss (kB) | Highest current figure (kB) |
|---|---|---|---|---|---|
| baseline | 900 MB | done, 4.5 s | 459,292 | 459,292 | 387,824 |
| 1 to 6 | 426 MB (5 % under 459,292 kB) | **`slice.out_of_memory` six times of six** | 442,036 to 457,204 | equal to the high-water reading in every run | 362,004 to 379,624 |

Six runs gave one verdict. In every run the watchdog's reading equalled the kernel's
peak. The current figure alone, which the watchdog used to read, was 14 to 18 % under the
peak, as the reviewer found. Failed jobs left no files and no Orca.

**Tests.**
- `TestMemoryWatchdog` in `test_orca_runner.py`:
  - `test_a_spike_between_samples_is_seen_through_the_high_water_mark` (resident 600 MB,
    high-water 930 MB, ceiling 900 MB: stopped);
  - `test_a_peak_over_the_ceiling_after_the_last_sample_is_delivered_with_a_note`;
  - `test_a_slice_under_the_ceiling_has_no_note`;
  - `test_the_peak_reported_is_never_under_either_reading` (5 cases);
  - `test_the_reader_sums_orcas_process_group`, now with `VmHWM`, a process with no
    high-water line, and a process gone between its `stat` and its `status`.
- `TestEveryPlateJobIsLogged::test_a_delivered_slice_over_the_ceiling_is_noted_in_its_result_and_log`
  in `test_web.py`.
- Real Orca: `tests_orca/test_orca.py::test_the_watchdog_sees_a_real_orcas_peak_through_its_high_water_mark`.
  It slices the heavy plate once to measure its peak, then again at a ceiling 5 % under
  it. The second slice must be either stopped, with a high-water reading over the
  ceiling, or delivered with the note. It must never be delivered silently. Seen: peak
  269,272 kB; at 249 MB it was stopped with a reading of 267,816 kB.

### 2. Refused plate jobs left no log line: fixed

**How.** `web.submit` now ends in one place. Every answer that is not 202 writes one log
line through `log_refusal`. The line has `event` `slice_job`, `state` `refused`,
`http_status`, `error_code`, `error_detail`, `parts` (key, name and `stl` of each part
the plate job named, at most 100), and `uploads` (each file field's name and size in
bytes). The other exit paths that logged nothing now log too:

- the 413 handler;
- the Werkzeug `HTTPException` handler when the request was `POST /slices`;
- the handler for unexpected exceptions on `POST /slices`, as a refusal line with the
  traceback.

The guide's "The log" paragraph describes the line.

**Tests (`TestEveryPlateJobIsLogged`, 15 tests):** each one asserts exactly one refusal
line whose code and detail equal the answer's. They cover:

- an HTML page sent as the STL (with its size);
- an empty STL;
- a plate job that is not JSON (no parts, with its upload size);
- no `plate_job` field;
- an upload named as a path;
- a full queue;
- an upload too large;
- a body that is not a form;
- a work folder that cannot be written;
- a full disk while an upload is saved;
- a bug while the plate job is read;
- a bug outside `submit`'s own handling;
- a Werkzeug HTTP error;
- a part that is not an object.

### 3. Tests could hang the suite: fixed, across the suite

**How.** Three layers:

1. **Bounded waits.** Every test that waits on a stand-in Orca that only a stop can end
   now runs it through `helpers.bounded`. `FAILSAFE_S`, `bounded` and `kill_fake` moved
   from `test_orca_runner.py` to `helpers.py`. If the slice has not returned in 10 s, the
   test fails with "the watchdog never stopped Orca within 10 s" and kills its stand-in.
   The tests are:
   - the three named by the reviewer: `TestMemoryWatchdog::test_orca_past_the_ceiling_...`,
     `test_the_ceiling_is_the_setting`, and the `over_the_memory_ceiling` scene in
     `test_errors.py`, which serves three tests;
   - one more of the same kind that the review did not name:
     `test_limits.py::TestMeasurePlate::test_measure_stops_a_slice_over_the_stop_rule`.
2. **A bound for every test in the suite.** `conftest.no_test_can_hang` is an autouse
   fixture. It arms a SIGALRM in the test's own process; tests run in the main thread,
   also under xdist. Any test still running after 20 s raises `Hung`, a `BaseException`,
   so no `except Exception` in the code under test can swallow it. The message says the
   test waits on a process, a thread or an event that never came.
3. **The stand-in ends itself.** `tests/fake_orca.py` and the child it can start call
   `signal.alarm(LIMIT_S)` with `LIMIT_S` = 25 s, so a stand-in can never outlive a
   failing test.

**A hang of the same kind, in `slicer.run_process`, found and fixed.** When the wait for
Orca ended by an exception (an interrupt, or the new hang bound), the cleanup reaped Orca
with `wait4` before the waiter thread had noted the exit. The waiter's `waitid` then
failed, so the note was never set, and the watchdog's `join` waited for ever. My probe
saw exactly this. Two fixes, either of which is enough on its own:

- the cleanup now waits for the waiter's note before it reaps Orca;
- the waiter sets the note in a `finally`.

Tests:
- `test_an_interrupt_while_orca_runs_kills_it_and_returns` (a SIGUSR1 handler raises
  while a stand-in that ignores SIGTERM runs);
- `test_a_wait_for_orcas_exit_that_fails_still_ends_the_run` (kills mutation N34).

Removing only the wait before the reap (N33) is not noticed, because the `finally` alone
prevents the hang. A test that would notice it depends on thread timing, so I wrote none.

**Proof, in a scratch copy:**
- With the watchdog's stop removed (N1), the suite fails 7 tests in 53.7 s on 2 workers
  and leaves no process. Round 2: hung past 120 s and left five processes.
- With the ceiling setting ignored (N20), it fails 5 tests in 13.5 s and leaves no process.
- A scratch test that waits on an event that never comes, and one whose stand-in ignores
  SIGTERM and is never stopped, each failed with the `Hung` message in 20.4 s on 2
  workers, with no process left (`fix2/hang_probe.log`).

### 4. A stop that arrived just after Orca ended was reported as the stop: fixed

**How.** The ordering now lives in one place, `slicer.settle`, and its docstring and the
module docstring state it:

1. A finished sliced file is never discarded. When Orca exited 0 and its sliced file
   reads and verifies, the slice succeeds, whatever stop was asked.
2. Then a stop the slice service sent while Orca was still running. `memory` is
   `slice.out_of_memory`, `timeout` is `slice.timeout`, anything else is a cancel.
3. Then Orca's own ending (`_exit_error`, which was `_check_exit`).

`run_process` now counts a stop only if Orca is still running at the moment it would be
signalled. `_still_running` checks with `waitid(WEXITED | WNOHANG | WNOWAIT)`, which
does not reap Orca. A stop asked after Orca ended is never sent and never reported. The
first reason asked is the one reported, which `Stop` already did and a test now pins.

**Tests.**
- `TestASlowNoteOfTheExit::test_orcas_own_ending_wins`, 12 cases. Four endings (a crash,
  a SIGTERM from outside, a plate refusal, a finished sliced file) are each combined with
  three stops asked after the exit (timeout, memory, cancel). The waiter's note is held
  back until the group has been signalled, the same delay as the reviewer's probe. The
  crash is `slice.orca_crashed` and the finished file is delivered, never "stopped by the
  slice service".
- `TestWhichStopIsReported`: the first reason is kept; a cancel after a watchdog stop
  reports the watchdog; a timeout after a cancel reports the cancel.
- `TestSettle` (7 cases): Orca finished after a stop was sent, so its file is delivered; a
  stop with no finished file is the stop; no stop and no file is `slice.no_output`.

**For the coordinator to rule on.** "Success wins every race against a stop" now holds
inside the slicer for every stop, the cancel included. One layer up, the job pool still
applies a cancel the student asked for before the final report: if the student cancels
as a slice finishes, the job ends `cancelled` and its sliced file is discarded. That rule
predates this round, and mutation N19 pins it. I kept it, because it is the student's own
request and `DELETE` has already answered `cancelling`. The guide's "How a slice ends"
and "Cancelling" paragraphs say so. If the ruling means a cancel too, the change is one
condition in `jobs.JobPool._run` and one test.

### 5. A full disk while an upload was saved was "The slicer failed unexpectedly.": fixed

**How.** An `OSError` from `FileStorage.save` is now `slice.scratch_unwritable`, "The
print server could not write the slicer's working files.", HTTP 500. The detail names the
upload ("saving the upload 'box.stl': OSError: [Errno 28] No space left on device"). The
job's folder is removed. The guide's HTTP face paragraph lists the case.

**Test:** `TestEveryPlateJobIsLogged::test_a_full_disk_while_an_upload_is_saved` checks
the code, the detail, the log line and the empty work folder.

### 6. Three kinds of file got a false sentence: fixed

**How (`mesh._not_binary`).**
- The ASCII STL test skips a UTF-8 byte-order mark and ignores case for both `solid` and
  `facet`.
- Signatures for PDF, JPEG and UTF-16 byte-order marks join PNG, zip and gzip.
- A file whose bytes 80 to 84 give a triangle count implying more bytes than
  `MAX_PART_BYTES` is "not an STL file", not "cut off". Its detail says the header's
  count describes a file larger than any part the service takes.

**Tests.** Five new corpus files, written by `make_bad_stls.py`, each with its expected
answer in `test_bad_stls.py::OUTCOMES`:

- `ascii_capitals.stl` and `ascii_with_bom.stl`: "is a text STL; the slicer needs a
  binary STL";
- `pdf.stl` and `jpeg.stl`: "is not an STL file";
- `utf16_text.stl`, UTF-16 with no byte-order mark, which only the count rule catches:
  "is not an STL file".

The guide's checks table lists them.

## The upgrade command's run to another version and back

The guide's "Taking a new upstream version" section now has a part titled "What happened
when the command was run to other versions and back". It records both earlier runs, with
what was run, what failed on the other version and why:

- Up to 2.5.1: the profile regeneration stopped, because 2.5.1 packs the Bambu Lab
  profiles in `BBL.opc`.
- Down to 2.4.1: the upstream check failed one test, on the catalog's `skipped` list,
  and the command stopped with its way back.

It also records that coming back to 2.4.2 restored the pin with no changes. I did not run
the command again in this round. Its code did not change, and a run rewrites repository
files. The record comes from [slice-hardening.md](slice-hardening.md) and
[slice-hardening-fix-1.md](slice-hardening-fix-1.md).

## Files changed

- `slice/src/penguin_slice/`: `slicer.py`, `web.py`, `mesh.py`, `service.py`, `jobs.py`.
- `slice/tests/`: `conftest.py`, `helpers.py`, `fake_orca.py`, `test_orca_runner.py`,
  `test_web.py`, `test_errors.py`, `test_limits.py`, `test_bad_stls.py`,
  `fixtures/make_bad_stls.py`, and five new files in `fixtures/bad_stls/`.
- `slice/tests_orca/test_orca.py`.
- `slice/README.md`.
- `contracts/plate-job.md`.

The scratch probes are in
`/tmp/claude-1000/-repos-popcornpenguins/c507b106-b789-4d12-a830-1dcc19de2171/scratchpad/fix2/`.

## What I could not do

- I wrote no test that notices N33 (see defect 3); the guard that covers it is tested.
- I did not repeat a real kernel out-of-memory kill. As in round 2, the cgroup is not
  ours.

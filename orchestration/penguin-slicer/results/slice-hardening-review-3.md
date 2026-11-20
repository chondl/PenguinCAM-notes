# Review 3 of the slice service, hardening phase

**Verdict: FIX, 2 defects that matter at the place a run's end is decided, and 5 minor
ones.** Written Thu 2026-11-19, 21:20 PT. Reviewed: the uncommitted changes under
`slice/` and `contracts/` on top of `c2c9a3c`, judged against
[slice-hardening.md](../briefs/slice-hardening.md), [upstream.md](../briefs/upstream.md)
and the coordinator's three rulings (the estimate never refuses and the watchdog guards
memory; a finished sliced file is never discarded by a stop the slice service decides on;
a cancel the caller asked for discards it).

**Overall judgement.** The slice service is close. The fast suite did not fail once in 40
random-order runs, coverage is 100 % of branches, every hostile file I added got a true
sentence, every plate job I sent left a log line, and nothing was left behind (no process,
no file) in any ending I forced, with the stand-in or with the real Orca. I would not
commit it as "hardened" yet for one reason: the place where the end of a run is decided
still gets two orderings wrong with the real Orca (defects 1 and 2). Both need a
coincidence of some milliseconds, so neither will bite often; both are exactly the class
the last two rounds were about, and both have a small fix and a deterministic test. If the
coordinator rules that defect 1 is outside ruling 2 (Orca did not "exit by itself") and
accepts defect 2 as a known rare misreport, the component is fit to commit with those two
written into the guide. The other five are small and can ride with the same fix round or
be ruled out.

Terms used below: **stop** means a stop the slice service sends to Orca (a timeout, a
watchdog stop, or a cancel); **outside kill** means a signal to Orca that the slice service
did not send; **stand-in** is `tests/fake_orca.py`.

My scratch files are in
`/tmp/claude-1000/-repos-popcornpenguins/c507b106-b789-4d12-a830-1dcc19de2171/scratchpad/r3/`
(`test_r3_hostile.py`, `real_orca.py`, `stop_lock.py`, `run_mut.sh`, and the logs named
below). No file in the repository was changed.

## Probe (a): where the end of a run is decided

`slicer.settle` and the line in `run_process` that decides whether a stop counts
(`slicer.py` line 593) were read and then driven two events at a time.

With the real Orca (6 hubs of 20,000 triangles, 2.4 s a slice, one process at a time;
`real_orca.py races`, log `real_races.log`):

| Ordering | Runs | Outcome | Judgement |
|---|---|---|---|
| timeout asked at Orca's last message ("All done, Success") | 3 | `slice.timeout` 3 of 3; the complete sliced file was on disk | **defect 1** |
| watchdog stop asked at the same point | 3 | `slice.out_of_memory` 3 of 3; the complete sliced file was on disk | **defect 1** |
| cancel asked at the same point | 3 | cancelled 3 of 3 | right (ruling 3) |
| timeout, cancel asked at "Exporting 3mf" | 2 each | `slice.timeout`, cancelled; only `plate.gcode.3mf.tmp` on disk | right: the file was not finished |
| outside SIGKILL | 1 | `slice.orca_killed`, "oom_kill count did not change" | right (ruling 1) |
| outside SIGTERM | 1 | `slice.orca_killed` | right |
| outside SIGSEGV | 1 | `slice.orca_crashed` | right |
| outside SIGKILL, then a timeout asked at once | 1 | `slice.timeout` | **defect 2** |
| outside SIGKILL, then a cancel asked at once | 1 | cancelled | right for the caller |
| cancel before Orca starts | 1 | cancelled after 0.002 s | right |
| watchdog at 100 MB and a timeout asked first | 1 | `slice.timeout` (the first reason asked) | right as documented |
| a plain slice after all of these | 1 | delivered | the service was left usable |

After every run: no process whose working folder was the slice's (`/proc/*/cwd`), and one
thread left in the probing process.

With the stand-in (`test_r3_hostile.py`, log `hostile.log`, 70 scratch tests, 1.6 s):

- An outside signal first, a stop asked at once after it (5 pairs: SIGKILL with cancel,
  timeout, memory; SIGSEGV with cancel, timeout): every one was reported as the stop,
  "stopped by the slice service (timeout) with SIGTERM". **Defect 2.** The existing
  `TestASlowNoteOfTheExit` covers only an Orca that has already become a zombie; mine
  covers the moment between the signal and that.
- A stop first, an outside SIGKILL in the grace time: reported as the stop. Right: the
  service did stop it.
- A caller's cancel after `settle` had already returned success: the job ended
  `cancelled`, log `queued, running, cancelling, cancelled`, no file left in the work
  folder. Right (ruling 3).
- A caller's cancel and a crash together: the job ended `failed` with
  `slice.orca_crashed` and `cancel_reason` in the log. Not a defect: it is true and the
  guide says so ("or `failed` when it had already failed").
- An abandonment (the sweeper's cancel) at the instant the worker returns a finished file:
  the job ended `cancelled` and the file was discarded. **Defect 3** (a ruling is needed).
- Seven endings through the HTTP face (ok, crash, cancel of a hang, refusal, truncated
  file, SIGKILL, no output): exactly one final log line each, the right code, and no file
  left except the delivered slice's.

## Probe (b): the watchdog with the real Orca near a plate's true peak

`real_orca.py peaks`, log `real_peaks.log`. Four slices with the ceiling out of reach gave
peaks of 265,540 to 269,336 kB. Then four runs at each ceiling:

| Ceiling | Stopped `slice.out_of_memory` | Delivered with `memory_note` | Delivered, no note |
|---|---|---|---|
| 10 % under the lowest peak (233 MB) | 3 | 1 | 0 |
| 3 % under (251 MB) | 3 | 1 | 0 |
| 0.5 % under (258 MB) | 3 | 1 | 0 |
| 0.5 % over the highest peak (264 MB) | 0 | 0 | 4 |
| 3 % over (271 MB) | 0 | 0 | 4 |
| 10 % over (290 MB) | 0 | 0 | 4 |

- **Over the peak the outcome is consistent**: 12 of 12 delivered, none noted, none
  stopped.
- **Under the peak the outcome is not consistent: 9 stopped, 3 delivered, of 12.** It is
  never silent and never wrong: each delivered one carried the note, each stopped one the
  measured peak. The cause is this plate: its memory rises from about 210 MB to about
  270 MB in the last 150 ms, while Orca writes the 3MF (every stopped run was stopped at
  2.27 to 2.53 s of a 2.4 s slice, with `plate.gcode.3mf.tmp` on disk), so whether a
  0.25 s sample lands before Orca exits is chance. The guide's own figure (six of six
  stopped, 12 hubs, 5 % under) does not hold for this plate. **Not a defect under ruling
  2**, which says the ceiling is not a promise; but the same plate job sent twice can get
  two different answers, and the guide should say that in those words instead of quoting
  only the six-of-six measurement.
- **The peak reported is the true peak.** Stopped runs reported 264,048 to 273,188 kB, the
  watchdog's high-water reading equal to `ru_maxrss` in all 9. Delivered-with-note runs
  reported 270,332 to 274,620 kB from `ru_maxrss`, with the watchdog's last reading (194
  to 214 MB) shown beside it. All are at or within 2 % above the free-run peaks; none is
  under.
- No process and no FIFO was left by any of the 28 runs.

## Probe (c): every plate job leaves a log line

I tried 60 ways for a plate job to reach `POST /slices` and looked for one that logs
nothing (`hostile.log`). Found none on the offered path:

- every bad STL (33 of my own, below): one `refused` line, or `queued` then one final line;
- no `plate_job` field, `plate_job` sent as a file, an empty one, a BOM, NaN, `1e999`, a
  5,000-digit integer, JSON nested 200 to 100,000 deep (in the value and inside a part),
  duplicate keys, two `plate_job` fields: one line each, no traceback, no recursion error;
- a JSON body, an empty body, a urlencoded body, a multipart body cut short, a body shorter
  than its Content-Length, 2,000 form fields, a 800 kB `plate_job` field (413), a client
  that goes away while sending (`ClientDisconnected`, and a `ConnectionResetError` from
  the stream): one `refused` line each. For the vanished client the sentence is "the
  request has no plate_job field", which is not what happened, but nobody is there to read
  it and the line is logged. Not a defect.
- uploads: the same name twice, an extra file, an STL sent as a text field, `stl` values
  `/etc/passwd`, `../../../../etc/passwd`, `.`, `..`, `~/box.stl`, `$HOME/box.stl`, a
  trailing newline, 1,000 slashes: each refused with a true sentence or accepted as the
  same file, one line each, nothing left in the work folder after a refusal.
- `POST /slices/` (trailing slash) answers 404 `slice.bad_request` and logs nothing. Not a
  defect: it is not the offered path and the sentence says so.

What a line carries: I searched every line of the seven endings for the values of the
secrets in this shell's environment; none. Orca gets an allowlisted environment, tracebacks
carry no values, and the refusal line caps names (80 characters), `stl` values (120) and
the number of parts and uploads (100). Two things I would change, both minor:
**defect 5** (the queued job's lines do not cap a part's name) and **defect 4** (a log
sink that raises wedges the queue). The lines carry no time of their own; a host's log
collector normally adds one, so I list that as an observation only.

## Probe (d): no test can hang

Eight regressions of my own, each in its own scratch copy of the package, the whole fast
suite on 2 workers against each (`run_mut.sh`, logs `mut-m1.log` to `mut-m8.log`). The
baseline of the scratch copy has one failure of its own
(`test_slicer.py::TestOrcaLocation::test_default_...`: the copy has no `tools/`), which is
not counted below.

| Regression put back | Tests that failed | Suite wall time | Stand-ins left |
|---|---|---|---|
| no SIGKILL after the grace time (an Orca that ignores SIGTERM is never killed) | 2 | 23 s | 0 |
| no final SIGKILL of Orca's group (a child left behind lives on, an interrupt leaves Orca) | 14 | 145 s | 0 |
| a cancel of a running job never reaches its `Stop` | 4 | 35 s | 0 |
| a cancelled job's files are not removed | 1 | 4.0 s | 0 |
| a watchdog stop is not reported (falls through to Orca's own ending) | 9 | 4.3 s | 0 |
| a full queue answered 202 | 2 | 3.7 s | 0 |
| the stop no longer checks that Orca is still running | 9 | 3.9 s | 0 |
| the wait for the waiter's note before reaping Orca removed (the interrupt fix's guard) | **0** | 3.7 s | 0 |

Seven of eight are caught, none hangs the suite, and none leaves a process. "Quickly"
holds for five of them (seconds). The three that make stand-in tests wait cost 10 s for
each test that waits (its fail-safe), so the worst took 145 s: bounded, and each failure
names what never happened, but not seconds. Not a defect; `--maxfail` on the make target
would cap it if the owner wants.

**The builder's untested guard** is the last row: `exited.wait()` before `os.wait4` in
`run_process`'s `finally`. I removed it and the suite passed, with one
`PytestUnhandledThreadExceptionWarning`. Judgement: **it does not matter for
correctness.** Without the guard, an interrupted run can reap Orca before the waiter
thread's `waitid` returns; the waiter then gets `ChildProcessError`, and the `finally` in
`note_exit` still sets `exited`, so the watchdog and the run end as they should. That
second guard is the one that prevents the hang, and it has a deterministic test
(`test_a_wait_for_orcas_exit_that_fails_still_ends_the_run`). All the untested guard buys
is that no traceback from the waiter thread is printed on stderr. A test for it would
depend on which thread the kernel wakes first, as the builder says; leaving it untested is
right.

## Probe (e): the fast suite, 40 times

`make -C slice test-flakes RUNS=40` (2 workers, a new seed from `/dev/urandom` each run):
**40 of 40 passed, 781 tests each, 0 failures, 0 errors.** Wall time per run 3.45 s at
best, 4.05 s median, 4.46 s at worst. Serial under coverage: 7.4 s.

Speed that could be had back: little. The ten slowest tests total 2.2 s of serial time;
three are over 0.2 s, all in `test_bad_stls.py`: `test_a_good_file_with_bytes_changed`
(0.34 s) and `test_any_coordinates_in_one_triangle` (0.33 s) are Hypothesis tests whose
example counts could be halved, and `test_a_dense_part_at_the_triangle_limit_is_read`
(0.30 s, plus 0.07 s of set-up) reads a 150,000-triangle part and is as fast as the reader.
Everything else is under 0.2 s. About a second of each 4 s run is the two workers starting
and importing numpy and shapely. Halving the two Hypothesis tests would save about 0.3 s;
I do not think it is worth a change. The growth to 781 tests has not cost speed that
matters.

Flake causes searched for and not found: no `time.sleep`, no wall-clock read in a test, no
fixed port, no shared path (every test in its own `tmp_path`), the kernel's `oom_kill`
count and the memory reader replaced for every test, the real timer replaced for every
test. `plate_3mf.py` reads the clock only when a plate job has no `local_time`.

## Probe (f): my own bad files

33 files beyond the corpus, each sent through the HTTP face (`hostile.log`). No traceback,
no hang, one final log line each. The sentences:

| File | Answer | True? |
|---|---|---|
| gzip of an STL, UTF-16 text STL, OBJ, HTML error page, JSON error, PNG, 284 bytes of 0xFF, 83 bytes, a count of 0xFFFFFFFF | "The file for Box is not an STL file." | yes |
| 84 zero bytes, 1 MB of NUL | "The file for Box has no triangles in it." | yes |
| one extra byte; one byte short | "has extra data after its last triangle"; "is cut off before its end" | yes |
| infinity in the last vertex | "has coordinates that are not numbers" | yes |
| NaN in a normal only; attribute bytes set; a binary STL whose header starts "solid" | accepted, sliced | right: none of these harms the part |
| denormal coordinates; a tetrahedron of 0.001 mm | "Box is too small to print (...)" | yes |
| a tetrahedron of 0.11 mm | accepted with "if it was drawn in inches..." | yes, a warning |
| coordinates of 1e30; a tetrahedron of 3 km | "larger than the printer can print in any orientation (340.0 x 320.0 x 340.0 mm)" | yes |
| the same triangle 12 times; a needle 0.05 mm thick | "Box is flat: it is 0.0 mm thick, too thin to print." | yes |
| a box missing one triangle | accepted with "holes in its surface (3 open edges, 1 separate pieces)" | yes |
| a box with every face doubled; a box and its mirror image | accepted with "has holes in its surface (0 open edges, 1 separate pieces)" | **no: defect 6** |
| a box 180 x 180 x 400 mm | "Box #1 is not fully on the plate", remedy "press Arrange" | true, but no arrangement can help: the "fits somewhere" test is a necessary one only. An observation, not a defect |

Odd part names (a newline with a forged log line, non-ASCII, a script tag, an escape
sequence, slashes, `..`, a space, a right-to-left override, a lone surrogate): all sliced,
the delivered file name was made safe each time (`Box_INFO_forged_log_line-...gcode.3mf`,
`__-...`), every log line serialised as JSON with the newline escaped. A part name of
300,000 characters is accepted: **defect 5**.

## Probe (g): the HTTP face and the brief's checks

The HTTP face: 12 paths and methods not offered (`GET /`, `GET /slices`, `PUT`, `POST` and
`DELETE` on the wrong paths, a 5,000-character job id, `%00`, an encoded `../..`,
`DELETE` of an unknown job) all answered with an error report (`slice.bad_request` or
`slice.unknown_job`) and the right status. Cancelling a done job twice answered
`finished` twice; its event stream gave the one final report; its file was served with the
summary header. Every refusal is a JSON error report with code, message, remedy,
retryable and detail.

The real server on a real socket with the real Orca (`serve_probe.py`, `python -m
penguin_slice serve` on port 18641, logs `serve-1.log` and `serve-2.log`):

- a plate job of 6 hubs followed on its event stream: 18 reports, sequences rising,
  fractions never falling, the last one `done`; the file fetched (1.76 MB, 83 layers);
- a second one cancelled at `generating_walls`: answer `cancelling`, final `cancelled`,
  no Orca process afterwards, its folder gone, its file request 409;
- a third one running when the server got SIGTERM: the server exited 0 in 0.07 s, no Orca
  outlived it, and its log ends `cancelling (shutdown)`, `cancelled (shutdown)`;
- the first job's folder (its sliced file and its upload) was still in the work folder
  after the server ended, and was removed when a new server started on the same folder.
  That is as the guide says (scratch of a process that is gone is removed at start).

1. **Flakes.** 40 of 40 (probe e); no cause found by search.
2. **Speed.** 4.05 s median on 2 workers; three tests over 0.2 s (probe e).
3. **Coverage.** Measured myself: 100 % of statements and of 482 branches in all 13
   modules (`__main__` 6, `errors` 14, `jobs` 80, `mesh` 52, `plate` 18, `plate_3mf` 12,
   `plate_job` 4, `print_config` 28, `service` 90, `slicer` 140, `web` 38). One
   `pragma: no cover`, on `_child_setup` (it runs in the forked child), which a test
   covers by behaviour. So no failure branch is unreached; the question is what the tests
   assert. The failure-path tests I read in `test_orca_runner.py` and `test_web.py` (the
   watchdog's five, the three of `TestSettle`, `TestWhichStopIsReported`, and the twelve
   of `TestEveryPlateJobIsLogged`) assert what the caller sees: the code, the sentence,
   the detail's wording, the log line's fields, the process gone. The eight mutations in
   probe (d) say the same from the other side: seven caught, and the eighth is a guard
   with no behaviour to assert.
4. **Error reports.** The guide's table has every code in `errors.CODES`, in the same
   order (43 codes, compared by a script). Every failure I produced, on purpose or by
   hostility, came back as an error report; none escaped as a bare exception or a
   traceback. The sentences that are wrong are in defects 2 and 6.
5. **Upstream.** Probe (h).
6. **Separation.** `tests/test_independence.py` and `tests/test_contracts.py` pass in
   every run; the package imports only the standard library, Flask, numpy and shapely.
8. **Hostile cases.** Probe (f) and (c); the brief's own list is covered by
   `test_bad_stls.py`, `test_orca_runner.py`, `test_jobs.py`, and the mutations show the
   tests fail when the handling is removed.
9. **Cancellation and cleanup.** Verified on the process table and the file system in
   probes (a) and (b): nothing left after a cancel, a timeout, a watchdog stop, a crash,
   an outside kill; a plain slice ran afterwards.
10. **Progress.** Not re-examined in depth this round; the fraction is Orca's own
    `total_percent` and nothing is sent after a final state (read in `jobs._progress`).

## Probe (h): the guide's "Taking a new upstream version" against upstream.md

| upstream.md, section 1 | Found |
|---|---|
| One pin | `ORCA_VERSION="2.4.2"` with its three checksums in `scripts/install-orca.sh`; no other statement of the version in `src/`, `scripts/`, the tests or the Makefile (the tests read it through `helpers.pinned_orca_version`) |
| One command | `make -C slice upgrade-orca VERSION=x.y.z`: fetches, verifies, installs beside the old one, moves the pin, regenerates the profiles, runs the upstream check |
| An upstream check | `make test-upstream`, which I ran: 28 passed in 13.4 s, one Orca at a time. Each test starts "Protects:"; they cover the command-line options, the return codes and `result.json` wording, the `--pipe` messages, the sliced file's metadata, placements kept, the profile fields, and also SIGTERM, the timeout, `bad_alloc`, the watchdog's reading |
| One seam | `slicer.py`; the guide says so |
| The guide section | The steps, what to look at in the diff, what to do when the check fails, how to go back |
| Proved once | Up to 2.5.1 (stops: the profiles are packed in `BBL.opc`), down to 2.4.1 (one test fails, as it should), back to 2.4.2 each time, all recorded |

Two things for the coordinator to know, neither a defect of this round:

- The command stops when `patches/orca/` holds a patch, instead of applying it.
  upstream.md section 2 says the command applies patches; the guide declares the deviation
  and leaves it to the owner, and upstream.md also forbids the source build that applying
  would need. It needs the owner's word, not a fix.
- The guide does not say what the upstream check leaves unprotected. From reading it: a
  critical warning that reaches only Orca's debug log (the patch note describes it), and
  the 30 ms between Orca's last message and its exit that defect 1 depends on.
- Taking Orca 2.5.x is not routine today: the flattening script cannot read `BBL.opc`. The
  guide says so plainly. That is work for a later strand, already recorded.

## Defects

Most serious first. For each: whether it is real, the evidence, and what would count as
fixed.

1. **A timeout or a watchdog stop that arrives after Orca has written the complete sliced
   file, and before Orca has exited, discards the file.** Real: it loses finished work.
   Rare: it needs the stop to fall in a window that was about 30 ms on my plate (from
   "All done, Success" at 2.445 s to the end of the run at 2.474 s).
   Evidence: with the real Orca, a timeout asked at "All done, Success" gave
   `slice.timeout` 3 of 3, and a watchdog stop asked there gave `slice.out_of_memory` 3 of
   3. In all six the scratch folder held `plate.gcode.3mf` under its final name (Orca
   writes `plate.gcode.3mf.tmp` and renames it), and all six files read and verified
   afterwards with `read_summary`, `verify_archive` and `plate_object_names` (83 layers,
   5,430 s, six hubs). The watchdog is the likelier cause in practice, because this
   Orca's memory peaks exactly while it writes the 3MF (probe b). I did not see it
   unforced in 12 runs at ceilings under the peak; all 9 of those stops fell while the
   file was still `.tmp`.
   Against the rulings: ruling 2's first sentence says a finished sliced file is never
   discarded by a stop the slice service decides on; its second names the case "Orca
   exited by itself with success", which this is not (Orca died on the SIGTERM). The
   coordinator should say which reading holds.
   Fixed when: after a timeout or a watchdog stop, a sliced file that is there under its
   final name and reads and verifies is delivered (with the note when the peak passed the
   ceiling), and a stand-in mode that writes the file and then waits for a signal proves
   it; a cancel still discards it. Or the ruling is that this is intended, and the guide's
   "How a slice ends" says so.

2. **An outside kill or a crash that lands just before a stop is asked is reported as the
   stop.** Real: it misreports. The error report says `slice.timeout` (or
   `slice.out_of_memory`) and the detail says "stopped by the slice service (timeout) with
   SIGTERM", when Orca ended on signal 9 or 11 that the slice service did not send. A
   student is told the plate took too long; a mentor reading the log does not see the
   kill or the crash.
   Evidence: stand-in, 5 of 5 pairs (`test_an_outside_signal_then_a_stop`); real Orca,
   outside SIGKILL then a timeout gave `slice.timeout`. Cause: `run_process` counts a stop
   when `waitid` says Orca has not exited yet, and a process that has been sent a fatal
   signal is in that state until the kernel has torn it down. That is milliseconds for a
   SIGKILL, and can be much longer for a crash that writes a core file (my SIGSEGV run
   left a `core` in the scratch folder, so core files are on in this container; a core of
   a 900 MB Orca takes a while to write, and the watchdog samples every 0.25 s).
   Fixed when: a run that was sent only SIGTERM (not escalated) and ended on another
   signal is reported by how Orca ended (`slice.orca_killed`, `slice.orca_crashed`, or
   `slice.out_of_memory` on the kernel's count), with the five pairs above as tests. A
   caller's cancel may still end `cancelled`.

3. **An abandoned job that finishes at the instant the sweeper cancels it loses its sliced
   file.** Real if ruling 2 covers it; small either way. Abandonment is a stop the slice
   service decides on (nobody asked for it), and `jobs._run` treats every `cancel_asked`
   alike: the job ends `cancelled`, the file is discarded.
   Evidence: `test_abandoned_at_the_instant_the_slice_finishes`: state `cancelled`, the
   result handed to `on_discard`, log `queued, running, cancelling, cancelled`. A client
   whose stream dropped for 120 s and who comes back finds `cancelled` instead of the file
   that was finished.
   Fixed when: only a caller's cancel discards a finished file (an abandoned or shut-down
   job that finished ends `done` and expires as any other), with a test; or the ruling is
   that an abandoned job is the caller's cancel by other means, and the guide's
   "Cancelling" paragraph, which today speaks only of the student's cancel, says so.

4. **A log sink that raises wedges the queue.** Real, minor: it needs the log itself to
   fail (a closed or broken stderr under `serve`). `JobPool.submit` logs `queued` after it
   has put the record in the table and before it hands the job to the executor, so an
   exception from the sink leaves a `queued` record that nothing will ever run.
   Evidence: `test_a_log_that_raises_on_arrival_leaks_a_queue_slot`: two submits with a
   sink raising `BrokenPipeError`, then a third with a healthy sink is refused `QueueFull`;
   counts `queued: 2` for ever. The same sink failing in `_finish` skips the cleanup of a
   failed job's files, and in the sweeper kills the sweeper thread (its `except` logs).
   Fixed when: a failure of the sink never changes what the pool does (caught around the
   call), with that test.

5. **A part's name has no length limit.** Real, minor, hostile input only. A name of
   300,000 characters is accepted: each of the job's log lines is 300 kB (three lines,
   900 kB, for one job), and a refusal's sentence to the student is 300 kB long
   (`test_a_very_long_part_name`: "message bytes 300047"). The refusal line caps names at
   80 characters; the queued job's lines and the sentences do not. Flask's 500 kB limit on
   a form field is the only bound.
   Fixed when: a part name over a stated length (the guide and the contract to say which)
   is refused as `slice.bad_plate_job`, with a test.

6. **The warning for a surface that is closed but not a clean solid says it "has holes".**
   Real, minor: a wrong sentence. A box with every face doubled, and a box overlaid with
   its mirror image, are accepted with "Box has holes in its surface (0 open edges, 1
   separate pieces); if the slice fails or looks wrong, repair it in CAD." There are no
   holes, and the sentence contradicts its own figure.
   Evidence: `test_bad_files`, the two rows in probe (f).
   Fixed when: with no open edge the warning says what is true (faces laid on top of each
   other, or edges shared by more than two faces), with a test for each wording.

7. **`python -m penguin_slice slice`: an interrupt that arrives while `Stop`'s lock is
   held hangs the command.** Real, very unlikely: the lock is held for a few bytecodes in
   `Stop.set` and `Stop.listen`. The command's signal handler calls `stop.set()` on the
   main thread, and `Stop._lock` is a plain `threading.Lock`: a second Ctrl-C during the
   first one's `set()`, or a first one during `run_process`'s `stop.listen`, re-enters the
   lock on the same thread and never returns.
   Evidence: `stop_lock.py` holds the lock on the main thread as `set()` does and sends
   SIGINT: "HUNG: the handler never returned" after 3 s. I did not make it happen by
   timing alone.
   Fixed when: the handler cannot block (an `RLock`, or a handler that only records the
   signal), with a test like `stop_lock.py`.

## Not defects, stated plainly

- A plate whose peak is just over the ceiling is stopped on most runs and delivered with
  the note on some (9 and 3 of 12). Ruling 2 allows it; the guide should say it.
- A caller's cancel that meets a crash ends `failed`, with the crash's error report.
- A cancel at Orca's last message discards a finished file. Ruling 3.
- A vanished client is logged as "no plate_job field".
- `POST /slices/` is not logged.
- The log lines carry no time.
- The upgrade command stops at a patch instead of applying it (the owner's decision).

# Penguin Slicer overnight run: ledger

Started Thu 2026-11-19 about 17:15 PT. Coordinator: the main session. After a compaction
or in a fresh session, trust this file and `git log` in
`/repos/popcornpenguins/penguin-slicer` (branch `build/ports-and-hardening`, local only,
no remote).

The plan is the
[restart plan](../../plans/2026-11-19-penguin-slicer-restart-plan.md). Briefs are in
[briefs/](briefs/standing-rules.md); results go in `results/`.

## What the owner asked for (Thu 11-19, evening)

- Ports and hardening of the slice service and printer delivery run overnight without the
  owner. Opus builds; a fresh Fable reviewer verifies; defects go back to Opus; repeat.
- The owner named these robustness cases: bad STL files (the Eiffel tower failure), an
  empty file, out-of-memory in slicing; for printer delivery, intermittent, slow and
  recovering networks on both links and the printer's error codes.
- **The mockup must be ready for the owner by Thu 11-19 23:30 PT** (moved from 21:30 by the owner at 18:20). Opus draft, then Fable
  rounds, then open it.

## Strands

| Strand | Chain | State |
|---|---|---|
| Mockup | Opus draft, Fable round 1, Fable round 2, coordinator check, open for owner | Draft returned 17:50. Fable round 1 running since 17:52. |
| Slice service | Opus port, Fable review, Opus fix, Fable re-review, commit, then Opus hardening ([brief](briefs/slice-hardening.md)), Fable review, fix, re-review, commit | Port running since 17:32. |
| Printer delivery | Same chain with [its hardening brief](briefs/delivery-hardening.md) | Port running since 17:32. |

Every review uses [briefs/review.md](briefs/review.md); every fix uses
[briefs/fix.md](briefs/fix.md). The port agents were dispatched before this folder
existed, with their briefs in the dispatch prompt; their reports arrive as messages and
the coordinator saves the substance to `results/<component>-port.md`.

## Rules for the coordinator

- Review and fix rounds continue for as long as a review finds real defects (something
  that can mislead a user, lose work, hang, leak, flake or hide a failure), up to a cap of
  four review rounds per phase per component (owner, Thu 11-19 18:28 PT). Defects still open
  after the fourth review go into the report to the owner, and that phase is committed
  as it stands with them listed. A phase is done when a fresh review passes, or finds only items that
  are not real defects; then it is committed and the chain moves on. When both components
  are hardened and pass, the run is done and stops; it does not need to fill the night.
  (Owner, Thu 11-19 18:27 PT; replaces the earlier cap of three rounds.)
- Commit after each phase that passes review, on `build/ports-and-hardening`, adding only
  that component's folder (and `contracts/` for the slice service). Never push.
- Machine: 4 CPUs, 5 GB. One real Orca at a time. If the slice service's hardening and a
  slice review both need real Orca, run them one after the other.
- Status update to the owner every 20 minutes while anything runs (cron `c99cb668`);
  cancel it when the morning report is posted.
- Stop for the owner before anything irreversible or outside this workspace. Creating a
  GitHub repository is the owner's.

## Rulings

- Owner decided Thu 11-19 18:20 PT: the daemon stays in Python for now; a port to Rust or
  Go comes later.
- Ruling: daemon telemetry is left out of hardening (open decision 3 unanswered; the
  plan's default). Structured logs on both halves are in.
- Ruling: the simulated printer is built from the one recorded status document and
  invented sequences, with a recording command added for a later session at the H2S
  (open decision 6 unanswered).
- Ruling: the reference plates are the set proposed in the restart notes' section 6.9
  (open decision 5 unanswered).
- Ruling: a small HTTP face is part of hardening the slice service, because progress
  streams, cancellation and vanished clients cannot be proven without one.
- Ruling: work is committed on the local branch `build/ports-and-hardening`, not `main`.

## Log

- Thu 11-19 17:15 PT: mockup draft dispatched (Opus).
- Thu 11-19 17:32 PT: slice service port and printer delivery port dispatched (Opus).
- Thu 11-19 17:50 PT: mockup draft returned: all walks reported passing, 66 decisions in
  `mockups/print-wizard/DECISIONS.md`.
- Thu 11-19 17:52 PT: mockup Fable round 1 dispatched.
- Thu 11-19 18:10 PT: briefs and this ledger written.
- Thu 11-19 18:00 PT: owner added the upstream requirement (routine upgrades of Orca
  Slicer and the printer library; small patches allowed for error and progress
  reporting). Written as [briefs/upstream.md](briefs/upstream.md), added to the review
  and hardening briefs and to the plan as section 5.6. Sent to the running delivery port
  agent as a small addition.
- Ruling: a patch to Orca itself needs a source build, so each one is the owner's
  decision; agents write the patch note and work around the gap.
- Thu 11-19 18:01 PT: slice service port returned; its claims are in
  [results/slice-port.md](results/slice-port.md) (420 fast tests in 0.85 s, 100% branch
  coverage, 8 real-Orca tests in 1.3 s; all unverified).
- Thu 11-19 18:08 PT: slice port review round 1 dispatched (Fable), result
  `results/slice-port-review-1.md`.
- Thu 11-19 18:12 PT: printer delivery port returned; its claims are in
  [results/delivery-port.md](results/delivery-port.md) (475 fast tests in 0.75 s, 93%
  branch coverage, 19 error codes; all unverified).
- Thu 11-19 18:15 PT: delivery port review round 1 dispatched (Fable), result
  `results/delivery-port-review-1.md`.
- Thu 11-19 18:20 PT: owner moved the mockup deadline to 23:30 PT (guard cron now fires
  about 23:00 PT) and decided the daemon stays in Python for now.
- Thu 11-19 18:25 PT: owner said the daemon will likely be deployed for testing on a
  Windows computer on the printer's network, up all the time. Added as requirement 9 of
  the delivery hardening brief; the Raspberry Pi stays supported.
- Thu 11-19 18:30 PT: owner narrowed it: for this version the daemon is a plain Python
  program run by hand on any operating system. No installers, no service setup, no
  operating-system secret protection. Requirement 9 rewritten.
- Thu 11-19 18:36 PT: mockup Fable round 1 returned. It fixed Send to Printer sending at
  once from the menu (now a confirmation), the Layout step's tiny parts (zooms to the
  copies), double-click a face to lay a copy down, and rewrote `DECISIONS.md` with a
  ten-item "Please react to these" list. Left open for round 2: grabbing a part by its
  hole, a laid-flat long part finding no free spot, tall error cards, the Assembly page.
- Thu 11-19 18:38 PT: mockup Fable round 2 dispatched.
- Thu 11-19 18:45 PT: delivery port review 1 returned: FIX, 12 defects
  ([results/delivery-port-review-1.md](results/delivery-port-review-1.md)). Flakes and
  speed clean (20 of 20 runs, 475 tests in about 0.6 s), coverage 97 to 100% per module,
  8 of 9 hand mutations caught. Worst: an accepted send can lose its sliced file (a race
  new in the port, 3 of 150 with real threads); a non-string `error` in an
  acknowledgement makes a team's status route answer 500 for ten minutes.
- Ruling: in the port phase, inherited faults are fixed only when small and safe;
  otherwise pinned as `known_fault` for hardening.
- Thu 11-19 18:47 PT: delivery port fix 1 dispatched (Opus), result
  `results/delivery-port-fix-1.md`.
- Thu 11-19 18:52 PT: slice port review 1 returned: FIX, 14 defects (7 made by the port,
  6 carried over, 1 both) ([results/slice-port-review-1.md](results/slice-port-review-1.md)).
  Verified: the real-Orca suite really slices (fast because the parts are tiny), 30 of 30
  runs pass, 100% branch coverage with 10 of 14 hand mutations caught. Worst: a good
  sliced file thrown away when `result.json` has an unexpected shape; success reported
  with a folder as the sliced file's path; the Orca version stated in six files.
- Thu 11-19 18:54 PT: slice port fix 1 dispatched (Opus), result
  `results/slice-port-fix-1.md`.
- **Correction, Thu 11-19 18:22 PT (read from the clock):** the times in the log entries
  above from "18:00" to "18:54" were estimated without reading the clock and run up to
  about 30 minutes ahead; their order is right. Every time from here on is read from the
  clock.
- Thu 11-19 18:21 PT: delivery port fix 1 returned: all 12 defects reported fixed, no
  `known_fault` pins needed, 538 tests, 20 of 20 runs
  ([results/delivery-port-fix-1.md](results/delivery-port-fix-1.md)); unverified.
- Thu 11-19 18:22 PT: delivery port review round 2 dispatched (Fable), result
  `results/delivery-port-review-2.md`.
- Thu 11-19 18:25 PT: mockup Fable round 2 returned: ready for the owner, a third round
  judged not worth it. Coordinator loaded it through the viewer: renders, no console
  errors. Committed and opened for the owner. Mockup strand closed until the owner's
  feedback; guard cron deleted.
- Thu 11-19 18:30 PT: slice port fix 1 returned: 13 of 14 defects reported fixed, the -100 sentence
  pinned as `known_fault`; 445 tests, 20 of 20 runs; Orca version now stated in one place
  ([results/slice-port-fix-1.md](results/slice-port-fix-1.md)); unverified. Slice port
  review round 2 dispatched (Fable), result `results/slice-port-review-2.md`.
- Thu 11-19 18:31 PT: delivery port review 2 returned: FIX, 1 defect (a test that reads every file
  under `delivery/daemon/` as UTF-8 fails on a stray `.DS_Store`). All 12 earlier
  defects confirmed fixed at their cause; 23 of 23 hand mutations caught; 538 tests, 20
  of 20 runs; concurrency probes clean
  ([results/delivery-port-review-2.md](results/delivery-port-review-2.md)).
- Ruling: one test-only defect does not earn its own fix and review round; it is the
  first item of the hardening dispatch. The delivery port is committed as `7e1e2e1`.
  **Delivery port phase closed after 2 review rounds.**
- Thu 11-19 18:31 PT: delivery hardening dispatched (Opus), result `results/delivery-hardening.md`.
- Thu 11-19 18:38 PT: slice port review 2 returned: FIX, 2 small defects, neither loses work (every
  negative Orca exit status reported as `slice.orca_killed`, so a crash reads as a kill;
  a plate job file nested extremely deep gives `slice.unexpected`). All 14 earlier
  defects confirmed fixed (30 of 30 fix-removal mutations caught, 17 others); 445 tests,
  29 of 29 runs, 100% branch coverage; real Orca 10 passed
  ([results/slice-port-review-2.md](results/slice-port-review-2.md)).
- Ruling: both defects are hardening's first items (the hardening brief already requires
  a kill for memory to be distinct from a crash). The slice port is committed as
  `c2c9a3c`. **Slice port phase closed after 2 review rounds.**
- Thu 11-19 18:38 PT: slice hardening dispatched (Opus), result `results/slice-hardening.md`. It is
  the only strand allowed to run real Orca.
- Thu 11-19 19:27 PT: slice hardening returned, DONE_WITH_CONCERNS
  ([results/slice-hardening.md](results/slice-hardening.md)); unverified. Claims: 664 fast
  tests in about 4 s, 20 of 20 runs, 100% branch coverage, 23 real-Orca tests in 8.9 s;
  Orca's `--pipe` option gives real stage and percentage progress; crash, memory kill,
  outside kill, cancel and timeout are separate error reports; the -100 sentence follows
  Orca's real reason; memory cap replaces the plate triangle cap (900 MB default, 8
  reference plates measured, highest peak 915 MB); `make upgrade-orca` went to 2.5.1 and
  back. Concerns for the owner: Orca 2.5.x packs the Bambu profiles in a file the catalog
  script cannot read, so 2.4.2 stays pinned; the memory model over-estimates smooth
  organic parts about 2 times; a "floating regions" refusal is only in Orca's debug log
  (a proposed Orca patch is written, not made); self-intersecting parts are not detected.
- Thu 11-19 19:27 PT: slice hardening review round 1 dispatched (Fable), result
  `results/slice-hardening-review-1.md`.
- Thu 11-19 19:37 PT: delivery hardening returned, DONE_WITH_CONCERNS
  ([results/delivery-hardening.md](results/delivery-hardening.md)); unverified. Claims:
  all nine requirements built; both hardware-test faults fixed; 36 error codes, six
  stages with a `stale` marker, an event stream, a start gate so a file starts at most
  once; daemon runs with `python -m` from one `--home` directory and has a `record`
  command; simulated printer in `delivery/simulator/`; `make test-sim`,
  `make test-upstream`, `make upgrade-printer-library` (run to 2.6.5 and back). 829 fast
  tests in 5.4 s, 20 of 20 runs; simulator suite 18 tests in 23 s. The simulated printer
  found a deadlock in the daemon's handling of the library's log (fixed) and an upload
  losing the end of its file under TLS 1.3 (open, on the H2S checklist). Not handled: the
  library accepts any printer certificate; no test holds a real socket stalled
  mid-upload. Decided by the builder: a relay restart keeps only the secret key.
- Thu 11-19 19:37 PT: delivery hardening review round 1 dispatched (Fable), result
  `results/delivery-hardening-review-1.md`.
- Thu 11-19 19:42 PT: slice hardening review 1 returned: FIX, 14 defects
  ([results/slice-hardening-review-1.md](results/slice-hardening-review-1.md)). Held under
  real Orca: cancel, timeout and a killed service each left no Orca process and no files;
  the progress fraction is always Orca's own. 100% branch coverage, 14 of 14 hand
  mutations caught, real-Orca suite 23 of 23. Found: one flaky test (1 failure in 20
  runs, a `/proc` read racing a process exit); the memory cap refuses a 100 mm solid cube
  (estimated 1,158 MB, real peak 276 MB) and estimates low elsewhere; an outside SIGKILL
  reported as out of memory; "No layers were detected" still gets a general sentence;
  HTML answers for 404, 405 and two 500s on the HTTP face; a failed download in the
  upgrade command leaves the pin moved.
- Ruling (owner to confirm): the memory estimate is too rough to refuse on. The guard
  becomes a watchdog that samples the running Orca's memory and stops it at the ceiling
  (900 MB default) with a truthful `slice.out_of_memory`; the estimate only informs and
  warns. Refitting the model belongs with the choice of hosting.
- Thu 11-19 19:42 PT: slice hardening fix 1 dispatched (Opus), result
  `results/slice-hardening-fix-1.md`.
- Thu 11-19 19:50 PT: delivery hardening review 1 returned: FIX, 11 defects (2 serious, 3 medium, 6
  low) ([results/delivery-hardening-review-1.md](results/delivery-hardening-review-1.md)).
  Held: a file is started at most once under every fault sequence the reviewer built; the
  deadlock fix is real; retries bounded; nothing Unix-only on a hand-run path; no secret
  in any log or report; 20 of 20 runs, simulator suite and upstream check 10 of 10 each;
  17 of 18 mutations caught. Serious: a print that is running is reported as finally
  failed after 90 s of printer silence or 17 min of relay link loss, and never corrected;
  an upload holds the whole file's text in memory and a failed upload sends megabytes of
  `detail` into every status answer. Also: old status shown as fresh after a reconnect;
  11 of 12 uploads lose their end under TLS 1.3 in the simulator (caught, none started;
  the library's `unwrap` option fixes it).
- Thu 11-19 19:50 PT: delivery hardening fix 1 dispatched (Opus), result
  `results/delivery-hardening-fix-1.md`.
- Thu 11-19 20:13 PT: slice hardening fix 1 returned: all 14 defects reported fixed
  ([results/slice-hardening-fix-1.md](results/slice-hardening-fix-1.md)); unverified. 729
  fast tests, 100 of 100 runs, 3.8 s on 2 workers; 27 real-Orca tests in 10.4 s. Memory
  watchdog in, `slice.plate_too_large` gone, estimate only logged (no warning: it would
  fire falsely on most solid parts). Two more process-exit races found and fixed. Upgrade
  proof run 2.4.2 to 2.4.1 and back worked; the upstream check failed on 2.4.1 as
  designed. For the owner: the upgrade command stops when a patch file exists instead of
  applying it, since an Orca patch needs a source build.
- Thu 11-19 20:13 PT: slice hardening review round 2 dispatched (Fable), result
  `results/slice-hardening-review-2.md`.
- Thu 11-19 20:23 PT: delivery hardening fix 1 returned: all 11 defects reported fixed, plus a race in
  the simulator (two threads on one TLS socket lost a status document in 2 of 13 runs)
  ([results/delivery-hardening-fix-1.md](results/delivery-hardening-fix-1.md));
  unverified. Silence no longer ends a job: the 6-hour rule and `delivery.job_expired`
  are gone, the relay's 15-minute deadline applies only before the start gate. `detail`
  capped at 2,000 characters; an 8 MB upload peaks under 2 MB. TLS 1.3 fixed with the
  library's `unwrap` option, no patch. 880 fast tests in 3.7 s, 20 of 20 runs; simulator
  suite 9 to 11 s. Upgrade round trip to 2.6.5 and back recorded in the guide.
- Thu 11-19 20:23 PT: delivery hardening review round 2 dispatched (Fable), result
  `results/delivery-hardening-review-2.md`. Asked to probe the overshoot: jobs that can
  now never end.
- Thu 11-19 20:35 PT: slice hardening review 2 returned: FIX, 6 defects
  ([results/slice-hardening-review-2.md](results/slice-hardening-review-2.md)). Held with
  real Orca: watchdog stop, cancel, timeout, outside kill and crash each give their own
  truthful report with nothing left behind. 40 of 40 runs, 729 tests, 4.3 s on 2 workers,
  100% branch coverage. Real defects: the watchdog samples every 0.25 s and misses
  Orca's peak, a spike under 0.1 s (same plate delivered four times and refused twice);
  a plate job refused on arrival leaves no log line; the watchdog's tests can hang; a
  stop that lands just after Orca finished discards a finished sliced file (rare).
- Ruling: a finished sliced file is never discarded; success wins every race against a
  stop. The watchdog reads the kernel's high-water mark so a spike is seen at the next
  sample; a slice that finishes before it is stopped is delivered, with its measured peak
  logged and noted as over the ceiling.
- Thu 11-19 20:35 PT: slice hardening fix 2 dispatched (Opus), result
  `results/slice-hardening-fix-2.md`.
- Thu 11-19 20:44 PT: delivery hardening review 2 returned: FIX, 6 defects (1 serious, 2 medium, 3 low)
  ([results/delivery-hardening-review-2.md](results/delivery-hardening-review-2.md)). The
  silence rule holds with no second start: silences up to 48 h on either link and a
  400-case random campaign. Fast suite 40 of 40, simulator suite 20 of 20, upstream
  check 10 of 10; 12 of 14 mutations caught. Serious: a fault a person clears at the
  printer (pause with an error set) ends the job `failed` while the print finishes.
  Medium: an acknowledgement answered by a foreign 404 page holds the job slot for ever;
  a job past the start gate can never be given up while silence lasts. Low: a start-path
  regression hangs the suite; the relay stores a sync snapshot of any size; the property
  test's outages miss the job's waits.
- Ruling: only evidence that the print has ended ends a delivery job; a pause or a
  clearable fault is a non-final "waiting for a person" stage.
- Ruling (owner to confirm): past the start gate, a caller may stop following a stale job,
  and the relay does so itself after 24 hours of continuous staleness; the record ends
  with `delivery.outcome_unknown`, whose sentence says the outcome is unknown, never
  that the print failed.
- Thu 11-19 20:44 PT: delivery hardening fix 2 dispatched (Opus), result
  `results/delivery-hardening-fix-2.md`.
- Thu 11-19 21:07 PT: delivery hardening fix 2 returned: all 6 defects reported fixed, plus two of the
  same kind ([results/delivery-hardening-fix-2.md](results/delivery-hardening-fix-2.md));
  unverified. One table (`PRINTER_VALUES`) classifies every printer value; new non-final
  stage `waiting_for_person`; stop-following route and the 24-hour rule end a stale job
  as `delivery.outcome_unknown`; request bodies over 64 kB refused; every test wait
  bounded. Behaviour change to check: an unknown printer state now refuses a new send as
  busy. Fast suite 20 of 20 in 3 to 4 s; simulator suite 26 tests; upstream check 44.
- Thu 11-19 21:07 PT: delivery hardening review round 3 dispatched (Fable), result
  `results/delivery-hardening-review-3.md`.
- Thu 11-19 21:07 PT: slice hardening fix 2 returned: all 6 defects reported fixed
  ([results/slice-hardening-fix-2.md](results/slice-hardening-fix-2.md)); unverified. The
  watchdog reads the kernel's high-water mark (six real-Orca runs at a ceiling 5% under
  the peak all stopped, each reading the true peak); the end of a run is decided in one
  place (`slicer.settle`); every refused plate job logs a line; every test wait bounded;
  one more hang found and fixed (an interrupt during a slice). 781 fast tests, 20 of 20
  runs, 100% branch coverage; real-Orca suite 28 of 28 in 12.8 s.
- Ruling: a cancel asked for by the caller still discards a file Orca happened to finish;
  "success wins" covers only stops the service decides on.
- Thu 11-19 21:07 PT: slice hardening review round 3 dispatched (Fable), result
  `results/slice-hardening-review-3.md`.
- Thu 11-19 21:21 PT: slice hardening review 3 returned: FIX, 2 defects where a run's end is decided
  and 5 minor ([results/slice-hardening-review-3.md](results/slice-hardening-review-3.md)).
  40 of 40 runs, 781 tests, about 4 s; 100% branch coverage; 7 of 8 hang regressions
  caught and none hung; every way of arriving at `POST /slices` left a log line; the
  reported memory peak was true every time. Defects: a stop landing after Orca wrote the
  complete file but before it exits discards the file (forced 6 of 6 with real Orca, a
  window of about 30 ms, not seen unforced in 12 runs); an outside kill just before a
  stop is reported as the stop. Minor: a raising log sink blocks the queue; no limit on
  a part name's length; one wrong warning; a possible deadlock in the interrupt path.
- Ruling: a complete, valid sliced file is never discarded by a stop the service decides
  on, even when the stop landed before Orca exited.
- Ruling: an abandoned job that finishes as the sweeper cancels it ends `cancelled` and
  its file is discarded; intended.
- Thu 11-19 21:21 PT: slice hardening fix 3 dispatched (Opus), result
  `results/slice-hardening-fix-3.md`. The review after it is the fourth and last.
- Thu 11-19 21:30 PT: delivery hardening review 3 returned: FIX, 8 defects; "fit to commit as work in
  progress, not yet as hardened"
  ([results/delivery-hardening-review-3.md](results/delivery-hardening-review-3.md)).
  Holds: no file started twice (a 300-case campaign with stop-following and resends, 15
  mutations all caught); silence ended nothing except by the 24-hour rule; fast suite 40
  of 40 (median 3.87 s), simulator suite 20 of 20, upstream check 10 of 10. Defects: an
  idle printer with an unknown stage code reads as printing and blocks every send for
  ever; six tests can still hang (one regression grew to 2.1 GB); after stop-following a
  second file is started while the first prints, if the printer is quiet; after a failed
  print every send is refused while the failed state lingers; a slow poller gets
  `job_unknown` in place of `outcome_unknown`. The reviewer's hanging regressions caused
  2 out-of-memory kills in the container between about 21:14 and 21:19 PT.
- Rulings: the printer's main state decides whether a print is going on, the stage code
  only describes it; an unknown main state refuses a send with its own retryable error
  report and never locks a caller in. A start command is sent only on a fresh report that
  the printer is free. A printer whose last print ended, well or badly, is free. Final
  records are kept 24 hours. A hard per-test time limit comes from `pytest-timeout`.
- Thu 11-19 21:30 PT: delivery hardening fix 3 dispatched (Opus), result
  `results/delivery-hardening-fix-3.md`. The review after it is the fourth and last.
- Thu 11-19 21:48 PT: slice hardening fix 3 returned: all 7 findings handled
  ([results/slice-hardening-fix-3.md](results/slice-hardening-fix-3.md)); unverified.
  "Complete" is defined in one place (final name, zip directory intact, required entries,
  every checksum); a complete file after a timeout or watchdog stop is delivered with a
  `stop_note`; an outside kill before a stop is reported as what it was; part and profile
  names capped at 200 characters; log failures swallowed and counted. 858 fast tests, 40
  of 40 runs (median 4.08 s), 100% branch coverage; real-Orca suite 32 of 32 in 20.9 s.
- Thu 11-19 21:48 PT: slice hardening review round 4, the last, dispatched (Fable), result
  `results/slice-hardening-review-4.md`, to end with "Open at commit" for the owner.
- Thu 11-19 22:06 PT: slice hardening review 4, the last, returned: fit to commit as hardened; 6
  defects, all low ([results/slice-hardening-review-4.md](results/slice-hardening-review-4.md),
  section "Open at commit"). No bad file delivered after a stop: every cut of a stand-in
  archive and 3,400 cuts of a real one failed as the stop; of 150 real slices stopped at
  random moments, 40 were delivered, each with G-code identical to a clean slice. Fast
  suite 45 of 45 (858 tests), real-Orca suite 3 of 3, 100% branch coverage, 18 of 20
  mutations caught. The owner's named cases all gave true sentences.
- Thu 11-19 22:06 PT: slice hardening committed as `30401cf`. **Slice service done after 4 review
  rounds.** Open at commit: no stop note on the command line; a summary header of 8 to
  17 kB with 25 warned parts; one rare zip damage reported as `slice.unexpected`; a
  reused output folder when `slice_plate` is called directly; the reported peak can
  include the service's own memory; a non-ASCII digit in the ceiling setting.

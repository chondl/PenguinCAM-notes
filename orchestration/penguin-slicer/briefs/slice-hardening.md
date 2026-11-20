# Brief: harden the slice service

- **Deliverable (REQUIRED):** the hardened slice service in
  `/repos/popcornpenguins/penguin-slicer/slice` (and the contracts it owns), and a result
  file at the result path in the dispatch line.
- **Stop condition (REQUIRED):** every requirement and every hostile case below has a
  passing test; the fast suite passes 20 times in random order with 2 workers; the
  real-Orca suite passes; the guide lists every error code and every stage.
- **Budget (REQUIRED):** 4 hours; no cloud spend.
- **Where this fits:** the slice service was ported from the print branch with its
  behaviour unchanged. This strand makes it robust. An independent reviewer then tries to
  break it.
- **Inputs:** [standing-rules.md](standing-rules.md) first. Then the component, the port's
  result and review files in `../results/` (their "list for hardening" is your starting
  inventory), the
  [restart plan](../../../plans/2026-11-19-penguin-slicer-restart-plan.md) sections 5 and
  6.2, and the
  [local mode errors and limits research](../../../research/2026-10-11-local-mode-errors-and-limits.md).

Work test first. Behaviour may now change; where it does, the contracts and the guide
change in the same piece of work.

## Requirements

1. **Errors.** Every failure reaches the caller as an error report. Orca's own reason is
   read (its `result.json`, its output) before any cleanup removes it. The wrong sentence
   for Orca's code `-100` ("no flat face on the plate") is removed: the sentence follows
   Orca's actual reason. When Orca reports empty layers and supports are off, the error
   report names the copy and the height and its action is `enable_supports`; when supports
   are already on, it says the mesh must be repaired in CAD and offers no action that
   cannot help. An Orca code or reason the service does not recognise still becomes a
   truthful error report with Orca's words kept in `detail`.
2. **Checks on every part before Orca runs.** A part is examined when the plate job
   arrives, and a bad one is refused or flagged with an error report naming the part,
   before any slice starts. Decide and document which findings refuse and which only warn
   (a warning travels in the result, not as a failure).
3. **Progress.** Orca is run with its output read as it arrives. Find out, by experiment
   with the installed Orca, what it reports while slicing headless (try its log level and
   any pipe or progress option; read its `--help`). If it reports stages or percentages,
   map them to stages and a fraction. If it does not, report the stages the service itself
   knows (checking parts, building the plate, slicing, reading the result) with elapsed
   time and an expected time from the plate's size, and no fraction. Never invent a
   fraction. Record what you found in the guide.
4. **Cancellation.** A cancel call stops Orca and every child it started (kill the process
   group, wait for it, escalate if it ignores the first signal), frees the slot, removes
   the job's files and reports `cancelled` only after the process is gone. Cancelling a
   queued job, a finished job and an unknown job each have a defined answer.
5. **Cleanup.** A job whose subscribers have all gone is cancelled after a stated grace
   time, which a returning subscriber resets. Scratch directories are removed on every
   path out: success, failure, timeout, cancel, crash. On start, the service removes
   scratch left by an earlier process that died. Nothing accumulates.
6. **Supportable from the server.** One structured log line per job transition, carrying
   the job id, the profiles and overrides, the parts with their sizes and the copies with
   their placements, the outcome, the error code and Orca's reason, peak memory and wall
   time. No secret.
7. **The plate limits.** Replace the plate triangle cap with a cap on estimated peak
   memory, using the memory model in the research file (part volume and copies, a factor
   for supports), with the ceiling as a setting, 900 MB by default. Keep the other plate
   limits. Extend the measurement script so the model can be refitted, and measure the
   reference plates proposed in the research and the restart notes' section 6.9 as far as
   the machine allows (one Orca at a time; stop measuring a plate that passes 3 GB).
   Report the measurements in the result file.
8. **Upstream.** Everything in [upstream.md](upstream.md), for Orca Slicer and its
   profiles. The port copied Orca from an installed tree; here the installer's real
   download path is run once and verified.
9. **A small HTTP face** for the service, so a client can submit a plate job, follow its
   progress reports as a stream, cancel it and fetch the sliced file: a Flask app factory
   inside `slice/`, tested with Flask's test client. Its error answers are error reports.

## Hostile cases: each needs a test that fails if the handling is removed

The owner asked for these by name: bad STL files (a broken model once failed every slice
with a useless message), an empty file, out-of-memory. Onshape will usually send good STL
files, but nothing guarantees it.

**Files.** Build a corpus of small bad files under the tests' fixtures, generated by a
script so each is reproducible, and a test per file:

- an empty file; a file of one byte; a binary STL cut off mid-triangle; a header whose
  triangle count is larger, and smaller, than the data; a count of zero;
- an ASCII STL; a file that is not an STL at all (a PNG, a 3MF, text);
- coordinates that are NaN or infinite; absurdly large coordinates; all triangles
  degenerate; a single triangle; a flat sheet with no volume;
- a mesh that is not watertight; a mesh with hundreds of separate slivers and a thin open
  lattice (a small synthetic stand-in for the Eiffel tower file described in the
  research: it must reproduce Orca's empty-layers refusal with supports off, in the
  real-Orca suite); inverted normals; self-intersection; two shells that do not touch;
- a part larger than the plate; a part taller than the printer; a part 25.4 times too
  small (an inch file read as millimetres); a part a thousandth of a millimetre across;
- a very dense mesh at the triangle limit and just over it.

For each: the service does not crash, does not hang, and answers with an error report (or
a documented warning) whose sentence is true for that file. Use property-based tests
(Hypothesis is allowed as a dev dependency, with a fixed seed database so the fast suite
stays deterministic and fast) to throw random bytes and randomly damaged valid files at
the reader: the only allowed outcomes are a parsed mesh or the reader's own error.

**Orca misbehaving.** With a stand-in for the Orca binary in the fast suite (a small
script the tests point the service at), and where it is cheap also with the real Orca:

- Orca killed by the kernel for memory (the stand-in dies on SIGKILL; in the real-Orca
  suite, run Orca under a memory limit low enough to make it fail, using `RLIMIT_AS` or
  whatever works on this machine, and confirm what the service sees). The error report
  says the plate is too large to slice and what to remove; it is distinct from a crash.
- Orca crashing with a signal; exiting non-zero with no `result.json`; exiting zero with
  no output file; writing a corrupt or truncated sliced file; writing a `result.json`
  that is not JSON;
- Orca hanging silently until the timeout; Orca hanging while ignoring SIGTERM; Orca
  leaving a child process behind;
- Orca printing megabytes of output (the service must not block on a full pipe or keep
  it all in memory); printing invalid UTF-8;
- the Orca binary missing, not executable, or for the wrong architecture;
- the scratch directory unwritable; the disk full during a slice (simulate with a failing
  write); a profile file missing or not JSON; an override outside its allowed values.

**Jobs.** Two jobs submitted at once with one slot; the queue full; cancel while queued;
cancel at the instant the job finishes; cancel twice; a subscriber that connects late, one
that disconnects and returns, many at once; the service stopping while a job runs (its
Orca must not outlive it); a job that finishes after its record expired.

## The result file

What changed, by requirement. What Orca reports while slicing (requirement 3). The table
of error codes. The measurements (requirement 7). Test figures: count, wall time, the
20-run result, coverage per module, real-Orca tests and their times. Every hostile case
with the test that covers it. What you could not do and why.

# Brief: verification review of one component

The dispatch line names the **component** (`slice` or `delivery`), the **phase** (`port` or
`hardening`), the round number and the result path.

- **Deliverable (REQUIRED):** a review file at the result path given in the dispatch line.
- **Stop condition (REQUIRED):** every check below has a verdict backed by a command you
  ran or a line you read, and every defect is listed with its evidence.
- **Budget (REQUIRED):** 60 minutes; no cloud spend.
- **Where this fits:** an Opus agent built this component; you are the independent check
  before the coordinator commits it. You have not seen that agent's report and must not
  look for it. Judge the code and the tests, not anyone's claims.
- **Inputs:** [standing-rules.md](standing-rules.md) first. Then the component's folder in
  `/repos/popcornpenguins/penguin-slicer`, its `README.md`, and `contracts/`. For the
  hardening phase also the component's hardening brief:
  [slice-hardening.md](slice-hardening.md) or
  [delivery-hardening.md](delivery-hardening.md). The print branch is there to compare
  behaviour against.

You review; you do not fix. Change no file in the repository. You may write scratch test
files and scripts under your own folder in
`/tmp/claude-1000/-repos-popcornpenguins/c507b106-b789-4d12-a830-1dcc19de2171/scratchpad/`.

## Checks, both phases

1. **Flakes.** Run the fast suite 20 times, in random order with a different seed each
   time, and with 2 parallel workers. Report every failure with its seed. Then hunt for
   causes that have not bitten yet: search the code and tests for real sleeps, wall-clock
   reads, real threads without joins, fixed ports, shared paths, module-level state shared
   between tests, reliance on dictionary or directory order, on the current directory, the
   home directory or the environment.
2. **Speed.** Wall time of the fast suite; the ten slowest tests; anything over 0.2 s.
3. **Coverage.** Measure branch coverage per module yourself. For each module, list the
   uncovered branches that are failure paths. Then sample: pick ten tests for failure
   paths and judge whether each asserts what the caller sees, or only that a line ran.
   Try mutation by hand on five important checks (invert a condition, remove a raise) in
   a scratch copy of the component and say which mutations the suite did not catch.
4. **Error reports.** List every way the component can fail towards its caller (read the
   code for every `raise`, every non-zero exit, every refusal). For each: is it an error
   report conforming to `contracts/error-report.md`, is its sentence true and useful, can
   its remedy actually help, is the detail kept, is there a test that produces it on
   purpose? List any failure that can escape as a bare exception or a traceback.
5. **Upstream.** Every point of [upstream.md](upstream.md) section 1 that the phase
   could reach: one pin, the upgrade command, the upstream check suite and what it leaves
   unprotected, the single seam, the guide section. In the port phase a missing piece is
   a defect only if the code makes it harder later (a version stated in two places, calls
   to upstream scattered outside one module); in the hardening phase every missing piece
   is a defect.
6. **Separation.** Nothing imports from outside the component except the standard
   library and declared dependencies. The contracts' example files are checked by tests.
   The guide lets a newcomer run the component alone.

## Extra checks, port phase

7. **Faithful.** Compare with the print branch: is any behaviour silently changed, any
   test dropped without a replacement, any module left behind that the component needs?

## Extra checks, hardening phase

8. **Each hostile case in the hardening brief** has a test, and the test would fail if the
   handling were removed. Add your own hostile cases the brief did not think of: write
   them as scratch tests, run them against the component, and report every one that
   produces a traceback, a hang, a leaked process or file, a wrong sentence, or an
   invented progress figure.
9. **Cancellation and cleanup are real.** After a cancel, a timeout, a crash and a
   vanished client: no child process left, no file left, the slot is free, and the same
   job can be run again. Verify by looking at the process table and the file system in
   a test, not by reading the code.
10. **Progress is honest.** No fraction is reported that the component cannot know; late
   subscribers get the latest report; nothing is sent after a final state; `cancelled`
   comes only after the work has stopped.

## The review file

Start with a verdict: `PASS`, or `FIX` with the count of defects. Then one section per
check with its evidence (commands and their figures). Then the defects as a numbered list,
most serious first, each with: what is wrong, the evidence, and what would count as fixed.
A defect is something that can mislead a user, lose work, hang, leak, flake or hide a
failure. A style preference is not a defect.

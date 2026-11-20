# Review 6 of printer delivery, hardening phase (the last)

Written Fri 2026-11-20 02:20 PT. Reviewed: the uncommitted changes under `delivery/` in
`/repos/popcornpenguins/penguin-slicer`, over commit `5d38566` on branch
`build/ports-and-hardening`. Judged against [review.md](../briefs/review.md),
[delivery-hardening.md](../briefs/delivery-hardening.md),
[upstream.md](../briefs/upstream.md) and the seven items "Open" in
[review 5](delivery-hardening-review-5.md). The builders' result and fix files were not
read. No file in the repository was changed (`git status --short` lists the same 13 paths
before and after).

## Verdict

**FIX, 7 defects, all rated low. What remains is low issues only**, on the same condition
as in review 5: items 1 and 2 of "Open" (the two limits left for the owner) are low only
if the real H2S shows a print it accepted within five minutes and does not keep the
previous print's end on screen under the new file's name for five minutes.

None of the seven defects lets a second start command reach a held printer in the code as
it stands. Two are about the tests (one fix has no test that fails when it is undone; a
failing property test takes minutes), one is the fast suite's time, and four are small
untruths or delays.

The seven items open in review 5:

| Item of review 5 | Now |
|---|---|
| 1. A daemon that could not watch takes a left-over end | Left as it is, by decision. The guide states it and the alternative plainly (section 6) |
| 2. A printer slower than 5 minutes gets a second start command | Left as it is, by decision. Stated plainly. One corner of it is wider than the guide says (defect 4) |
| 3. The hold is lost when both halves restart | Fixed. 180 aimed cases and 4,300 campaigns: no second start command with the note whole, half written, damaged, unreadable or stale |
| 4. "Already sent" said after a crash before the command | Fixed. The cancel answers "may already have sent"; 0 untrue answers in 4,300 campaigns |
| 5. An untrue reason on a printer that answers on and off | Fixed. The job ends `delivery.earlier_start_unsettled` with the seconds of fresh reports in `detail` |
| 6. The guide's walk | Fixed. All eight steps happen as written, but for one stage name in step 5 that the stream was too quick to show (section 5) |
| 7. Time limits without their setting's name | Fixed. Two tables name every limit with its default |

Scratch files of this review are in
`/tmp/claude-1000/-repos-popcornpenguins/c507b106-b789-4d12-a830-1dcc19de2171/scratchpad/r6/`:
`repeat.sh`, `fast.log`, `sim.log`, `up.log`, `speed.sh`, `speed.txt`, `prof.py`,
`mutate.py`, `mutations-a.log`, `mutations-b.log`, `single.py`, `single-G2.log`,
`single-small-set.log`, `notes.txt`, `cancel.txt`, `targets.txt`,
`campaign-scaled-4000.txt`, `campaign-unscaled-300.txt`, `cov.sh`, `walk.sh`, `walk.out`,
`walk/`, `sigint.sh`, and my tests in `copy/delivery/tests/`: `r6_campaign.py`,
`r6_notes.py`, `r6_cancel.py`, `r6_n4.py`, `r6_targets.py`, `r6_targets2.py`,
`r6_targets3.py`. (`walk.out` holds the walk's own pairing code, a throwaway of a relay
that no longer runs.)

## 1. The note of a start command (dispatch item a)

Read: `start_record.py` whole, and every use of it in `run_loop.py`. Run: `r6_notes.py`,
at the real settings, through the relay app, the real `RunLoop` and `RelayClient` and the
stand-in printer on fake clocks. One case is: a restart of the daemon, the relay or both,
at one of six points (after the gate and before the note; after the note and before the
command; after the command and before the note says `sent`; after that; 30 s into the
hold; at the settling), with the note as the restarted daemon finds it (whole, cut to half
its bytes, garbage, unreadable by permission, removed, stale from an earlier job when none
was there, or naming another printer), on a printer that shows the print 200 s after the
command or never. 70 s later the caller sends again, 90 s later cancels the first job;
after everything ends one more send must print. 180 cases ran.

| Invariant | Result |
|---|---|
| A file sent two start commands | 0 of 180 |
| A start command while the printer held an earlier one, note whole, half, garbage, unreadable or stale | 0 of 144 |
| The same, note removed or naming another printer, both halves restarted, command already sent | 6 of 6, as the design says: nothing is left that knows of the start |
| "The start command has already been sent" when none was | 0 |
| A job that never ended | 0 |
| The printer blocked: the last send did not print | 0 of 180 |
| A note left on the disk at the end | 0 of 180 |

What the caller sees:

| Restarted | The first job | A cancel 90 s later | The resend 70 s later |
|---|---|---|---|
| The daemon alone | Stays `start_not_shown`; ends `done` when the print shows, or `delivery.start_timeout` at 306 s | Before the note says `sent`: `delivery.start_being_sent`, "may already have sent" (true in each case). After: `delivery.cancel_too_late` (true). After the settling: `delivery.already_finished` | Refused, `delivery.job_in_flight` |
| The relay alone | Gone: `404 delivery.job_unknown`, "no record of this print, perhaps because it restarted", remedy "look at the printer ... before sending it again" | `delivery.job_unknown` | Accepted, shows `waiting_for_earlier_print`, then `delivery.printer_busy_at_start` when the first print shows, or prints after the hold settles |
| Both | Gone, as above | `delivery.job_unknown` | As for the relay alone, the hold coming from the note. Died before the note was written: the resend starts at once, which is right, because no command went |

Every sentence in those cases is true. The three invariants of the dispatch hold: no
second start command to a held printer; a damaged note never frees a printer (it holds
until 300 s of whole, fresh reports show no print, or a print going settles it); and no
note holds a printer for ever (the longest wait of the last send was 365 s).

Two things cost time rather than truth (defect 5): in 26 of the 180 cases the last send
waited 364 or 365 s instead of 64 or 65 s. Those are every case with a damaged or stale
note that the restarted daemon read, including the ones where the first print had already
been seen going and had finished.

What I read and did not run: the write is whole-or-nothing (temporary file, `fsync`,
`os.replace`); the folder itself is not flushed, so after a power cut the note can be
missing, which is the "removed" row above and needs the relay to restart in the same five
minutes. Nothing in `start_record.py` is Unix-only.

## 2. The hold under my own campaigns (dispatch item b)

`r6_campaign.py` is review 5's campaign with three additions: both halves restarting in
the same second, the note damaged just before a restart (garbage, half, empty, unreadable,
or a stale note written where none was), and a check that no file is sent two start
commands counting those that never reached the printer.

| | 4,000 campaigns, scaled settings | 300 campaigns, real settings |
|---|---|---|
| A file sent a start command twice | 0 | 0 |
| A start command on a picture not whole, not fresh or showing a print | 0 | 0 |
| A start command while the printer printed or held an earlier start | 0 | 0 |
| `cancelled`, yet a start command went | 0 | 0 |
| A "not started" code, yet a start command went | 0 | 0 |
| `printing` reported with no start command | 0 | 0 |
| "The start command has already been sent", none sent | 0 | 0 |
| A job still running when the faults had ended | 0 | 0 |
| The printer blocked: no later send printed | 0 | 0 |
| `done` for a print the printer never showed | 40 | 1 |
| A printer-error end with no printer error | 63 | 5 |

The last two rows are item 1 of "Open" and nothing else: every one of the 109 had a
daemon that could not watch and a printer that kept the previous end under the new name.
One campaign (seed 3868) also answered a stop-following with `delivery.still_reporting`
for such a job; same cause.

Aimed runs (`targets.txt`): review 5's sequence for its defect 3 now sends one start
command; for its defect 4 the cancels at 20 s and 90 s both say "may already have sent"
and the job ends `delivery.start_timeout` with no command sent; for its defect 5 the job
ends `delivery.earlier_start_unsettled`. The two limits behave exactly as review 5
describes (a second start command at 307 s and at 312 s).

One sequence the campaigns do not reach (`r6_cancel.py`, last test; defect 4): the first
job is no longer followed (the relay restarted 20 s after the command), the printer is off
the network from 5 s to 400 s after the command, and a resend arrives at 402 s. The hold
had counted 4 s of fresh reports, yet the second start command went, while the first was
still pending (the print showed at 420 s). A hold counts the time since its last look, and
nobody looks at it between jobs. It cannot free a printer sooner than 5 minutes after the
command by the clock, so it stays inside item 2 of "Open", but the guide's sentence "Time
without a whole, fresh picture is not counted" is not true there.

## 3. The property tests (dispatch item c)

Fourteen regressions, each put back alone in a scratch copy: the seven that review 5 found
escaping the property tests, and seven of my own in the new code. Each was run twice: the
three property tests alone (one worker each, cut at 150 s), and the rest of the fast suite
without them.

| Regression | The three property tests alone | The aimed tests (the rest) |
|---|---|---|
| G2 a picture without the main state counts as fresh | 2 fail, but only after 191 s and 312 s (run to its end separately: 321 s) | 5 fail in 6 s |
| G4 no wait for a free printer before the gate | 1 fails (`random_faults`), 70 s | 7 fail in 5 s |
| G7 a daemon that could not watch never takes an end | none failed in 150 s; one still running | 4 fail in 5 s |
| G9 a cancel past the gate always says "sent" | 1 failed, one still running at 150 s | 7 fail in 4 s |
| G11 a rebuilt hold forgets the gate's age | **0, escaped** | 1 fails in 5 s |
| G12 a start command that raises is taken as refused | 1 failed, one still running at 150 s | 1 fails in 8 s |
| G13 a reconnect does not make the picture not whole | 1 fails (`random_starts`), 95 s | 1 fails in 7 s |
| N1 a damaged note does not hold the printer | 1 fails (`a_resend_while...`), 25 s | 4 fail in 7 s |
| N2 the note is written only after the command | 1 fails (`a_resend_while...`), 30 s | 12 fail in 10 s |
| N3 a hold from a `sending` note claims the command went | **0, escaped** | 4 fail in 8 s |
| N4 `take_age` counts the watched time twice | **0, escaped** | **0: nothing in the fast suite fails** |
| N5 the reason after the wait chosen by the last look | **0, escaped** | 2 fail in 11 s |
| N6 settling a hold leaves its note behind | **0, escaped** | 6 fail in 8 s |
| N7 the relay takes `start_not_shown` as "sent" | 1 fails (`random_faults`), 148 s | 5 fail in 4 s |

Counts. Of review 5's seven: the property tests now fail on five (G2, G4, G9, G12, G13),
do not fail within 150 s on one (G7) and miss one (G11). Of my seven: they fail on three
(N1, N2, N7) and miss four. By test, where the name was printed:
`test_random_faults_never_print_twice_and_always_tell_the_truth` catches G2, G4 and N7;
`test_random_starts_never_overlap_and_never_end_on_a_left_over` catches G2 and G13;
`test_a_resend_while_the_first_start_is_unsettled_never_overlaps` catches N1 and N2. Only
aimed tests catch G7 (in a usable time), G11, N3, N5 and N6. The aimed tests catch
thirteen of fourteen, each in 4 to 11 s.

Two findings.

**N4 survives the whole fast suite (defect 1).** It undoes the builder's fix of the double
count in `StartHold.take_age`. It is a real regression, not an equal rewrite: `r6_n4.py`,
at the real settings, restarts the daemon 10 s after the command, lets it watch for about
100 s, quiets the printer for 75 s, stops following the stale job and sends again at
188 s, on a printer that shows the first print at 250 s. The code as it stands sends one
start command and refuses the second job as busy. With N4 the second start command goes
while the first is pending.

**A failing property test takes minutes (defect 2).** Under G2 the two failing property
tests ran 191 s and 312 s, and Hypothesis printed "has spent more than five minutes
working to shrink a failing test case". The 30 s per-test limit does not end them. With
G2 in place the whole fast suite had not finished after 290 s when I stopped it. The
aimed tests fail on the same regression in 6 s.

Coverage under the fast suite (`cov.sh`, data file in the scratch folder): `run_loop.py`
99%, `start_record.py` 96% (missing: a path with no folder part, and a temporary file
that cannot be removed after a failed write), `printer.py` 96%, `__main__.py` 97%,
`config.py` 97%, `relay_client.py` 99%, `deliveries.py` 98%, `relay.py` 99%, `routes.py`
99%, the other relay modules 100%. Sampling: I read the first 200 lines of
`daemon/tests/test_daemon_start_record.py` and lines 366 to 546 of
`tests/test_start_decided.py`; each test there asserts the note's content, the
acknowledgement, the code or the count of start commands, not that a line ran.

## 4. Flakes and speed (dispatch item d)

Every run was pytest started directly from `delivery/.venv/bin/python` under `timeout -k 5
240` and a 2 GB address-space limit on pytest itself.

| Suite | Runs | Failures | Time per run (pytest's own figure) |
|---|---|---|---|
| Fast suite, random order, 2 workers, seeds `6300 + 7919 * run` | 40 | 0 | 6.65 s to 12.57 s; runs 1 to 13, before my other work shared the CPUs: 6.65 s to 7.38 s, median 7.12 s |
| The same, measured again with nothing of mine running | 3 | 0 | 6.74 s, 7.45 s, 6.74 s |
| Simulated-printer suite (36 tests) | 10 | 0 | 15.4 s to 17.2 s |
| Upstream check (55 tests) | 5 | 0 | 15.6 s to 17.3 s |

The fast suite is 1,125 tests and 156 subtests. The claim is right: about 7 s, up from
about 3.7 s in review 5.

**Where the time goes** (`speed.txt`, quiet machine):

| | Time |
|---|---|
| Fast suite, one worker | 11.94 s |
| `test_random_faults_never_print_twice_and_always_tell_the_truth` (60 examples) | 2.56 s |
| `test_a_resend_while_the_first_start_is_unsettled_never_overlaps` (120 examples) | 1.87 s |
| `test_random_starts_never_overlap_and_never_end_on_a_left_over` (80 examples) | 1.83 s |
| The next slowest tests | 0.33 s, 0.21 s, 0.15 s, then 0.07 s and less |
| Fast suite, 2 workers, without those three tests | 3.60 s, 3.72 s, 3.33 s |
| Collection | 0.19 s |

So the three property tests are 6.3 s of 11.9 s of work, and about 3.3 s of the 7 s a
person waits; the other 1,122 tests take what they took before. The reason given is half
right. There are 260 examples where there were 110, and one example costs about 24 ms
where it cost about 13 ms. Under a profiler (`prof.py`) about two thirds of an example is
the relay's routes called through Flask's test client (32,713 requests in the 260
examples: the daemon's syncs and the test's own reads of the job), and making a new relay
app for each example is a few percent; the real printer link does not appear among the
first 45 entries. The note adds 352 real `fsync` calls, 0.4 s under the profiler, which is
real waiting on the disk inside the fast suite and will be slower on a slow disk.

**What would bring it back down.**

- Reading the job from the relay directly instead of through the route, in the per-second
  loop of `random_starts`, saved 0.3 s of 6.2 s. Not worth much alone.
- Lowering `max_examples` to 30, 40 and 20 brings the three tests to 1.9 s and the fast
  suite to about 4.5 s, **but loses catches**: with those figures the property tests
  passed under N1 and under N2 (`single-small-set.log`), which the full figures catch;
  G4 and G13 were still caught.
- So the suggestion is the one in the dispatch, with one condition. Move the three
  campaigns at their present figures (or larger) to their own target, run before a
  commit and by reviewers. Keep in the fast suite a fixed set of examples written out by
  hand (Hypothesis's `@example`, or plain parametrised cases), one for each regression the
  campaigns are known to catch (G2, G4, G9, G12, G13, N1, N2, N7), with shrinking and
  generation off. The fast suite then returns to about 4 s and still fails, in seconds,
  on every one of them.
- Give the harness a note writer that does not call `fsync`, and keep the `fsync` under
  its three unit tests.
- Whatever is kept in the fast suite, turn shrinking off there (defect 2): a regression
  must fail the suite in seconds, not hold it for five minutes.

Hunt for causes that have not bitten: the new files have no real sleep, no thread and no
fixed port; `start_record.save` reads the wall clock only for the `written_at` field,
which a person reads and no rule uses; every test writes its note under its own temporary
folder. The simulated-printer suite's 16 s is unchanged from review 5.

## 5. The guide's "Try it on one machine" (dispatch item e)

Done as written (`walk.sh`), the home in the scratch folder, after checking that `make
install` would change nothing (`uv sync --locked --dry-run`: "Would make no changes").

| Step | Result |
|---|---|
| 1. The simulated printer | Listens on 18883 and 18990; prints the serial and the access code |
| 2. `pair` | "Connected", prints the pairing code and the `run` command |
| 3. The relay | Listens on 8787 |
| 4. `run` | "paired with the relay", then the idle line; `request=sync` lines in the relay's log |
| 5. Send and stream | `202` with the job id; the stream ended with `done` after 27 s: `waiting_for_daemon`, `waiting_for_printer`, `starting`, `printing` (heating the bed, levelling, 25, 75 percent), `done`. No `uploading` report reached the stream (too quick, like `downloading`); the guide names it |
| 6. Cancel at once | `"outcome":"cancelled"`; the report says `cancelled` |
| 7. Cancel one the daemon holds (`upload_refused`) | `202`, `"outcome":"cancelling"`; 8 s later the report says `cancelled`; the daemon's log says it removed the file and "it was never started on the printer" |
| 8. Too late to cancel | Report `printing`; the cancel answers `409 delivery.cancel_too_late` with the sentence the guide quotes; the print went on to `done` |

After the whole print the home held `config.toml` and an empty `downloads/`, no
`start.json`. The relay's log, the daemon's log and the event stream hold no pairing
code, token or access code. None of the three programs was left running.

Two things seen on the way. In step 7 the daemon's log has the line "printer library said:
Failed to execute function: 550 No such file." and then "removed ... from the printer",
for a file that never reached the printer (defect 6). And my script's stop sent the
daemon three interrupts at once (to the program and to its two wrappers), and its log
ended in a traceback, `KeyboardInterrupt` inside the line that logs "stopping" (defect 7).
One interrupt, and two in quick succession, sent to the daemon alone (`sigint.sh`), both
ended with "stopping" and no traceback.

## 6. The guide on the two limits

The subsection "Two limits that wait for the real printer" states both limits with what
the user sees and that a resend sends a second start command while the first is pending;
says both are left until the owner decides; names the two lines of the hardware checklist
that settle them; and gives the alternative (end the job as outcome unknown and keep the
printer held until a picture or a person clears it) with its two costs and why it is the
owner's choice. Plain and complete. The one thing it does not say is defect 4.

## 7. Everything else in the brief (dispatch item f)

- **Error reports, route by route** (from the walk's relay). The four caller routes for a
  job answer an unknown job with `404 delivery.job_unknown` and a finished one with
  `409 delivery.already_finished`; a send whose body is not JSON, or has no token, answers
  `404 delivery.sliced_file_missing`; each is a whole error report with code, sentence,
  remedy and detail, and each left its line in the relay's log. The daemon's routes answer
  a bad token with `401 {"error": "repair"}` and an unknown pairing code with
  `404 {"error": "not paired"}`: short on purpose, and the daemon is not the caller. A
  path or method the relay does not have gets the web framework's own HTML page (404,
  405) from the stand-in server; in a real deployment that page belongs to the caller's
  application. All 45 codes of `errors.py` are in the guide and named in a test; the new
  one, `delivery.start_not_recorded`, has a test that produces it through the whole chain,
  and its sentence and remedy are true.
- **Nothing Unix-only on the daemon's path.** A search of the daemon's package finds
  `pwd` and `os.chown` only inside the guarded hand-over for the old install, as before.
  The note uses `os.open`, `os.fsync`, `os.replace` and `os.unlink`, which Windows has.
  The test that imports the whole daemon with the Unix-only modules missing passed in all
  43 fast runs. The old install's configuration folder is writable by its service user, so
  the note can be written there.
- **What is left on the printer after a cancel** (`r6_cancel.py`): with the file uploaded
  and the job waiting for a quiet printer, a cancel at each of 21 moments (every 4 s from
  6 s to 86 s) ended the job `cancelled`, sent no start command, removed the file from
  the stand-in printer, left the download folder empty and no note, and the same file sent
  again printed.
- **Upstream.** No file of the pin, the upgrade command or the seam is among the changed
  paths; the upstream check passed 5 times.
- **Separation and the contracts' example files.** Their tests are in the fast suite and
  passed in all runs. Not gone through again by hand.
- **Progress is honest.** No `printing` without a start command in 4,300 campaigns;
  "nothing after a final state" is asserted by the repository's own property tests, which
  passed.

## Defects

All low. Most serious first. Items 1 and 2 of "Open" are not counted here.

1. **The fix of the double count has no test that fails when it is undone.** Evidence:
   regression N4 in `StartHold.take_age` passes all 1,125 tests; `r6_n4.py` shows that
   with it a second start command goes at about 200 s while the first is pending. Fixed
   when a test with that sequence is in the fast suite.

2. **A failing property test takes minutes, and the 30 s limit does not end it.**
   Evidence: `single-G2.log` (191 s and 312 s, five minutes of shrinking); the fast suite
   under G2 unfinished after 290 s. Fixed when a regression fails the fast suite in
   seconds: shrinking off, or the campaigns in their own target.

3. **The fast suite takes about 7 s, and 3.3 s of it is three tests.** Evidence: section
   4. Fixed as section 4 suggests, keeping one written-out example for each regression the
   campaigns catch, because fewer random examples lose N1 and N2.

4. **A hold that nobody is watching counts the time it was not watched.** Evidence:
   section 2, last paragraph (4 s of fresh reports counted, second start command at
   402 s). It is inside item 2 of "Open" by the clock, but the guide says time without a
   whole, fresh picture is not counted. Fixed when the guide says so, or when a hold
   counts only what it watched.

5. **A damaged or stale note makes the next print wait five minutes for nothing.**
   Evidence: 26 of 180 cases in section 1; the stage says "Waiting to see whether the
   print sent before this one has started", which is not true of a stale note, nor of a
   print already seen going and finished. Fixed when a damaged hold is settled by the
   first job's own evidence, and the stage's sentence fits a hold whose start is unknown.

6. **The daemon's log shows an error-looking line and says "removed" for a file that was
   never on the printer.** Evidence: section 5, step 7. Fixed when the "no such file"
   answer to a delete is reworded or dropped and the line says the file was not there.

7. **Several interrupts at once end the daemon's log in a traceback.** Evidence: section
   5. Not reproduced with one or two interrupts. Fixed when the last lines of `cmd_run`
   cannot be interrupted into a traceback.

## Open

Each item stands alone. "Likely" is my estimate from the code and the stand-in printer;
only the real H2S can settle items 1 and 2.

1. **A print can be reported as finished, or as failed, when it has not begun.** If the
   daemon restarted or lost the printer for two minutes just after a start command, and
   the printer keeps showing the previous print's end under the new file's name for five
   minutes, the delivery job ends `done` (or failed), and a resend sends a second start
   command. Unlikely: it needs both at once, and nobody has seen an H2S hold an old end
   under a new name. Fixing it takes a recording that rules it out, or ending such a job
   as "outcome unknown" and keeping the printer held until a person or the printer's
   report clears it, which is the owner's decision. **Low**, serious if the H2S is found
   to do this.

2. **A printer that takes more than five minutes to show a print it accepted is reported
   as not having started it.** The user sees a failure whose remedy says to look at the
   printer first; a resend is accepted and sends a second start command while the first
   is pending. The five minutes are by the clock, not of fresh reports, when the first
   job is no longer followed and the printer was off the network. Unlikely: the one
   recorded report suggests seconds. Fixing it takes a measured time and a setting well
   above it, or the same "held until cleared" rule as item 1. **Low**, serious if the H2S
   is found to be that slow.

3. **One of this round's fixes is not protected by any test.** To a user: nothing now. If
   someone later undoes the fix by accident, a second start command can go to a printer
   about three minutes after the first, and no test will say so. Likely only if that code
   is edited again. Fixing it takes one test; the sequence is written in my scratch
   folder. **Low.**

4. **When a real bug is introduced, the fast suite can take more than five minutes
   instead of failing in seconds.** To a user: nothing. To whoever is working on the code:
   a long wait where a quick failure was due. Certain for some bugs (seen with one of
   fourteen tried; three more ran past 150 s). Fixing it takes a setting on three tests or
   moving them to their own target. **Low.**

5. **The fast suite takes about 7 seconds where it took about 4.** To a user: nothing.
   About 3.3 s is three random-sequence tests. Fixing it takes moving those to their own
   target and keeping about eight fixed examples in the fast suite; simply running fewer
   random examples would stop catching two of the bugs they catch now. **Low.**

6. **After the daemon restarts and finds a damaged or outdated note of a start, the next
   print waits five minutes before it starts.** To a user: one delay of five minutes with
   a message about an earlier print, in a case where there may be none. Unlikely: it
   needs a restart of the daemon together with a damaged file or a restart of the relay.
   Fixing it takes a few lines and a test. **Low.**

7. **The guide says time when the printer is silent never counts towards freeing it, and
   in one corner it does.** To a user: nothing beyond item 2. Fixing it takes one sentence
   in the guide, or a few lines so that a hold counts only what it watched. **Low.**

8. **The daemon's log has a line that looks like an error when a cancelled file was never
   on the printer, and says it removed it.** To a user: nothing; to whoever reads the log
   for support: a false alarm. Certain in that case. Fixing it takes rewording one line.
   **Low.**

9. **Pressing Ctrl-C several times at once can end the daemon's log with a traceback.**
   To a user: an alarming last line; the daemon has stopped correctly. Seen once, with
   three interrupts. Fixing it takes a few lines. **Low.**

**What remains is low issues only**, provided the hardware session confirms what items 1
and 2 assume. The checklist "For the session at the real printer" at the end of
[review 4](delivery-hardening-review-4.md) still applies as written; its lines on the
documents between the start command and the first `PREPARE` or `RUNNING`, and on the
seconds from the start command to the first document naming the file, decide items 1
and 2.

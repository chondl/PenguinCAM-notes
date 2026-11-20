# Review 5 of printer delivery, hardening phase

Written Fri 2026-11-20 00:55 PT. Reviewed: the uncommitted changes under `delivery/` in
`/repos/popcornpenguins/penguin-slicer`, over commit `81b5f4a`. Judged against
[review.md](../briefs/review.md), [delivery-hardening.md](../briefs/delivery-hardening.md),
[upstream.md](../briefs/upstream.md), the six items "Open at commit" in
[review 4](delivery-hardening-review-4.md) and the coordinator's four rulings on the
start in the dispatch. The builders' result and fix files were not read. No file in the
repository was changed (`git status --short` lists the same 25 paths before and after).

## Verdict

**FIX, 7 defects, all rated low. What remains is low issues only**, with one condition
stated plainly: defects 1 and 2 are the builder's two stated limits, and they are low
only if the real H2S shows a print it has accepted within five minutes and does not keep
the previous print's end on screen under the new file's name for five minutes. Nobody has
recorded that yet. If the hardware session finds either behaviour, that defect becomes
serious (a wrong final answer, and a second start command to a printer that still holds
the first).

The six items open at commit `81b5f4a`:

| Item of review 4 | Now |
|---|---|
| 1. A start command on a report without the main state | Fixed. Such a picture is never free; 3,150 campaigns sent every start command on a whole, fresh picture |
| 2. A left-over end ends the job in its first seconds | Fixed for a daemon that watched the start. A daemon that could not watch still takes it after 5 minutes (defect 1) |
| 3. No cancel after the gate, two untrue sentences | Fixed. A cancel worked at each of 60 moments before the start command. One untrue sentence remains in a crash window (defect 4) |
| 4. A slow printer gets a second start command | Fixed up to 5 minutes by the hold. Beyond 5 minutes it still happens (defect 2) |
| 5. No way to try it by hand | Fixed. The walk works as written, except one sentence of step 6 (defect 6) |
| 6. Refused requests not logged | Fixed. Each refusal I made left its line |

Scratch files of this review are in
`/tmp/claude-1000/-repos-popcornpenguins/c507b106-b789-4d12-a830-1dcc19de2171/scratchpad/r5/`:
`repeat.sh`, `fast.log`, `sim.log`, `up.log`, `mutate.py`, `mutations.log`, `walk.sh`,
`walk/`, `campaign-3000.txt`, `campaign-unscaled.txt`, and my tests in
`copy/delivery/tests/r5_campaign.py` and `copy2/delivery/tests/r5_targets.py`,
`r5_targets2.py`, `r5_targets3.py`.

## 1. Flakes and wall times (dispatch item e)

Every run was pytest started directly from `delivery/.venv/bin/python`, in `delivery/`,
under `timeout -k 5 240` and a 2 GB address-space limit on pytest itself.

| Suite | Runs | Failures | Time per run (pytest's own figure) |
|---|---|---|---|
| Fast suite, random order, 2 workers, seeds `5200 + 6151 * run` (11351 to 251240) | 40 | 0 | 3.52 s to 4.47 s, median 3.74 s |
| Simulated-printer suite (`-m simulator`, 36 tests) | 10 | 0 | 15.4 s to 18.1 s |
| Upstream check (`-m "upstream or simulator"`, 55 tests) | 5 | 0 | 15.8 s to 17.1 s |
| The together run (`-m real_time`, 2 tests) | 1 | 0 | 1.6 s |

The fast suite is 1,064 tests and 156 subtests. No run hung. No `time.sleep`, wall-clock
read or fixed port in `tests/`, `relay/tests/`, `daemon/tests/` or `conftest.py` outside
the upstream and hardware files.

## 2. Speed: is anything in the fast suite slow without need?

No. One worker, no coverage: 5.7 s. Six tests take more than 0.1 s and together about
2.1 s; the other 1,058 take about 3.6 s.

| Test | Time |
|---|---|
| `tests/test_start_decided.py::test_random_starts_never_overlap_and_never_end_on_a_left_over` | 0.59 s |
| `tests/test_link_faults.py::test_random_faults_never_print_twice_and_always_tell_the_truth` | 0.53 s |
| `tests/test_link_faults.py::test_the_link_down_from_just_after_the_start_ends_done_not_failed[60]` | 0.34 s |
| `tests/test_start_decided.py::test_a_resend_while_the_first_start_is_unsettled_never_overlaps` | 0.26 s |
| `tests/test_link_faults.py::test_a_printer_off_for_a_day_shows_its_true_age_then_ends_with_the_outcome_unknown` | 0.21 s |
| `tests/test_link_faults.py::test_the_link_down_from_just_after_the_start_ends_done_not_failed[17]` | 0.14 s |

All six simulate minutes to hours second by second on fake clocks; none waits on the wall
clock. The three property tests are 110 random sequences in 1.4 s, which is what they are
for. The simulated-printer suite's 17 s is real TLS connections and one certificate made
per test (slowest test 1.75 s); one certificate shared by the suite would cut it, and
that is a preference, not a defect.

A suite with a regression in it is slower: three of my thirteen regressions took 40 s,
51 s and 80 s to fail (section 3), all ended by the bounded sleeps and the 30 s per-test
limit, none hung.

## 3. Coverage, and would the property tests catch regressions here (dispatch item d)

Branch coverage under the fast suite, data file in the scratch folder:

| Module | Cover | Uncovered failure paths |
|---|---|---|
| `daemon/.../run_loop.py` | 98% | 587 (printer link with no `delete`), 629 and 904 (returns after `_await_start`, which always raises), 1091 |
| `daemon/.../printer.py` | 96% | 510-511, 757-758, 765, 793-794, 867-869 (not read one by one) |
| `daemon/.../__main__.py` | 97% | 99-100, 232, 348-349, 419-423 |
| `daemon/.../config.py`, `relay_client.py` | 97%, 99% | `config.py` 136-137 |
| `relay/.../deliveries.py`, `relay.py`, `routes.py` | 98%, 99%, 99% | `routes.py` 620 |
| `relay/.../errors.py`, `limits.py`, `sliced_files.py`, `app.py`, `caller.py`, `paths.py` | 100% | none |
| `simulator/__main__.py`, `together/relay_server.py` | 0%, 51% | covered by the simulated-printer suite's `test_by_hand.py`, not by the fast suite |

Thirteen regressions of my own, each put back alone in a scratch copy and run against the
whole fast suite. **None survived the suite.** The question asked was narrower: would the
three property tests (the two in `test_start_decided.py` and
`test_random_faults_never_print_twice_and_always_tell_the_truth`) have caught it?

| Regression put back | Failed tests | Property tests among them | Run time |
|---|---|---|---|
| G1 an end naming our file always counts | 15 | 2 | 80 s |
| G2 a picture without the main state counts as fresh | 5 | **0, escaped** | 4 s |
| G3 a restarted daemon does not rebuild the hold | 2 | 1 (the aimed one) | 20 s |
| G4 no wait for a free printer before the gate | 7 | **0, escaped** | 4 s |
| G5 silence after the start command counts towards "did not start" | 6 | 1 | 40 s |
| G6 the hold dropped when the relay no longer holds the job | 4 | 0 (see below) | 5 s |
| G7 a daemon that could not watch never takes an end | 4 | **0, escaped** | 4 s |
| G8 the relay takes an end naming the file while still starting | 12 | 2 | 51 s |
| G9 a cancel past the gate always says the command was sent | 2 | **0, escaped** | 4 s |
| G10 a hold left by another job never holds | 8 | 1 (the aimed one only) | 16 s |
| G11 a rebuilt hold forgets the gate's age | 1 | **0, escaped** | 4 s |
| G12 a start command that raises is taken as refused | 1 | **0, escaped** | 5 s |
| G13 a reconnect does not make the picture not whole | 1 | **0, escaped** | 4 s |

Judgement: the builder's account holds, and it generalises. The broad property test
catches regressions that produce a wrong end (G1, G5, G8); it does not catch a removed
hold (G10: only the aimed test), and seven of thirteen regressions in this area escaped
all three property tests and were caught only by aimed unit tests. The reasons: the
stand-in printer's partial pictures always carry a true state (so G2 and G13 do no harm
in it), no property test cancels (G4, G9), and none checks how long a job waited (G11).
The property tests are a net under the aimed tests, not a replacement for them. That is
acceptable because each rule has its aimed test, and each of the thirteen was caught by
one. G11, G12 and G13 each rest on a single test.

G6 is not a real regression at the level of the whole system: the daemon rebuilds the hold
from the relay's `previous_start` on the next job, so the unit tests fail and the
sequences stay correct.

Sampling of assertions: I read all eleven tests of `tests/test_start_decided.py`; each
asserts the caller's report, the error code and the count of start commands, not that a
line ran. I did not read the bodies of the unit tests named in `mutations.log`; that they
fail under the matching regression is the evidence that they assert the behaviour.

## 4. The start, exhaustively (dispatch item a)

`r5_campaign.py` drives the relay app, the real `RunLoop` and `RelayClient` and the
stand-in printer on fake clocks, through a seeded random campaign: the printer before the
send idle or showing the previous print's end (`FINISH`, `FAILED`, idle with an error
code); after a start command it shows the print at once, after a delay under the settle
time, or never, with or without the previous end kept under the new name; up to seven of:
partial pictures, quiet streams, printer outages, link outages, link faults on sync,
acknowledgement and the gate, a daemon restart, a relay restart, a cancel, a
stop-following, a resend; and, in two cases of five, the daemon dying just before the
start command, just after it, or the command raising. After the faults end the campaign
waits for every job, then sends once more to see that the printer is not blocked.

| | 3,000 campaigns, settings scaled as the repository's own property tests scale them | 150 campaigns at the real settings |
|---|---|---|
| A file sent a start command twice | 0 | 0 |
| A start command on a picture not whole, not fresh, or showing a print | 0 | 0 |
| A start command while the printer printed or held an earlier start | 0 | 0 |
| `cancelled`, yet a start command went | 0 | 0 |
| A "not started" code, yet a start command went | 0 | 0 |
| `printing` reported with no start command sent | 0 | 0 |
| A job still running when the faults had ended | 0 | 0 |
| The printer blocked: no later send printed | 0 | 0 |
| `done` for a print the printer never showed | 27 | 5 |
| A printer-error end with no printer error | 66 | 2 |
| "The start command has already been sent", none sent | 50 | 2 |

The last three rows are defects 1 and 4. Every one of the 100 wrong ends had a daemon
that could not watch (restarted, or without a picture for the left-over time) and a
printer that kept the previous end under the new name past the settle time. Every one of
the 52 untrue sentences followed a daemon that died between the gate and the command.

Ruling by ruling:

1. **Free needs a whole, fresh report that says so.** Holds. A picture with no main state
   reads `unrecognised` and is never free; after a reconnect the picture is not whole
   until a document with `gcode_state` arrives (the library calls the connect hook after
   it asks for a whole report and on the same thread as the messages, so there is no race;
   the upstream check pins both hooks).
2. **An end counts only if it is this print's.** Holds for a daemon that watched: the
   repository's tests and my campaigns never ended a job on a left-over end while the
   daemon watched. A restarted daemon does find a real end (regression G7 is caught by
   four tests). The price is defect 1.
3. **The wait before the gate; a cancel works until the command.** Holds: with the printer
   quiet for 200 s from the upload on, a cancel at each of 60 moments (every 4 s) worked
   whenever no start command had gone, and was refused only after one had. One untrue
   sentence remains (defect 4).
4. **After a start command the printer is held.** Holds within the settle time and one
   process's memory; a slow printer gets `start_not_shown` with `waited_s`, not a failure
   at 60 s. Two ways past it are defects 2 and 3. The six settings of the start are named
   in the guide with defaults; some other limits are not (defect 7).

## 5. The builder's two stated limits (dispatch item b)

**A printer slower than 5 minutes to show a print** (`r5_targets.py`, show after 330 s).
The user sees `start_not_shown`, "The printer has the file and has not shown the print
yet", with the seconds waited; a resend at 100 s is refused (`delivery.job_in_flight`) and
stop-following is refused (`delivery.start_not_shown_yet`). At 307 s the job ends
`failed`, `delivery.start_timeout`: "The printer did not show the print as started within
300 seconds. Look at the printer before sending again, because the part may be printing
already." A resend is then accepted, and **a second start command goes to the printer
while it still holds the first**. The first job stays `failed` though its part prints.

**A daemon that could not watch, and a left-over end shown longer than 5 minutes**
(daemon restarted 2 s after the command; the printer shows the previous `FINISH` under the
new name for 400 s, then prints). The user sees `start_not_shown` until 312 s, then
**`done`**, for a print that has not begun. A resend is accepted and a second start
command goes while the first is pending. With a left-over `FAILED` the job ends
`delivery.printer_error_at_start` instead.

**Is there a safer rule that needs no timing of the real printer?** Yes, one, at a cost.
Time is used in both limits to decide something the pictures do not show. The rule that
needs no timing: when the settle time passes without proof (no print of ours seen going,
no end proven ours), end the delivery job as outcome unknown ("the printer has the file
and never showed the print; look at the printer") and keep the printer held until either
a picture proves the printer moved on (another file going or ended, or the printer
reconnecting with a whole `IDLE` picture that names no file) or a person says the printer
is clear (a flag on the resend, or a small route). Then no clock ever frees a printer for
a second start command. The cost is one confirmation by a person after a start the
printer truly ignored. For the second limit there is no timing-free way to say `done`:
the previous print's `FINISH` under our name and our own print's `FINISH` look the same
in the fields the daemon reads, so the honest answer for a daemon that could not watch is
"outcome unknown", unless a recording shows a field that tells them apart (the layer
total, for instance). That conflicts with the ruling that a restarted daemon must find a
real end, so it is the owner's choice; the hardware session may make the choice
unnecessary.

## 6. The hold (dispatch item c)

- **Can it outlive every way of clearing it and block a printer for ever?** No. Every
  whole, fresh picture either settles it (our print going, a proven end) or counts
  towards the settle time, also when it shows the previous end under our name. A picture
  that is not whole, not fresh or of an unknown main state counts nothing, but on such a
  picture no start could go anyway, and each job ends by its own ten-minute limit with a
  code. The hold lives in the daemon's memory; a restart drops it and the relay's
  `previous_start` rebuilds it with the gate's age. In 3,150 campaigns a send made after
  the faults ended always printed.
- **What the caller sees while it holds.** The next delivery job is accepted and shows
  `waiting_for_earlier_print`, "Waiting to see whether the print sent before this one has
  started". A cancel there works (the job ended `cancelled`, one start command in all).
  Stop-following there answers `delivery.not_started`, which is right.
- **Does `delivery.earlier_start_unsettled` tell the truth?** Its sentence ("was sent
  another print just before this one and has not shown within 10 minutes whether that one
  started, so this print was not started") is true in the ordinary case. I could not
  reach it through the whole chain in three tries: the hold settles after 5 minutes of
  whole, fresh pictures and the job's limit is 10, so the code is given only when the
  printer answered for less than half of those 10 minutes and happens to be answering at
  the last look; the repository's unit test reaches it. When the printer is not answering
  at the last look, the job ends with the other code and an untrue detail (defect 5). The
  sentence is not true in two corners: the earlier job passed the gate but its start
  command was never sent (defect 4's crash, then a restart), and "just before" when the
  hold is hours old because the printer was off.

## 7. The guide's "Try it on one machine" (dispatch item f)

Done as written, with the home in the scratch folder ("any empty one will do").

| Step | Result |
|---|---|
| 1. `uv run python -m simulator --scenario whole_print` | Listens on 18883 and 18990; prints the serial and the access code |
| 2. `pair --home ... --backend http://127.0.0.1:8787 --dev --printer-ports 18883,18990` | "Connected to the printer", prints the pairing code |
| 3. `uv run python -m together.relay_server --code ...` | Listens on 8787 |
| 4. `run --home ...` | "paired with the relay", then idle; 18 `request=sync` lines in the relay's log |
| 5. Send and stream | `202` with the job id; the stream ended with `done` after 28 s: `waiting_for_daemon`, `waiting_for_printer`, `uploading`, `starting`, `printing` (heating bed, levelling, 25, 75 percent), `done`. No `downloading` report appeared (the download is too quick) |
| 6. Cancel at once | `"outcome":"cancelled"`, report `cancelled`, as written |
| 6. "A cancel a few seconds later ... answers `cancelling`" | **Not as written**: 6 s later the answer was `409 delivery.cancel_too_late` and the print ran. On one machine the daemon takes the job at its next 5 s sync and sends the start command within the same second, so the `cancelling` window is too short to hit by hand (defect 6) |

Ctrl-C (SIGINT) stopped all three programs; none was left running.

## 8. Log lines for refused requests, and secrets (dispatch item g)

From the walk's relay log, each refusal I caused:

```
printer-delivery request=send printer=fcabd9c1 status=409 team=- error=delivery.printer_busy
printer-delivery request=job printer=fcabd9c1 status=404 job=jnope0000 error=job_unknown
printer-delivery request=cancel printer=fcabd9c1 status=404 job=jnope0000 error=job_unknown
printer-delivery request=sync printer=- status=401 error=token_invalid
```

`caller_team` in `routes.py` now writes a line for the 401 and the 429 on the four
delivery job routes. I read that code and did not cause those two refusals myself (the
walk's stand-in caller signs everyone in); `relay/tests/test_relay_routes.py` asserts the
lines for `not_signed_in`, `identity_unreadable` and `rate_limited`, and passed in all 40
runs.

Secrets: the walk's relay log, daemon log and event stream hold no pairing code (plain or
dashed), no daemon token, no access code and no download token. The simulated printer
prints its own test access code, as the guide says it does.

## 9. Everything else in the brief, briefly (dispatch item h)

- **Error reports.** The three new codes (`delivery.start_being_sent`,
  `delivery.start_not_shown_yet`, `delivery.earlier_start_unsettled`) are in the guide's
  table and conform; the changed sentences of `delivery.cancel_too_late` and
  `delivery.outcome_unknown` no longer say the print started. Untrue cases: defects 4
  and 5.
- **Upstream.** One pin, the upgrade command, the seam and the guide section are as review
  4 found them. The upstream check grew to 55 tests and now pins the message hook and the
  connect hook that the whole-picture rule rests on. Not protected, because only a real
  H2S can show it: whether the H2S sends partial documents, and what it shows between a
  start command and the print.
- **Separation.** Unchanged; the import tests passed in all 40 runs.
- **Cancellation and cleanup.** In the campaigns no cancelled job ever had a start
  command. Whether a cancelled job's file is gone from the printer, and the process
  table after a crash, I did not check again by hand; the suite's own assertions stand
  for those.
- **Error reports route by route, the daemon as a plain Python program, the contracts'
  example files:** not gone through again in this round beyond the suites passing; review
  4's findings on them are the last independent check.
- **Progress is honest.** No `printing` report without a start command in any campaign.
  "Nothing after a final state" I left to the repository's `assert_truthful`, which ran in
  all 40 fast runs.
- **Still open by design, not counted:** a report up to 15 s old counts as fresh.

## Defects

All low. Most serious first.

1. **A daemon that could not watch the start takes a left-over end, shown for 5 minutes,
   as this print's end.** `StartHold._end_counts` in `run_loop.py`. Evidence: section 5,
   second case (`done` at 312 s for a print not begun, then a second start command), and
   100 wrong ends in 3,150 campaigns, every one with such a daemon and such a printer.
   The builder states this limit in the guide. Fixed when either a recording of the real
   H2S shows it cannot keep the previous end under a new name for 5 minutes, or the job
   ends as outcome unknown in that case and the printer stays held (section 5).

2. **A printer slower than 5 minutes to show a print is failed and can get a second start
   command.** `START_SETTLE_SECONDS`. Evidence: section 5, first case. Stated by the
   builder. Fixed when the real time is on record and well under the setting, or when no
   clock frees the printer (section 5).

3. **The hold is lost when the daemon and the relay both restart inside the settle time.**
   The hold is in the daemon's memory and its copy (`last_grant`) in the relay's.
   Evidence (`r5_targets2.py`): start command at 7 s, printer shows the print at 207 s;
   both restarted at 40 s; a resend at 70 s was accepted and its start command went while
   the first was pending. Either restart alone keeps the hold. Fixed when the daemon keeps
   the hold in its home directory, with a test that restarts both.

4. **After a daemon dies between the gate and the start command, the caller is told the
   command was sent.** The restarted daemon reports `start_not_shown` with
   `start_sent: true` for a hold it rebuilt, and the relay then answers a cancel with
   `delivery.cancel_too_late`, "The start command for this print has already been sent to
   the printer". Evidence (`r5_targets2.py`): died at 7 s with no command sent; cancel at
   20 s said `delivery.start_being_sent` ("may already have sent", true); cancel at 90 s
   said `delivery.cancel_too_late`; the job ended `delivery.start_timeout` at 308 s with
   no start command ever sent; 52 campaigns show the same. Fixed when a rebuilt hold does
   not claim `start_sent` (the "may already have sent" sentence stays), with a test.

5. **A job that waited behind the hold on a printer that answers on and off ends with a
   reason that is not true.** `_await_free_printer` picks the code by whether the picture
   is fresh at the last look. Evidence (`r5_targets3.py`, printer quiet 50 s of every
   60): the second job showed `waiting_for_earlier_print`, then ended
   `delivery.printer_unreachable_at_start`, "could not reach the printer for 10 minutes",
   detail "no whole, fresh report from the printer for 600 s", while the hold had counted
   254 s of fresh reports. Fixed when the detail gives the seconds of fresh reports and
   the code is `delivery.earlier_start_unsettled` whenever the hold was the reason.

6. **Two statements of the guide's walk do not happen as written**, and one quotation is
   wrong. Step 6's "a cancel a few seconds later ... answers `cancelling`" answered
   `409 delivery.cancel_too_late` (section 7); step 5 names `downloading`, which the
   stream did not show; the section "How a start is decided" quotes
   `delivery.start_being_sent` as "is being sent to the printer now", which is not its
   sentence. Fixed when step 6 says what a person will see (or offers a way to slow the
   start, such as a scenario whose printer is quiet at first) and the quotation matches.

7. **Not every time limit is a named setting in the guide.** The table has the six of the
   start. `GATE_WAIT_SECONDS` (10 min) and `HOLD_CHECK_SECONDS` (30 s) appear in the
   guide only as figures, as do the relay's limits (20 s, 60 s, 2 min, 15 min, 24 h).
   Fixed when the table, or one beside it, lists each with its name and default.

## Open

Each item stands alone. "Likely" is my estimate from the code and the stand-in printer;
only the real H2S can settle items 1 and 2.

1. **A print can be reported as finished, or as failed, when it has not begun.** If the
   daemon restarted or lost the printer for two minutes just after a start command, and
   the printer keeps showing the previous print's end under the new file's name for five
   minutes, the delivery job ends `done` (or failed) and the printer counts as free, so a
   resend sends a second start command. Unlikely: it needs both things at once, and
   nobody has seen an H2S hold an old end under a new name at all. Fixing it means either
   a recording that rules it out, or ending such a job as "outcome unknown" and keeping
   the printer held until a person or the printer's report clears it. **Low**, serious if
   the H2S is found to do this.

2. **A printer that takes more than five minutes to show a print it accepted is reported
   as not having started it.** The user sees a failure whose remedy says to look at the
   printer first; a resend is accepted and sends a second start command while the first
   is still pending. Unlikely: the one recorded H2S report suggests seconds, not minutes.
   Fixing it is a measured time and a setting well above it, or the same "held until
   cleared" rule as item 1. **Low**, serious if the H2S is found to be that slow.

3. **If the daemon and the relay both restart within five minutes of a start command the
   printer has not shown yet, a resend can send a second start command.** To a user: two
   start commands to one printer. Unlikely: two restarts in the same five minutes, a slow
   printer and a resend. Fixing it means the daemon writing its hold to its home
   directory. **Low.**

4. **After a crash of the daemon in the instant between permission to start and the start
   command, a cancel is refused with "the start command has already been sent", though
   none was.** To a user: one untrue sentence for up to five minutes, then the job ends
   as not started; nothing is printed. Very unlikely: the window is a fraction of a
   second. Fixing it is a few lines in the daemon and a test. **Low.**

5. **A job that waited for an earlier start to settle, on a printer whose network keeps
   dropping, can end saying the printer could not be reached for ten minutes.** To a
   user: a reason that is half true (the printer answered on and off; the real reason was
   the earlier start). Likely only on a flaky printer network after a start that never
   showed. Fixing it is a few lines where the reason is chosen. **Low.**

6. **The guide's hand walk promises a `cancelling` answer that a person cannot get, and
   misquotes one sentence.** To a user: nothing; to a newcomer: a step that answers "too
   late to cancel" where the guide says otherwise. Certain when the walk is followed.
   Fixing it is a few lines of the guide. **Low.**

7. **Some time limits are in the guide as figures without their setting's name.** To a
   user: nothing; to whoever tunes the limits after the hardware session: a search of the
   code. Fixing it is a table in the guide. **Low.**

**What remains is low issues only**, provided the hardware session confirms what items 1
and 2 assume. The checklist "For the session at the real printer" at the end of
[review 4](delivery-hardening-review-4.md) still applies as written; its lines on the
documents between the start command and the first `PREPARE` or `RUNNING`, and on the
seconds from the start command to the first document naming the file, are the two that
decide items 1 and 2.

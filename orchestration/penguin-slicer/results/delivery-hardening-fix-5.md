# Fix 5 of printer delivery, hardening phase

Written Fri 2026-11-20 01:55 PT. Worked from [review 5](delivery-hardening-review-5.md), its
section "Open", under the coordinator's ruling in the dispatch: items 1 and 2 unchanged in
behaviour and stated in the guide; items 3 to 7 fixed; the property tests strengthened
against the reviewer's seven escaped regressions. All changes are uncommitted under
`delivery/` in `/repos/popcornpenguins/penguin-slicer`, over commit `5d38566` on
`build/ports-and-hardening`. Scratch files are in
`/tmp/claude-1000/-repos-popcornpenguins/c507b106-b789-4d12-a830-1dcc19de2171/scratchpad/f5/`.

## Per item

| Item | Result |
|---|---|
| 1. A daemon that could not watch takes a left-over end shown 5 minutes as this print's end | **Not changed, by ruling.** The guide's "How a start is decided" now has a subsection "Two limits that wait for the real printer" that states this limit, what the user sees, what the hardware session must measure, and the reviewer's timing-free alternative with its cost |
| 2. A printer slower than 5 minutes to show a print is failed, and can get a second start command | **Not changed, by ruling.** Stated in the same subsection, with the same alternative |
| 3. The hold is lost when the daemon and the relay both restart inside the settle time | **Fixed** (below) |
| 4. After a crash between the gate and the command, a cancel says the command was sent | **Fixed** (below) |
| 5. A job held behind an earlier start on an on-and-off printer ends with an untrue reason | **Fixed** (below) |
| 6. The guide's walk, step 6, and one misquoted sentence | **Fixed**, and the whole walk done again by hand (below) |
| 7. Not every time limit in the guide carries its setting's name | **Fixed**: every time limit in the guide now has its setting's name beside its figure, and a second table lists every other time limit with its module and default |

### 3. The note of a start command

New module `daemon/penguin_delivery_daemon/start_record.py`; `paths.py` names the file
`start.json` in the daemon's home; `__main__.py` passes it to the run loop.

- Written **before** the start command (`sending`: printer serial, job id, the file's name
  on the printer, the computer's clock time for people only), rewritten `sent` once the
  command went (or raised on its way), removed when the hold settles (seen going, a proven
  end, or the settle time of pictures without the print; also on a refused command).
- Crash-safe: each write goes whole to `start.json.tmp`, `flush` and `fsync`, then
  `os.replace` over the note (replaces on Windows too). A crash mid-write leaves the old
  note or none, never part of one.
- A process that finds a note holds the printer from it, with no help from the relay. Its
  time counts from the first picture it watches (never from the note's clock time);
  when the relay gives the gate's age (`start_granted_age_s` or `previous_start`), the
  hold takes it, counting from the gate as a relay-rebuilt hold does.
- A note that is there but cannot be read or understood (cut off, not JSON, wrong shape,
  wrong version, too large, unreadable path) holds the printer as a hold with no file
  name: only `START_SETTLE_SECONDS` of whole, fresh pictures with no print going, or a
  print going, settles it. It never frees the printer.
- A note naming another printer serial (paired again since) is set aside.
- A note that cannot be written means no start command: the file is removed and the job
  ends with a new code, `delivery.start_not_recorded` (in `errors.py` and the guide's
  table, produced on purpose by two tests). A note that cannot be marked `sent` stays
  `sending`; it still holds.
- The job the note names, offered again by the relay with or without `start_granted`, is
  never started again.

Tests: `daemon/tests/test_daemon_start_record.py` (38 tests: the note itself, each kind of
damage, a crash at the write, at the fsync and at the rename, the run loop's use of the
note, each restart case); in `tests/test_start_decided.py`,
`test_a_restart_between_the_gate_and_the_settling_never_sends_a_second_start`, 18 cases:
the daemon, the relay and both restarted at each of six points (after the gate's yes and
before the note; after the note and before the command; after the command and before
`sent`; after `sent`; 30 s into the hold; at the acknowledgement once the print shows),
then a resend 70 s later and a cancel 90 s later; one start command per file, none while
the printer holds another, the cancel's code right for each point, and a free printer at
the end. Also the reviewer's sequence as
`test_both_halves_restarted_inside_the_hold_keep_the_printer_held` and
`test_a_note_that_cannot_be_written_reaches_the_caller_as_not_started`, and a CLI test that
`run` keeps the note beside its configuration.

### 4. "Already sent" only when it was

- The daemon reports `start_not_shown` with `start_sent` equal to what it knows: true for
  its own command, true for a note that says `sent`, false for a hold rebuilt from the
  relay or from a `sending` note.
- The relay (`deliveries.py`) no longer takes the stage `start_not_shown` as the daemon's
  word that the command went; only `start_sent: true` is. So it answers a cancel with
  `delivery.start_being_sent` ("may already have sent the start command") until the job
  ends, never `delivery.cancel_too_late`.
- `delivery.start_being_sent`'s remedy now says what to do: "Look at the printer: if this
  print starts, stop it on the printer's own screen; if it does not, wait for this print's
  report to end before sending it again."
- A `delivery.start_timeout` after such a restart says in `detail` that the process cannot
  know whether the start command was sent.

Tests: `test_a_daemon_dead_between_the_gate_and_the_command_is_never_said_to_have_sent_it`
(the reviewer's sequence: cancels at 20 s and 90 s both `delivery.start_being_sent`, the
job ends `delivery.start_timeout`, nothing sent), the cancel column of the 18-case matrix,
`test_a_daemon_that_cannot_know_whether_the_command_went_is_never_taken_to_say_so` (relay),
and two run-loop tests on `start_sent` after each kind of note.

### 5. The reason after the wait

`_end_unstarted_after_wait` in `run_loop.py`: after `PRINTER_WAIT_SECONDS` the code is
`delivery.earlier_start_unsettled` whenever an earlier start still holds the printer and
the printer gave at least one whole, fresh picture in the wait; only a printer that never
did is `delivery.printer_unreachable_at_start` (the sentence's ten minutes are then true).
The detail gives the job and file of the earlier start, whether its command was sent or
may have been, how long ago, the seconds of whole, fresh reports the hold has counted of
those it needs, how long the printer answered in the wait, and the last report with its
age. The sentence of `delivery.earlier_start_unsettled` no longer says "just before" or
that the other print was sent a command: "Another print sent to this printer before this
one may have been started, and the printer has not shown within 10 minutes whether it
was, so this print was not started."

Tests: `TestTheReasonAfterTheWait` in `test_daemon_start_record.py` (the reviewer's printer
quiet 50 s of every 60: `delivery.earlier_start_unsettled` with the counted seconds; a
printer quiet throughout: `delivery.printer_unreachable_at_start`, 10 minutes, "no whole,
fresh report ... in the 600 s waited"; a printer that answered once: still the hold).

### 6. The walk

Step 5 now names the stages a person sees (`waiting_for_daemon`, `waiting_for_printer`,
`uploading`, `starting`, `printing` with heating, levelling, 25 and 75 percent, `done`) and
says `downloading` is seldom seen on one machine. Step 6 is the cancel at once. The
untrue sentence is gone; step 7 gets a cancel the daemon holds by restarting the simulated
printer with `--scenario upload_refused` (the daemon reconnects by itself and retries the
upload for about 15 s), one command line with `sleep 5`; step 8 restarts it with
`whole_print` and cancels ten seconds after a send: `409 delivery.cancel_too_late`. The
quotation in "How a start is decided" now matches the sentence.

Done twice by hand with the guide's commands (`walk.sh` in the scratch folder; home an
empty scratch folder), the second time after the last wording change, Fri 11-20 01:17 to
01:19 PT: step 5 streamed the stages above to `done` in 28 s; step 6 `cancelled`; step 7
`202 "outcome":"cancelling"` (at 5 s the job was still `waiting_for_daemon`, handed out),
then `cancelled`, the daemon's log "removed sample_part-....gcode.3mf from the printer"
and "it was never started on the printer"; step 8 `409 delivery.cancel_too_late`, then
`done`. Ctrl-C ended all three programs; none was left; no `start.json` was left in the
home. Output: `walk.out` and `walk2.out`.

### 7. Names beside figures

Every time limit in `delivery/README.md` now carries its setting's name. The table of "How
a start is decided" gained `PRINTER_POLL_SECONDS`, `GATE_WAIT_SECONDS`,
`START_POLL_SECONDS` and `HOLD_CHECK_SECONDS`; a new table lists every other limit with its
module and default (`SYNC_INTERVAL`, `PROGRESS_SYNC_SECONDS`, `EXCHANGE_INTERVAL`,
`BACKOFF_START`/`BACKOFF_CAP`, `LOG_EVERY`/`IDLE_LOG_EVERY`, `STALE_AFTER_SECONDS`,
`PRINTER_QUIET_SECONDS`, `PRINT_VANISH_SECONDS`, `OUTCOME_UNKNOWN_AFTER_SECONDS`,
`FINAL_TTL_SECONDS`, `DAEMON_ONLINE_SECONDS`, `STATUS_ONLINE_SECONDS`,
`JOB_PENDING_TIMEOUT_SECONDS`, `JOB_HANDED_OUT_TIMEOUT_SECONDS`, `LAST_RESULT_TTL_SECONDS`,
`RECORD_TTL_SECONDS`/`STATUS_TTL_SECONDS`, `SWEEP_EVERY_SECONDS`, `SLICE_MAX_AGE_SECONDS`,
`STREAM_HEARTBEAT_SECONDS`, the seven rate limits). The state diagram's "3 min" label became
"not collected in time", so the diagram itself was not otherwise changed.

## The property tests

What changed (`tests/link_faults.py`, `tests/test_start_decided.py`,
`tests/test_link_faults.py`):

- **The real `PrinterLink` in the loop.** `ShopLibrary` stands in for the printer library:
  it merges documents, keeps the last connection's picture over a reconnect, calls the
  connect hook, and sends only partial documents for `whole_after` seconds of each
  connection. All three property tests hear the printer through it, so a regression in
  `printer.py`'s whole-picture rule now reaches them.
- **The printer's own truth recorded**: every start command tried (`commanded`), every one
  that reached a printer already printing (`busy_starts`), every picture the daemon read,
  every ask of the start gate with the picture it was asked on, and each gate's time.
- **New faults**: reconnects, someone starting a print at the printer while it is off the
  network, a cancel, the daemon dying after the gate, after the note or after the command,
  a damaged note, a start command that raises before or after reaching the printer, a
  relay restart, both halves restarting together, a stream gone quiet from the download
  while the first asks of the gate time out.
- **The invariants** (`check_start_path`, one function used by all three): one start
  command per file, counting those that never arrived; none while the printer prints (its
  truth) or while an earlier start is unsettled, across restarts of either half or both;
  every start command and every ask of the gate before it grants on a whole, fresh picture
  of a free printer; `done` only for a print shown; a "not started" code only for a file
  never sent a command; "refused" only for a file the printer did not take; "did not
  start" only for one it never printed; `printing` and `delivery.cancel_too_late` only
  after a start command; no hold past `START_SETTLE_SECONDS` of whole, fresh pictures
  after the gate (while the granting relay runs), nor after the held print was seen going;
  nothing after a final state. The guide's two stated limits (items 1 and 2) stay exempt,
  as before.
- Examples: 80, 120 and 60 (were 40, 30 and 40). Still `derandomize=True`, no database.

**The measure.** Each regression put back alone in a scratch copy and the three property
tests run one at a time (`mutate.py`; measured with Hypothesis's shrink phase switched off
so a catch is reported at its first failing example; the examples generated are the
suite's), then the whole fast suite (logs `mutations-final-G.log` and
`mutations-final-N.log`, plugin `plugin/f5_noshrink.py`, in the scratch folder):

| Regression | P1 random starts | P2 resend while unsettled | P3 random faults | Whole fast suite |
|---|---|---|---|---|
| G2 a picture without the main state counts as fresh | caught | escaped | caught | 7 fail |
| G4 no wait for a free printer before the gate | escaped | escaped | caught | 8 fail |
| G7 a daemon that could not watch never takes an end | escaped | escaped | caught | 5 fail |
| G9 a cancel past the gate always says the command was sent | caught | escaped | caught | 9 fail |
| G11 a rebuilt hold forgets the gate's age | escaped | escaped | escaped | 1 fail |
| G12 a start command that raises is taken as refused | caught | escaped | caught | 3 fail |
| G13 a reconnect does not make the picture not whole | caught | escaped | escaped | 2 fail |
| N1 the note is never read | escaped | caught | escaped | 16 fail |
| N2 a rebuilt hold says the command went | escaped | escaped | caught | 6 fail |
| N3 the relay takes `start_not_shown` as the command sent | escaped | escaped | caught | 6 fail |
| N4 the note is not written before the command | escaped | caught | escaped | 13 fail |
| N5 a damaged note frees the printer | escaped | caught | escaped | 5 fail |

Of the reviewer's seven escaped regressions, **six are now caught by the property tests
alone** (P1 catches 4, P2 0, P3 6); of the five of the new code, all five (P1 0, P2 3,
P3 2). Per test over all twelve: P1 4, P2 3, P3 8.

**Not caught by any property test: G11.** It makes a hold rebuilt after a daemon restart
wait the whole settle time again instead of the rest of it. That is a delay of at most
the time between the gate and the restart, never a second start command or an untrue
word; the hold-time invariant must allow a few seconds of slack (the daemon looks every
`PRINTER_POLL_SECONDS` and its word reaches the relay at the next sync), and in the scaled
sequences the extra wait is mostly inside that slack. Its aimed test
(`test_an_old_previous_start_settles_on_the_first_free_picture`) catches it.

Speed, one worker, no coverage: P1 1.8 s, P2 1.7 s, P3 2.5 s (were 0.6 s, 0.3 s, 0.5 s).

## Test figures

Every run was pytest started directly from `delivery/.venv/bin/python`, in `delivery/`,
under `timeout -s KILL 240` and a 2.5 GB address-space limit (`repeat.sh`; logs
`fast.log`, `sim.log`, `up.log` in the scratch folder), Fri 11-20 01:42 to 01:52 PT.

| Suite | Runs | Failures | Wall time per run |
|---|---|---|---|
| Fast suite, random order, 2 workers, seeds `7300 + 5113 * run` | 40 | 0 | 6.8 s to 10.5 s, median 7.1 s |
| Simulated-printer suite (`-m simulator`, 36 tests) | 10 | 0 | 16.7 s to 18.3 s |
| Upstream check (`-m "upstream or simulator"`, 55 tests) | 5 | 0 | 17.1 s to 18.5 s |

A first try of the same 40 fast runs (stopped at run 38 to add wall times to the log) also
had no failure. The fast suite is 1,125 tests and 156 subtests (was 1,064). It is about 3 s
slower per run than at review 5 (3.5 s to 4.5 s then): the three property tests now take
about 6 s together on one worker (1.4 s before), from more examples and the real
`PrinterLink` in each.

Branch coverage under the fast suite (was, at `5d38566`): `run_loop.py` 99% (98%),
`start_record.py` 96% (new: the unlink of a temporary file that was never created, 92-93),
`deliveries.py` 98% (98%), `errors.py` 100%, `relay.py` 99%, `routes.py` 99%,
`printer.py` 96%, `__main__.py` 97%, `paths.py` 100%. Nothing fell.

## Changed files

Under `/repos/popcornpenguins/penguin-slicer/delivery/`: `README.md`;
`daemon/penguin_delivery_daemon/` `run_loop.py`, `start_record.py` (new), `paths.py`,
`__main__.py`; `relay/penguin_delivery_relay/` `deliveries.py`, `errors.py`; tests
`daemon/tests/test_daemon_start_record.py` (new), `daemon/tests/test_daemon_cli.py`,
`relay/tests/test_relay_deliveries.py`, `tests/link_faults.py`,
`tests/test_start_decided.py`, `tests/test_link_faults.py`.

## Beyond the list, and concerns

- One defect of the same kind found beside item 3 and fixed: a hold rebuilt from the note
  and then given the relay's gate age must count from the gate to its first watched
  picture, or it double-counts (a property test found this on the way).
- One rule-of-work slip: one line of `tests/test_link_faults.py` (an import) was edited
  with `sed` instead of the Edit tool.
- For the hardware session, add: that `start.json` appears in the daemon's home during a
  start and is gone once the print shows, and that a daemon restarted (Ctrl-C, run again)
  in the minute after a start command holds the printer (a resend waits in
  `waiting_for_earlier_print`).

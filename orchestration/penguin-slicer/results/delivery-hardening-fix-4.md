# Printer delivery, hardening: fix 4

Written Fri 2026-11-20 00:30 PT. Works from
[delivery-hardening-review-4.md](delivery-hardening-review-4.md) (six defects) and the
coordinator's rulings in the dispatch. Changes are uncommitted in the working tree of
`/repos/popcornpenguins/penguin-slicer` (branch `build/ports-and-hardening`, over
`81b5f4a`), all under `delivery/`.

## The design: "How a start is decided"

Written first, as a section of the guide (`delivery/README.md`, "How a start is
decided"), then built to it. In short:

- **A whole, fresh picture.** The daemon's picture is *whole* only once a document carrying
  `gcode_state` has arrived since the current MQTT connection began (`PrinterLink` hooks the
  library's `on_connect_handler` and reads each message in `on_message_handler`); partial
  documents merge onto it. A picture with no main state reads `unrecognised`
  ("no main state (gcode_state) reported yet"), is never free, and is treated like a stale
  one: ask for a whole report, wait.
- **Free** = whole, fresh, a main state meaning no print, and no earlier start holding the
  printer.
- **Every wait before the gate.** The daemon waits for a free printer at arrival, between
  upload attempts and after the upload, and again before every further ask of the gate
  (all cancellable). Past the gate there is one look and no wait: free, send the command;
  not free, send nothing, remove the file, acknowledge a failure that says "not started".
- **The hold** (`StartHold` in `run_loop.py`). After an accepted start command no other
  start goes to that printer until the evidence settles it: seen going; a proven end of
  ours; or `START_SETTLE_SECONDS` of whole, fresh pictures without our print. The hold
  outlives the job that made it (stop-following, a dropped job); a restarted daemon
  rebuilds it from the relay (`start_granted_age_s` on a re-offered job, `previous_start` on
  the next one). After `START_SLOW_SECONDS` the stage is `start_not_shown` with `waited_s`.
- **An end counts only if it is this print's**: seen going; or, once the command is
  `LEFTOVER_END_SECONDS` old, a main state that changed after the command; or, for a daemon
  that could not watch (restarted, or blind for `LEFTOVER_END_SECONDS`), once the command
  is `START_SETTLE_SECONDS` old, so a real end is always found. The relay moves a job to
  `printing` on its own only on a going state; an end before that comes from the daemon.

| Setting | Default |
|---|---|
| `FRESH_REPORT_SECONDS` | 15 s |
| `REPORT_REQUEST_SECONDS` | 10 s |
| `PRINTER_WAIT_SECONDS` | 10 min |
| `START_SLOW_SECONDS` | 60 s |
| `START_SETTLE_SECONDS` | 5 min |
| `LEFTOVER_END_SECONDS` | 2 min |

The guide states the limits of the rule: a printer slower than `START_SETTLE_SECONDS` to
show a print is taken not to have started it, and a left-over end shown longer than that
to a daemon that could not watch is taken for ours. The hardware checklist asks for the
timings that set each figure.

## Per defect

1. **A document with no main state read as "no print". Fixed.** `classify` makes a missing,
   `null` or empty `gcode_state` unrecognised as a whole (guide table row changed);
   `map_status` adds `whole`; `PrinterLink.snapshot` narrows `whole` to "since this
   connection"; `RunLoop._fresh` refuses a picture that is not whole. Tests:
   `test_daemon_printer.py::TestWhatTheReportMeans::test_a_document_with_no_main_state_says_nothing_about_a_print`
   (the reviewer's document among nine), `TestPrinterLink::test_the_picture_is_whole_only_after_a_main_state_since_the_connection`,
   `test_daemon_job_flow.py::TestFreshWordBeforeTheStart::test_a_picture_with_no_main_state_is_never_free`
   and `..._not_whole_since_the_connection_is_never_free`, `TestHowAStartIsDecided` (three),
   `tests/test_start_decided.py` (the reviewer's H2 and the reconnect case), simulator
   scenario `no_main_state`, upstream test `test_the_message_hook_gets_the_message_and_the_connect_hook_fires_on_each_connect`.
2. **Our name under the previous print's end ended the job. Fixed**, in the daemon
   (`StartHold._end_counts`) and the relay (`printer_shows_it_going` instead of
   `printer_has_it` for leaving `starting`). Tests: the reviewer's H3 sequences
   (`test_a_left_over_end_with_our_name_never_ends_the_job`, 3 states × 2 delays), a
   left-over that stays ends `start_timeout` never `done`, the restarted daemon both ways
   (just after the start: waits; gate old: finds the end at once), the relay half
   (`test_an_end_naming_the_file_before_it_was_seen_going_is_not_taken`), simulator scenario
   `left_over_finish` (two tests).
3. **The post-gate wait could not be cancelled and was described as started. Fixed.** The
   wait moved before the gate (and is repeated before every further ask); past the gate,
   one look. The relay tracks `start_sent` (the daemon's progress says so): cancel answers
   `delivery.start_being_sent` until then, `delivery.cancel_too_late` after, both
   reworded so neither says the print started; stop-following with fresh word before the
   print shows answers `delivery.start_not_shown_yet`, not "still reporting, so it is
   running"; `delivery.outcome_unknown` now says the print may also never have started.
   Tests: the reviewer's sequence
   (`test_a_cancel_while_the_printer_is_quiet_after_the_upload_ends_it_unstarted`, and H4
   on the whole path, `test_a_printer_quiet_from_the_download_on_can_be_cancelled`),
   `test_past_the_gate_there_is_one_look_and_no_wait`,
   `test_the_wait_is_made_again_before_a_second_ask_of_the_gate`, relay
   `test_cancel_after_the_start_was_granted_is_refused_with_an_error_report` (rewritten) and
   `test_stop_following_while_the_printer_has_not_shown_the_print_says_so`.
4. **A slow printer got a final failure and a second start. Fixed** by the hold, the
   non-final `start_not_shown` stage, and the settle time (5 min, named, in the guide). New
   code `delivery.earlier_start_unsettled` for a job that waited ten minutes on an
   unsettled hold. Tests: the reviewer's H6
   (`test_a_printer_slow_to_show_the_print_is_not_failed_and_gets_no_second_start`),
   stop-following then a resend during the hold
   (`test_stop_following_then_a_resend_waits_for_the_earlier_start`), the ignored start that
   frees the printer only after settling, the run-loop cases (second job waits, is refused
   when the held print shows, ends `earlier_start_unsettled`, the rebuilt hold from
   `previous_start`, old and malformed `previous_start`), relay
   `test_a_restarted_daemon_is_told_the_gates_age_and_the_previous_start`, simulator
   scenario `slow_start`.
5. **No way to try the chain by hand. Fixed.** Guide section "Try it on one machine"
   (four terminals: `python -m simulator`, `pair --printer-ports`, `python -m
   together.relay_server --code`, `run`, then `curl` to send, stream and cancel). New:
   `simulator/__main__.py` (any scenario, chosen ports, plays the print every
   `--step-seconds`), `together/relay_server.py` (the relay alone, development mode, one
   stand-in team), `pair --printer-ports MQTT,FTPS` and the config fields
   `printer_mqtt_port`/`printer_ftps_port` (written only when set) used by `pair`, `run`,
   `status` and `record`. **The walk was run exactly as written** (twice, the second time
   with the guide's `/tmp/pd-home`): paired, online, the sample went `starting` →
   `printing` (heating, levelling, 25, 75 percent) → `done` in 19 s; the one-line cancel
   answered `cancelled`; a cancel a few seconds later answered `cancelling` and the daemon
   removed the file and acknowledged `cancelled`. Tests: `tests/test_by_hand.py` (6) and
   `test_the_simulated_printer_runs_on_its_own_and_plays_a_print` in the simulator suite.
6. **Refused job-route requests were not logged. Fixed**, and the same kind beside it:
   every refusal on every route now names itself (`error=not_signed_in`,
   `identity_unreadable`, `rate_limited`, `https_required`, `token_invalid`,
   `not_paired`, `file_unknown`), with the team when known and the job id on job routes;
   the installer's two refusals, unlogged before, too. Tests:
   `test_relay_routes.py` (four job routes × signed out, unreadable identity, rate
   limited; and one test over the other routes' refusals). No code, token or download
   token appears in any of them (asserted).

Earlier invariants kept and re-asserted: one start command per file, no two files
overlapping, silence ends nothing except the 24-hour rule, nothing after a final state.

## Tests

New random sequences in `tests/test_start_decided.py`: two Hypothesis tests (40 and 30
examples, derandomized, settings scaled down by monkeypatch so each takes under 0.5 s):
printer slow or never showing, left-over ends, partial pictures, quiet spells, outages,
stop-following, a resend, a daemon restart; invariants as above, plus every start's
evidence whole, fresh and free. The second aims at the ruling-4 sequence.

Hand mutations on a scratch copy (its own packages ahead of the installed ones), each
alone:

| Mutation | Caught by |
|---|---|
| `_fresh` ignores `whole` | job-flow and run-loop tests |
| an end naming our file always counts | 10 tests, both property tests among them |
| no hold on another job's start | 2 directed tests and the aimed property test |
| the relay leaves `starting` on an end | 10 tests |
| no wait for a free printer before asking the gate | 4 tests |
| cancel past the gate always `too_late` | 2 tests |
| stop-following before the print shows says `fresh` | 2 tests |
| refused job routes unlogged | 8 tests |

While building, the random test found two real cases, both now in the design and the
guide: an end that arrived after the start but before a slow print showed (now never
before `LEFTOVER_END_SECONDS`), and a restarted daemon taking a left-over end for ours too
early (now only at `START_SETTLE_SECONDS`).

Coverage (branch, fast suite): `run_loop.py` 98% (was 99%: two `return`s after
`_await_start`, which always raises, stay unreachable as before), `printer.py` 96%,
`config.py` 97%, `__main__.py` 97%, `deliveries.py` 98%, `relay.py` 99%, `routes.py` 99%,
`errors.py` 100%.

Closing runs, on the final tree, each pytest run straight from `delivery/.venv` under
`timeout -k 5 300` and a 2.5 GB address-space limit (script and logs in the session
scratchpad, `f4/final.sh` and `f4/final/`):

| Suite | Runs | Failures | Wall time per run |
|---|---|---|---|
| Fast suite, random order (seeds `4100 + 7919 * n`), 2 workers; 1,064 tests, 156 subtests | 40 | 0 | 3.8 s to 5.0 s |
| Simulated-printer suite (`-m simulator`, 36 tests) | 10 | 0 | 15.4 s to 18.7 s |
| Upstream check (`-m "upstream or simulator"`, 55 tests) | 5 | 0 | 16.1 s to 17.1 s |

The together run (`-m real_time`, 2 tests) passed as well.

## Not done

- The real H2S timings: every figure in the settings table is a guess; the hardware
  checklist in the guide now asks for the first documents after a start, the time to show
  a print, whole or partial documents, and the idle report rate.
- `simulator/printer.py` is still 9% under the fast suite (it runs only in `make test-sim`).

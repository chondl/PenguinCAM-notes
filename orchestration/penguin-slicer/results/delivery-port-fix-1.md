# Printer delivery, port phase, fix round 1

**Status: DONE.** All 12 defects of
[delivery-port-review-1.md](delivery-port-review-1.md) are fixed. None was left pinned:
the inherited ones (defect 8 and the claim cleanup next to defect 1) were small and safe.

Worked Thu 11-19 18:21 PT, in `/repos/popcornpenguins/penguin-slicer/delivery` only. No
git command was run. Scratch copies and scripts are in
`/tmp/claude-1000/-repos-popcornpenguins/c507b106-b789-4d12-a830-1dcc19de2171/scratchpad/fix1/`.

## Stop condition

| Check | Result |
|---|---|
| Fast suite, 20 runs, `-n 2 -p randomly`, seeds 101 to 2020 (`fix1/flake20.sh`) | **20 of 20 passed**, 538 tests each, 0.64 s to 1.39 s |
| `make test-together` (real threads) | 2 passed |
| `make together ARGS=--in-process` | PASS |
| Branch coverage per module | No module fell. `sliced_files.py` went from 97% to 100%; `errors.py` and `routes.py` stay 100% and 99% (same `71->exit`). Total 93% |
| The reviewer's 19 probes, the 150-round real-thread race included | 19 passed (0 of 150 sends lost) |
| New tests against the unfixed tree (the reviewer's `mut/m0` with the new relay tests copied in) | 45 fail, one or more for every relay defect (1, 2, 3, 6, 7, 8, 11). The new tests that pass there pin behaviour that was already right: two-team isolation, the team handed to `find_sliced_file`, a null or empty-string token. The 8-thread test also passes there, because it is not deterministic |
| Mutation `m2` (`find_sliced_file` asked with a different team) | Now caught by 7 tests (before: 475 passed) |
| Each known fault fixed in a scratch copy (`fix1/faults.sh`) | Fault 1: 5 failures, all `known_fault`. Fault 2: 1 failure, `known_fault`. No unmarked test fails |

## Defects

1. **Fixed.** `SlicedFileStore.add` now marks the entry as waiting for its claim.
   `prune` skips such entries, and the send route ends the wait in a `finally` with
   `confirm` (claimed) or `discard` (refused, or the claim raised). Tests:
   `TestJobsRoute::test_another_request_between_holding_the_file_and_claiming_the_job_keeps_it`
   (it runs a status poll inside `claim_job`, then the download answers 200 with the
   bytes); `test_only_one_of_many_simultaneous_sends_wins`, which now gives each thread
   its own stream, downloads the winner's job, checks the bytes are the winner's, and
   checks the spool holds one file; `TestSlicedFileStore::test_prune_leaves_an_entry_waiting_for_its_claim_alone`
   and `test_a_discard_ends_the_wait_too`. In the same test, a thread that fails before
   the barrier now aborts it, so the others cannot hang (the review's flake finding).
   **Same kind, also fixed:** a `claim_job` that raised used to leave the copied stream
   in the spool. `test_a_claim_that_raises_leaves_no_file_behind`.
2. **Fixed.** The ack route stores `errors.reason_text(body['error'])`. An empty value
   is None as before, a string stays as it is, and any other JSON value is kept as its
   JSON text. `error_report` also accepts a value that is not a string. Tests:
   `TestDaemonRoutes::test_an_ack_error_of_any_json_type_leaves_the_status_route_working`
   (a number, a list, an object, `0` and `[]`, each with a 200 status and an error
   report), `test_an_acknowledgement_reason_becomes_one_string_without_a_token`, and
   `test_error_report_accepts_a_reason_that_is_not_a_string`.
3. **Fixed.** Two new codes, both in the guide's table, both with tests that produce them
   on purpose:
   - `delivery.sliced_file_unreadable` (500, JSON) covers `find_sliced_file` raising and
     a stream that fails while it is copied. `detail` and the log line carry
     `Could not read the sliced file: <Class>: <first line>`, with any download token cut
     out. Tests: `test_a_find_sliced_file_that_raises_is_an_error_report_not_a_500_page`,
     `test_a_stream_that_fails_while_copied_is_an_error_report_and_leaves_nothing`, and
     `test_relay_errors.py::test_sliced_file_unreadable`.
   - A send token that is not a non-empty string is never passed to the caller. It
     answers 404 `delivery.sliced_file_missing`, the same as an empty body.
     `test_a_token_that_is_not_a_non_empty_string_is_never_handed_to_the_caller`.
4. **Fixed.** The guide's interface section and the `caller.py` docstring now state the
   caller's duty to return None for another team's token, and why only the caller can
   check it. `relay_fakes.Caller` records every `(token, team)` it is asked about. New
   `relay/tests/test_relay_two_teams.py` is built from the probes. Its `find_sliced_file`
   refuses tokens the asking team does not own. It covers the exact `Team` handed over, a
   send of another team's token refused with nothing held, status and result, sync and
   acknowledgement, the download token on no caller route, log or event, both teams'
   downloads at once, and the last-result clearing across teams. One more test is in
   `test_relay_routes.py`: `test_find_sliced_file_is_asked_with_the_token_and_the_identified_team`.
5. **Fixed.**
   (a) The two tests that pinned fault 1 without the marker are now
   `test_known_fault_the_real_h2s_report_gives_the_archive_path_as_file` and
   `test_known_fault_subtask_name_is_used_only_when_gcode_file_is_empty`, both marked.
   Their state and progress assertions moved into an unmarked
   `test_the_real_h2s_report_maps_to_running_with_its_progress`.
   `test_upload_passes_on_whatever_the_library_returns` pins fault 2 as well, so it is
   now `test_known_fault_upload_passes_on_the_none_of_a_swallowed_failure`, marked.
   (b) On success, `FakePrinter.upload`, `FakeBambuPrinter.upload_file` and the
   together run's stand-in printer now return `'226 Transfer complete.'`
   (`daemon_fakes.FTP_TRANSFER_COMPLETE`). That is ftplib's final reply, which the
   pinned library's `upload_file` returns. It is checked in
   `.venv/.../bambulabs_api/ftp_client.py`. The library returns that reply, not the
   file name the old fake returned.
   (c) The guide's known fault 2, the fake's docstring and the run-loop known-fault
   docstring now say that only a failure during the transfer returns None, while a
   refused connection or login raises.
   Proof: `fix1/faults.sh`. Fixing either fault fails only `known_fault` tests.
6. **Fixed.** A `SlicedFile` whose `path` is not a file is refused at the send with 404
   `delivery.sliced_file_missing`, whose action is `slice_again`. The guide, the
   docstring and the code table say so.
   `TestJobsRoute::test_a_path_that_is_not_a_file_is_refused_at_the_send`.
7. **Fixed.** The same `reason_text` cuts any download token out of the reason before it
   is stored. So `last_result.reason`, the "acknowledged:" log line and the
   `printer_ack` event carry none.
   `TestDaemonRoutes::test_the_reason_is_stored_logged_and_reported_without_the_download_token`.
8. **Fixed** (inherited, small). A `json_object()` helper answers `{}` for any JSON body
   that is not an object, on the send, pair, sync and ack routes.
   `test_a_json_body_that_is_not_an_object_answers_as_an_empty_body` covers a list, a
   string, a number, null and true. The daemon side is
   `test_a_daemon_body_that_is_json_but_not_an_object_answers_as_an_empty_body` (pair
   404 `not paired`, sync 200, ack 200 with no reason). One small change on sync: a
   non-object body is now stored as an empty snapshot, not as none, so it reads the same
   as a body that is not JSON. The caller sees the same `status: null` either way.
9. **Fixed.** New `delivery/tests/test_contracts.py` reads `contracts/` directly:
   - It reads the field table out of `error-report.md` and checks that four kinds of
     emitted report (with `where`, with `action`, with neither, and the fallback) have
     the required fields, only contract fields, the example's types and `where` keys, and
     a code of the form `component.what`.
   - It runs `examples/sliced-file.json`'s `file` through `suffixed_name` and both
     `strip_job_suffix` functions.
   - It checks `PLATE_NUMBER` against the `Metadata/plate_<n>.gcode` entries of
     `sliced-file.md`.
10. **Fixed.** `make test-parallel` runs `-n 2`. The Makefile comment and the guide say
    two workers.
11. **Fixed.** When `identify` raises on a send, the answer is now 401
    `delivery.identity_unreadable`: "The printer service could not read which team sent
    this print." / "Sign in again, then send the print once more." `detail` names the
    exception, and the response has no `need_verification`. A status poll still reads as
    unpaired, as the guide says.
    `TestJobsRoute::test_an_identify_that_raises_is_refused_as_unreadable_not_as_unpaired`
    asserts the sentence, the remedy and the detail, and so does
    `test_relay_errors.py::test_identity_unreadable`.
12. **Fixed.** The fixture's comment now says "the bambulabs_api pinned in
    delivery/daemon/pyproject.toml". The `.json` exemption is gone, and the one-pin test
    asserts that it read the fixture.

## Upstream, port-phase part ([upstream.md](../briefs/upstream.md))

- One pin and one seam were already met, and the tests still enforce both.
- The guide has a new section, **"Taking a new upstream version"**, under "Upstream". It
  gives the manual steps until the upgrade command exists: move the pin, `uv lock
  --upgrade-package`, what to read in the `uv.lock` diff, and every library call and
  status field the seam relies on. It says to bring `FakeBambuPrinter` and the fixture in
  line first, and why `make test` alone cannot notice a library change. Then it covers
  the hardware smoke test, where a failure is fixed (in `printer.py` only), and rollout
  through `install.sh`.
- Not done (hardening): the upgrade command, the upstream check suite, and a test that
  compares `FakeBambuPrinter` with the installed library.

## Guide changes beyond the numbered defects

The "What was cut" table now states the two behaviour changes the review found
unstated. First, the relay serves the download only while it holds the job, so a second
download after the acknowledgement answers 404. Second, a refused send of a stream still
costs one copy of the file. The `routes.py` docstring lists the new refusals.

## For the hardening pass

Unchanged and still open, from the review: the four untested timing behaviours (the job
thread only on the success path, `PrinterLink.upload` with no timeout, a backwards step
of the relay's clock freezing rate-limit windows, whole-body downloads in-process),
`status` failing with a traceback on an unreadable or invalid config, the two known
faults, and the upstream items above.

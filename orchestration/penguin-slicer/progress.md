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

- At most three review and fix rounds per phase per component. What is still open after
  the third goes into the morning report; the chain moves on only if no open defect can
  lose work, hang, leak or mislead.
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

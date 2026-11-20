# Standing rules for every strand

Read this before your own brief. Terms: the **slice service** (`slice/`) and **printer
delivery** (`delivery/`) are two components of the repository
`/repos/popcornpenguins/penguin-slicer`. The **print branch** is the read-only source they
were ported from: `/repos/popcornpenguins/PenguinCAM/.worktrees/onshape-test-bed`.

## The repository's rules

Read `/repos/popcornpenguins/penguin-slicer/README.md` and everything under `contracts/`.
A component depends only on `contracts/`. Every failure reaches the caller as an error
report; every long job sends progress reports.

## The owner's quality bar

The owner judges this project by how it handles the unusual case, and has said: "Slow
flaky tests are the bane of making good progress." So, for every component:

- **Fast suite** (`make test` in the component's folder): no real Orca, no real printer,
  no network beyond loopback, no real sleeping or waiting on the wall clock (clocks are
  injected, waits are events), no fixed ports, no shared temporary paths, no dependence on
  test order, the current directory, the home directory or the user. It finishes in
  seconds.
- **No flakes:** a test that fails once in any number of runs, in any order, alone or in
  parallel, is a defect and is fixed at its cause. Never retried, skipped, marked expected
  to fail, or given a longer timeout.
- **Coverage that means something:** branch coverage is measured per module; every
  refusal, limit, timeout, expiry and state transition has a test that reaches it and
  asserts what the caller sees. A test that executes lines without asserting behaviour
  does not count.
- **Every failure is an error report** with a stable code, a sentence a student
  understands, where it happened, a remedy that can actually help, and the underlying
  detail kept for the log. Each code is listed in the component's guide and has a test
  that produces it on purpose.

## Machine limits

This container has 4 CPUs and 5 GB of memory in total, shared with other agents working
at the same time. One Orca slice can use 1 to 2 GB. Never run more than one real Orca
process at a time, never run the real-Orca suite in parallel workers, and keep parallel
test workers to 2.

## Rules of work

- Stay inside the folder your brief names. Other agents are working in the other folders
  of the same checkout at the same time.
- No git command that writes (add, commit, switch, checkout, stash, reset) in any
  repository: the coordinator commits. Nothing is pushed anywhere.
- Shell: one plain command per call, absolute paths, no `cd ... && ...` chains (use
  `make -C <path>` or `uv run --project <path>`), no `rm` on a path built from a variable,
  no `eval`, no `sh -c` with built strings, no indirect expansion, no loops that build
  command names. Files are created and edited with the Write and Edit tools only, never
  through a heredoc or an interpreter.
- Never print or write a secret from the environment. Test values for codes and tokens
  are obviously fake. Do not touch port 6238.
- You have no sub-agents.
- One name per thing in everything you write: slice service, printer delivery, relay,
  daemon, plate job, sliced file, delivery job, part, copy, plate, profile, error report,
  progress report.
- The deliverable named in your brief is a file. Your reply is one status line (`DONE`,
  `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT`, `BLOCKED`) and at most 14 more lines.

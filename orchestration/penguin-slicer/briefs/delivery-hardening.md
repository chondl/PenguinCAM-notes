# Brief: harden printer delivery

- **Deliverable (REQUIRED):** hardened printer delivery in
  `/repos/popcornpenguins/penguin-slicer/delivery`, and a result file at the result path
  in the dispatch line.
- **Stop condition (REQUIRED):** every requirement and every hostile case below has a
  passing test; the fast suite passes 20 times in random order with 2 workers; the guide
  lists every error code, every stage and every state of a delivery job.
- **Budget (REQUIRED):** 4 hours; no cloud spend.
- **Where this fits:** printer delivery was ported from the print branch with its
  behaviour unchanged, including known faults pinned by tests marked "known fault". This
  strand makes it robust. An independent reviewer then tries to break it.
- **Inputs:** [standing-rules.md](standing-rules.md) first. Then the component, the port's
  result and review files in `../results/` (their "list for hardening" is your starting
  inventory), the
  [restart plan](../../../plans/2026-11-19-penguin-slicer-restart-plan.md) sections 5 and
  7.2, and the
  [first hardware test notes](../../../handoffs/2026-10-09-printer-relay-first-hardware-test.md).

Work test first. Behaviour may now change; where it does, the guide changes in the same
piece of work. The daemon stays in Python and must stay installable alone on a Raspberry
Pi with few dependencies. No real printer is available: everything is proven against the
simulated printer you build.

Printer delivery is three machines and two networks: the relay on a server, the daemon in
the shop, the printer beside it. The owner's concern, in their words: networks "fail
intermittently or just be slow", and a thing "that seems like it's down but then recovers"
is hard to be robust against and must be caught. Treat every exchange between relay and
daemon, and between daemon and printer, as something that can be slow, cut, repeated or
answered wrongly at any moment.

## Requirements

1. **The known faults fixed.** The start check matches the uploaded name without its
   extension against the printer's `subtask_name`, as the hardware test notes describe,
   and the tests marked "known fault" flip. The upload's result is checked, and success is
   judged by the printer's own report, not by the FTP reply alone. Library log lines that
   look like errors when nothing failed are captured and reworded or demoted.
2. **Errors.** Every failure a caller of the relay can meet is an error report: no daemon
   paired; daemon not seen for a stated time; printer unreachable; printer busy with
   another print (naming it and its progress); download of the sliced file failed; upload
   failed; printer refused the start; print not started in time; print failed partway,
   with the printer's own error code and, where a meaning is known, its meaning; print
   stopped at the printer; delivery job expired. Unknown printer error codes still give a
   truthful error report with the code kept in `detail`.
3. **Progress.** A delivery job sends progress reports through its whole life with these
   stages: waiting for the daemon, downloading, uploading to the printer (with a fraction
   from bytes sent), starting, then the print itself with the printer's stage (heating,
   calibrating, printing and the like, mapped from its stage code), percent, layer of
   total layers and minutes remaining as extra fields. Reports reach the relay's caller as
   a stream; a caller that connects late gets the latest at once. When the daemon or
   printer goes quiet, the reports say so (a `stale` marker with the age of the last
   word) instead of repeating old figures as if fresh.
4. **Cancellation.** A delivery job can be cancelled at any point before the printer
   starts the file: while waiting, downloading, uploading. A partly uploaded file is
   removed from the printer when possible. Cancelling after the print started is refused
   with an error report that says the print must be stopped at the printer. Cancel while
   the daemon is unreachable takes effect when it returns, and it never starts the file.
5. **Cleanup and restarts.** A daemon restarted at any point of a delivery job never
   starts the same file twice and never loses a job that had not started: it recovers
   what it was doing from the relay and from the printer's own report. A relay restarted
   mid-job: decide and document what survives (the port keeps state in memory); at the
   least every party ends in a defined state and the caller gets an error report, not
   silence. Downloaded files on the daemon and expired records on the relay are removed.
6. **Supportable from the server.** One structured log line per transition of a delivery
   job and per exchange with the daemon (request lines included: the hardware test could
   not tell whether status was still being asked for). The daemon's own log says plainly
   what it is doing and what it is waiting for, and nothing in it looks like an error
   unless something failed. No pairing code, access code or token in any log.
7. **Upstream.** Everything in [upstream.md](upstream.md), for the printer library. The
   simulated printer's suite doubles as the upstream check for it.
8. **The simulated printer.** A program in `delivery/` that plays a Bambu H2S to the
   daemon over real loopback sockets, speaking as much of the printer's MQTT status and
   FTPS upload as the daemon uses, scripted by scenario files: a whole print from start to
   finish, and each failure below. Only one real status document was recorded (its fields
   are in the hardware test notes; the provisional fixture is in the daemon's tests), so
   the sequences are invented from that document and from what the notes say the H2S
   reports; say so in the guide and make scenarios easy to replace with real recordings
   later. Add a recording command to the daemon that saves every status document of a
   real print to a file, so the owner can capture real sequences in one session.
   The simulated printer runs in its own small suite (`make test-sim`), kept fast and
   deterministic; the fast suite uses injected transports with no sockets.

9. **The daemon runs on Windows.** Added by the owner Thu 11-19 18:25 PT: the first real
   deployment for testing will be a Windows computer that sits on the printer's network
   and is always on. The Raspberry Pi stays supported. So:
   - nothing Unix-only at import or on any path the daemon takes on Windows (the port
     imports `pwd` in its entry point; look for `os.geteuid`, `fcntl`, signals Windows
     lacks, `/etc` and `/var/tmp` paths, file modes, `os.rename` over an existing file,
     file locking, and names Windows forbids in the files it downloads);
   - configuration, state and downloads live in the platform's proper per-machine places,
     chosen in one module;
   - a Windows install and run path in the guide: how to install with `uv` or plain
     Python, how to pair, how to keep it running across reboots (a scheduled task at
     start-up, or a service; pick the simplest that survives a reboot and say how to see
     its log), and how to run the recording command there;
   - the secrets the daemon keeps (its token, the printer's access code) are readable only
     by the account that runs it, on both platforms; say how that is done on Windows;
   - no Windows machine is available here, so prove what can be proven: the fast suite
     runs every platform-dependent choice with the platform injected (both branches
     tested on Linux), a test imports the whole daemon with the Unix-only modules made
     unimportable, and the result file ends with a short checklist of what the owner must
     confirm on the real Windows machine.

## Hostile cases: each needs a test that fails if the handling is removed

Build a fault-injecting transport for both links and drive it with a fake clock, so each
case is a deterministic test that runs in milliseconds.

**Relay and daemon link.** For each exchange (pairing, sync, job fetch, download of the
sliced file, acknowledgement, status upload):

- the request times out; the answer arrives after the timeout; the connection is reset
  before, during and after the answer; DNS fails; TLS fails;
- the relay answers 500, 502, 503, 429 with and without a retry hint, a web page instead
  of JSON (a captive portal or proxy), truncated JSON, an answer of the wrong shape;
- the download stops partway, stalls without closing, delivers the wrong length or
  wrong content (a checksum must catch it);
- the link is down for seconds, minutes, hours, then returns; it flaps every few seconds;
  it is very slow but alive;
- the same request is delivered twice; an acknowledgement is lost so the daemon repeats
  it; two daemons claim the same pairing; the daemon's clock is wrong by hours;
- the relay restarts between any two exchanges; the daemon restarts between any two
  exchanges.

For each: bounded retries with backoff and jitter (jitter from an injected source so
tests are deterministic), no tight loop, no duplicate print, no job silently lost, and the
caller's progress reports and error reports tell the truth throughout.

**Daemon and printer link.**

- the printer is off when the job arrives and comes on later; it drops off the network
  mid-upload, mid-start, mid-print, and returns; its status stream goes silent while the
  socket stays open; it reconnects with stale status;
- the upload is refused, stalls, is cut at each quarter of the file, reports failure
  though the file arrived (the 426 case from the hardware test), reports success though
  the file is short;
- the start command is accepted and nothing happens; it is refused; the printer starts a
  different file; someone starts another print at the printer between upload and start;
- the printer is busy, paused, in an error state, door open, out of filament, mid
  calibration, updating firmware, when the job arrives;
- during the print: a printer error code appears and clears; an error code that ends the
  print; a pause and resume at the printer; a stop at the printer; percent going
  backwards or jumping; fields missing from the status document; a status document that
  is not JSON; unknown fields and unknown stage codes;
- the wrong access code; a printer certificate the daemon does not expect; a printer at
  a new address after its lease changed.

For each: the daemon never crashes and never busy-loops, the delivery job ends in the
right state or keeps going when the fault clears, and the caller sees a truthful stage or
error report. "Seems down, then recovers" must not fail a job that can still succeed, and
must not hide a job that has in fact failed.

Use property-based tests where they fit (Hypothesis as a dev dependency, deterministic
settings): random sequences of faults on both links, with the invariants that a sliced
file is started on the printer at most once, every delivery job reaches a final state or
is still honestly reported as in progress, and no report is sent after a final state.

## The result file

What changed, by requirement. The table of error codes, the stages and the states of a
delivery job. Test figures: count, wall time, the 20-run result, coverage per module, the
simulated printer suite and its time. Every hostile case with the test that covers it.
What a session at the real H2S must confirm, as a short checklist for the owner. What you
could not do and why.

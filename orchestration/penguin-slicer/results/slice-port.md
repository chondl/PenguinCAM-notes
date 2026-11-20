# Slice service port: the port agent's report

Returned Thu 2026-11-19 18:01 PT. These are the port agent's own claims, saved by the
coordinator; the review in `slice-port-review-1.md` checks them.

## What was ported

- Package `penguin_slice` under `slice/src/`: `slicer`, `plate`, `plate_3mf`, `plate_job`,
  `mesh`, `limits`, `jobs`, `print_config`, the profiles and catalog, the sample part.
  Scripts in `slice/scripts/`, tests in `slice/tests/`, real-Orca tests in
  `slice/tests_orca/`.
- New: `service.py` (`slice_plate_job(plate_job, out_dir)` and the plate job checks),
  `errors.py` (`error_report(exc)` and 28 error codes, listed in `slice/README.md`),
  `__main__.py` (the command line), `contracts/plate-job.md`, `contracts/sliced-file.md`
  and their examples.
- Taken from modules not ported: from `routes.py` the copy validation, the order of plate
  job checks, the mesh read on arrival, the scratch-folder logic and four sentences; from
  `part_store.py` the part key pattern, relaxed from exactly 22 characters to 1 to 64.
- Cut: the team configuration (replaced by `choose_profiles(printer, filament, process)`),
  the team's override permission flag, the page id and team on the plate job. Orca is
  found through `PENGUIN_SLICE_ORCA`, else `slice/tools/orca`, when a slice starts.
- Orca was copied from the print branch's installed tree, not downloaded; the installer's
  download path is exercised only with a fake `curl`.

## Claimed test figures

420 fast tests in 0.85 s; 10 of 10 random-order runs and 10 of 10 runs on 4 workers
passed; slowest test 0.02 s; branch coverage 100% on every module; 8 real-Orca tests in
1.3 s total.

## The port agent's list for hardening

**Wrong or unhelpful sentences**
- Orca's `-100` says "A part has no flat face on the plate; choose another Lay flat."
  Not fixed; its code is `slice.empty_layers`.
- The unknown-printer sentence mentions the team configuration and PenguinCAM.
- "A part is no longer on the server; press Refresh from Onshape…" is used for an unknown
  part key or a missing STL file.
- "Onshape could not export {name}…" is used for any STL that is not binary, is
  truncated, or has non-finite coordinates. ASCII STL is refused this way.
- "This request could not be read." says nothing about what was wrong.
- "A part was left off the plate" does not name the copy.
- "…this part" is used for whole plates. "The slicer output could not be read." covers
  two different failures. "lower the quantities" refers to a user interface.
- "too small (under 0.1 mm)" also refuses a part of exactly 0.1 mm.
- The missing-Orca error is an operator message.

**Failure paths with no information**
- `OverrideError` and `MeshError` carry no details; `MeshError` has no part name field
  and the adapter recovers it by parsing the sentence.
- `SliceError` has no kind; the adapter tells failures apart by sentence text and code.
- `slice_stl` ignores Orca's return code in `result.json`; Orca's `error_string` is never
  captured; an unreadable `result.json` is skipped silently.

**Blind waits, progress, cancellation, cleanup**
- The Orca call blocks and its output is read only at the end: no progress, no
  cancellation, up to 240 s with nothing to report.
- `JobPool.wait` compares wall-clock times: two updates in one tick, or a clock stepping
  back, are invisible. A sequence number fixes it, and the progress report requires one.
- No cancel and no cancelled state. The sweeper loops forever with no way to stop it.
- Scratch folders are left behind if the process is killed.
- A sliced file of the same name is overwritten; two plate jobs in one minute collide.

**Fragile**
- Unknown plate job fields are ignored: a misspelled `overrides` silently means none.
- STL paths are not confined to any folder (matters once there is an HTTP face).
- The catalog is cached for the life of the process.
- The fake Orca used by the fast suite can drift from the real one.

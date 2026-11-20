# Upstream code: a requirement on both components

Added Thu 2026-11-19 at the owner's request. It is part of the port and of the
hardening of both components, and reviews check it.

Both components rest on open-source code written by others: the slice service on **Orca
Slicer** (the program and its profile files), the daemon on the **`bambulabs_api`**
Python library and whatever else it uses to talk to the printer. Call these **upstream**.

## 1. Taking a new upstream version must be routine

The owner: "It should be relatively straightforward to get a new version of Orca Slicer
and then update these pieces of code."

- **One pin.** Each upstream's version is stated in exactly one place in the component
  (with its checksum where a file is downloaded), and everything else reads it from there.
- **One command to move the pin** (for example `make upgrade-orca VERSION=x.y.z`): it
  fetches that version, verifies it, regenerates everything derived from upstream (for
  Orca, the profile catalog built from Orca's own profiles), and runs the upstream check.
- **An upstream check:** a named suite (`make test-upstream`) of tests that pin down
  every upstream behaviour the component relies on, each test saying what it protects.
  For Orca: the command-line options used; the return codes and the shape and wording of
  `result.json` that the error reports are built from; what Orca prints while slicing
  that progress is built from; the metadata read out of the sliced file; that placements
  and orientations in the plate file are kept; the profile fields the catalog and the
  overrides depend on. For the printer library: the calls the daemon makes and the status
  fields it reads. When a new version breaks an assumption, a test in this suite fails
  and says which assumption, instead of a student finding out.
- **Everything that touches upstream sits behind one seam** in the component (one module
  that runs Orca and reads its files; one module that talks to the printer library), so a
  change upstream is absorbed in one place.
- **A guide section, "Taking a new upstream version"**, with the steps, what to look at
  in the diff of the regenerated files, and what to do when the upstream check fails.
- Prove it once: where a newer or older upstream version than the pinned one exists and
  is cheap to fetch, run the upgrade command to it and back, and record what happened.
  If that is too heavy for this machine, say so and say what was verified instead.

## 2. Small patches to upstream are allowed, kept honest

The owner: small patches are fine "if errors are not reported well or if progress is not
being reported"; not a new feature.

- First choice is always to work with what upstream already offers. A patch is for a real
  gap in error or progress reporting that cannot be closed from outside.
- A patch is small, does one thing, and is kept in the repository as a patch file against
  a named upstream version, with a note beside it: what gap it closes, why it could not
  be closed from outside, whether it has been or should be offered upstream, and the test
  in the upstream check that fails without it.
- The upgrade command applies the patches and stops with a clear message when one no
  longer applies.
- Patching Orca means building Orca from source, which is a large build. Do not start one
  on this machine. If you find a gap in Orca that only a patch can close, write the patch
  note and the proposed change, and report it for the owner to decide; work around it for
  now. Patching the Python printer library is cheap and may be done.
- Nothing upstream is edited in place, and no upstream source is copied into the
  component without its licence and its version recorded.

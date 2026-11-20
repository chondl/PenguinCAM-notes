# PenguinCAM notes

Working notes for my contributions to [PenguinCAM](https://github.com/6238/PenguinCAM): design
specs, implementation plans, build prompts, research, handoff notes, and guides that only
apply to my own setup.

PenguinCAM itself keeps only documentation that is broadly useful for deploying or working
on the app — the kind of guide already in its `docs/`. Everything else about how I design,
plan and test changes lives here, and nothing in PenguinCAM links to this repository.

| Folder | What is in it |
|---|---|
| `specs/` | Design specs, one per feature |
| `plans/` | Implementation plans written from the specs |
| `prompts/` | Prompts that drove agent build sessions |
| `research/` | Background research |
| `handoffs/` | Where-we-left-off notes for picking work back up |
| `guides/` | How-tos specific to my machines, e.g. [testing the printer relay from a Mac](guides/PRINTER_DEV_TESTING.md), [running an Onshape checkpoint](guides/ONSHAPE_CHECKPOINT.md) |
| `tools/` | Small standalone scripts. [helix_hole.py](tools/helix_hole.py) writes G-code for one round hole in wood, centered on XY0 with its bottom at Z0: `python3 tools/helix_hole.py --tool 4mm --hole 0.5in --height 2in > hole.nc`. Tests: `python3 -m unittest tools/test_helix_hole.py`. [simulate_helix_hole.py](tools/simulate_helix_hole.py) runs a set of examples through PenguinCAM's `gcode_sim.py` beside PenguinCAM's own hole toolpath. It found that PenguinCAM's hole entry helix (radius 1.3 x the end mill radius) leaves an uncut core in every hole wider than 2 x the end mill diameter, and that `gcode_sim.py` simulates a program's first `G0 Z` at XY0 as a plunge from Z0. [surface_bed.py](tools/surface_bed.py) surfaces the MDF bed at the Z height the head was jogged to, between two machine X limits and machine Y0 to Y25, all moves in machine coordinates (`G53`): `python3 tools/surface_bed.py --tool 1.5in --xmin 2in --xmax 22in > surface.nc`. Tests: `python3 -m unittest tools/test_surface_bed.py` |

## Current work: 3D printing

**The 3D printing work moved to its own repository on Thu 2026-11-19:**
[6238/PenguinSlicer](https://github.com/6238/PenguinSlicer). Its plan, research, mockup
and build records live in that repository's `docs/` folder. What remains here is the
record of the first attempt:

- [Print path restart notes, Sun 10-11](handoffs/2026-10-11-print-path-restart-notes.md),
  with the [investigation of local mode errors and plate limits](research/2026-10-11-local-mode-errors-and-limits.md)

- [Roadmap after the first relay test, 2026-10-09](plans/2026-10-09-print-roadmap.md)
- [Onshape test bed and milestone 1 build: where it stands, 2026-10-09](handoffs/2026-10-09-onshape-test-bed-and-milestone-1-build.md)
- Onshape test bed: [design spec](specs/2026-10-09-onshape-test-bed-design.md),
  [running an Onshape checkpoint](guides/ONSHAPE_CHECKPOINT.md)
- Milestone 1 print features in Onshape: [design spec](specs/2026-10-09-print-onshape-features-design.md),
  [plan](plans/2026-10-09-print-onshape-features.md)
- [Where we left off, 2026-09-14](handoffs/2026-09-14-print-handoff.md)
- Stage 1, slicing with Orca Slicer: [design spec](specs/2026-09-13-3d-print-slicing-design.md)
- The Bambu printer relay: [design spec](specs/2026-09-13-bambu-printer-relay-design.md),
  [plan](plans/2026-09-13-bambu-printer-relay.md)

These files were moved out of the `docs/superpowers/` folder and `docs/PRINTER_DEV_TESTING.md`
in PenguinCAM's `feature/3d-print-stage1` and `feature/printer-relay` branches on 2026-09-27.
Links to PenguinCAM files point at its `main` branch, so a link to a file that is only on an
unmerged branch will not work until that branch merges.

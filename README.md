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
| `guides/` | How-tos specific to my machines, e.g. [testing the printer relay from a Mac](guides/PRINTER_DEV_TESTING.md) |

## Current work: 3D printing

- [Where we left off, 2026-09-14](handoffs/2026-09-14-print-handoff.md)
- Stage 1, slicing with Orca Slicer: [design spec](specs/2026-09-13-3d-print-slicing-design.md)
- The Bambu printer relay: [design spec](specs/2026-09-13-bambu-printer-relay-design.md),
  [plan](plans/2026-09-13-bambu-printer-relay.md)

These files were moved out of the `docs/superpowers/` folder and `docs/PRINTER_DEV_TESTING.md`
in PenguinCAM's `feature/3d-print-stage1` and `feature/printer-relay` branches on 2026-09-27.
Links to PenguinCAM files point at its `main` branch, so a link to a file that is only on an
unmerged branch will not work until that branch merges.

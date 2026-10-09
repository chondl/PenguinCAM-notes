# 3D printing roadmap, after the first relay test

Agreed with the owner on Fri 10-09, after the printer relay's first print on the team's H2S
([test notes](../handoffs/2026-10-09-printer-relay-first-hardware-test.md)). The goal is a
tool the team uses from the production Onshape panel, and the order is chosen so that most
of the work runs without the printer and without the owner in the shop.

Each sub-project gets its own design spec, written when it is reached.

## Milestone 1: Onshape integration, through downloading a file (local only)

1. **Test bed for Onshape**: [design spec](../specs/2026-10-09-onshape-test-bed-design.md)
2. **Supportability, Onshape web side**: server-side logging of what students and mentors do
   in the panel.
3. **Model from Onshape**: export the selected part instead of `print/sample_part.stl`.
4. **Placement on the plate**: preview, move and rotate parts on the plate.
5. **Multiple parts from Onshape**
6. **Profiles**: filament, process and nozzle chosen from team configuration.

## Milestone 2: the daemon (local only)

7. **Supportability**: the server side of daemon telemetry and logging.
8. **Test bed for the 3D printer**: a simulated Bambu printer, replaying real H2S status
   documents.
9. **Supportability, print daemon side**: telemetry from the daemon and a clearer local log.
10. **Daemon architecture and rebuild**: bridge or adapters in the daemon; one
    self-contained Go or Rust executable.
11. **Relay fixes and polish**: the four bugs from the first test, file names, progress
    streaming, the preview image.

## Milestone 3: shipping

12. **Shipping**: push, pull request to `6238/PenguinCAM`, Railway deployment with Orca.

## After shipping

Beambox laser, multiple printers per team, other printer brands, cancel and pause from the
wizard, a print queue.

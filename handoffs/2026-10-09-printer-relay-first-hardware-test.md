# Printer relay: first test against the H2S, Fri 10-09

The first run of `feature/printer-relay` against the team's Bambu Lab H2S, on Fri 10-09
around 13:40 PT. It followed [PRINTER_DEV_TESTING.md](../guides/PRINTER_DEV_TESTING.md): the
backend ran in the agent container on port 6238, the daemon ran on the Mac, and the H2S sat on
the same LAN as the Mac. This file records issues and ideas for later features. Nothing in
it has been fixed yet.

## What worked

- **The daemon's `pair` command:** discovery heard nothing, so the IP address and serial
  were typed in by hand. The daemon reached the printer over MQTT and printed the pairing
  code. The `systemctl` and `penguincam` user notes appeared as expected.
- **Pairing with the backend:** the daemon logged `paired with the backend`. The pairing
  code reached the backend through `PRINTER_DEV_PAIRING_CODE` and a temporary patch, not
  through the Onshape YAML (see "State left behind").
- **Sending a print:** the wizard sliced the sample part and showed Send to Printer. The job
  `jb345bf38` was queued, the daemon downloaded the sliced file and uploaded it over FTPS,
  and the start command was accepted. **The H2S printed the part**, running the file as
  `sample_part-jb345bf38`.

## Issues found

### 1. The start check never matches the H2S's report (bug)

`_acknowledge_if_the_printer_has_it` in `print/printer_daemon/run_loop.py` acknowledges a job
when `snapshot['file']` equals the uploaded name, `sample_part-jb345bf38.gcode.3mf`.
`map_status` in `print/printer_daemon/printer.py` fills `file` from `gcode_file` first and
`subtask_name` second. While our file was printing, the H2S reported:

| Field | Value |
|---|---|
| `gcode_state` | `RUNNING` |
| `gcode_file` | `/data/Metadata/plate_1.gcode` |
| `subtask_name` | `sample_part-jb345bf38` |
| `stg_cur` | `14` |
| `mc_percent` | `0` |
| `mc_remaining_time` | `17` |
| `layer_num` / `total_layer_num` | `0` / `50` |
| `print_error` | `0` |

`gcode_file` is the G-code path inside the archive, never our name, and `subtask_name` is
our name without `.gcode.3mf`. So the job was acknowledged as failed, `the printer did not
start the file within 60s`, while the part printed. The same mismatch would break the
restarted-daemon check that keeps a job from printing twice. The fix: match the uploaded
name with its extension removed against `subtask_name`, and pin the fixture below.

The whole status document from this print is in `~/h2s_status_printing.json` on the Mac. It
should replace the provisional `print/printer_daemon/tests/fixtures/h2s_status.json`.
It was read with the daemon running alongside. Whether the second MQTT client disturbed
the daemon was not checked.

### 2. The upload returns 426, but the file arrives intact

The daemon output showed `Failed to execute function: 426 Failure reading network stream.`
during the upload, and the file printed anyway. `bambulabs_api` 2.6.6 logs this line itself:
`PrinterFTPClient.connect_and_run` catches every exception, logs it and returns `None`.
`PrinterLink.upload` never checks that return value. Two consequences:

- A real upload failure is just as invisible. The daemon would go on to start a missing
  file, and the job would fail only on the start timeout.
- A success looks like an error to anyone reading the log.

A likely cause, not yet confirmed: the library closes the TLS data connection without a
TLS shutdown (`ImplicitFTP_TLS(unwrap=False)` is the default), and the printer reports that
as a broken stream. Try `unwrap=True`, or do the upload with our own FTPS code, and judge
success by the printer's report rather than by the FTP reply.

### 3. No preview image on the printer's screen

The H2S showed no preview of the part. Orca runs headless and skips thumbnails for lack of
an OpenGL context (`docs/3D_PRINTING.md`, "No thumbnails"). That was known and accepted at
stage 1. On a printer with several jobs, though, a blank tile is a usability gap.

### 4. Smaller observations

- `pair` printed `Connected to the printer  (0938AC…)` with the model and name blank: the
  daemon does not find the H2S's model and name in the fields it reads.
- `Connection aborted … RemoteDisconnected` appeared once during pairing. It came from a
  backend restart, and the daemon retried correctly. The message is still alarming for
  something that is routine.
- The daemon ran on macOS with `uv`, from the archive `make daemon-tarball` builds.

## Future features

These are recorded, not started. Each one is new behaviour that ships through a PR, so
each starts with `designing-a-feature`.

### Daemon telemetry to the server (most important)

**The owner's main takeaway from this test.** Mentors will set up a daemon without knowing
what they are doing, or it will break for reasons nobody on site can see. The only evidence
the team will have is what the daemon sends to the server. So:

- From the moment it starts, before pairing succeeds, the daemon sends the server what is
  needed to help a mentor debug it: its version, platform and Python version; the backend
  URL it uses; whether the printer answers over MQTT; the identity the printer reports; each
  pairing attempt and its result; each job stage and its outcome; and the errors it hit.
- The server keeps this per daemon and shows it to whoever supports the team.
- It needs a channel that works before pairing (there is no token yet), a cap on volume, and
  no secrets: never the access code, the token or download tokens.

### A clearer local log on the daemon

Some mentors are savvy and will read the daemon's own log. It should tell them plainly
whether things are working:

- Nothing that looks like an error unless something actually failed. The 426 line in issue 2
  and the `RemoteDisconnected` retry in issue 4 are the examples from this test. Library log
  lines should be captured and reworded, or demoted.
- Progress lines that show the daemon is alive and working: printer connected, backend
  reachable, paired, syncing, idle with the printer's state, each job stage and its outcome.
  While waiting, a periodic line that says what it is waiting for.

### File names that say which part and when

**The owner wants every file name tied to its part**, so anyone who sees a name, on the
printer's screen, in its file list or in a download, can tell which part it is and the date
and time it was printed, in the local time zone. Today the names are
`sample_part.gcode.3mf` for the slice and `sample_part-jb345bf38.gcode.3mf` on the printer:
the part is the hardcoded sample, and the job id says nothing to a person.

Points to settle in the design:

- The part name comes from Onshape once the model is fetched from Onshape instead of the
  hardcoded `print/sample_part.stl`, the next feature already planned.
- "Local" means the shop's time zone, not the server's (Railway runs in UTC). Either the
  browser sends its zone with the slice, or the daemon stamps the name with the Pi's own
  clock when it uploads.
- The start check (issue 1) finds the job by name, so the name must stay unique per job
  and predictable to the daemon. The job id, or something equally unique, stays in it.
- The H2S's screen shows only so many characters, and the printer's file system and FTPS
  may restrict characters. Both limits need checking on the printer.

### A preview image in the sliced file

**The owner wants this in a future version.** The test print ran fine without one, so the
missing preview is not a blocker, but the printer's screen should show the part. Two ways to
do it, from issue 3:

1. Render a small picture of the placed part on the server and add it to the archive, the
   way Bambu's own slicer writes `Metadata/plate_1.png`. Which image names and sizes the H2S
   actually reads is unverified.
2. Give Orca a virtual display (Xvfb with Mesa's software OpenGL) so it draws the preview
   itself. That is a heavy, fragile dependency on Railway.

## State left behind

- **The relay branch's backend is still running** on port 6238 in the container, from
  `.worktrees/printer-relay`, with `PRINTER_DEV_PAIRING_CODE` set. Its log is
  `/tmp/penguincam-relay.log`.
- **A temporary patch is uncommitted** in `.worktrees/printer-relay/frc_cam_gui_app.py`,
  marked `TEMP … do not commit`. In development mode it puts `PRINTER_DEV_PAIRING_CODE` into
  the session's team config when the Onshape YAML has no pairing code, so the wizard offers
  Send to Printer without anyone editing the YAML. Keeping this as a real development switch
  would save every future test the YAML edit. To drop it, run
  `git checkout frc_cam_gui_app.py` in the worktree.
- `dist/penguincam-printer-daemon.tar.gz` was rebuilt from the branch as it stands.
- Section 4.7 of the guide (the smoke test) was not run. The status document captured during
  this print covers the same ground without starting a second print.

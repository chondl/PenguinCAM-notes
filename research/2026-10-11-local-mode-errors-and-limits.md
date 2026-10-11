# Local mode print session of Sun 10-11: errors and plate limits

Investigation of the two problems the owner hit in local mode, written Sun 10-11. It feeds
section 5 and the next work in the
[print path restart notes](../handoffs/2026-10-11-print-path-restart-notes.md).

**About the evidence.** The scripts, run directories, sweep results, uploaded parts and the
owner's sliced archives named below lived in the development container's scratch space
(the session scratchpad and `/tmp`), which does not survive. Their names are kept only so
the method is clear; the measured numbers are copied here in full.

Session investigated: the owner's local-mode run on Sun 10-11 between 10:02 and 10:25 PT,
against the local mode server started Sat 10-10 around 06:57 PT (pids 90410/90413/90423,
still running and not touched at the time). All times below are Pacific. The `[PRINT]` lines in the
stdout log carry no timestamps, so times come from the metrics database `/tmp/metrics.db`
(UTC, converted; scratch space, gone).

## Short answer

1. **"Not touching the plane"**: every failed slice was **Orca return code -100**, and every failed plate held the
   **Eiffel tower STL (L3)**. Code -100 is Orca's *generic* "Failed slicing the model". The real reason sat in
   Orca's `result.json`: *"Object can't be printed for empty layer between 105.42 and 106.14 [and 111.18–113.1].
   Maybe parts of the object … are too thin, or the object has faulty mesh"*. The cause is **the STL itself**
   (non-manifold, 889 shells, a thin open lattice near the top) **sliced with supports off**. It is not our 3MF
   transform: raw Orca on the bare STL fails the same way. Proven by offline reproduction. The one Eiffel slice that worked
   (10:04 PT) had supports on (its archive shows `enable_support 1`). Our sentence "no flat face … choose another
   Lay flat" is a wrong mapping of -100, and the logs dropped Orca's real reason.
2. **Limit**: only the client-side **plate triangle cap** (300k, `MAX_JOB_TRIANGLES`) fired, 3 times. The two uploaded parts were 139,989 + 112,402
   triangles, so any second copy of either crossed 300k. But measurement shows **triangles barely drive Orca
   memory**: 6 bunnies at 674k triangles peaked at 1,739 MB, and the same 6 decimated to 60k triangles still peaked
   at 1,525 MB. Part volume × copies (plus supports, +30–50%) drives memory. The current caps therefore block
   harmless plates *and* let through plates far over the 900 MB stop rule.
3. No exceptions, no 4xx/5xx, no orphaned Orca. `client_error` holds mostly informational "parked" hints. Nothing in the log
   shows a browser closing mid-slice, and the server has no cancel path.

## Inputs (what the owner uploaded)

Stored at `~/.local/state/penguincam-testbed/local-parts/de1d096f244b247629e7e641/` in the container (copies were
kept in scratch space; the part store copies had the same md5s).

| Ref | Name | Triangles | Size (mm) | Watertight | Notes |
|---|---|---|---|---|---|
| L1 | FixoLab_-_Ghost_-_Model | 33,728 | 34.8 x 36.2 x 29.6 | yes | volume 16,096 mm³ |
| L2 | Cube_3d_printing_sample | 12 | 20 x 20 x 20 | yes | |
| L3 | Eiffel_tower_sample | 139,989 | 54.7 x 54.7 x 120.9 | **no**, 889 shells | 1 main shell (138,506 faces) + ~888 zero-thickness 4-face slivers; bed contact 564.8 mm² |
| L4 | Stanford_Bunny_sample | 112,402 | 107.7 x 87.8 x 107.9 | yes | volume 279,628 mm³ |

L1 to L4 are the four files the owner uploaded, one upload each. There was a single Eiffel tower
file: a 35.3 MB ASCII STL, which local mode converted on upload to a 7.0 MB binary STL of 139,989
triangles (an ASCII facet takes about 250 bytes, a binary one 50). "2 x L3" in the timeline below
means two copies of that one part on the plate, not two meshes.

## Timeline (from `/tmp/metrics.db`, Pacific)

| Time (Sun 10-11) | Page | Event |
|---|---|---|
| 10:04:28 → 10:05:00 | 12166206 | job JTq7XF6n, 3 copies (2 x L3 + L2), 279,990 tri: **done**, 31.8 s; downloaded 10:05:21 |
| 10:14:26, 10:15:26, 10:21:15 | 19e2186e | `client_error code=job_triangles` (L3 + L4 on the page) |
| 10:20:44 | 19e2186e | `client_error code=off_plate` "Stanford_Bunny_sample #1 is not fully on the plate." |
| 10:21:23 → 10:21:33 | 19e2186e | tGM35fJT, L3 + L4, 252,391 tri: **failed -100**, 10.3 s |
| 10:21:50 → 10:22:11 | 19e2186e | Y__erKnc, 2 x L3, 279,978 tri: **failed -100**, 21.4 s |
| 10:22:38 → 10:22:59 | 19e2186e | 03EBiQmu, 2 x L3 + L2, 279,990 tri: **failed -100**, 21.6 s |
| 10:23:17 → 10:23:28 | 4bdc7ca0 | RLMiHhbk, L3 + L2, 140,001 tri: **failed -100**, 10.9 s |
| 10:23:53, 10:24:13, 10:24:34 | 505a19cb | L2 alone; L1 + L2; 3 x L1 + L2: all **done** (0.1, 0.7, 1.8 s); downloaded 10:25:07 |

All four failures contain L3, and every plate without L3 succeeded. The failure time scales with the Eiffel copy count (about 10 s per copy).

## Q1. "The part was not touching the plane"

**Code path.** `print/slicer.py` `slice_plate` → non-zero exit 156 → `orca_return_code` reads `result.json`
`return_code` = -100 → `ORCA_CODE_MESSAGES[-100]` = "A part has no flat face on the plate; choose another Lay flat."
→ `SliceError` → `print/routes.py` logs `slice_failed code=-100 reason=…` and the pool logs `exc.details`, which is
only `exit code 156\nrun found error, return -100, exit...`. Then `shutil.rmtree(scratch)` deletes `result.json`,
which held the real reason.

Server log excerpt (job tGM35fJT, 10:21:33 PT):
```
[PRINT] slice_failed pid=19e2186ed0c8 team=0 job=tGM35fJT seconds=10.261 code=-100 reason="A part has no flat face on the plate; choose another Lay flat."
print job tGM35fJT failed: A part has no flat face on the plate; choose another Lay flat.
exit code 156
run found error, return -100, exit...
```

**Reproduction (proven).** A script (`repro.py`, scratch space) drives the shipping code
(`mesh.orientation_footprints` → `plate_job.run_plate_job` → `plate_3mf.write_plate_3mf` → `slice_plate`) with the
default H2S profile set that the session used (`config=team`, `configured=no`):

| Run | Result | Orca `result.json` |
|---|---|---|
| L3 `+z` alone, profile defaults (supports off) | **-100**, 11.2 s, 210 MB | `warning_message`: "Object can't be printed for empty layer between 105.42 and 106.14. Object can't be printed for empty layer between 111.18 and 113.1. Object: Eiffel_tower_sample #1. Maybe parts of the object at these height are too thin, or the object has faulty mesh" |
| L3 `+z`, walls 3 + infill 20 (supports off) | **-100**, 9.3 s | same |
| L3 `+z`, supports on | **ok**, 19.8 s, 557 MB, 502 layers | none |
| L3 bare STL, Orca's own arrange (`raw_stl.py`, no PenguinCAM 3MF) | **-100** | same empty-layer message |
| L3 decimated to 50k, supports off / on | -100 / ok | same |
| L4 alone, supports off | ok, 3.6 s, 367 MB | none |

The successful archive of Sun 10-11 10:04 PT (job JTq7XF6n, scratch space) holds `enable_support 1`,
`support_type tree(auto)`, `wall_loops 3` and `sparse_infill_density 20%`: the owner had set overrides on that page.
Its Eiffel copies sit at identity rotation, and their first-layer area (564.82 mm²) equals the STL's bed contact.

**Root cause.**
- *Proven:* the failure comes from the uploaded Eiffel STL's geometry. The mesh is not watertight and carries hundreds of degenerate
  sliver shells. Its slices at about 105–106 mm and 111–113 mm (where the open lattice gives 169 section
  entities at z 105.5) close into no polygon, so Orca sees empty layers and refuses unless supports are on. It
  is not our transform (lowest Z at 0, units mm, contact area matches), and Orca is behaving as designed.
- *Proven:* our mapping `-100 → "no flat face"` is wrong. -100 is Orca's generic slicing failure, and the "no flat
  face" reading rested on one observed case (a box standing on an edge, in the Orca placement experiments of Fri 10-09, whose notes were in scratch space). The
  sentence sent the owner to Lay flat, which cannot help.
- *Strongly suspected, not provable from the record:* the four failing jobs ran with supports off. Overrides are
  not logged and the scratch dirs are deleted, but any of those plates would have sliced with supports on.

**Did the `[PRINT]` logging suffice?** It was enough to see *that* every failure was -100 and involved part L3. It was not enough to say *why*.
Missing:
- Orca's `result.json` `error_string` and `sliced_plates[].warning_message` on failure (read only on success,
  in `read_summary`). This one field would have diagnosed the failure from the log alone.
- The job's **overrides** (supports, walls, infill, brim) on `slice_queued`.
- Per copy: ref, orientation, angle (or at least the distinct orientations) on `layout` / `slice_queued`.
- Which part names / refs are in the job (only counts now), so "all failures contain L3" took cross-referencing
  triangle sums.
- Mesh health on `export`: watertight / shell count. L3 would have flagged at upload time.
- The `[PRINT]` lines carry no timestamp in stdout; Railway adds one, but local logs need the metrics DB.

## Q2. "We hit the complexity limits pretty early"

**What fired.** Only `job_triangles` (`MAX_JOB_TRIANGLES = 300_000`, summed over copies), and only in the browser
(`print/static/print_layout.js:146`). It fired 3 times on page 19e2186e on Sun 10-11 at 10:14:26, 10:15:26 and 10:21:15 PT. The
`client_error` event does not carry the count. The page held L3 (139,989) + L4 (112,402) = 252,391, so any quantity of 2
crossed the cap (2 x L3 + L4 = 392,380, L3 + 2 x L4 = 364,793). The per-part cap (150k), the copy cap (25), the byte caps
and the 240 s timeout did not fire. The sample STLs are dense downloads, and our Onshape tessellation settings
(`STL_CHORD_TOLERANCE_M`, `STL_ANGLE_TOLERANCE_RAD`) do not apply to them in local mode. In production, an STL imported into
Onshape as a mesh would presumably also export with its own triangles (not verified).

**What actually drives Orca (measured on this 6-vCPU aarch64 box, one slice at a time, peak RSS of the Orca process).**

| Plate (H2S 0.6, 0.24 mm, profile defaults unless noted) | Triangles | Time | Peak |
|---|---|---|---|
| 1 x bunny | 112,402 | 3.6 s | 367 MB |
| 2 x bunny | 224,804 | 7.2 s | 711 MB |
| 4 x bunny | 449,608 | 13.8 s | 1,281 MB |
| 6 x bunny | 674,412 | 20.7 s | 1,739 MB |
| 6 x bunny decimated to 50k | 300,000 | 18.7 s | 1,767 MB |
| 6 x bunny decimated to 25k | 150,000 | 14.4 s | 1,714 MB |
| 6 x bunny decimated to 10k | 60,000 | 11.9 s | 1,525 MB |
| 2 / 4 / 6 x bunny, supports on | | 9.8 / 18.1 / 31.9 s | 1,012 / 1,752 / 2,569 MB |
| 6 x bunny 25k, supports on | 150,000 | 20.9 s | 2,288 MB |
| 1 x Eiffel, supports on | 139,989 | 19.8 s | 557 MB |
| earlier: 25 x 11,968-tri hub (`print/jobs.py`) | 299,200 | 7.6 s | 786 MB |
| earlier: 2 x 149,760-tri hub | 299,520 | 1.7 s | 218 MB |

Findings:
- **Memory is about printed volume x copies, not triangles.** Each bunny copy costs about 230–280 MB. Cutting its
  triangles 11x (674k → 60k) cut the peak only 12% (1,739 → 1,525 MB), though time dropped 42%. Per copy, the hub
  (22,184 mm³) costs about 27 MB and the bunny (279,628 mm³, 12.6x the volume) about 265 MB (about 10x). A rough fit:
  **peak ≈ 100 MB + about 1 MB per 1,000 mm³ of part volume on the plate, x1.3–1.5 with supports** (the **memory model**; suspected, from three
  shapes). Bounding-box volume and surface area fit worse.
- **The caps protect the wrong thing.** 6 x bunny at 25k triangles (150k total, 6 copies) passes every current cap and
  peaks at 1,714 MB, or 2,288 MB with supports: 1.9–2.5x the 900 MB stop rule (`MEASURE_MAX_PEAK_KB`). Meanwhile
  L3 + 2 x L4 (about 0.9 GB estimated) is refused for triangles.
- **Instancing helps time a lot and memory somewhat** (`instanced.py`, scratch space: one shared `<object>`, six build
  items). 6 x bunny: 20.7 → 9.6 s, 1,739 → 1,482 MB (−15%). With supports: 31.9 → 11.8 s, 2,569 → 1,913 MB (−26%). Rotated copies
  also work (11.4 s, 1,573 MB). The catch is the one `print/plate_3mf.py` documents: Orca blanks the
  copies' names (`plate_1.json` names came back `["L4","plate","plate",…]`), so the name guard and the printer's
  skip-object labels break. Whether per-instance names can be restored (for example through `Metadata/model_settings.config`)
  is untested.
- **Decimation is cheap and accurate.** Quadric decimation (`fast-simplification`) took 0.05 s. Bunny 112k → 25k
  deviates p99 0.033 mm (max 0.06), far below a 0.6 mm nozzle and 0.24 mm layers; 112k → 10k gives p99 0.10 mm. It
  mostly buys time and per-part-cap headroom, not memory. Decimating the Eiffel to 50k reaches max 1.07 mm deviation
  (thin lattice) and does not fix its empty layers.
- **Server memory.** The Railway plan's memory is still unmeasured (`docs/DEPLOYMENT_GUIDE.md` line ~395), so whether
  a 1.5–2.5 GB slice fits is open. This container has 7.9 GB total.

**Options, with the evidence for each.**
1. *Replace the plate triangle cap with a memory model.* Compute mesh volume (numpy, at export; watertight meshes
   only, with the bounding box as the fallback), sum over copies, and add a supports factor. Cap at the stop rule. Calibrate with
   `print/scripts/measure_plate.py` extended to the bunny and the hub. This lets 2–3 big organic parts through and stops
   the 6-bunny plate.
2. *Count unique meshes for the parsing cost.* Keep a per-part triangle cap (or decimate above it) and drop the copies x
   triangles sum: triangles cost time, not memory.
3. *Decimate oversized parts automatically* (for example to ≤ 50k when p99 deviation stays under about 0.05 mm) instead
   of refusing "too detailed". Requires `fast-simplification` (or similar) in `requirements.txt`.
4. *Instancing* for repeated copies, if the naming can be solved. It is the largest time win (2–3x).
5. *Measure the Railway plan* before raising anything; the memory model decides `MAX_RUNNING` too.

## Q3. Other errors and browser-close behaviour

- No exceptions or tracebacks. Every `request` status is 200/202/204/304 (0 lines with status 4xx/5xx).
- `client_error` counts: 6 `parked` (an informational hint, "New copies are waiting beside the plate…", logged as
  an error, which is noise), 3 `job_triangles`, 1 `off_plate` (Sun 10-11 10:20:44 PT, a placement while dragging), and 4 `slice_failed` (the
  browser echoing the server's -100 sentence).
- Startup warnings only: random secret key, Turnstile keys unset, a doubled banner (Flask reloader). Expected in local
  mode.
- Orca's stderr in an isolated run also printed a Wayland socket-path-too-long error (path > 108 bytes under the
  scratch dir). It was harmless here but would surface if deep `upload_folder` paths are used.
- **Browser close / cancel:** no evidence. Each page reload (12166206 → 19e2186e → 4bdc7ca0 → 505a19cb) came
  after the previous job finished. `pgrep -af orca` shows no Orca process now. By code, closing the browser only
  drops the SSE stream (`print_job_events`). The job keeps running to completion or the 240 s timeout, with no cancel
  and no event marking an abandoned job.

## Recommended next work

1. On every failed slice, log Orca's `result.json` `error_string` + `warning_message` and show the warning (trimmed)
   to the student. Stop mapping -100 to "no flat face". Map Orca's empty-layer warning to a sentence such as "Part X has
   gaps or very thin features at about 105 mm; turn Supports on or repair the mesh".
2. Log the overrides, part refs and orientations on `slice_queued`, and mesh health (watertight, shells) on `export`.
   Optionally warn at upload when a part is not watertight.
3. Replace `MAX_JOB_TRIANGLES` with a volume-based memory model calibrated by measurement; keep or decimate at the
   per-part cap.
4. Measure the Railway plan's memory; then decide instancing (after a naming spike) and the copy cap.
5. Make `parked` a non-error event, and consider a cancel when the SSE client disconnects.

## Evidence

All of it lived in the development container's scratch space and is gone; the numbers above
are the record.

- Scripts: `repro.py`, `instanced.py`, `raw_stl.py`, `geom.py`, `decimate.py`, `sweep.sh`,
  `settings.py`.
- Runs with `plate.3mf`, `process.json` and Orca's `result.json` (the Eiffel run's
  `result.json` held the empty-layer message), and the sweep results. One sweep row (1 x
  bunny) was killed by an outside `pkill` around Sun 10-11 10:55 PT and was re-run; the
  table above uses the re-run.
- The owner's archives: job JTq7XF6n (the successful Eiffel slice, supports on) and job
  4eCYL0ya.

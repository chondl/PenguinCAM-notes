# Print path in Onshape, milestone 1: design

Sub-projects 2 to 6 of milestone 1 in the
[3D printing roadmap](../plans/2026-10-09-print-roadmap.md):

- supportability on the Onshape web side;
- the model from Onshape;
- placement on the plate;
- multiple parts;
- profiles.

They are designed together because each builds on the one before.

The owner asked on Fri 10-09 for the agent to build all of milestone 1 without them, from
Onshape's public documentation, and then validate it in one recorded run together. So the
design choices below are the agent's rulings, marked **Ruling** where a reasonable person
might choose otherwise. The owner reviews them after the fact. The milestone ends at
downloading a file; sending to the printer is milestone 2.

Built on the [Onshape test bed](2026-10-09-onshape-test-bed-design.md). Facts about Onshape
come from a docs brief (Onshape's public documentation and OpenAPI, Fri 10-09); facts about
Orca come from a spike in the container (Orca 2.4.2, Fri 10-09). Where a fact depends on
behaviour Onshape does not document, the design says so, and the first recorded run settles
it.

## 0. Separation from the CNC path

The owner wants the 3D printing path kept strongly apart from the CNC path, and may one
day split it into its own app. Everything in this design follows four rules:

1. **All new code lives under `print/`**: Python modules, routes in the print blueprint,
   templates and scripts. Nothing new goes into `frc_cam_gui_app.py`, `onshape_integration.py`,
   `team_config.py`, `templates/wizard.html` or `static/`.
2. **The print path talks to Onshape through its own module**, `print/onshape_parts.py`.
   It uses the shared `OnshapeClient` only as an authenticated transport
   (`_make_api_request` and its session) and adds no method to it. Sign-in and the session
   cookie stay shared, because the panel is one app with one sign-in.
3. **The print page does its own Onshape messaging**, in `print/static/print_onshape.js`.
   It never loads or calls `static/source_onshape.js`.
4. **Configuration for printing is read by `print/print_config.py`** from the raw
   `printing:` section of the team YAML. `team_config.py` keeps passing the section
   through untouched, as it does for `pairing_code` today.

The few unavoidable touches outside `print/` are listed in section 9, with why each one is
needed. If the print path later becomes its own app, it takes `print/` and those touches.

**Recommended, not done:** a separate Onshape right-panel extension that opens `/print`
directly, so a student does not start in the CNC page. That is a change to the Onshape app's
registration, which only the owner can make (section 11).

## 1. What a student does

1. In Onshape, in a Part Studio or an Assembly, open the PenguinCAM panel and choose
   **3D Printing**. The print wizard opens: Setup, Parts, Layout, Preview, as today.
2. **Setup** shows the team's printer and offers the team's filaments and print settings
   (section 6). Defaults are preselected.
3. **Parts:** click parts in Onshape's model or parts list. Each part appears in the list
   with its name, size and a quantity (1 by default). **Add from another document…** opens
   Onshape's own part picker for parts elsewhere. A part can be removed or its quantity
   changed.
4. **Layout:**
   - A top-down view of the plate shows every copy's footprint, placed automatically.
   - Drag a copy to move it, or rotate it by 90° or by any angle about the vertical axis.
   - **Lay flat** buttons choose which face of the part rests on the plate.
   - A copy that does not fit, or comes too close to another, is drawn in red, and Next is
     disabled with a sentence saying why.
   - **Arrange** places everything again automatically.
5. **Preview:** slicing starts, as today, and the plate is shown in 3D with every copy where
   it was placed, plus print time, filament and layer count. **Download** gives a
   `.gcode.3mf` named after the parts and the time. Google Drive works as today.

The full-page (upload) mode keeps the fixed sample part, unchanged. **Ruling:** uploading
an STL in full-page mode is out of scope; the milestone is about Onshape.

## 2. Supportability on the Onshape web side

The owner's goal: any support question about the print path can be answered from the
server's logs, without asking the team for anything.

### 2.1 Print events

`print/events.py` writes one log line per **print event** through the app's existing
`log()`, so Railway's log viewer shows it. It also passes the event to
`metrics.log_event('print_<name>', team_number=…, metadata=…)`, so the existing metrics
pipeline counts it. Line format:

```
[PRINT] <event> sid=<session id> team=<n|-> job=<id8|-> key=value …
```

- **Session id (`sid`):** a random 8-character id made when the print page is served, kept
  in the Flask session. It ties one student's page load to all their later requests.
  **Ruling:** no Onshape user id, name or email in print events. The session id plus the
  team number is enough to follow one student's attempt, and it keeps students' identity
  out of logs. Who started a print is decided in milestone 2 with file names.
- **Values** are explicit fields, never serialized objects. Onshape document, element and
  part ids may appear. Tokens, cookies, keys, download tokens and pairing codes never do;
  they are not passed to `events.py` at all.

Events, each with its fields:

| Event | When | Fields |
|---|---|---|
| `page` | `/print` served | source, theme, has_onshape_context, config (team or default) |
| `config` | team config resolved for printing | printer, filaments offered, processes offered, warnings |
| `select` | parts arrive from Onshape | via (selection or dialog), count, element type |
| `export` | one part exported | part id, element id, units, bytes, triangles, size_mm, calls, ms, outcome |
| `export_failed` | export failed | part id, status, reason |
| `layout` | the student enters Preview | copies, parts, plate fill percent, any rotation not a multiple of 90 |
| `slice_queued`, `slice_done`, `slice_failed` | job transitions (existing) | job, copies, filament, process, overrides, seconds, Orca code, reason |
| `deliver` | download or Drive | job, action, outcome |
| `client_error` | an error message shown in the browser | step, message (as shown), code |
| `request` | every print-blueprint request | method, path (no query), status, ms |

The browser reports the errors it shows through `POST /print/client-event` with
`{step, message, code}`. That route accepts only those three fields, limits each to 300
characters, and is rate limited (30 per minute). Every user-facing error in the print
wizard calls it.

### 2.2 Reading the logs

`docs/3D_PRINTING.md` gains a section on support: how to filter Railway's logs for
`[PRINT]` and one `sid`, and what each event means. **Ruling:** no new log store or
dashboard; Railway's log search is the tool until it proves too little.

## 3. The model from Onshape

### 3.1 The print page knows its Onshape context

Today `/print` sees the document, workspace and element ids only inside its `return` link.
`print_page` now reads them from the `return` URL's query on the server, validates each as
an Onshape id (24 hex characters, or the unsubstituted `{$…}` placeholder for a version
context), and puts them in the template as `window.PenguinCAM.onshape`, the way the CNC
panel does. No CNC code changes: the CNC page's link already carries the return URL.

### 3.2 Messages with Onshape: `print/static/print_onshape.js`

- On load, in Onshape mode, it posts `applicationInit` with the document, workspace and
  element ids. It validates incoming messages against the `server` the panel was opened
  with, as Onshape's documentation asks; it falls back to `*.onshape.com` only when
  `server` is absent.
- On entering Parts, it arms an unbounded `requestSelection` with
  `entityTypeSpecifier: ['BODY']`. Each answer from Onshape is passed to one function,
  `partSelectionsFromMessage(message) -> [{partId?, selectionId?, occurrencePath?, name?}]`.
  It is the only place that knows the shape of Onshape's selection messages. That shape is
  not documented, so the function accepts the field names the CNC code has seen
  (`selectionId`, `entityId`, `partId`) and the ones a recording shows. Its node tests use
  the recorded messages once they exist.
- On leaving Parts, it sends `stopRequest`.
- **Add from another document…** sends `openSelectItemDialog` with `selectParts: true,
  selectMultiple: true`. Each `itemSelectedInSelectItemDialog` adds a part (document,
  version or workspace, element, `partName`, `idTag`). Closing the dialog sends
  `closeSelectItemDialog`.
- **Ruling:** both ways feed the same list. The click selection is the everyday way. The
  dialog is the reliable fallback, and the only way to pick parts from another document.

### 3.3 Resolving and exporting: `print/onshape_parts.py`

`POST /print/onshape/parts` receives the panel's Onshape context and the raw selections. It
answers with the resolved parts:

```
{"parts": [{"ref": "<opaque id>", "name": str, "size_mm": {x,y,z}, "triangles": int,
            "source": {"documentId", "wvm", "wvmId", "elementId", "partId"}}],
 "errors": [{"name"?, "message"}]}
```

Resolution rules:

- **The element type** is learned once per page with
  `GET /documents/d/{did}/{wvm}/{wvmid}/elements?elementId={eid}`, and cached in the
  session.
- **In a Part Studio**, a selection's part id is used directly. When only a selection id
  is present, `GET /parts/d/{did}/{wvm}/{wvmid}/e/{eid}` is called once and the part is
  matched by id.
- **In an Assembly**, `GET /assemblies/d/{did}/{wvm}/{wvmid}/e/{eid}` (one call, cached per
  page) maps the selected occurrence to its instance's source document, version or
  microversion, element and part id. **Ruling:** the part is exported in its own Part
  Studio's frame, ignoring its pose in the assembly. For printing, only the part's shape
  matters; the student orients it on the plate in Layout.
- **From the dialog**, `idTag` is tried as the part id. Onshape does not document whether
  the two are the same. If the export fails, the part list for that element is fetched and
  the part is matched by `partName`. The first recording settles which case holds.

Export, one part at a time:

- `GET /parts/d/{did}/{wvm}/{wvmid}/e/{eid}/partid/{pid}/stl?mode=binary&units=millimeter`,
  sent with `allow_redirects=False`.
- The 307 is followed by hand, with authentication re-attached only when the target host
  ends in `.onshape.com`. This is the same rule as the test bed's `part-export` scenario;
  the helper lives in `print/onshape_parts.py`, and the test bed imports it from there.
- **Ruling:** one export per part, not the Part Studio endpoint's zip of several parts. Its
  file naming is undocumented, and the per-part call is deterministic. The production app
  is public, so its calls cost nothing. The development app's calls are counted by the
  test bed's ledger when recording.

Each exported mesh is checked with `print.slicer.stl_bounds`: it must have triangles and a
size over 0.1 mm. It is stored by the **part store**.

### 3.4 Part store: `print/part_store.py`

- Exported meshes live on disk under the app's upload folder, in a directory per print
  session id. They are indexed by `ref`, an opaque random id handed to the browser, and
  hold the source and the mesh's footprints (section 4.2).
- They expire one hour after last use. A sweeper runs alongside the job pool's.
- **Ruling:** a part is exported once, when selected, and reused for every later slice. A
  **Refresh from Onshape** button on the Parts step re-exports every part, for when the
  student has edited the model meanwhile.
- Limits: 20 distinct parts per session, 50 MB of meshes per session. Beyond them the
  student sees a sentence saying so.

### 3.5 Errors the student can see

| Cause | Message |
|---|---|
| Not signed in to Onshape | the existing Connect flow |
| A selection that is not a solid part | "Only solid parts can be printed: <name> was skipped." |
| Export failed | "Onshape could not export <name>. Try again, or Refresh from Onshape." |
| Allowance exhausted (402, development app only) | "Onshape refused the export (API limit reached)." |
| Too many parts or too much data | "Up to 20 different parts per print." / "These parts are too large to slice together." |

## 4. Placement on the plate

### 4.1 What the Orca spike established

From the spike, observed on Fri 10-09:

- With `--arrange 0 --orient 0`, Orca keeps every part exactly where it is placed, within
  0.01 mm, and only drops each part onto the plate.
- One slice can hold several parts.
- A part entirely off the plate is **silently left out**.
- Overlapping parts fail with return code -101; a part crossing the plate edge fails with
  -52; a part with no flat face on the plate fails with -100.
- Orca's automatic brim can be about 17.6 mm wide around a tall part.
- `--rotate` flags are unusable.
- Writing our own 3MF with one object per part and a transform per build item works.

### 4.2 The placement model

A **copy** is one instance of a part on the plate. Each copy has:

- `ref`, the part;
- `orientation`, one of six: which axis of the part points down, `+z` (as modelled), `-z`,
  `+x`, `-x`, `+y`, `-y`;
- `angle`, degrees about the vertical axis, any value from 0 to 359;
- `x, y`, the centre of the copy's footprint on the plate, in millimetres from the plate's
  origin.

For each part and each of the six orientations, the server computes:

- the **footprint**, the convex hull of the mesh's vertices projected onto the plate after
  the orientation;
- the height.

It returns them with the part, so the browser can draw, rotate and check copies without
the mesh. Rotation by `angle` and translation happen in the browser and again on the server.

**Ruling:** six axis-aligned orientations rather than "pick a face". A face picker needs
the mesh in 3D in the Layout step, which the narrow panel makes hard; the six cover nearly
every FRC printed part. A part with no flat face down in an orientation fails at slicing
with -100, and the message says so.

### 4.3 Rules a placement must pass

These are checked in the browser while the student drags, and **again on the server**
before slicing; the server's check is the authority:

- **On the plate:** every footprint lies inside the printable area, read from the printer
  profile's `printable_area`, with a 3 mm margin.
- **Not too tall:** the height is within `printable_height`.
- **Apart:** no two footprints come closer than the spacing, 12 mm by default. **Ruling:**
  12 mm leaves room for a typical brim on each side; Orca's -101 still catches a larger one.
  The spacing is a constant in `print/plate.py` and is sent to the browser with the plate
  size, so there is one source.

The geometry (convex polygons, rotation, distance between polygons, containment) is written
once in Python (`print/plate.py`) and once in JavaScript (`print/static/plate_geometry.js`),
because the browser checks while dragging. **Ruling, a deliberate mirror:** the two
implementations share one set of test cases, a JSON file of polygons, placements and
expected verdicts that both test suites read. The pair cannot drift without a test failing.

### 4.4 Arrange

`arrangeCopies(copies, plate, spacing)` in `plate_geometry.js` places copies in rows by
their footprints' bounding boxes, largest first, left to right and front to back. It keeps
each copy's orientation and angle. It runs when parts are first added and when the student
presses Arrange. If a copy does not fit, it is left off the plate and drawn in red at the
side, and Next stays disabled. **Ruling:** a simple shelf arrangement, not Orca's arrange.
Orca's arrange also changes rotations, which would undo the student's choices.

### 4.5 The Layout step's interface

- The existing 2D plate canvas becomes interactive:
  - drag to move;
  - click to select a copy;
  - the selected copy shows rotate −90°, rotate +90°, an angle field, and a Lay flat menu
    with the six orientations named by the face that rests on the plate ("as modelled",
    "upside down", "on its side (x)" …);
  - delete and duplicate.
- Copies are drawn as their footprints, red when they break a rule. A sentence under the
  canvas names the first broken rule.
- Keyboard: arrows move the selected copy 1 mm (10 mm with Shift); R rotates 90°.
- The 3D view (`print_viewer.js`) shows the placed copies on the plate in Layout as well as
  in Preview, loading each part's mesh once from `GET /print/parts/<ref>.stl`. **Ruling:**
  the 3D view is for checking only; all editing happens in the 2D view, which works in the
  narrow panel.

### 4.6 Slicing a placement: `print/plate_3mf.py`

- `POST /print-job` now takes `{copies: [...], filament, process, overrides}`. The server
  validates the placement (4.3) and the profile choice (6), then queues the job. A bad
  placement gets a 400 naming the rule.
- The worker writes a 3MF (3MF core specification) to the job's scratch directory:
  - one `<object>` mesh per part, named after the part;
  - one `<build><item>` per copy, whose transform applies the orientation, the angle and
    the position. The copy's footprint centre goes to `(x, y)` and its lowest point to z = 0.
- It runs Orca with `--arrange 0 --orient 0`, with the job's profile files (section 6).
  The wrapper in `print/slicer.py` gains `slice_plate(model_3mf, profiles, output_dir)`.
  `slice_stl` stays for the sample part.
- **After slicing,** `Metadata/plate_1.json` in the output must list one object per copy.
  A missing copy fails the job with "A part was left off the plate", which is the guard
  against Orca's silent drop.
- **Orca return codes** map to messages:

| Code | Message |
|---|---|
| -101 | "Parts are too close together; spread them out." |
| -52 | "A part crosses the edge of the plate." |
| -100 | "A part has no flat face on the plate; choose another Lay flat." |
| -50 | "No part is fully on the plate." |
| other | the existing generic slicing error |

- The delivered file is named
  `<first part name>[+N more]-<YYYYMMDD-HHMM>.gcode.3mf`, using the browser's local time,
  which the browser sends with the job. Names are reduced to letters, digits, `-` and `_`,
  at most 40 characters. **Ruling:** this covers the part and the local time from the
  owner's naming wish; who started it is left to milestone 2.

### 4.7 Preview

Preview shows the plate in 3D as sliced, from the placement, plus the existing summary. The
per-copy object list from `plate_1.json` is checked against the placement as above.

## 5. Multiple parts

Multiple parts are what sections 3 and 4 already describe. The rules:

- up to 20 distinct parts, a quantity of 1 to 20 each, at most 50 copies per plate;
- one plate only. **Ruling:** several plates are out of scope; when the copies do not fit,
  the message suggests lowering quantities and printing twice;
- a slice of many copies takes longer. The job pool's timeout stays, and the slice
  status line already shows elapsed time.

## 6. Profiles

### 6.1 What the team can choose

The team YAML's `printing:` section, which already holds `pairing_code`, gains:

```yaml
printing:
  pairing_code: ...            # existing
  printer: "Bambu Lab H2S 0.4 nozzle"
  filaments:                   # first is the default
    - "Bambu PLA Basic @BBL H2S"
    - "Bambu PETG HF @BBL H2S"
  processes:                   # first is the default
    - "0.20mm Standard @BBL H2S"
    - "0.16mm High Quality @BBL H2S"
  allow_overrides: true        # students may change infill, walls, supports, brim
```

The names are Orca's own profile names for that printer. A team without these keys gets
the current fixed set: the printer `Bambu Lab H2S 0.6 nozzle`, the filament
`Generic PETG @BBL H2S`, the process `0.24mm Balanced Quality @BBL H2S 0.6 nozzle`.

### 6.2 The profile catalog

`print/scripts/flatten_orca_profiles.py` today flattens three fixed profiles. It now
flattens a **catalog**, written to `print/profiles/catalog/`:

- every printer profile of the Bambu Lab H2S family (`Bambu Lab H2S 0.2/0.4/0.6/0.8 nozzle`);
- every process and filament profile in Orca's BBL folder whose `compatible_printers`
  names one of them;
- `index.json`, listing each profile's name, kind, file and compatible printers.

The existing three files stay as the defaults. **Ruling:** only the team's own printer
family is flattened, the Bambu H2S. Another family is a one-line change to the script's
list, and the per-family structure is ready for the other brands that come after
shipping. The size of the catalog is measured in the first build task, and if it is over
5 MB, only the filament families in `index.json`'s allowlist are kept.

`print/print_config.py` reads the team's `printing:` section against the catalog:

- unknown names are warnings shown on Setup and logged in the `config` event, and fall back
  to the defaults;
- a filament or process not compatible with the chosen printer is dropped with a warning.

The checks happen when the config loads, not at slice time.

### 6.3 Student overrides

When `allow_overrides` is true (the default), Setup offers four settings over the chosen
process:

| Setting | Orca key | Choices |
|---|---|---|
| Infill | `sparse_infill_density` | 10, 15, 20, 30, 40, 60, 100 % |
| Walls | `wall_loops` | 2, 3, 4, 6 |
| Supports | `enable_support`, `support_type` | off; on (tree, auto) |
| Brim | `brim_type` | auto; off; outer only |

The server accepts only these keys and values. The worker writes the job's process file
as the chosen catalog profile with the overrides merged, in the job's scratch directory.
**Ruling:** four settings that FRC students actually change; anything more belongs in a
team's own process profile.

### 6.4 Setup step

Setup shows:

- the printer, read-only;
- a Filament menu and a Print settings (process) menu, each holding the team's list;
- the four overrides, when allowed;
- any config warnings.

The summary chips show the filament and process.

## 7. Error handling

Every error the student sees is one plain sentence, and is also sent as a `client_error`
print event (2.1). Server failures log the cause with the session id; the browser never
receives a stack trace or an upstream body.

## 8. Testing

### 8.1 Without Onshape

- Python unit tests:
  - id validation and context parsing in `print_page`;
  - selection resolution (Part Studio, Assembly, dialog) against synthetic cassettes in the
    test bed's replay adapter;
  - the export redirect rule;
  - the part store's limits and expiry;
  - footprints for the six orientations;
  - placement rules (shared JSON cases);
  - the 3MF writer (transforms checked by reading the 3MF back);
  - config reading against the catalog;
  - override validation;
  - file naming;
  - print events, including that no token, cookie or pairing code reaches a log line.
- Node tests:
  - `plate_geometry.js` (the shared JSON cases, plus arrange);
  - `partSelectionsFromMessage`;
  - layout interaction helpers.
- `make test` (with Orca):
  - a two-part placement slices and both copies are in `plate_1.json`;
  - a rotated part's footprint after slicing matches the placement within 0.5 mm;
  - an overlapping placement is refused before Orca runs;
  - a profile with overrides slices.

### 8.2 With the test bed

Browser scenarios on the replay development server, against the fake Onshape host:

- select two parts → both listed with sizes;
- set quantity 2 → three copies arranged;
- rotate one, then lay it on its side;
- slice;
- download.

Until recordings exist, these run against synthetic message logs and cassettes written from
the docs, marked synthetic. After the owner's validation run (section 10) they run against
the real recordings, and the synthetic ones are deleted.

### 8.3 New test bed scenarios

The test bed gains, in its own scenario list:

- `print-select-parts`: the print page's own selection, in `tb-two-parts`;
- `print-dialog-parts`: the dialog;
- `print-assembly-part`: in `tb-assembly`;
- `print-export`: the export calls the print path makes.

They replace the checklist strip's raw probes for the print page, once the print page sends
its own messages.

## 9. Changes outside `print/`

| File | Change | Why it cannot live in `print/` |
|---|---|---|
| `frc_cam_gui_app.py` | none beyond the test bed's | the print blueprint already registers itself |
| `team_config.py` | none: `printing:` already passes through | — |
| `config_validation.py` | accept the new `printing:` keys without warnings | it validates the whole YAML; it delegates the printing section to `print/print_config.py` |
| `docs/3D_PRINTING.md` | support section; profiles; placement | the developer guide |
| `testbed/` | the four new scenarios; imports the redirect helper from `print/onshape_parts.py` | the test bed's own scenario list |

## 10. The validation run with the owner

The owner said the work ends with a quick run together, to record and find problems. The
agent prepares a checklist for it:

1. The owner adds the credentials and the test folder (test bed spec, section 13).
2. The agent runs `build-docs` and the live API check.
3. The agent runs the automated Onshape UI run. If it is stopped, the owner does an Onshape
   checkpoint instead.
4. The recordings replace the synthetic ones. Every browser scenario runs in replay, and
   the findings go to a handoff note.

## 11. For the owner afterwards

- A separate right-panel extension for printing that opens `/print` directly (section 0).
- Whether names of who started a print belong in file names (milestone 2).
- Whether to allow STL upload in full-page mode.
- The profile catalog's size and whether other printer families are wanted.

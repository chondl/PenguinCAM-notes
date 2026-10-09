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
might choose otherwise. The owner reviews them after the fact. The milestone's new work ends
at downloading a file. **Send to Printer**, which the print wizard already offers
(`chooseAction('printer')` in `print/static/print_wizard.js`, `printer_panel.js`), keeps
working with the new multi-part jobs (section 4.6); improving it is milestone 2.

Built on the [Onshape test bed](2026-10-09-onshape-test-bed-design.md). Facts about Onshape
come from a docs brief (Onshape's public documentation and OpenAPI, Fri 10-09); facts about
Orca come from a spike and from the adversarial review's experiments in the container (Orca
2.4.2, aarch64 Linux, 6 cores, Fri 10-09). Where a fact depends on behaviour Onshape does not
document, the design says so, and the first recorded run settles it.

### Terms

Each term below has one meaning throughout this design.

- **Page id (`pid`):** a random id the print page makes in the browser on each page load
  (section 2.1). It replaces the "print session id" of the first draft.
- **Flask session:** the app's signed session cookie, shared by every PenguinCAM panel in
  the browser. "Session" alone is not used.
- **Onshape sign-in:** the OAuth credentials the Flask session holds.
- **Part:** one Onshape part the student picked, exported once to a mesh.
- **Copy:** one placement of a part on the plate (orientation, angle, position). A part
  with quantity 3 has three copies. "Instance" is kept for Onshape assembly instances.
- **Plate:** the printer's build surface. The existing code calls its size `bed_mm`.
- **Part store, part `ref`, catalog, print event:** defined in sections 3.4, 3.4, 6.2 and
  2.1.

## 0. Separation from the CNC path

The owner wants the 3D printing path kept strongly apart from the CNC path, and may one
day split it into its own app. Everything in this design follows four rules:

1. **All new code lives under `print/`**: Python modules, routes in the print blueprint,
   templates, styles (`print/static/print_layout.css`; the page keeps loading the shared
   `static/wizard.css` as today) and scripts. The few touches outside `print/` are listed,
   each with why, in section 9.
2. **The print path talks to Onshape through its own module**, `print/onshape_parts.py`.
   It gets the signed-in Onshape client through a function handed to it by
   `init_print_routes`, the way `print/routes.py` already receives the limiter, the token
   manager and the session gate in `ctx`. It adds one small transport method to the shared
   client (section 3.3); everything Onshape-specific about printing stays in `print/`.
   Sign-in and the Flask session stay shared, because the panel is one app with one
   sign-in.
3. **The print page does its own Onshape messaging**, in `print/static/print_onshape.js`.
   It never loads or calls `static/source_onshape.js`. It reuses that file's proven
   selection pattern by writing it again (section 3.2), not by importing it.
4. **Configuration for printing is read by `print/print_config.py`** from the raw
   `printing:` section of the team YAML. `team_config.py` keeps passing the section
   through untouched; one small helper there finds the section (section 9).

If the print path later becomes its own app, it takes `print/` and the touches in
section 9.

**Recommended, not done:** a separate Onshape right-panel extension that opens `/print`
directly, so a student does not start in the CNC page. That is a change to the Onshape app's
registration, which only the owner can make (section 12).

## 1. What a student does

1. In Onshape, in a Part Studio or an Assembly, open the PenguinCAM panel and choose
   **3D Printing**. The print wizard opens: Setup, Parts, Layout, Preview, as today.
2. **Setup** shows the team's printer and offers the team's filaments and print settings
   (section 6). Defaults are preselected.
3. **Parts:** click a part in Onshape's model or parts list; it is added to the list with
   its name, size and a quantity (1 by default). Click the next part to add it too.
   **Add from another document…** opens Onshape's own part picker for parts elsewhere. A
   part can be removed or its quantity changed in the list.
4. **Layout:**
   - A top-down view of the plate shows every copy's footprint, placed automatically.
   - Drag a copy to move it, or rotate it by 90° or by any angle about the vertical axis.
   - **Lay flat** buttons choose which face of the part rests on the plate.
   - A copy that does not fit, or comes too close to another, is drawn in red, and Next is
     disabled with a sentence saying why.
   - **Arrange** places everything again automatically.
5. **Preview:** slicing starts, as today, and the plate is shown in 3D with every copy where
   it was placed, plus print time, filament and layer count. **Download** gives a
   `.gcode.3mf` named after the parts and the time. Google Drive and Send to Printer work as
   today.

The full-page (upload) mode keeps the fixed sample part, unchanged. **Ruling:** uploading
an STL in full-page mode is out of scope; the milestone is about Onshape.

## 2. Supportability on the Onshape web side

The owner's goal: any support question about the print path can be answered from the
server's logs, without asking the team for anything.

### 2.1 Print events

`print/events.py` writes one log line per **print event** through the app's existing
`log()`, so Railway's log viewer shows it. Every print event except `request` is also passed
to `metrics.log_event('print_<name>', team_number=…, metadata=…)`, so the existing metrics
pipeline counts it. Line format:

```
[PRINT] <event> pid=<page id|-> team=<n|-> job=<id8|-> key=value …
```

- **Page id (`pid`):** 12 lowercase hex characters drawn with `crypto.getRandomValues` when
  the print page loads, held in page memory only, and sent with every print request in the
  `X-Print-Page` header. The server accepts it only if it matches `^[0-9a-f]{12}$`; a print
  API request without a valid page id gets a 400. A reload or a second Onshape tab makes a
  new page id, so two tabs never share one. **Ruling:** the page id is a log correlation
  key and the owner of stored parts (section 3.4), never an authority: the part `ref` is the
  bearer handle.
- **`team=`** is the team number, or `-` when the Flask session holds the default config
  (`session['using_default_config']`), because the defaults report team 6238.
- **Ruling:** no Onshape user id, name or email in print events. The page id plus the team
  number is enough to follow one student's attempt, and it keeps students' identity out of
  logs. Who started a print is decided in milestone 2 with file names.
- **Values** are explicit fields, never serialized objects. **One quoting rule:** a value
  made only of letters, digits and `._:/@+-` is written bare; any other value (a space, a
  newline, a quote, an `=`, anything non-ASCII) is written JSON-encoded with `json.dumps`
  (ASCII only), so no value can end a line or forge a `[PRINT]` line. Onshape document,
  element and part ids may appear. Tokens, cookies, keys, download tokens, full job ids and
  pairing codes never do; they are not passed to `events.py` at all. This strengthens the
  app's rule of no secrets and no personal data in logs.

Events, each with its fields:

| Event | When | Fields |
|---|---|---|
| `page` | the print page's first call, `POST /print/page` | source, theme, has_onshape_context, wvm, configured (yes/no), server, config (team or default) |
| `config` | team config resolved for printing | printer, filaments offered, processes offered, skipped names, error |
| `select` | parts arrive from Onshape | via (selection or dialog), count, element type |
| `export` | one part exported | part id, element id, bytes, triangles, size_mm, calls, ms, outcome |
| `export_failed` | export failed | part id, status, reason |
| `layout` | the student enters Preview | copies, parts, plate fill percent, any rotation not a multiple of 90 |
| `slice_queued`, `slice_done`, `slice_failed` | job transitions | job, copies, triangles, filament, process, overrides, seconds, Orca code, reason |
| `deliver` | download, Drive or Send to Printer | job, action (`download`, `drive`, `printer`), outcome |
| `client_error` | an error message shown in the browser | step, message (as shown), code |
| `request` | every print-blueprint request except static files | method, route rule (for example `/print-job/<job_id>`), status, ms |

- **`request` is a log line only.** It writes no metrics row: a row per request would start
  a thread and a SQLite write for every poll and SSE connection (`metrics.py`). It logs the
  route rule, never the path, so no full job id (a bearer of the download through
  `/print-job/<id>`) reaches a log.
- **The slice events replace the existing `print_job` metric** (`print/routes.py`), so one
  name counts slices. The docstrings that still say "fixed set", "sample part" or "Stage 1:
  one fixed printer" (`print/slicer.py`, `print/__init__.py`, the template comment) are
  updated in the same change.

The browser reports the errors it shows through `POST /print/client-event` with
`{step, message, code}`. Every user-facing error in the print wizard goes through one
helper, `showError(step, message, code)` in `print/static/print_wizard.js`, which shows the
sentence and posts it; the tests check that no other code path writes to the error line.
The route accepts only those three fields, limits each to 300 characters, and sits behind
the print page's session gate.

**Route limits.** Each print route states its own limit rather than inheriting the global
"200 per hour":

| Route | Gate | Limit |
|---|---|---|
| `GET /print` | existing | existing (200 per hour) |
| `POST /print/page` | session gate | 10 per minute |
| `POST /print/onshape/parts` | Onshape sign-in | 20 per minute |
| `GET /print/parts/<ref>.stl` | session gate, owning page id | 120 per minute |
| `POST /print-job` | existing | existing (3 per minute) |
| `POST /print/client-event` | session gate | 30 per minute |
| `POST /print/deliver` | session gate | 30 per minute |
| `GET /print/part` | none: it serves only the sample part, for the upload mode; the Onshape flow never calls it | existing (200 per hour) |

The session gate is the existing `require_session` in `ctx`. The Onshape sign-in gate is the
app's `_has_onshape_session`, handed in through `init_print_routes` as it already is to
`init_printer_routes`: `require_session` alone also passes the anonymous upload flow's
`app_verified` sessions, which have no Onshape sign-in.

### 2.2 Reading the logs

`docs/3D_PRINTING.md` gains a section on support: how to filter Railway's logs for
`[PRINT]` and one `pid`, and what each event means. **Ruling:** no new log store or
dashboard; Railway's log search is the tool until it proves too little.

## 3. The model from Onshape

### 3.1 The print page knows its Onshape context

Today `/print` sees the Onshape ids only inside its `return` link, which carries the CNC
panel's full query (`static/wizard.js`). `print_page` now reads six fields from the
`return` URL's query on the server: `documentId`, `workspaceId`, `versionId`,
`microversionId`, `elementId`, `server`, plus `configuration` when present.

- Each id must be 24 hex characters or an unsubstituted `{$…}` placeholder; anything else
  is dropped.
- `server` must be an `https://` origin whose host is `onshape.com` or ends in
  `.onshape.com`; otherwise it is `https://cad.onshape.com`, the CNC panel's default.
- The raw values go to the template as `window.PenguinCAM.onshape`, the way the CNC panel
  passes them, because Onshape's messages tolerate a literal `{$workspaceId}` but not an
  empty one.
- **The REST address** is resolved on the server, per request, exactly as the CNC export
  does: each id is cleaned with the same placeholder rule as `_clean_onshape_id`, and the
  path segment comes from the existing static `OnshapeClient._wvm_path(did, w, v, m)`, which
  prefers the workspace, then the version, then the microversion. The print path calls that
  static method rather than writing a second copy. A context with no usable workspace,
  version or microversion gets the sentence "Open this panel from a Part Studio or Assembly
  tab."
- `server` is used for the message origin check (3.2) and logged in the `page` event. REST
  calls go to the client's API base, as the CNC path's do.

No CNC code changes: the CNC page's link already carries the return URL.

### 3.2 Messages with Onshape: `print/static/print_onshape.js`

Every message the print page sends carries `documentId`, `workspaceId` and `elementId`
from `window.PenguinCAM.onshape`, as the docs require of every message.

- **On load,** in Onshape mode, it posts `applicationInit`. It accepts incoming messages
  only from the `server` origin the panel was opened with.
- **Selection, the CNC panel's proven pattern.** On entering Parts, `armPartSelection()`
  posts `requestSelection` with `filterType: 'simple'`, `entityTypeSpecifier: ['BODY']`,
  `bodyTypeSpecifier: ['SOLID']`, `requiredSelectionCount: 1` and a fresh `messageId`.
  The message handler:
  - acts only on `REQUESTED_SELECTION` and ignores Onshape's generic `SELECTION` events;
  - ignores answers while the Parts step is not active;
  - ignores a `PENDING` status;
  - on an empty selection (a deselection or a timeout), re-arms and changes nothing;
  - otherwise passes the message to `partSelectionsFromMessage(message)`, adds the part,
    and re-arms.

  So the Parts list grows by one part per click, and parts leave it only through the
  list's remove button; it does not mirror Onshape's highlight. A part already in the list
  is not added twice. This is the pattern `static/source_onshape.js` uses for faces in
  Onshape today, written again for bodies in the print path's own file.
- `partSelectionsFromMessage(message) -> [{partId?, selectionId?, occurrencePath?, name?}]`
  is the only place that knows the shape of Onshape's selection answers. That shape is not
  documented, so it accepts the field names the CNC code has seen (`selectionId`,
  `entityId`, `partId`, `bodyId`) and the ones a recording shows. Its node tests use the
  recorded messages once they exist.
- **On leaving Parts,** it marks the step inactive and sends `stopRequest`.
- **Add from another document…** sends `openSelectItemDialog` with `selectParts: true,
  selectMultiple: true`. Each `itemSelectedInSelectItemDialog` adds a part (document,
  version or workspace, element, `elementConfiguration`, `partName`, `idTag`). On
  `selectItemDialogClosed`, which Onshape sends when the dialog closes for any reason, the
  page re-arms the click selection. Leaving Parts with the dialog open sends
  `closeSelectItemDialog`.
- **Ruling:** both ways feed the same list. The click selection is the everyday way. The
  dialog is the fallback, the only way to pick parts from another document, and the way to
  pick a specific configuration (3.3). Onshape's unbounded selection mode is recorded once
  in the validation run for reference but is not used.

### 3.3 Resolving and exporting: `print/onshape_parts.py`

`POST /print/onshape/parts` receives the panel's Onshape context and the raw selections. It
answers with the resolved parts:

```
{"parts": [{"ref": "<opaque id>", "name": str, "size_mm": {x,y,z}, "triangles": int,
            "source": {"documentId", "wvm", "wvmId", "elementId", "partId",
                       "configuration"?, "linkDocumentId"?}}],
 "errors": [{"name"?, "message"}]}
```

Resolution rules:

- **The element type** is learned once per element with
  `GET /documents/d/{did}/{wvm}/{wvmid}/elements?elementId={eid}` (in Onshape's OpenAPI,
  with `elementId` as a query parameter). It and the assembly definition below are kept in
  an in-process cache keyed by document, wvm id, element and configuration, for ten
  minutes; never in the Flask session cookie, which has no room for them.
- **Configurations.** Onshape's export, parts and assembly endpoints all take a
  `configuration` parameter, and the evidence gives a configuration string on every path,
  so **Ruling:** the print path passes the configuration through rather than refusing
  configured parts:
  - dialog picks carry `elementConfiguration`;
  - assembly instances carry `configuration` in the assembly definition;
  - click selections in a Part Studio use the panel URL's `configuration` parameter, which
    Onshape fills from `{$configuration}` once the owner adds it to the registered panel URL
    (section 12).

  Until then, a click selection in a Part Studio arrives with no configuration. The server
  then reads `GET /elements/d/{did}/{wvm}/{wvmid}/e/{eid}/configuration` once (cached with
  the element type). If the Part Studio defines configuration parameters, it refuses the
  click selection with "This Part Studio has configurations. Use Add from another document…
  to pick the configuration to print." It never silently exports the default
  configuration.
- **In a Part Studio,** a selection's part id is used directly. When only a selection id
  is present, `GET /parts/d/{did}/{wvm}/{wvmid}/e/{eid}` is called once and the part is
  matched by id.
- **In an Assembly,** `GET /assemblies/d/{did}/{wvm}/{wvmid}/e/{eid}` (one call, cached as
  above) maps the selected occurrence to its instance's source document, version or
  microversion, element, part id and configuration. Occurrences inside a subassembly are
  followed through the definition's `subAssemblies`. A part from another document is
  exported with `linkDocumentId` set to the open document. An instance with
  `isStandardContent` is refused with "<name> is standard content (hardware) and is not
  printed." **Ruling:** the part is exported in its own Part Studio's frame, ignoring its
  pose in the assembly. For printing, only the part's shape matters; the student orients it
  on the plate in Layout.
- **From the dialog,** `idTag` is tried as the part id. Onshape does not document whether
  the two are the same. If the export fails, the part list for that element is fetched and
  the part is matched by `partName`. If more than one part has that name, the pick is
  refused with "Two parts are named <name>; rename one in Onshape." The first recording
  settles which case holds.

Export, one part at a time:

- `GET /parts/d/{did}/{wvm}/{wvmid}/e/{eid}/partid/{pid}/stl?mode=binary&units=millimeter`
  with an explicit print tessellation, `chordTolerance=0.00005` (metres, so 0.05 mm) and
  `angleTolerance=0.1309` (radians, 7.5°), plus `configuration` and `linkDocumentId` when
  set, sent with `allow_redirects=False` and `Accept: application/vnd.onshape.v1+octet-stream`
  on the request and every hop. **Ruling:** Onshape's OpenAPI gives the units (chord in
  metres, angle in radians and under π/2) but not the server's defaults, so the print path
  never relies on them. 0.05 mm is under half the finest layer step and far under the
  0.4 mm nozzle; 7.5° gives every hole 48 segments. Typical FRC parts stay well under the
  per-part triangle cap (section 5); the validation run (section 11) records the triangle
  counts the test documents actually export. Both values are constants in `print/limits.py`.
- The 307 is followed by hand, with authentication re-attached only when the target host
  ends in `.onshape.com`. This is the same rule as the test bed's `part-export` scenario;
  the redirect helper lives in `print/onshape_parts.py`, and the test bed imports it from
  there.
- **Transport.** `_make_api_request` always prefixes the API base, so it cannot fetch the
  redirect's absolute URL, and the follow-up needs the bearer token or the API keys.
  **Ruling:** `OnshapeClient` gains one method, `request_absolute(method, url, **kwargs)`,
  which applies the same authentication and the same 401 refresh-and-retry, and
  `_make_api_request` becomes a call to it with the API base prefixed. Authentication stays
  in one place, and no token leaves the client.
- **The download is streamed** with a byte cap (section 5): beyond the cap the export stops
  and the student sees "<name> is too detailed to print here (over 150,000 triangles)."
- **Ruling:** one export per part, not the Part Studio endpoint's zip of several parts. Its
  file naming is undocumented, and the per-part call is deterministic. The production app
  is public, so its calls cost nothing. The development app's calls are counted by the
  test bed's ledger when recording.

Each exported mesh is read with numpy (already a dependency): it must have triangles, at
most the per-part triangle cap, and a size over 0.1 mm. The footprints (4.2) are computed
from the same array. The existing pure-Python `print.slicer.stl_bounds` stays for the
sample part only: on a one-million-triangle STL it took 1.1 s and 557 MB peak memory,
against 0.27 s for the numpy read (measured Fri 10-09). The mesh is then stored by the
**part store**.

Onshape tokens refreshed during these calls are saved by the app's existing end-of-request
hook (`_persist_onshape_tokens`, `frc_cam_gui_app.py`), which runs for every request,
blueprints included, as long as the client was obtained through
`session_manager.get_client`. The function `init_print_routes` hands to the print path
wraps exactly that call, so no separate persistence step is needed.

### 3.4 Part store: `print/part_store.py`

- Each exported mesh is stored on disk under the app's upload folder in a directory named
  by its **`ref`**, a random id of 128 bits (`secrets.token_urlsafe(16)`), the same kind of
  bearer handle as the job ids. A `ref` is looked up in the store's index, never joined
  into a path from the request.
- Each entry records its owning page id, its source (3.3), its footprints (4.2), its
  triangle count and its last use. A request whose page id is not the entry's owner gets a
  404, so a part list cannot leak between tabs.
- **Ruling:** a part is exported once, when selected, and reused for every later slice. A
  **Refresh from Onshape** button on the Parts step re-exports every part **under new
  refs** and the browser swaps them in, so a queued job never reads a mesh that is being
  replaced.
- Entries expire one hour after last use. A sweeper runs alongside the job pool's. The
  index lives in process memory, so on start and on each sweep the store also deletes
  directories under its folder that have no index entry and are older than one hour.
- Limits: section 5.

### 3.5 Errors the student can see

| Cause | Message |
|---|---|
| Not signed in to Onshape when the print page loads | `print_page` sends the panel back to the CNC page, as today, where Connect is offered |
| Onshape sign-in dies mid-wizard (the app dropped dead credentials) | "Your Onshape sign-in expired. Go back, Connect, and return to 3D Printing." with a link to the return URL |
| A selection that is not a solid part | "Only solid parts can be printed: <name> was skipped." |
| Standard content | "<name> is standard content (hardware) and is not printed." |
| A configured Part Studio without a configuration | see 3.3 |
| Two parts with the dialog's name | "Two parts are named <name>; rename one in Onshape." |
| Export failed | "Onshape could not export <name>. Try again, or Refresh from Onshape." |
| Allowance exhausted (402, development app only) | "Onshape refused the export (API limit reached)." |
| A limit in section 5 | the sentence listed there |

## 4. Placement on the plate

### 4.1 What the Orca experiments established

From the spike and the adversarial review's experiments, observed on Fri 10-09:

- With `--arrange 0 --orient 0`, Orca keeps every part exactly where it is placed, within
  0.01 mm, and only drops each part onto the plate.
- One slice can hold several parts.
- A part entirely off the plate is **silently left out**.
- Overlapping parts fail with return code -101; a part crossing the plate edge fails with
  -52; a part with no flat face on the plate fails with -100.
- Orca's automatic brim can be about 16 to 18 mm wide around a tall part. **Brims that
  would collide are trimmed, not refused:** two 20 mm wide, 80 mm tall pins 2 mm apart
  slice with return code 0, each brim cut where they meet; at 12 mm apart the brims stop
  0.7 mm short of each other.
- Copies that share one 3MF `<object>` lose their names: copies after the first are listed
  with an empty name in `plate_1.json` and print under `; printing object  id:0`, which
  the printer's skip-object list shows blank. One `<object>` per copy, each with its own
  name, gives every copy its own named entry and G-code label.
- A 30-copy plate (30 hubs, 36 mm across, 512 triangles each, **15,360 triangles in all**)
  sliced in 8.7 s with 814 MB peak memory. Triangle count drives time and memory: the plan
  review's plate of 30 copies at 249,960 triangles in all took 43 s and 716 MB (732,988 KB),
  and at 999,960 triangles 5 min 52 s and 1,087 MB (1,113,140 KB), past the slice timeout
  (section 5).
- Student overrides merged into a process profile take effect: the G-code header shows the
  chosen infill, walls, supports and brim.
- `--rotate` flags are unusable.

### 4.2 The placement model

Each copy has:

- `ref`, the part;
- `orientation`, one of six: which axis of the part points down, `+z` (as modelled), `-z`,
  `+x`, `-x`, `+y`, `-y`;
- `angle`, degrees about the vertical axis, any value from 0 to 359;
- `x, y`, the centre of the copy's footprint on the plate, in millimetres from the plate's
  origin.

For each part and each of the six orientations, the server computes:

- the **footprint**, the convex hull (shapely, already a dependency) of the mesh's vertices
  projected onto the plate after the orientation. Opposite orientations share one
  projection, mirrored, so three hulls serve all six;
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
- **Apart:** no two footprints come closer than the spacing, **5 mm**. **Ruling:** Orca
  trims brims that would collide instead of refusing the plate (4.1), so the spacing does
  not have to hold two full brims. 5 mm keeps at least about 2.5 mm of brim on each part
  between neighbours, leaves a gap the student can see in the top-down view, and keeps
  clear of Orca's -101 for touching or overlapping parts. A 12 mm spacing would cost plate
  area for no gain. The spacing is a constant in `print/plate.py` and is sent to the
  browser with the plate size, so there is one source.

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
- **Ruling:** Layout has no 3D view and no keyboard shortcuts. Editing happens in the 2D
  view, which works in the narrow panel; Preview's 3D view (4.7) is where the student
  checks the result.

### 4.6 Slicing a placement: `print/plate_3mf.py`

- `POST /print-job` now takes `{copies: [...], filament, process, overrides, local_time}`.
  The server validates the placement (4.3), the limits (5) and the profile choice (6), then
  queues the job. A bad placement gets a 400 naming the rule.
- `JobPool.submit()` gains a payload argument, which the pool hands to the worker with the
  job id (`print/jobs.py`, `print/routes.py`); today the worker receives only the job id.
- The worker writes a 3MF (3MF core specification) to the job's scratch directory:
  - **one `<object>` mesh per copy**, named `<part name> #<n>`, the part name sanitized
    (below) and n counting from 1 for each sanitized name, so two different parts that are
    both named `Bracket` give `Bracket #1`, `Bracket #2`, `Bracket #3`, never two
    `Bracket #1` (a naming decision for the owner to confirm, section 12). **Ruling:** Orca blanks the names of copies that share an object (4.1); one object
    per copy gives every copy its own name in `plate_1.json`, in the G-code and in the
    printer's skip-object list. The 3MF grows with the number of copies, but it is only
    Orca's input;
  - one `<build><item>` per copy, whose transform applies the orientation, the angle and
    the position. The copy's footprint centre goes to `(x, y)` and its lowest point to z = 0.
- **Part names are sanitized** before they reach a 3MF object name, a file name or a G-code
  comment (Orca writes `; printing object <name>`, and the printer runs that file): they are
  reduced to the file-name character set, letters, digits, `-` and `_`, with other
  characters becoming `_`, at most 40 characters, and `part` if nothing is left. The
  writer XML-escapes attributes as well.
- It runs Orca with `--arrange 0 --orient 0`, with the job's profile files (section 6).
  The wrapper in `print/slicer.py` gains `slice_plate(model_3mf, profiles, output_dir)`.
  `slice_stl` stays for the sample part.
- **After slicing,** `Metadata/plate_1.json` must list exactly the object names the 3MF
  holds, each once. A missing or blank name fails the job with "A part was left off the
  plate", which is the guard against Orca's silent drop. The guard matches names, not a
  count.
- **Orca return codes** map to messages:

| Code | Message |
|---|---|
| -101 | "Parts are too close together; spread them out." |
| -52 | "A part crosses the edge of the plate." |
| -100 | "A part has no flat face on the plate; choose another Lay flat." |
| -50 | "No part is fully on the plate." |
| other | the existing generic slicing error |

- **The delivered file name** is
  `<first part name>[_plus<N>]-<YYYYMMDD-HHMM>.gcode.3mf`, for example
  `Bracket_plus2-20261009-1432.gcode.3mf` when two more parts share the plate. The part
  name is sanitized as above, so the whole name uses only letters, digits, `-` and `_`
  before the extension. The time is the browser's local time, sent as `local_time`; the
  server accepts it only if it matches `^\d{8}-\d{4}$` and otherwise uses the server's UTC
  time. The name never ends in `-j` and seven or eight hex digits before the extension,
  so it cannot be mistaken for the relay's job suffix (`print/printer_relay.py`).
  **Ruling:** this covers the part and the local time from the owner's naming wish; who
  started it is left to milestone 2.
- **Send to Printer** needs no new code path: the job registers its file with the token
  manager under the delivered name, and `POST /printer/jobs` already sends whatever file
  the token names, under that name. Sending is logged as a `deliver` event with action
  `printer`. Because the team chooses its printer and nozzle (section 6), a printer name
  that does not resolve fails closed (6.2), so a typo can never slice for the wrong nozzle
  and send that file to a real printer.

### 4.7 Preview

Preview shows the plate in 3D as sliced, from the placement: `print_viewer.js` loads each
part's mesh once from `GET /print/parts/<ref>.stl` and draws every copy with its transform,
plus the existing summary. The object names in `plate_1.json` are checked against the
placement as above.

## 5. Multiple parts and limits

Multiple parts are what sections 3 and 4 already describe. The rules:

- one plate only. **Ruling:** several plates are out of scope; when the copies do not fit,
  the message suggests lowering quantities and printing twice;
- a slice of many copies takes longer. **Ruling:** a plate slice gets 240 s before it is
  stopped; the sample part's slice keeps today's 120 s (`print/slicer.py`). The slice
  status line already shows elapsed time.

**Limits**, set from the measurements so that one job stays well inside the memory of the
single gunicorn process and the one Orca it runs (`Procfile`: one worker; the pool runs one
slice at a time):

| Limit | Value | Basis | Message |
|---|---|---|---|
| Triangles per part | 150,000 | half the per-job cap, so one part can still go on a plate twice; the export's tessellation (3.3) keeps typical FRC parts well under it; the numpy read at this size is a few tens of MB | "<name> is too detailed to print here (over 150,000 triangles)." |
| Download per part | 7.5 MB, streamed | exactly 150,000 binary STL triangles plus the header (7,500,084 bytes) | same as above |
| Distinct parts per page id | 20 | the first draft's figure; each part costs one export | "Up to 20 different parts per print." |
| Mesh bytes per page id | 50 MB | 20 parts at a typical 2.5 MB | "These parts are too large to slice together." |
| Copies per plate | 30, quantity 1 to 30 each | 30 copies of 512 triangles (15,360 in all) measured at 814 MB peak and 8.7 s; 30 copies of 8,332 triangles (249,960 in all) at 716 MB and 43 s; 50 copies were never measured | "Up to 30 copies per plate; print the rest in a second job." |
| Triangles per job, summed over copies | 300,000 | triangles, not copies, drive time and memory: 249,960 took 43 s and 716 MB, 999,960 took 5 min 52 s and 1,087 MB (plan review, Fri 10-09); 300,000 is confirmed by the first build task's measurement | "These copies are too detailed to slice together; lower the quantities." |
| Plate slice time | 240 s (the sample part keeps 120 s) | 249,960 triangles took 43 s, so a plate at the caps has room on a busier machine | "The slicer took too long on this part." (today's sentence) |
| Part store on disk, all page ids | 500 MB | backstop: a reload makes a new page id and so escapes the per-page limits | "The print service is busy; try again in a few minutes." |

The first build task, before the part store exists, slices plates at the limits (30 copies
with 300,000 triangles in all, and two copies of one 150,000-triangle part) and records
their peak memory and time in `print/jobs.py`'s sizing note beside the existing 93 MB figure.
**Stop rule:** if either plate peaks over 900 MB (921,600 KB of peak resident memory, 1 MB = 1,024 KB as Linux reports it) or takes over 180 s, the per-job triangle
cap comes down to the largest value that stays inside both, and that value and its
measurement are recorded there and in this table.

**Where the numbers came from.** The 814 MB and 8.7 s figure that first set the copy cap was
measured on 30 copies of only 512 triangles each, 15,360 in all; it never supported the
first draft's 1,000,000-triangle job cap. The plan review measured the same 30-copy plate at
249,960 and 999,960 triangles in all (4.1), and the job and part caps were set from those.

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

The names are Orca's own profile names for that printer; the four in the example exist and
are compatible with `Bambu Lab H2S 0.4 nozzle`. A team with no `printer:` key gets the
current fixed set: the printer `Bambu Lab H2S 0.6 nozzle`, the filament
`Generic PETG @BBL H2S`, the process `0.24mm Balanced Quality @BBL H2S 0.6 nozzle`.

The nozzle volume type (High Flow) and the plate (Textured PEI) stay fixed in the flatten
script, as today. Whether a team should choose them is a question for the owner
(section 12).

### 6.2 The profile catalog

`print/scripts/flatten_orca_profiles.py` today flattens three fixed profiles, finding each
at `<kind>/<name>.json`. That lookup fails for the catalog: many BBL filaments live in
vendor subfolders and inherit from Orca's separate filament library (for example "AliZ PLA
@base"). The script now flattens a **catalog**, written to `print/profiles/catalog/`:

- **Name index.** The script walks every JSON file, recursively, under Orca's
  `profiles/BBL/<kind>/` and `profiles/OrcaFilamentLibrary/<kind>/`, and indexes each by
  its `name` field. `inherits` is resolved through that index, so a BBL filament can inherit
  from a library base. Two files with the same name fail the build.
- **What it flattens:** every printer profile of the Bambu Lab H2S family
  (`Bambu Lab H2S 0.2/0.4/0.6/0.8 nozzle`), and every process and filament profile marked
  `instantiation: "true"` whose flattened `compatible_printers` names one of them.
  Library base profiles are flattened only as parents, never listed.
- **What it skips, and why:** a profile whose variant array lacks
  `Direct Drive High Flow`, because every variant-aware value would silently resolve to the
  wrong index; 27 profiles (the addnorth family among them) are skipped for this today. It
  also drops a printer, filament and process combination whose variant indexes differ,
  extending today's `check_selection` to every combination. Each skipped profile and
  dropped combination is listed in the build log and in `index.json`.
- `index.json` lists each profile's name, kind, file and compatible printers, and the
  skipped names.

**Measured size:** 163 filament and 16 process profiles name an H2S printer, 1.30 MB
flattened with the four printers (Fri 10-09). The catalog is committed whole; no allowlist
is needed. The existing three files stay as the defaults. **Ruling:** only the team's own
printer family is flattened, the Bambu H2S. Another family is a one-line change to the
script's list, and the per-family structure is ready for the other brands that come after
shipping.

`print/print_config.py` reads the team's `printing:` section against the catalog, when the
config loads, not at slice time:

- **A configured printer name that is not in the catalog fails closed:** Setup shows "The
  team configuration names printer '<name>', which PenguinCAM does not know. Ask a mentor
  to fix printing.printer." and slicing is disabled. It never falls back to the default
  printer.
- An unknown filament or process name, or one not compatible with the chosen printer, is
  dropped with a warning shown on Setup and logged in the `config` event. If a list ends
  empty, Setup shows the same kind of error and slicing is disabled, because the default
  filament and process belong to the 0.6 nozzle.
- Only a team with no `printer:` key gets the default set.

Orca profile names are name-derived identifiers: when Orca renames a profile, a team's YAML
stops resolving. Failing closed with a message naming the key makes that visible (section
10).

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
The review's experiment confirmed the merged values reach the G-code (4.1). **Ruling:**
four settings that FRC students actually change; anything more belongs in a team's own
process profile.

### 6.4 Setup step

Setup shows:

- the printer, read-only;
- a Filament menu and a Print settings (process) menu, each holding the team's list;
- the four overrides, when allowed;
- any config warnings, or the config error that disables slicing.

The summary chips show the filament and process.

## 7. Error handling

Every error the student sees is one plain sentence, shown through `showError` and so also
sent as a `client_error` print event (2.1). Server failures log the cause with the page id;
the browser never receives a stack trace or an upstream body.

## 8. Testing

### 8.1 Without Onshape

- Python unit tests:
  - context parsing in `print_page`: the six fields, placeholders, `server` validation,
    and the wvm choice through `_wvm_path`;
  - selection resolution (Part Studio, Assembly, subassembly, standard content, dialog,
    duplicate names, configurations) against synthetic REST cassettes in the test bed's
    replay adapter; the REST calls are documented, so cassettes written from the OpenAPI
    are allowed and marked synthetic;
  - the export redirect rule and `request_absolute`;
  - the byte and triangle caps;
  - the part store: page id ownership, limits, expiry, orphan sweep, refresh under new refs;
  - footprints for the six orientations;
  - placement rules (shared JSON cases);
  - the 3MF writer: one object per copy, names, transforms checked by reading the 3MF back;
  - config reading against the catalog, including the fail-closed printer;
  - override validation;
  - file naming and name sanitizing;
  - print events: the quoting rule, `team=-` on default config, no metrics row for
    `request`, and that no token, cookie, full job id or pairing code reaches a log line.
- Node tests:
  - `plate_geometry.js` (the shared JSON cases, plus arrange);
  - `partSelectionsFromMessage`;
  - the selection handler: re-arm after an answer, an empty answer, `PENDING`, inactive
    step;
  - layout interaction helpers;
  - that every error path goes through `showError`.
- `make test` (with Orca):
  - a two-part placement slices and every copy's name is in `plate_1.json`;
  - with `brim_type: no_brim`, a rotated part's footprint after slicing matches the
    placement within 0.5 mm (the bounding box in `plate_1.json` includes any brim);
  - an overlapping placement is refused before Orca runs;
  - a profile with overrides slices;
  - the catalog builds, and its skipped list matches `index.json`.

### 8.2 With the test bed

Browser scenarios on the replay development server, against the fake Onshape host:

- select two parts → both listed with sizes;
- set quantity 2 → three copies arranged;
- rotate one, then lay it on its side;
- slice;
- download.

These scenarios replay only message logs recorded in real Onshape, as the
[test bed design](2026-10-09-onshape-test-bed-design.md) requires in its section 5.4. Until
the validation run (section 11) records them, they are skipped with "needs a recording",
not passed. Synthetic message logs are allowed only as self-test fixtures for the fake
Onshape host and the print page's own node tests, under `testbed/tests/fixtures/`, each
marked `"synthetic": true`; they are deleted when the real recordings land, and no
scenario ever replays one.

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
| `frc_cam_gui_app.py` | the `init_print_routes(...)` call passes two more things: `has_onshape_session` (the app's `_has_onshape_session`) and `onshape_client` (a function returning `session_manager.get_client(get_current_user_id())`) | the session manager, the user id and the Onshape gate are app globals; the blueprint reaches app state only through this call, as `init_printer_routes` already does. Token persistence needs no hook: the app's `_persist_onshape_tokens` runs after every request for a client obtained this way |
| `print/routes.py` `init_print_routes` | signature gains the two arguments above, stored in `ctx` | (inside `print/`, listed because its caller changes) |
| `onshape_integration.py` | `OnshapeClient.request_absolute(method, url, **kwargs)`; `_make_api_request` calls it | following the export's 307 needs the client's credentials, which must not leave the client (3.3) |
| `team_config.py` | one helper, `printing_section()`, returning the raw `printing:` dict from the root or, for a v1 file, from the default machine; `pairing_code` uses it | the v1 layout moves `printing:` under the default machine; one lookup serves both `pairing_code` and `print/print_config.py` instead of two copies |
| `config_validation.py` | none | it already accepts unknown `printing:` keys without a warning; its string sanitizer strips only parentheses and non-ASCII characters, and no catalog profile name has either (checked Fri 10-09) |
| `docs/3D_PRINTING.md` | support section; profiles; placement; limits | the developer guide |
| `testbed/` | the four new scenarios; imports the redirect helper from `print/onshape_parts.py` | the test bed's own scenario list |

## 10. New entities and identifiers

| Entity | Identifier | Durability | Documented in | Lifecycle |
|---|---|---|---|---|
| Page id | `pid`, 12 lowercase hex characters, made in the browser per page load | ephemeral; lives in page memory and in log lines | `print/static/print_wizard.js`, `print/events.py`, `docs/3D_PRINTING.md` | gone on reload; log lines keep it for Railway's retention |
| Part `ref` | 128-bit `secrets.token_urlsafe(16)` | one hour after last use | `print/part_store.py` | Refresh issues new refs; the sweeper deletes expired entries and orphan directories |
| Copy object name | `<sanitized part name> #<n>`, n counting per sanitized name | lives in the delivered `.gcode.3mf` and on the printer's skip-object list | `print/plate_3mf.py` | fixed when the job is sliced |
| Delivered file name | `<first part name>[_plus<N>]-<YYYYMMDD-HHMM>.gcode.3mf` | durable on the team's disk, Drive and printer | `print/plate_3mf.py`, `docs/3D_PRINTING.md` | the relay adds its own `-j<id>` suffix when sending |
| Print event names | `page`, `config`, `select`, … (2.1) | durable in logs and metrics | `print/events.py`, `docs/3D_PRINTING.md` | renaming one breaks saved log searches; `print_job` is retired in their favour. `deliver` arrives through `POST /print/deliver` (metrics name `print_deliver`) |
| Orca profile names as team config keys | Orca's own `name` field, for example `Bambu PLA Basic @BBL H2S` | as durable as Orca's naming; name-derived | `docs/3D_PRINTING.md`, `index.json` | an Orca rename makes a printer key fail closed and a filament or process key drop with a warning, both naming the key |
| `X-Print-Page` header | carries the page id | per request | `print/routes.py` | none |

## 11. The validation run with the owner

The owner said the work ends with a quick run together, to record and find problems. The
agent prepares a checklist for it:

1. The owner adds the credentials and the test folder (test bed spec, section 13).
2. The agent runs `build-docs` and the live API check.
3. The agent runs the automated Onshape UI run. If it is stopped, the owner does an Onshape
   checkpoint instead. The run records the click selection in a Part Studio and an
   Assembly, the dialog (including whether `idTag` equals the part id), a configured Part
   Studio, and once the unbounded selection mode for reference.
4. The recordings land, the synthetic fixtures are deleted, every browser scenario runs in
   replay, and the findings go to a handoff note.

## 12. For the owner afterwards

- A separate right-panel extension for printing that opens `/print` directly (section 0).
- Adding `configuration={$configuration}` to the registered panel URL, so click selections
  in a configured Part Studio print the configuration on screen (3.3).
- Whether names of who started a print belong in file names (milestone 2).
- Whether to allow STL upload in full-page mode.
- Whether teams should choose the nozzle volume type and the plate (6.1).
- Whether other printer families are wanted in the catalog.
- **Copy names (a naming decision to confirm):** copies are numbered per sanitized name,
  not per part (4.6), so two different parts both named `Bracket` print as `Bracket #1`,
  `Bracket #2`, `Bracket #3` on the printer's skip-object list, and the list does not say
  which Part Studio each came from. The alternative, telling them apart by Part Studio, makes
  longer names.
- The rate limiter keys on the remote address, and `ProxyFix` is set without `x_for`, so
  behind Railway's proxy every limit may be counted per proxy rather than per user. Not
  verified; it affects the whole app, not only printing.

## 13. Adversarial review (folded in)

The review (Fri 10-09) read the code at the test bed worktree and ran Orca experiments. Each
finding was checked against its evidence before folding.

| Finding | Disposition |
|---|---|
| M1 copies sharing an object lose their names | Folded (4.1, 4.6): one object per copy, named `<part name> #<n>`; the guard matches names. Verified in the experiment's `plate_1.json` and G-code |
| M2 the 12 mm spacing rests on a wrong claim | Folded (4.1, 4.3): spacing 5 mm. Verified: brims trimmed at 2 mm, 0.7 mm short at 12 mm |
| M3 the catalog build fails with today's script | Folded (6.2): name index over BBL and the filament library, High Flow skips, per-combination check, measured 1.30 MB, allowlist clause dropped. Verified by rerunning the catalog script |
| M4 Send to Printer ignored | Folded (preamble, 2.1, 4.6, 6.2): keeps working, `deliver` action `printer`, unknown printer fails closed |
| M5 the session id rotates and is shared | Folded (2.1, 3.4) with the controller's ruling: a per-page-load page id from the browser, parts keyed by `ref` with an owning page id, global disk cap |
| M6 section 9 understates outside changes | Folded (0, 3.3, 9): client getter and Onshape gate through `init_print_routes`, `request_absolute`. Partly rejected: tokens need no explicit `update_session_tokens` call, because the app's `after_request` hook `_persist_onshape_tokens` already saves them for any client obtained through `session_manager.get_client` |
| M7 version context and `server` unspecified | Folded (3.1, 3.2): six fields, `_wvm_path` reused, ids on every message |
| M8 selection departs from the proven pattern | Folded (3.2): count 1, `REQUESTED_SELECTION`, re-arm, deselection defined |
| M9 configurations ignored | Folded (3.3): configuration passed through; a configured Part Studio without one is refused, never exported in its default |
| M10 unsafe text in logs, 3MF and G-code | Folded (2.1, 4.6): one quoting rule; names sanitized to the file-name character set |
| M11 resource limits unmeasured | Folded (3.3, 5): numpy read, streamed byte cap, triangle caps, 30-copy cap. Verified: 30 copies 814 MB and 8.7 s, on 15,360 triangles in all (corrected by the plan review, below); one million triangles 1.1 s and 557 MB in pure Python (the review measured 2.4 s and 658 MB; same order) |
| M12 synthetic message logs contradict the test bed spec | Folded (8.1, 8.2) with the controller's ruling: synthetic logs only as marked self-test fixtures, deleted when recordings land |
| M13 no new entities section | Folded (section 10, Terms) |
| m1 `team=` on default config | Folded (2.1) |
| m2 `request` metrics rows and full job ids | Folded (2.1): log line only, route rule, no static files |
| m3 client-event gate and route limits | Folded (2.1); the `ProxyFix` concern is unverified and goes to the owner (12) |
| m4 `config_validation.py` change unnecessary; v1 `printing:` lookup | Folded (9): no change there; one `printing_section()` helper |
| m5 `JobPool.submit()` has no payload; refresh races a queued job | Folded (3.4, 4.6) |
| m6 `idTag` fallback and assembly cases | Folded (3.3) |
| m7 the elements endpoint is unverified | Rejected: `GET /documents/d/{did}/{wvm}/{wvmid}/elements` with an `elementId` query parameter is in Onshape's OpenAPI; the spec now cites it |
| m8 no Connect flow on the print page | Folded (3.5) |
| m9 where the Layout CSS lives | Folded (0) |
| m10 the rotated-footprint test reads a brim | Folded (8.1) |
| m11 `[+N more]` breaks the character rule; time pattern | Folded (4.6): `_plus<N>`, `^\d{8}-\d{4}$` |
| m12 the part-store index is lost on restart | Folded (3.4) |
| m13 `selectItemDialogClosed` | Folded (3.2) |
| m14 nozzle volume type and plate are fixed | Folded (6.1, 12) as an owner question |
| m15 `print_job` metric and stale docstrings | Folded (2.1) |
| m16 one error helper; overrides confirmed | Folded (2.1, 6.3) |
| Lens 7 vocabulary ("instance", "session", "plate") | Folded (Terms) |
| Lens 9 cuts: 3D view in Layout, keyboard nudges, allowlist clause, `request` metrics rows | Folded (4.5, 6.2, 2.1) |

**Plan review (Fri 10-09).** The adversarial review of the implementation plan measured a
30-copy plate at the first draft's job cap: 999,960 triangles took 5 min 52 s and 1,087 MB,
past both the 120 s slice timeout and the memory rule, and 249,960 took 43 s and 716 MB.
Folded (3.3, 4.1, 4.6, 5, 12) with the controller's rulings: 300,000 triangles per job,
150,000 per part, 30 copies per plate, a 240 s plate slice timeout, an explicit export
tessellation, the measurement first with a stop rule at 900 MB or 180 s, and copy numbering
per sanitized name sent to the owner.

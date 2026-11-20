# Wizard research: advanced mode, automatic lie and arrange, interaction without modes

Research for the next round of changes to the
[print wizard mockup](../mockups/print-wizard/index.html), answering the four questions of
[the brief](../orchestration/penguin-slicer/briefs/wizard-research.md) as the owner widened
them on Thu 11-19. Terms follow the mockup's [decisions file](../mockups/print-wizard/DECISIONS.md)
(part, copy, plate, Layout step, Preview step, advanced mode, layer preview), plus these:

| Term | Meaning |
|---|---|
| **resting position** | One way a copy can lie on the plate: one face of the part's 3D convex hull down, stable (its centre of mass above that face). |
| **auto-orient** | Choosing a copy's resting position by a score, with no student input. |
| **Arrange** | Placing every copy on the plate automatically (the mockup's existing button). |
| **rotation handle** | The mockup's existing round handle that turns the selection about the vertical axis. |
| **resting-position strip** | A row of small pictures under the 3D view, one per resting position of the selected part. |
| **face markers** | Dots drawn on the selected copy's candidate faces; one click lays it on that face. |
| **tip handle** | A second handle beside the rotation handle that steps the copy to its next resting position. |
| **box tumbler** | A box drawn around the selected copy whose sides are clicked to put that side down. |
| **Scheme O, Scheme S, Scheme T** | The three complete interaction schemes in section D: Onshape's mouse, slicer's mouse, top-down first. |

## Short answer

- **A.** Onshape gives a right-panel application no dialog, tab-sized surface or resize
  message; its message list has nothing of the kind. Build advanced mode as a full-height
  view inside the panel, organised like Orca's own settings column (search first, tabs,
  subgroup headings, a common/all switch, per-setting revert), and let it use extra width
  when the student drags the panel wider, which PenguinCAM's own help says is possible.
- **B.** Port the idea, not the code (Orca and Tweaker-3 are AGPL/GPL, PenguinCAM is MIT):
  candidates from the faces of the part's 3D convex hull, score by bed contact, overhang
  area and height, keep stable ones. About 110 ms for 100,000 triangles in node; it lays the
  hood rib flat (8 mm tall instead of 353 mm). Do it when a part arrives.
- **C.** Arrange after auto-orient, on convex hulls, with each copy tried at its
  smallest-rectangle angle and at +90, +180 and +270 degrees, in a pile around the plate's
  middle; run it beside the mockup's current packer and keep whichever parks fewer copies.
  No library is needed. It fails where the convex hull wastes space (curved parts).
- **D.** Recommend Scheme O: left button on a copy moves it, right drag orbits as in Onshape,
  wheel or pinch zooms, middle drag or Shift drag pans; lay a copy down from the
  resting-position strip (double-click on a face stays as a shortcut). No tool modes remain.
  Take Orca's per-line-type time in the Preview legend, with click-to-hide; leave the rest.

## A. A bigger surface for advanced mode inside Onshape

The owner ruled out a separate browser window and a separate browser tab; they are not
developed here.

### What Onshape offers a right-panel application

Onshape's right panel message list
([Element Right Panel](https://onshape-public.github.io/docs/app-dev/messages/element-right-panel/))
has exactly these messages an application can send: `applicationInit`, `showMessageBubble`,
`requestViewerImage`, `requestSelection`, `requestSelectionHighlight`, `stopRequest`,
`openAnotherElementInCurrentWorkspace`, `openFeatureDialog`, `closeFeatureDialog`,
`openSelectItemDialog`, `closeSelectItemDialog`, `errorReload`, `keepAlive`. It receives
`itemSelectedInSelectItemDialog` and `selectItemDialogClosed` (plus `SELECTION`).

- No message shows application content in a dialog, a modal, a flyout or a larger frame,
  and none changes the panel's size. `openSelectItemDialog` opens Onshape's own part picker
  (PenguinCAM already uses it, `print/static/print_onshape.js:119-121`); `openFeatureDialog`
  opens an Onshape feature's dialog. Neither carries application content.
- The extension locations
  ([Extensions](https://onshape-public.github.io/docs/app-dev/extensions/)) that embed a
  page are the element right panel, the element tab and the document list info panel.
  No location is a dialog. "Open in new window" is an action type, which is the browser
  window the owner ruled out.
- Onshape publishes no panel width; the test bed's 320 px is a guess
  ([restart notes](../handoffs/2026-10-11-print-path-restart-notes.md), the row "Panel
  width 320 px"), and the test bed lets `?panel=` try 240 to 800 px
  (`testbed/host/local.js:236-238`).
- **The student can probably drag the panel wider.** PenguinCAM's own CNC wizard tells users
  "↔ Widen the panel for easier layout" (`static/wizard.js:1029`), and its user guide says
  "Widen the panel for more room to work" (`static/docs/usage.html:210`). I found no Onshape
  page that states it or gives the limits.

### An application element tab in the same document

Onshape allows one element tab extension per application; a student adds it from
Insert new tab > Applications, and it becomes a tab of the CAD document with its own
element id ([Element Tab](https://onshape-public.github.io/docs/app-dev/messages/element-tab/)).
The panel could switch to it with `openAnotherElementInCurrentWorkspace`, given that id.
Both pages would be frames of the same PenguinCAM origin under the same Onshape page, so
they could share state through the server or a `BroadcastChannel` (storage is partitioned
by top-level site, which is the same for both).

Not recommended: it adds a tab to the team's CAD document for every document that prints,
which every team member then sees in the document and its versions; the student has to
create it once per document; and switching to it hides the Part Studio and the panel, so the
student loses sight of the plate while changing settings. Whether the panel's page survives
the switch is not documented.

### The browser's full-screen request (untested, cheap to test)

If Onshape's panel frame allows full screen, `element.requestFullscreen()` from a click in
the panel fills the screen with advanced mode and returns to the panel on Escape, without
leaving the Onshape page. Whether the frame allows it is one line in the real panel:
`document.fullscreenEnabled`. I could not run it (it needs the panel inside Onshape). Treat
it as a bonus if the check says yes, not as the plan.

### Recommendation: a complete settings view inside the panel

Orca's own process settings column is narrow too, and it holds 340 settings:
`TabPrint::build()` (`src/slic3r/GUI/Tab.cpp:2311-2961` at v2.4.2) builds 6 pages (Quality 105
settings in 10 groups, Strength 50 in 4, Speed 42 in 8, Support 50 in 7, Multimaterial 44
in 5, Others 48 in 8). What keeps it usable:

1. **A tier switch.** Every setting has a mode (Simple, Advanced, Expert), and a switch at
   the top of the column hides the higher tiers (`Tab.cpp:76-81`, `Tab.cpp:416-434`).
2. **Search in the column's top bar**, "Search in preset" (`Tab.cpp:303-323`).
3. **Pages as a row of tabs, groups under headings**, each heading with an icon
   (`Tab.cpp:2317-2360`). I found no collapsing of groups.
4. **Per-setting revert**: each changed field gets an undo arrow back to the preset's value
   (`Tab.cpp:289-301`).

For the mockup, at panel width:

- Search box first, always visible; results from every tab, as now (decision 19).
- One row of tab names (Quality, Strength, Speed, Support, Others), as now.
- A two-way switch "Common / All settings" in the header, standing in for Orca's tiers:
  Common shows the 9 to 13 settings per tab the mockup already samples, All shows the rest
  under the same headings. This replaces "the sample" note with a real structure.
- Subgroup headings that collapse, all open in Common, all closed in All except the first,
  so a long tab is a list of headings to open.
- An undo arrow on each changed setting, beside the existing "Changed only" filter.
- When the panel is wider than about 480 px: tabs move to a vertical rail on the left and
  labels sit beside their values, one setting per row, as in Orca's column. Use a
  `ResizeObserver` on the panel, not a media query, so it follows a panel the student drags.

**How the mockup imitates it honestly:** keep advanced mode inside the panel, and add a
drag handle on the panel's left edge in the mock Onshape page (as the CNC help implies
Onshape has), with a mockup note saying the real limits are not known. That exercises the
wide layout without promising a dialog Onshape does not have.

## B. Choosing how each part lies, automatically

### What Orca does

Orca's auto-orient is `src/libslic3r/Orient.cpp` (v2.4.2; descends from Tweaker-3, whose
repository is GPL-3.0).

- **Candidates** (`Orient.cpp:115-121`, `284-288`): the original orientation; the 10 face
  normals with the most total area on the mesh; the 14 with the most area on the mesh's 3D
  convex hull (`mesh->convex_hull_3d()`, line 208); 18 fixed directions (the six axes and
  45-degree diagonals); duplicates removed.
- **Features per candidate** (`get_features`, line 375): bottom area (facets within the first
  layer height of the lowest point, line 392), overhang area (facets facing down more
  steeply than the support threshold angle, not on the bed, line 401, with outer appearance
  faces weighted 4 times), bottom area of the hull, a contour estimate (4·√bottom), and
  low-angle faces (1.4 to 14 degrees from flat, above the first layer, line 442).
- **Score** (`target_function`, line 451): roughly
  (overhang·0.24 + 0.63 + low-angle area·0.01) ÷ (0.63 + contour·0.23 + bottom·1.17 +
  hull bottom·0.1), times 6.6, plus 100 when the bottom area is under 0.1 mm² (line 465).
  Height is **not** in the score; the height ratio term is commented out. The overhang angle
  comes from the profile's `support_threshold_angle` (`OrientJob.cpp:233-236`).
- Q orients the selection (or everything), Shift+Q the whole plate
  (`KBShortcutsDialog.cpp:226-227`); options are enable rotation and "minimise area"
  (`GLCanvas3D.cpp:5796-5850`).

### A small one in JavaScript

I found no JavaScript port of Tweaker-3 or of Orca's orienter. Porting either copies GPL or
AGPL code into MIT PenguinCAM; write our own small score instead.

- **Candidate set:** the faces of the part's 3D convex hull, merged by normal, at least
  25 mm² (the mockup's own rule, decision 36), stable (the part's centre of mass, projected
  down, falls inside that hull face), plus the orientation as modelled. Hull faces are the
  only faces a rigid part can rest on, so this is the complete set of resting positions; a
  hull of a real part has tens to a few hundred faces after merging. three.js r128 ships
  `examples/js/math/ConvexHull.js` (MIT), which the Preview step's three.js version already
  includes.
- **Score:** cost = (overhang area + 1) ÷ (bed contact area + 1) + height ÷ 100, plus 100
  when contact is under 25 mm². Overhang counts faces not on the bed that face down more
  than 45 degrees from vertical; contact counts faces within 0.1 mm of the plate.
- **Experiment** (`orient_bench.js`, kept in the scratchpad, not committed): the mockup's
  rib tessellated to 100,004 triangles, 28 candidates. Normals and candidates took 28 ms,
  scoring 80 ms in node 24 on an aarch64 Linux machine. Best: flat side down, contact
  10,744 mm², no overhang, 8 mm tall. As modelled: contact on an edge (1 mm²), 240 mm² of
  overhang, 353 mm tall, cost 226 against 0.08.
- **Where to run it:** once per part when it arrives on the Layout step, in a Web Worker if
  parts are large; the result is the part's default resting position for every copy.

### Where the simple score goes wrong

- **Parts that need supports whichever way they lie** (a bracket with a boss on each side):
  the score still picks the least overhang, but the student should be told supports will be
  needed; show "needs supports" on that resting position.
- **Round parts** (pulleys, spacers): many hull faces of a cylinder are thin strips with
  tiny contact; the stability and 25 mm² rules drop them, leaving the two flat ends, which
  is right. A sphere or a fully rounded part has no candidate; keep it as modelled.
- **Strength:** the score knows nothing of load. Layer lines run parallel to the plate, so a
  thin rib standing on its end breaks along a layer; lying flat is both the best score and
  the strong way for the hood rib. A part whose load runs vertically as modelled (a tall
  standoff) would be weakened by the default; only the student knows. This is why the
  student must be able to pick another resting position easily (section D).
- **Appearance faces:** Orca weights overhang on outer faces; we have no such marking.
- **Lying flat can make a copy too wide for the plate:** the rib's chord is 353 mm and the
  plate is 340 x 320 mm, so the flat rib fits only turned diagonally. Arrange must try
  turns (section C).

## C. Arranging the parts on the plate, automatically

### What Orca does

Arrange (A, all; Shift+A, selected plates, `KBShortcutsDialog.cpp:223-224`) calls
`src/libslic3r/Arrange.cpp` (v2.4.2), built on libnest2d's no-fit-polygon placer with a
first-fit selection (`Arrange.cpp:8-9`, `366-367`).

- **What it places:** each instance's 2D convex hull (`ModelInstance::get_arrange_polygon`,
  `src/libslic3r/Model.cpp:3379`), inflated by half the spacing (`Arrange.cpp:122`); the NFP
  implementation is for convex shapes only (`Arrange.cpp:43`).
- **Order:** priority, bed temperature, extruder, then largest area first
  (`Arrange.cpp:806-820`).
- **Rotations:** off by default (`Arrange.hpp:121`). When the student ticks "Auto rotate for
  arrangement" (`GLCanvas3D.cpp:5939`), each item starts at its smallest-bounding-rectangle
  angle, is turned to fit if too big for the bed (`Arrange.cpp:997-1007`), and the placer
  tries 0, 45, 90 and 135 degrees (`Arrange.cpp:296-297`).
- **Goal:** a compact pile in the middle: big items score by distance of their corners to
  the pile's centre, pile density and alignment with same-sized neighbours; small items
  gather around the big ones (`Arrange.cpp:441-595`); the pile is then centred on the bed
  (`Arrange.cpp:288-290`). Spacing is a slider in Arrange's options popup
  (`GLCanvas3D.cpp:5922-5934`).

### What exists for a browser

| Option | Licence | Fit for this |
|---|---|---|
| SVGnest (`Jack000/SVGnest`) | MIT | Browser NFP nesting with a genetic search that runs until stopped; built to minimise sheet length, not a centred pile. Too much for 25 copies. |
| Deepnest (`Jack000/Deepnest`, `deepnest-next/deepnest`) | none stated / not asserted | A desktop (Electron) relative of SVGnest. Licence unclear; do not use. |
| potpack (`mapbox/potpack`) | ISC | Rectangles into a near-square, no bin limit, no rotations. Wastes the corners of L shapes and triangles. |
| maxrects-packer (`soimy/maxrects-packer`) | MIT | Rectangles into fixed bins with 90-degree turns. Bounding rectangles only. |
| A small placer on convex hulls | ours | What the mockup already has the parts for: hulls, `polyDistance`, `placeNear`. |

### Experiment

`arrange_bench.js` (scratchpad, not committed) ran the mockup's `MockPlate.arrange` and a
"pile" arrange on the mockup's own parts in node: largest first; each copy at its
smallest-rectangle angle and +90, +180, +270 degrees (45-degree turns only if none fits);
every free spot on a 5 mm grid scored by the pile's bounding box (√(w·l) + 0.3·longest side)
plus a pull toward the plate's middle, then refined at 1 mm; the pile centred at the end.

| Plate | Mockup Arrange: parked, pile | Pile arrange: parked, pile |
|---|---|---|
| Assembly mix (4 brackets, 2 pulleys, camera mount, 6 spacers, 2 gussets, 2 ribs flat) | 3 parked, 334 x 290 mm | 1 parked, 278 x 267 mm |
| 2 ribs flat + 10 gussets | 8, 332 x 286 | 8, 281 x 280 |
| 12 gussets | 6, 332 x 272 | 7, 256 x 254 |
| 25 L brackets | 0, 332 x 174 | 0, 235 x 265 |

No placement broke a rule. Times were 0.2 to 1.5 s, unoptimised (the pair check reruns the
whole `check()`); exporting `polyDistance` and caching hulls should cut that several times
(not measured). Turning by 180 degrees mattered: without it the pile was larger on every
plate with triangles.

### Recommendation

Arrange as: auto-orient every copy first (section B), then run the pile arrange and the
mockup's current packer, and keep the result that parks fewer copies, the smaller pile
breaking a tie. It costs about one more function of 80 lines in `plate.js`, no library, under
2 s for 25 copies, and it belongs in a Web Worker in the product. Keep the convex-hull rule
(decision 44) as Orca does.

**When it fails:** curved and L-shaped parts, because their hulls include the hollow side:
two flat ribs cannot nest one inside the other's curve, and that is why 8 gussets park when
two ribs share the plate. True-outline nesting (SVGnest's level) would fix that and is not
worth it here. A greedy pile also fills edges less well than a corner-first scan (12
gussets), which is why both run.

## D. Interaction without modes, and what Orca's two views do

### Orca's Prepare view

| Operation | Orca | Kind |
|---|---|---|
| Select a copy | Left click; Esc deselects all (`KBShortcutsDialog.cpp:239`) | action |
| Add to or remove from selection | Ctrl + left click; Shift + left drag draws a selection rectangle (`KBShortcutsDialog.cpp:232-233`) | action |
| Move a copy | Left drag on the object moves it with no tool on (`GLCanvas3D.cpp:4439-4452`); arrows 10 mm, Shift+arrows 1 mm; Move tool (M) for exact values | drag, plus a tool |
| Turn a copy | Rotate tool (R): rings on the selection | tool that stays on |
| Lay on face | "Lay on face" tool (F, `GLGizmoFlatten.cpp:72`): marks the hull's faces of at least 5 mm², up to 254 (`GLGizmoFlatten.cpp:152-340`); a click on one lays the object down (`GLGizmoFlatten.cpp:22-35`) | tool that stays on |
| Auto-orient | Q / Shift+Q, toolbar button with an options popup | action |
| Arrange | A / Shift+A, toolbar button with an options popup | action |
| Orbit, pan | Left, middle and right drag each set in preferences to Pan or Rotate view (`KBShortcutsDialog.cpp:212-221`, `GLCanvas3D.cpp:4301-4303`) | drag |
| Zoom | Wheel; I and O | wheel |
| Standard views | Ctrl+0 default, Ctrl+1 top, Ctrl+2 bottom, Ctrl+3 front, Ctrl+4 back, Ctrl+5 left, Ctrl+6 right (`KBShortcutsDialog.cpp:241-247`) | action |
| Undo, redo | Ctrl+Z, Ctrl+Y | action |
| Delete, duplicate | Del; Ctrl+K clones (object list) | action |

So Orca's modes are its tools (move, rotate, scale, lay on face, cut and the painting
tools); Arrange and auto-orient are single actions; nothing but a tool's own rings or face
marks appears on the selected object. Cura is the same: its rotate tool has a "Lay flat"
button and a "Select face to align to the build plate" toggle that is a mode
(`Ultimaker/Uranium`, `plugins/Tools/RotateTool/RotateTool.qml:64-117`). PrusaSlicer and
Bambu Studio share Orca's lay-on-face tool. So no slicer studied lays a part on a face
without a mode.

**Onshape**, which the students use every day: right drag rotates the view, wheel zooms,
middle drag or Ctrl + right drag pans, F or a double click of the wheel zooms to fit, and
the view cube gives standard views
([Onshape help: view navigation](https://cad.onshape.com/help/Content/View/view_navigation_and_the_view_cube.htm)).
The mockup today orbits on left drag and pans on right drag, against those habits.

**PenguinCAM's CNC wizard** Layout step (2D, `static/wizard.js:900-1010`): click selects,
Shift-click adds, click on empty space deselects, drag moves the selection, a round handle
turns it (snapping to 45 degrees within 5), and − / + buttons zoom. No pan, no undo, no
keyboard shortcuts.

### Orca's Preview view

- **Layer slider:** vertical, two thumbs (top and bottom of the visible layer range), with a
  one-layer switch (L) (`IMSlider.cpp:449-466`, `877-1003`); up and down arrows move it,
  Shift or Ctrl makes it 5 times faster (`KBShortcutsDialog.cpp:299-313`). Ticks on it mark
  pauses, colour changes and custom G-code (`IMSlider.cpp:690`, `821-830`).
- **Horizontal slider:** steps through the moves of the top layer (`GCodeViewer.cpp:977`);
  left and right arrows, Home and End.
- **Colour schemes:** Summary, Line Type, Layer Height, Line Width, Speed, Actual Speed,
  Acceleration, Jerk, Fan Speed, Temperature, Flow, Actual Flow, Tool, Filament, Layer Time,
  Layer Time (log), Pressure Advance (`GCodeViewer.cpp:69-102`).
- **Legend:** for Line Type, a table of line type, time, percent and filament used, with an
  eye per row that hides that line type (`GCodeViewer.cpp:3679-3681`, `3876-3885`); options
  rows for Travel, Seams, Retract, Unretract, Filament Changes and Wipe, each toggled the
  same way (`GCodeViewer.cpp:3815-3859`); a total time and cost estimate
  (`GCodeViewer.cpp:2798-2808`). C shows the G-code text window.

**Worth taking for "pick a profile and print":** time per line type in the legend, and a
click on a legend row to hide it (the student sees at once that supports take a third of
the time, or hides supports to see the part). **Not worth it:** the two-thumb range (one
thumb is enough), the horizontal slider, the other colour schemes, the G-code window, and
slider ticks (pauses for inserts would need G-code editing the panel does not offer).

### Ways to lay a copy on a face without a mode

All five use the same candidate set as section B (stable hull faces of at least 25 mm²),
so curved surfaces and many small faces are already reduced to a short list; each list is
sorted by the auto-orient score and capped at 6.

| Option | How it works (mouse / touch) | At 320 px | Many small faces, curves | With moving and orbiting | Build cost |
|---|---|---|---|---|---|
| **1. Tip handle** | A second small handle beside the rotation handle; a click steps to the next resting position, Shift-click the previous. Touch: tap. | One more 24 px target; fine. | Blind: the student cannot see the next position before it happens; 6 steps to cycle. | Its own hit target, as the rotation handle; no conflict. | Low |
| **2. Box tumbler** | A box around the selected copy; a click on a side puts that side down; dragging a corner rolls it 90 degrees. Touch: tap a side. Read by eye: the side under the pointer is shaded and its outline dropped onto the plate, no axis letters. | Box lines cross neighbours and the part; cluttered for small copies. | Only six axis-aligned positions: misses slanted faces (a gusset's long edge), works for the rib. This is the old "Lay flat in six orientations". | A click inside the box but on the part is ambiguous: move or tumble. Needs a drag threshold and box sides only at the edges. | Medium |
| **3. Face markers** | On the selected copy only, a dot on each candidate face's centre; hover shows the face; one click lays the copy there. Touch: tap a dot (28 px hit area). | Dots crowd on a copy 40 px across; faces on the far side need an orbit first. | Six dots at most; curved parts get few or none, which is honest. | Dots are their own targets; a drag starting on a dot still moves the copy after 4 px. | Low to medium (the mockup already finds faces and draws patches) |
| **4. Resting-position strip** | Under the view, while one part's copies are selected: up to 6 pictures of the part in each resting position, the auto-orient choice first and marked "Best", the current one outlined, a line under each ("8 mm tall", "needs supports"). Click or tap applies to every selected copy of that part. | Five 52 px pictures fit one row; legible whatever the zoom. | Same short list; each picture shows the whole part, so no aiming at faces. | Outside the 3D view: no conflict at all. | Medium (an off-screen three.js render per position, cached per part) |
| **5. Free rotation ball** | Drag a ring or ball on the selected copy to turn it freely; on release it snaps to the nearest resting position. Touch: one-finger drag on the ring. | Too small to control well; a 3D drag in a 320 px view is fiddly. | Snap handles curves, but the student steers blind between positions. | Competes with orbiting; needs exact hit testing on the ring. | High |

Also seen: a right-click (long-press) menu on a face, "Lay on this face" (no mode, but
hidden, and long-press fights the drag); the current double-click on a flat face (no mode,
fast for those who know it, not discoverable).

**Recommended: option 4, the resting-position strip,** with double-click on a face kept as
a shortcut and the Lay on face tool removed. It needs no aiming in a small view, works the
same with a mouse, a trackpad and a finger, shows the auto-orient result and its
alternatives as one thing, carries the "needs supports" warning, and cannot collide with
moving or orbiting. **If the owner wants it on the part itself, option 3** is the next best:
it keeps the action where the student looks, at the cost of crowding on small copies.
Option 1 is the cheapest fallback.

### Three complete schemes

Every scheme has: no tool modes; the rotation handle on the selected copy (it stays, as in
the CNC wizard); the strip for resting positions; Duplicate and Delete beside the selection's
name (decision 39); Arrange and Auto-orient as buttons; the red bar and sentences for broken
rules (decision 42). The schemes differ in how buttons and gestures are shared.

**Scheme O (Onshape's mouse), recommended.**

| Operation | Mouse | Trackpad | Touch | Competing gestures and how it settles |
|---|---|---|---|---|
| Select one copy | Left click on it | Click | Tap | — |
| Add or remove from selection | Shift- or Ctrl-click | Shift-click | Long-press adds | Both keys accepted: Shift is the CNC wizard's, Ctrl is Orca's. |
| Select nothing | Click empty plate; Esc | Click empty | Tap empty | A click is a press and release under 4 px of travel. |
| Several at once | Move, turn, lay down and Delete act on the whole selection | same | same | — |
| Move a copy | Left drag that starts on a copy | Drag on a copy | One-finger drag on a copy | Starts on a copy (its outline, decision 34) = move. |
| Turn about vertical | Drag the rotation handle | same | same | Handle wins over the copy under it. |
| Lay on a face | Strip under the view; double-click a flat face | same | Tap in the strip | Double-click needs no press-hold, so it does not fight a drag. |
| Orbit | Right drag anywhere; left drag on empty plate | Drag on empty plate | One-finger drag on empty | Right drag is Onshape's; left drag on empty is for trackpads and touch. |
| Pan | Middle drag, Ctrl + right drag, or Shift + left drag on empty | Shift + drag on empty | Two-finger drag | Ctrl + right is Onshape's. |
| Zoom | Wheel, toward the pointer | Two-finger scroll or pinch | Pinch | The wheel over the view does not scroll the panel; the student scrolls the panel beside the view. |
| Fit view | "Zoom to copies" and "Whole plate" buttons; F | same | Buttons | F is Onshape's zoom to fit. |
| Top-down view | A "Top" button beside the fit buttons; Ctrl+1 as in Orca | same | Button | — |
| Duplicate, delete | Buttons by the name; Del; Ctrl+D duplicates | same | Buttons | Orca's Ctrl+D deletes all; not copied. |
| Arrange | Button | same | same | Auto-orients first (section C). |
| Auto-orient | "Best" in the strip; a button for all copies | same | same | — |
| Undo, redo | Ctrl/Cmd+Z, Ctrl+Y or Shift+Cmd+Z; ↶ ↷ buttons | same | Buttons | New; Orca has it, the mockup does not. |
| Why is it red | Red bar at the top of the view, sentences below with Arrange or a resting position as the fix | same | same | Unchanged (decision 42). |

**Scheme S (slicer's mouse).** As the mockup works today: left drag on empty orbits, right
drag or Shift drag pans, wheel zooms, Ctrl- or Shift-click adds, with the strip in place of
the Lay on face tool. Cheapest (a few lines change), but right drag pans where Onshape
orbits, so a student's hand does the wrong thing half the time.

**Scheme T (top-down first).** The view opens looking straight down, orthographic, like the
CNC wizard: left drag on empty pans, wheel or pinch zooms, and a "3D" button (or right
drag) tilts the camera; how a copy lies is chosen in the strip, so orbiting is rarely
needed. Moving and turning copies are exact in plan view and every copy is large. It loses
the sense of height and of which way a part stands that the 3D view gives at a glance, and
the "3D" button is close to a view mode.

| Operation | Scheme S | Scheme T |
|---|---|---|
| Move | Left drag on a copy | Left drag on a copy |
| Turn | Rotation handle | Rotation handle |
| Lay on a face | Strip; double-click a face | Strip only |
| Orbit | Left drag on empty | Right drag, or the 3D button then left drag on empty |
| Pan | Right drag; Shift drag | Left drag on empty; two-finger drag |
| Zoom | Wheel, pinch | Wheel, pinch |
| Select, add, deselect, fit, undo, arrange, duplicate, delete | As Scheme O | As Scheme O |

**What a student must be told (Scheme O):** one line under the view, "Drag a copy to move
it, drag the round handle to turn it, pick how it lies below. Right-drag to look around."
**What they discover unaided:** selecting, dragging, the wheel, the strip (it is visible),
the handle (it appears on selection), and orbiting and panning, which match Onshape.
**What stays hidden but harmless:** double-click on a face, keyboard shortcuts, Ctrl + right
pan.

## For the mockup

1. Lay each part on its best resting position when it arrives, by the section B score, and show "laid flat automatically" once in the message line; the Shooter Hood Rib then arrives 8 mm tall.
2. Add the resting-position strip under the 3D view for the selected part, best first, current outlined, with the height and "needs supports" under each picture.
3. Remove the Lay on face tool and its mode; keep double-click on a flat face.
4. Switch the pointer map to Scheme O: right drag orbits, middle or Ctrl + right or Shift + left drag on empty pans, left drag on empty also orbits.
5. Make Arrange auto-orient first, try each copy at its smallest-rectangle angle and at +90, +180, +270 degrees in a pile around the plate's middle, run beside the current packer, and keep the result that parks fewer copies.
6. Add undo and redo (buttons and keys) for every Layout step change.
7. Add a "Top" view button beside "Zoom to copies" and "Whole plate", and F for zoom to fit.
8. Give advanced mode a "Common / All settings" switch, collapsible subgroup headings, and an undo arrow on each changed setting.
9. Add a drag handle on the mock panel's left edge, with a mockup note that the real limits are unknown, and lay advanced mode out with a left tab rail above about 480 px, by `ResizeObserver`.
10. In the Preview step's legend, show each line type's time and percent and hide a line type when its row is clicked.
11. Put the strip, the face markers and the tip handle behind the scenario strip as alternatives, so the owner can try options 3 and 1 against 4.

## Not verified

- That the student can drag Onshape's right panel wider, and its minimum and maximum
  widths: inferred from PenguinCAM's own help text, not from Onshape.
- Whether Onshape's panel frame allows full screen (`document.fullscreenEnabled`).
- Whether an element tab's page and the right panel both survive switching between them.
- Orca's default assignment of left, middle and right drag (read from preferences at run
  time; the defaults were not read); and whether Orca's settings groups collapse. Orca 2.4.2
  was not run under Xvfb; everything about Orca here is from its v2.4.2 source.
- Onshape's touch and trackpad gestures (the help page was found, its trackpad section not
  read in full).
- The browser cost of the orient score and of the pile arrange: measured in node, not in
  Chrome inside Onshape; the 3D convex hull time for 100,000 triangles was not measured.
- That three.js r128's `examples/js/math/ConvexHull.js` is the non-module build the mockup
  can load as is (from memory of the three.js tree, not checked).
- The pile arrange's results on real team parts; only the mockup's procedural parts were
  tried.
- How well the simple score agrees with Orca's on real parts; no side-by-side run was made.

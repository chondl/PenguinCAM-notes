# Penguin Slicer mockup: decisions and fakes

The mockup is [index.html](index.html) in this folder; serve the folder with any static
file server and open it. It is a throwaway: its only product is your reactions.

It was built from the CNC wizard (`templates/wizard.html`, `static/wizard.js`,
`static/wizard.css`), the print branch's wizard (`print/`), the stand-in Part Studio
(`testbed/host/`), and sections 5 and 6 of the
[print path restart notes](../../handoffs/2026-10-11-print-path-restart-notes.md). Where
those sources did not decide something, the mockup had to. Every such decision is listed
here, each as the choice made and then the alternative rejected.

## Terms

Each term has one meaning in the mockup and in this file.

| Term | Meaning |
|---|---|
| **Setup step, Parts step, Layout step, Preview step** | The wizard's four steps, in that order. |
| **part** | One distinct solid, from Onshape or from an uploaded file. |
| **copy** | One placement of a part on the plate, labelled `Name #n`. |
| **plate** | The printer's build plate and everything on it. |
| **profile** | A team's named set of slicing settings, such as Structural. |
| **advanced mode** | The view that fills the panel with every slicing setting. |
| **layer preview** | The layer bar on the Preview step and the toolpaths it shows. |
| **slicing progress, print progress** | What the panel shows while slicing, and while printing. |
| **scenario strip** | The yellow mockup controls above the page. It is not part of the product. |

## Please react to these

Ten questions, each answerable in a sentence. The number in brackets is the entry in the
full list below, which says what the mockup does today and what it rejected.

1. **Laying a copy down (35).** The mockup offers two ways: double-click a flat face, or
   press **Lay on face** and click one of the faces it marks. Do you want both, only the
   double-click, or only the tool?
2. **How parts arrive on the plate (32).** A copy arrives as it was modelled, so the
   Shooter Hood Rib arrives standing and too tall and the student lays it down. Should
   parts arrive as modelled, or already lying on their largest flat face?
3. **Is the 3D view big enough at 320 px (46, 47)?** The Layout step stays at panel width
   and zooms to the copies so they are large enough to drag. Is that workable, or should
   the Layout step fill the whole panel as advanced mode does?
4. **When a laid-down copy needs more room (37).** It moves to the nearest free spot. If
   there is none, the whole plate is arranged again, which moves copies the student may
   have placed by hand. Is rearranging acceptable there, or should other copies never move
   unless the student presses Arrange?
5. **Confirming a send (61, 62).** Send to Printer always asks once more, naming the
   printer, the copies, the time and the filament. Do you want that confirmation every
   time, or only the first time in a session?
6. **Slicing progress (50, 51, 52).** The card shows a percentage, the stage's name, the
   list of stages, elapsed time and "about 0:19 left". If Orca on a server turns out to
   report only stages and no percentage, is a bar that steps from stage to stage enough?
7. **Print progress (63).** After a send, a card on the Preview step shows the stage
   (Sending, Heating, Leveling, Printing, Done), percent, layer of total, time left and
   the expected finish time, and the layer preview follows the printer. What else would a
   student standing at the printer want there?
8. **Stopping things (53, 68, 67).** A slice can be cancelled at any moment. A send can be
   cancelled until the file has arrived. A running print cannot be stopped from the panel;
   the card says to use the printer's screen. Do you want pause or stop from the panel?
9. **Changing the profile keeps your changes (14).** If a student raises infill and then
   picks another profile, the change stays on top of the new profile and a sentence says
   so. Keep the changes, or clear them when the profile changes?
10. **A repeat click on a listed part (23).** It does nothing but flash the row and say to
    raise the quantity; a ↻ button on the row brings in a changed part from Onshape. Should
    a repeat click raise the quantity instead?

Two things the mockup cannot show honestly and that need your requirement, not your
reaction: what **Cancel slice** should do while the connection to the server is lost (the
mockup cancels as if it could reach the server), and which of Orca's other Prepare tab
tools you count as needed (46 leaves out scale, cut, mirror, auto-orient and per-object
settings).

## Every decision

### Whole panel

1. The panel's brand reads "Penguin Slicer"; rejected: "PenguinCAM" with a 3D Printing subtitle.
2. The Setup step has no CNC "Mode" radio group; rejected: keeping the CNC Mode fieldset, as the print branch's page does.
3. The panel is always the CNC wizard's dark theme; rejected: following Onshape's light or dark theme as the CNC wizard does through `?theme=`.
4. The standalone context keeps the one-step-at-a-time wizard at the chosen width; rejected: the CNC wizard's full-page 2 x 2 grid of all four steps.
5. The standalone context shows the team configuration loaded from a saved configuration link, so Send to Printer works there too; rejected: default configuration with no printer when there is no Onshape.
6. Next is disabled, and the step itself says why, until the step's rules pass (as the print branch does); rejected: the CNC wizard's `alert()` when Next is pressed too early.
7. A summary row of chips (filament, profile, number of changes, parts and copies, plate area used) grows as the student advances, as in the CNC wizard; rejected: no summary.
8. A finished step's pill shows a tick in place of its number, so the four pills stay on one row at 320 px; rejected: the CNC wizard's tick after the name, which wraps the row.

### Setup step

9. The printer is one line with a live state chip (Idle, Receiving your plate, Printing 38%); rejected: a printer menu, since the team configuration names one printer.
10. Four filaments are offered with PETG first and marked "(most prints)"; rejected: PETG only, or hiding the others behind advanced mode.
11. Five team profiles (Structural, Pulley, Camera mount, Draft, Fine), each with a one-line purpose under the menu, valued for the 0.6 mm nozzle; rejected: three generic profiles named by layer height.
12. The four quick overrides (Infill, Walls, Supports, Brim) and advanced mode edit one shared set of changes: each quick override is a shortcut to one advanced mode setting, and a change made in either place shows in both; rejected: quick overrides as a separate layer applied on top of advanced mode.
13. A quick override whose setting was set in advanced mode to a value not in its menu shows that value labelled "(advanced mode)"; rejected: showing the menu blank. Every change from the profile, from either place, is listed on the Setup step under "N settings changed from Structural", with Review in advanced mode and Reset all; rejected: a bare "advanced settings in use" flag.
14. Changing the profile keeps the student's changes on top of the new profile and says so in a sentence under the Profile menu; rejected: clearing the changes on a profile change, or asking first.
15. Advanced mode covers process settings only (the Quality, Strength, Speed, Support and Others tabs); rejected: also filament and printer settings.
16. Changes in advanced mode last for this page load only and are never saved as a profile; rejected: remembered per student, or saved back to the team configuration.
17. Advanced mode range-checks a number when it is entered and keeps the previous value with a sentence giving the allowed range; rejected: passing any value through for Orca to refuse.
18. Reset all in advanced mode asks for a second click ("Reset all 3?"); rejected: resetting at once, or a modal dialog.
19. The advanced mode search matches a setting's label, subgroup, tab and key and shows results from every tab; rejected: searching the open tab only.
20. Advanced mode has a "Changed only" filter; rejected: no filter (it was not asked for).
21. Advanced mode shows 9 to 13 settings per tab under Orca's subgroup headings, with a mockup note on each tab saying it is a sample; rejected: a flat alphabetical list.
22. Nothing in the mockup locks advanced mode or the quick overrides by team configuration; rejected: honouring an `allow_overrides: false` lock (an open question in the restart notes).

### Parts step

23. In a Part Studio, a click on a part adds it with quantity 1. A click on a part already listed changes nothing: its row flashes and a sentence says to raise the quantity. A ↻ button on each row exports that part again from Onshape to pick up a change made there; rejected: a repeat click raising the quantity, or exporting again.
24. Clicks in Onshape are taken only while the Parts step is showing, and the page's toolbar says so otherwise; rejected: adding parts from any step.
25. A part that failed to export blocks Next until the student presses Try again or Remove on its row; rejected: letting Next go ahead without it.
26. The not-watertight warning sits on that part's row, in amber, and does not block; rejected: a separate warning list above the parts.
27. In an Assembly, one button adds every distinct part with its instance count as the quantity, leaves out standard content with a sentence naming it, and imports non-printed parts (the hex shaft) for the student to remove; rejected: filtering non-printed parts by name or an Onshape property.
28. Pressing the assembly button when a part is already listed sets its quantity to the assembly count; rejected: adding the count to the existing quantity.
29. A plate holds up to 25 copies (`MAX_COPIES` in `limits.py`), quantities clamp at 25, and the Parts step shows the limit's own sentence when the total passes it; rejected: splitting the copies across plates automatically.
30. Each part row shows the part's size as modelled, with its volume in the tooltip; rejected: showing its triangle count, or the volume on the row, which wrapped at 320 px.
31. The standalone upload accepts STL and 3MF files, by drop or by file chooser; rejected: STL only.

### Layout step

32. Copies arrive in their CAD orientation with no automatic orientation, so the Shooter Hood Rib arrives standing and too tall; rejected: automatically laying every part on its largest flat face.
33. The first visit to the Layout step arranges every copy. Later, a new copy takes the free spot nearest the middle of the copies already there, and a duplicate takes the free spot nearest its original; rejected: the first free spot from the front-left corner, which put new copies far from the group, and parking new copies beside the plate, as the print branch did.
34. Pointer use in the 3D view: drag a copy to move it across the plate; drag empty space to orbit; right-drag or Shift-drag empty space to pan; wheel or pinch to zoom; click to select; Shift-click to add or remove. A press anywhere inside a copy's outline takes that copy, including through a hole such as the pulley's bore; rejected: a toggle between a "move" mode and a "view" mode, and taking a copy only where the pointer touches its surface.
35. A copy is laid down in two ways. A double-click on a flat face lays the copy down on it. The Lay on face tool dims the copies, marks every face a copy can lie on in a pale colour (as Orca's Place on face does), shows the face under the pointer in blue, lays the copy down on a click, and stays on until Done or Escape; rejected: laying down on a plain click, which would collide with selecting and dragging.
36. A face can be lain on when it is flat, on the outside of the part (nothing sticks out past it) and at least 25 mm²; a click on any other surface gets a sentence saying why; rejected: offering only the six bounding-box faces.
37. A copy that no longer fits where it stood after being laid down moves, turned if need be, to the free spot nearest where it stood, and the message says so. When no spot is free with the other copies where they are (the long rib laid flat among small parts), the whole plate is arranged again, the view zooms out to show it, and the message says so; rejected: leaving it overlapping its neighbours for the student to sort out.
38. Rotation about the vertical axis uses one round handle beside the selection, as in the CNC wizard, snapping to 45 degrees within 5 degrees and turning a multi-selection about its common centre; rejected: the print branch's Left 90 / Right 90 buttons and angle field.
39. Duplicate and Delete appear beside the selection's name under the view, only while something is selected; rejected: keeping them in the toolbar, which wrapped to two rows at 320 px. If a duplicate lands out of sight, the view zooms to the copies again.
40. Duplicate and Delete on the Layout step change that part's quantity on the Parts step, and deleting a part's last copy removes the part; rejected: copies that drift apart from the Parts step's quantities.
41. Keyboard: Delete removes the selection, Escape leaves Lay on face or clears the selection, Ctrl or Cmd+A selects every copy; rejected: no keyboard shortcuts.
42. Every broken rule is said twice: its first sentence in a red bar at the top of the 3D view, where the student is looking, and in full under the view with a remedy button (Arrange, or Lay on face). Clicking the red bar scrolls to the full sentences; clicking a full sentence selects the copies it names; rejected: only red copies with no sentences, and sentences only under the view, where they fell below the fold at 320 px. A copy that is too close to two or more others gets one sentence naming all of them.
43. The off-plate sentence names the edge (front, back, left, right), with a small marker at the plate's front; rejected: no edge named, or axis names.
44. The placement rules are `plate.py`'s (5 mm between copies, 3 mm inside the plate edge, 340 mm height), measured on convex hulls, so the hollow side of a curved part is not usable space; rejected: measuring exact outlines.
45. Arrange places the largest copy first, may turn a copy by 90 or 45 degrees to make it fit, and slides the packed group to the middle of the plate; copies that still do not fit wait beside the plate under `limits.py`'s one-plate sentence; rejected: an Arrange that never turns copies, and packing into the front-left corner.
46. Orca's other Prepare tab tools (scale, cut, mirror, auto-orient, per-object settings) are left out; rejected: including them before the owner says which ones count as "similar to the orcaslicer UI". The Layout step stays the panel's width; rejected: filling the panel as advanced mode does.
47. The view opens zoomed to the copies and zooms to them again after Arrange; two small buttons in the view switch between "Zoom to copies" and "Whole plate"; rejected: always framing the whole plate.
48. The hint under the view is three short sentences, with the rest behind "More ways to move and look"; rejected: one long paragraph that pushed the view's messages below the fold.

### Preview step

49. Entering the Preview step starts the slice, and coming back with the same plate and settings shows the last result without slicing again; rejected: a separate Slice button.
50. Slicing progress is a card with a ring gauge around a stacked-layers icon, the percentage and stage name, elapsed time ticking every second beside the time left ("about 0:19 left"), a thin bar, and the list of stages with ticks; rejected: a spinner with a percentage only, and showing the expected total, which leaves the student to subtract.
51. The time left comes from an expected time worked out from the copies, their volume and the layer count; past 130% of that the gauge and the time turn amber with "taking longer than the expected 0:47"; rejected: no expected time.
52. "Generating support" stays in the stage list, struck through, when Supports is off; rejected: hiding that stage.
53. Cancel slice is on the slicing progress card at every moment, beside a line saying that slicing runs on the server and that Back also stops it, and leads to a sentence with Slice again and Back to Layout; rejected: a confirmation dialog before cancelling. Leaving the Preview step while slicing (Back or the step bar) stops the slice without a message; rejected: keeping the slice running in the background, or asking first.
54. A lost connection shows an amber banner with the time it dropped and the reconnect try, freezes the percentage, marks the stage "(last heard)", replaces the time left with "no news since 0:11" while the elapsed time keeps going, and never shows a finished or failed slice until the page reconnects; rejected: failing the slice when the connection drops, and going on showing a time left the page can no longer know.
55. Each slice failure shows the panel's sentence plus a collapsed "Details for a mentor" with Orca's own words and the page id; rejected: the sentence only, or Orca's words only.
56. Empty layers with Supports off name the copy and the height and offer "Turn on Supports and slice again", which visibly sets the Supports change (the summary shows "+1 change") and slices again; rejected: the sentence alone.
57. Empty layers with Supports already on say the mesh is faulty and send the student back to the Parts step to repair the part in CAD and bring it in again; rejected: offering a retry.
58. The plate-too-large refusal happens before slicing and is measured in plastic volume (the memory model), not triangles; rejected: the plate triangle cap. A plate of one copy gets a different remedy (slice it in Orca on a shop computer), because lowering the quantity cannot help.
59. The layer preview is a vertical bar inside the right edge of the 3D view with the layer number on its handle, plus - and + buttons and arrow keys; rejected: Orca's two-handle range bar, and a separate full-panel view. Toolpaths are coloured by line type in Orca's colours with a legend of only the types present; rejected: one colour.
60. The slice summary shows print time and filament weight large, with copies, layers, layer height and the time the slice took on one quiet line; rejected: six equal tiles, which pushed the layer preview below the fold. The two large figures step aside while a plate is being sent or printed, since the print progress card carries the time.
61. The final action is the CNC wizard's split button: Send to Printer, with Download on the caret menu. Choosing from the menu changes the button and does nothing else; rejected: acting at once on a menu choice, as the CNC wizard's Drive item does.
62. Send to Printer opens a confirmation naming the printer, the copies, the print time and the filament, and reminding the student to clear the plate; the print starts on "Send and print". Every "Send again" after a refused or failed send goes through the same confirmation; rejected: sending on the first press.
63. Print progress is a card at the top of the Preview step: the stage in words with the percentage, the file name, a track of the five stages a print goes through (Sending, Heating, Leveling, Printing, Done) with the current one marked, a bar, and four figures: layer of total, time left, time since it was sent and the expected finish as a time of day. A line says the figures are the printer's own report, a few seconds behind. The layer preview follows the printer's layer until the student moves the bar; rejected: a separate printing step or page, and one status line.
64. While this page's plate is being sent or printed, the Send to Printer button reads "Sending…" or "Printing…" and cannot be pressed; Download stays on the menu; rejected: letting a second send go out and be refused by the printer.
65. A busy printer means the plate is not sent, with Send again and Download; rejected: queueing the plate on the printer. An unreachable printer names how long ago the shop computer that talks to the printer last reported; rejected: a generic "printer offline".
66. A print that fails partway marks the stage it failed in on the track, names the layer and the printer's reason, and offers Send again and Download; rejected: a failure state with no remedy.
67. The panel has no pause or stop for a running print; the print progress card says to use the printer's screen; rejected: stopping a running print from the panel.
68. While the file is on its way to the printer the card has **Cancel sending**, and says that nothing prints until the whole file has arrived; cancelling leaves the sliced plate ready to send again; rejected: a send that cannot be taken back once pressed.
69. A slice that times out says to slice again first (the server may have been busy), and only then to lower the quantities or pick the Draft profile; with one copy on the plate it does not mention quantities; rejected: one sentence for every plate, which told a student with one copy to print fewer.

## What is fake and could mislead

1. Toolpaths are generated shapes, not G-code and not Orca's output: walls are each layer's cross-section pushed inward, infill is straight scanlines whatever the pattern, solid and top layers come from comparing neighbouring layers, supports are zig-zags in a grid under downward faces, and brims ring the first layer.
2. Print time and filament grams are estimates from those fake toolpaths, not Orca's numbers.
3. Slicing time, stage durations, the time left and the percentage are invented formulas with a random spread. Whether the real slice service can report a percentage at all is not yet known.
4. The stage names are Orca-like but unverified: nobody has checked what Orca 2.4.2 reports when run headless.
5. Nothing is exported from Onshape; an export takes a random second or so, and an uploaded file is never read: it becomes the next mock part in turn, under the file's name.
6. "Not watertight: 14 open edges in 2 places" is a fixed sentence; nothing checks a mesh.
7. The empty-layer height is 62% of the named copy's height, and the named copy is the not-watertight part if there is one, else the tallest copy.
8. Armed Layout step errors move copies to make the problem, and armed "too tall" adds a Shooter Hood Rib if there is none; armed "plate too large" lowers the cap for that plate and says so in a mockup note.
9. The 600 cm³ plate cap is invented; the real cap waits on memory measurements of the plates the team wants to print.
10. Hulls are thinned to at most 40 points for speed, so placement distances can be off by about 0.2 mm.
11. The printer, the printer's error code, the other student's file name and the 7-minute last report are invented.
12. Download saves nothing; it only shows a sentence.
13. Speeds: at Real-time-ish, slicing runs at clock speed and printing at 60 times; at Fast, slicing runs 6 times and printing 900 times; a lost connection always lasts 8 real seconds.
14. The page around the panel is not Onshape: its feature list is decorative, its graphics area is simplified, the assembly is the mock parts placed to look like a mechanism (they are not mated and do not fit exactly), and the team configuration link does nothing.
15. The automatic brim rule (tall and thin, or a small footprint) is invented.
16. Part sizes and volumes are from the procedural mock geometry, which approximates real FRC parts.
17. Advanced mode shows about 50 settings as a sample; Orca has several hundred.
18. Cancel slice works while the connection is lost, which a real page could not promise.
19. A press inside a copy's outline takes that copy even where the outline is empty (inside the corner of the L Bracket), because the outline is the same filled-in hull the placement rules use.
20. The expected finish time is this computer's clock plus the invented print time. The stages of a print (Heating, Leveling) and their lengths are invented; the real ones come from the stage code the printer reports.
21. Cancel sending always works at once. A real cancel has to reach the shop computer and may arrive after the printer has started.

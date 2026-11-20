# Penguin Slicer mockup: decisions and fakes

The mockup is [index.html](index.html) in this folder; serve the folder with any static
file server and open it. It is a throwaway: its only product is your reactions.

It was built from the CNC wizard (`templates/wizard.html`, `static/wizard.js`,
`static/wizard.css`), the print branch's wizard (`print/`), the stand-in Part Studio
(`testbed/host/`), and sections 5 and 6 of the
[print path restart notes](../../handoffs/2026-10-11-print-path-restart-notes.md). Where
those sources did not decide something, the mockup had to. Every such decision is listed
here, each as the choice made and then the alternative rejected.

The third round (Fri 11-20) follows the
[wizard layout and advanced mode research](../../research/2026-11-19-wizard-layout-and-advanced-mode-research.md)
and your reactions to the second: no modes on the Layout step, parts that arrive lying
sensibly, an Arrange that tries harder, and advanced mode that stays in the panel.

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
| **resting position** | One way a copy can lie on the plate: one flat outside face of its part down, stable (its centre of mass above what touches the plate). |
| **auto-orient** | Choosing a copy's resting position by a score, with no student input. The Layout step's **Auto-orient** button does it on request. |
| **Arrange** | Placing every copy on the plate automatically (the Layout step's button). |
| **rotation handle** | The round handle beside the selection that turns it about the vertical. |
| **resting-position strip** | A row of small pictures under the 3D view, one per resting position of the selected part. The scenario strip calls it **Pictures under the view**. |
| **face markers** | Small amber arrows (↓) on the selected copy's candidate faces; a click lays it on that face. The scenario strip calls them **Arrows on the part's faces**. |
| **box tumbler** | A box around the selected copy whose sides are clicked (or the box dragged) to put that side down. The scenario strip calls it **Box around the part**. |
| **tip handle** | A second handle (⤵) beside the rotation handle that steps the copy to its next resting position. The scenario strip calls it **Tip handle**. |
| **Like Onshape, Like a slicer, Top-down first** | The three mouse schemes the research compared, as the scenario strip's **Mouse** menu names them. The research file calls them Scheme O, Scheme S and Scheme T. |
| **status line** | The one line just above the 3D view on the Layout step: green when every copy fits, red with the first problem when not. |

## Please react to these

This round's questions, each answerable in a sentence. The options are named here exactly
as the scenario strip names them. On the Layout step, select a copy, then switch **Lay on
face**, **Mouse** and **Parts arrive** in the scenario strip; each takes effect at once.
The number in brackets is the entry in the full list below. (Last round's ten questions are
in this file's history; any you have not answered still stand.)

1. **Lay on face (35): which one?** *Pictures under the view* (the research's choice),
   *Arrows on the part's faces*, *Box around the part*, or *Tip handle*? A double-click on a
   flat face works under all four. Try each on the L Bracket and on the Shooter Hood Rib:
   they behave differently on a small blocky part and on a long thin one.
2. **Mouse (34): which one?** *Like Onshape* (right-drag turns the view), *Like a slicer*
   (drag on empty plate turns it, right-drag slides it), or *Top-down first* (the view
   starts from above, drag on empty plate slides it, the 3D button tilts it)?
3. **Parts arrive (32): lying their best way, or as modelled?** Lying their best way, the
   Shooter Hood Rib arrives flat and the student can put it back as modelled; as modelled,
   it arrives standing 353 mm tall with an error and an Auto-orient button.
4. **Advanced mode at 320 px (19, 21):** do the search box, the Common / All settings
   switch, the tab row and the collapsing subgroups make the settings findable, or is the
   column still too cramped?
5. **Advanced mode when the panel is wider (73):** at 560 px the tabs become a rail on the
   left, at 760 px the subgroups sit in two columns. Onshape offers no dialog, so a panel
   dragged wider is the only "bigger" there is. Is that enough?
6. **Arrange and Auto-orient stay two buttons (45, 76):** Arrange decides where copies sit
   and keeps how each one lies; Auto-orient decides how they lie. Arrange offers to lay
   copies their best way only when it has checked that more would then fit. Right, or
   should Arrange always auto-orient first, even if that undoes a way the student chose?
7. **The status line (75):** the plate's state is one line above the picture, where last
   round it was a red bar inside the picture that could cover a copy or the rotation
   handle. Does one line say enough, with the full sentences and their buttons below?

## Open facts, not decisions

The research could not verify these; the mockup takes no position on them.

- **How wide the real panel can be dragged.** PenguinCAM's own CNC help says to widen the
  panel, so a student probably can; Onshape publishes no panel width and no limits. The
  mockup's drag handle allows 240 to 800 px, the test bed's range, not Onshape's.
- **Full screen inside Onshape.** Whether Onshape's panel frame allows the browser's full
  screen (`document.fullscreenEnabled` in the real panel) is untested. The mockup does not
  offer it.
- **An element tab beside the panel.** Whether a PenguinCAM element tab and the right panel
  both survive switching between them is not documented. The mockup does not use one.
- **Onshape's trackpad and touch gestures.** *Like Onshape* copies Onshape's mouse; its
  trackpad and touch gestures were not read in full.
- **Onshape's default mouse.** The research took Onshape's mapping (right-drag turns the
  view) from its documentation; nobody checked it in a real Part Studio for this round.
- **Speed in Onshape.** On an aarch64 Linux machine, auto-orient took 0 to 12 ms per mock
  part and Arrange about 1.5 s for 23 copies in a software-rendered Chrome (1 s in node);
  not measured in Chrome inside Onshape, nor on real team parts, whose meshes are larger.

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
15. Advanced mode covers process settings only (the Quality, Strength, Speed, Support and Others tabs); rejected: also filament and printer settings. It stays inside the panel, in the same browser tab, filling the panel; rejected: a separate browser window or tab (you ruled both out), a dialog (Onshape gives a right-panel application no message that opens one), and an element tab in the document (it would add a tab to every team document that prints and hide the Part Studio while settings change).
16. Changes in advanced mode last for this page load only and are never saved as a profile; rejected: remembered per student, or saved back to the team configuration.
17. Advanced mode range-checks a number when it is entered and keeps the previous value with a sentence giving the allowed range; rejected: passing any value through for Orca to refuse.
18. Reset all in advanced mode asks for a second click ("Reset all 3?"); rejected: resetting at once, or a modal dialog.
19. The advanced mode search comes first, is always visible, matches a setting's label, subgroup, tab and key, and shows results from every tab whatever the Common / All settings switch says; rejected: searching the open tab only.
20. Advanced mode has a "Changed only" filter; rejected: no filter (it was not asked for).
21. Advanced mode is built like Orca's settings column: search, then a **Common / All settings** switch (standing in for Orca's Simple / Advanced / Expert tiers), then the tabs, then Orca's subgroup headings, which collapse. Common shows the 9 to 13 settings per tab teams change most, every subgroup open; All settings adds the rest (still a sample of Orca's), with only the first subgroup open, plus any subgroup holding a change. Each changed setting has an undo arrow (↶) back to the profile's value and says the profile's value under it. The way back is **‹ Setup** at the top and **Back to Setup** at the bottom, beside "Your changes stay for this print"; rejected: a flat list, and tiers named Simple / Advanced / Expert, which would read as a judgement of the student.
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

32. A part's copies arrive in its best resting position, chosen in the browser by the research's score (more contact with the plate, less overhang, lower is better), so the Shooter Hood Rib arrives lying flat, 8 mm tall instead of 353 mm. A message says once per part that it was laid down automatically and how tall it stood; a selected copy says "Laid down automatically" with a **Put back as modelled** link. The scenario strip's **Parts arrive** menu switches to arriving as modelled, with Auto-orient on request, so you can compare; rejected: arriving as modelled (last round's choice), and laying every part on its largest flat face, which stands a bracket on its back.
33. The first visit to the Layout step arranges every copy. Later, a new copy takes the free spot nearest the middle of the copies already there, and a duplicate takes the free spot nearest its original; rejected: the first free spot from the front-left corner, which put new copies far from the group, and parking new copies beside the plate, as the print branch did.
34. The Layout step has no modes: every operation has its own affordance, always on. By default the mouse is *Like Onshape*: left drag that starts on a copy moves it (a press anywhere inside its outline takes it, through a hole too); right drag, or left drag on empty plate, turns the view; middle drag, Ctrl + right drag or Shift + left drag on empty plate slides it; the wheel zooms toward the pointer; click selects, Shift- or Ctrl-click adds or removes, a click on empty plate clears. The scenario strip's **Mouse** menu switches to *Like a slicer* (left drag on empty plate turns the view, right drag slides it) or *Top-down first* (the view starts straight down, left drag on empty plate slides it, right drag or a **3D** button tilts it). A few lines under the view say the current gestures; rejected: a "move" mode and a "view" mode, and last round's slicer mapping as the default, since right drag slides there where it turns the view in Onshape. Turning the view is slowed to about half the usual rate, because in a view this small a short drag otherwise swings it all the way round.
35. Laying a copy on a face has no mode either. By default the **resting-position strip** sits directly under the view while copies of one part are selected, and the panel scrolls it into sight when a click selects a copy: a picture of each resting position (up to six), the best first and marked Best, the current one outlined, each with its height and "overhangs" or "too tall" under it, and "as modelled" last when it is not already one of them; a click lays every selected copy that way. The scenario strip's **Lay on face** menu offers three others to compare: **face markers** (an amber arrow on each candidate face of the one selected copy that faces you, the best one green; hover shows the face, a click lays it there; a drag that starts on an arrow still moves the copy; a face turned away from you has no arrow until you turn the view), the **box tumbler** (a box around the one selected copy; hover shades a side and dashes on the plate the outline it would stand on; a click puts that side down; dragging the box rolls it toward the drag; only the parts of the box not hidden behind the copy itself can be clicked) and the **tip handle** (⤵ beside the rotation handle; a click steps to the next resting position, Shift-click the one before). A double-click on a flat face works in all four. Left out: the free rotation ball that snaps to the nearest resting position, the research's costliest option, which competes with turning the view and is hard to steer in a 320 px view; rejected: last round's Lay on face tool, which stayed on until Done.
36. A face can be lain on when it is flat, on the outside of the part (nothing sticks out past it) and at least 25 mm²; a double-click on any other surface gets a sentence saying why. The resting positions are those faces that leave the part stable, scored, with positions that score the same in every way (the six flats of a hex shaft) shown once; rejected: offering only the six bounding-box faces, except in the box tumbler, which is that option.
37. A copy that no longer fits where it stood after being laid down moves, turned if need be, to the free spot nearest where it stood, and the message says so. When no spot is free with the other copies where they are (the long rib laid flat among small parts), the whole plate is arranged again, the view zooms out to show it, and the message says so; rejected: leaving it overlapping its neighbours for the student to sort out.
38. Rotation about the vertical axis uses one round handle beside the selection, as in the CNC wizard, snapping to 45 degrees within 5 degrees and turning a multi-selection about its common centre; rejected: the print branch's Left 90 / Right 90 buttons and angle field.
39. Duplicate and Delete appear beside the selection's name under the view, only while something is selected; rejected: keeping them in the toolbar, which wrapped to two rows at 320 px. If a duplicate lands out of sight, the view zooms to the copies again.
40. Duplicate and Delete on the Layout step change that part's quantity on the Parts step, and deleting a part's last copy removes the part; rejected: copies that drift apart from the Parts step's quantities.
41. Keyboard, with the view focused: Delete removes the selection, Escape clears it, Ctrl or Cmd+A selects every copy, Ctrl+Z undoes, Ctrl+Y or Ctrl+Shift+Z redoes, Ctrl+D duplicates, F zooms to the copies, Ctrl+1 looks from above; rejected: no keyboard shortcuts.
42. Every broken rule is said twice: its first sentence in the status line just above the 3D view, where the student is looking, and in full under the view with a remedy button (Arrange, or Auto-orient for a copy too tall). Clicking the status line scrolls to the full sentences; clicking a full sentence selects the copies it names; rejected: only red copies with no sentences, and sentences only under the view, where they fell below the fold at 320 px. A copy that is too close to two or more others gets one sentence naming all of them.
43. The off-plate sentence names the edge (front, back, left, right), with a small marker at the plate's front; rejected: no edge named, or axis names.
44. The placement rules are `plate.py`'s (5 mm between copies, 3 mm inside the plate edge, 340 mm height), measured on convex hulls, so the hollow side of a curved part is not usable space; rejected: measuring exact outlines.
45. Arrange runs two packers and keeps the result that leaves fewer copies beside the plate, the smaller pile breaking a tie: last round's shelf packer (largest first, scanning from a corner, turning a copy 90 or 45 degrees when it does not fit) and the research's pile (largest first, each copy tried at the turn that gives its outline the smallest rectangle and a quarter, half and three-quarter turn from it, 45 degrees more only if none fits, every free spot scored by how small and square the pile stays and how near the middle). Either way the group ends in the middle of the plate. Arrange turns copies about the vertical only and keeps each copy's resting position. When copies do not fit it says so in one line ("Arrange placed 16 of 23 copies, turning 14; 7 copies do not fit and wait beside the plate"), and each copy left beside the plate says it did not fit, with Back to Parts in place of an Arrange button that could not help; rejected: one packer only, and auto-orienting every copy first (see question 6 and entry 76).
46. Orca's other Prepare tab tools (scale, cut, mirror, per-object settings) are left out; auto-orient is now in, as a button and on arrival; rejected: including the others before you say which count as "similar to the orcaslicer UI". The Layout step stays the panel's width; rejected: filling the panel as advanced mode does.
47. The view opens zoomed to the copies and zooms to them again after Arrange; small buttons in the view switch between "Zoom to copies", "Whole plate" and "Top" (straight down; under *Top-down first*, where the view starts from above, a "3D" button tilts it instead); rejected: always framing the whole plate.
48. The hint naming the current mouse gestures and the current way to lay a copy down sits below the selection's row and the resting-position strip, with the rest behind "More ways to move and look"; rejected: one long paragraph that pushed the view's messages below the fold, and the hint directly under the view, which pushed the pictures out of sight.

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
59. The layer preview is a vertical bar inside the right edge of the 3D view with the layer number on its handle, plus - and + buttons and arrow keys; rejected: Orca's two-handle range bar, and a separate full-panel view. Toolpaths are coloured by line type in Orca's colours with a legend of only the types present; each row gives that type's print time and share, a last row the time spent heating, travelling and changing layers, and a click on a row hides that type in the layer preview (and shows it again), as Orca's legend does; rejected: one colour, and the rest of Orca's Preview (the horizontal move slider, the other colour schemes, the G-code window, ticks on the layer bar), which the research found not worth it for "pick a profile and print".
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

### Added in the third round

70. Every change on the Layout step can be undone and redone: moving, turning, laying down, Arrange, Auto-orient, Duplicate and Delete, with ↶ ↷ buttons beside Arrange and the usual keys. Undo stays within the Layout step: a change on the Parts step that adds or removes copies starts it afresh; rejected: no undo (last round), and undo across steps, which would have to undo quantities on the Parts step.
71. **Auto-orient** is a button beside Arrange: it lays the selected copies, or every copy when none is selected, in their best resting position. When it changes every copy and they then break a placement rule, it arranges the plate too and says so; rejected: leaving the student to press Arrange after it.
72. Advanced mode's labels carry no axis letters: Orca's "X-Y hole compensation", "Top Z distance" and "Support/object xy distance" read "Hole compensation", "Gap above support" and "Support/object side gap"; the search still finds them by Orca's key ("xy hole"); rejected: Orca's labels as they are.
73. Advanced mode follows the panel's width as it changes (watched, not a fixed breakpoint, so it would follow a panel the student drags): a tab row when narrow; from 480 px a rail of tabs on the left; from 700 px the subgroups in two columns; rejected: the same single column at every width.
74. The mock Onshape page has a drag handle on the panel's left edge, as the CNC help implies Onshape has, limited to the test bed's 240 to 800 px, and the scenario strip's how-to note says the real limits are not known; rejected: only the fixed widths in the Panel width menu.
75. The Layout step's status line is always there and always one line tall, just above the 3D view: "✓ All 3 copies fit the plate." in green, or the first problem in red with "Fix ↓" or "+2 more ↓"; rejected: last round's red bar inside the picture, which could cover a copy or the rotation handle, and a line that appears only when something is wrong, which would move the picture under a drag.
76. Arrange and Auto-orient stay two buttons with two meanings: where copies sit, and how they lie. When Arrange leaves copies over and some do not lie their best way, it also tries the plate with every copy laid its best way, and only if fewer copies are then left over does its message offer one button ("Lay them the best way: 3 more fit"). Lying flat usually takes more of the plate, not less, so the offer is rare; rejected: Arrange always auto-orienting first (it would undo a way the student chose, and on the mock assembly it left 7 copies over where keeping them as they lay left 2), and one button that does both.
77. The rotation handle is drawn over everything in the view, so a tall copy in front of it never hides it; rejected: leaving it on the plate behind the copy, where it disappeared behind a bracket standing on end.
78. A resting position with much of the part hanging over air is labelled "overhangs", and its tooltip says it will probably need Supports; rejected: "needs supports", which claims more than the mockup's invented threshold knows.

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
17. Advanced mode shows about 50 settings under Common and about 95 under All settings, both samples; Orca's five process tabs hold about 295.
18. Cancel slice works while the connection is lost, which a real page could not promise.
19. A press inside a copy's outline takes that copy even where the outline is empty (inside the corner of the L Bracket), because the outline is the same filled-in hull the placement rules use.
20. The expected finish time is this computer's clock plus the invented print time. The stages of a print (Heating, Leveling) and their lengths are invented; the real ones come from the stage code the printer reports.
21. Cancel sending always works at once. A real cancel has to reach the shop computer and may arrive after the printer has started.
22. Auto-orient scores the mock parts' flat outside faces only. The research's candidate set is the faces of the part's 3D convex hull, which also include faces that bridge across a part (from an L bracket's foot to the top of its upright); the mockup leaves those out. The score is ours, not Orca's, and was not compared with Orca's on real parts.
23. The "overhangs" label on a resting position means more than 400 mm² facing down more than 45 degrees, an invented threshold; whether such a part really needs Supports is Orca's to say, and nothing here asks it. Faces inside a mock part where two of its pieces meet (a pulley's flange on its toothed body) are left out of the overhang, a fix for the mock geometry that real exported meshes would not need.
24. *Top-down first* looks straight down through the same perspective camera as the other schemes; the research describes an orthographic view, in which every copy keeps its size wherever it is.
25. The box tumbler's box is the part's bounding box as modelled, so a copy laid on a slanted face gets a slanted box, and a side can put a copy on an edge that would not stand on its own.
26. The panel's drag limits (240 to 800 px) are the test bed's, not Onshape's.

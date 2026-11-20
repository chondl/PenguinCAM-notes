# Brief: research for the wizard's Layout step, Preview step and advanced mode

- **Deliverable (REQUIRED):** one research file at
  `/repos/popcornpenguins/PenguinCAM-notes/research/2026-11-19-wizard-layout-and-advanced-mode-research.md`.
- **Stop condition (REQUIRED):** each of the four questions below has an answer with its
  evidence (a source file and line in Orca Slicer's repository, a documentation page, a
  library's repository, or an experiment you ran), a recommendation for the mockup, and a
  plain statement of what you could not verify.
- **Budget (REQUIRED):** 75 minutes; no cloud spend.
- **Where this fits:** the owner tried an interactive mockup of a 3D printing wizard that
  runs in Onshape's right panel (about 320 px wide) and gave first reactions. Your answers
  decide the next round of changes to the mockup, which another agent makes from your
  file. Recommend the simplest thing that works; the owner said "we don't want to get too
  crazy here".
- **Inputs:** the mockup at `/repos/popcornpenguins/PenguinCAM-notes/mockups/print-wizard/`
  (`index.html`, `js/layout3d.js`, `js/plate.js`, `DECISIONS.md`); PenguinCAM's own Onshape
  integration in `/repos/popcornpenguins/PenguinCAM/.worktrees/onshape-test-bed`
  (`static/wizard.js`, `templates/wizard.html`, the OAuth popup it already opens); Orca
  Slicer's public repository and documentation on the web; an installed Orca Slicer 2.4.2
  at `/repos/popcornpenguins/penguin-slicer/slice/tools/orca` (its GUI can run under Xvfb,
  but a first-run dialog may block it; do not spend more than ten minutes on that).
- **Standing rules that apply:** read-only everywhere except your deliverable; one plain
  shell command per call with absolute paths; no `rm` on variable-built paths; files
  written with the Write tool; no git commands that write; do not touch port 6238; no
  personal or project details in any web request beyond public search terms. When one
  Markdown file refers to another, use a real Markdown link. Diagrams, if any, as
  `mermaid` fences, `flowchart TB`. Give every concept one name and keep it.

## The owner's reactions, quoted

1. "Can the advanced modeling parameters be a bigger dialog box in onshape versus being
   trapped in that narrow 320-pixel-wide window?"
2. "Can the initial layout do rotations to get a better auto layout? I'm specifically
   referring to the shooter hood rib. Seems like the default orientation in the Parts
   Studio assembly is unlikely to be the best way to print. It seems like we could do a
   better job here arranging the items. ... see if there's something you can do simply,
   or if there's a third-party library. Or maybe the Orca codebase has a library for doing
   an auto arrange that we can base something here on. That said, I do think this should
   generally be client-side code in JavaScript versus going to the server to arrange. We
   don't want to get too crazy here and if it's just too hard to make the automatic
   arrangement work, then let's not."
3. "I'm also not thrilled about the modality of having a modal for Arrange and then having
   a mode for [Lay on] Face. It seems like this could be handled with something where you
   can just click on the object, similarly to the drag handle for rotation. ... I'm not
   sure what UI we could use to do Lay on Face without a mode but it seems like something
   that you could handle by not having to have an Arrange versus [Lay on] Face mode
   switch."
4. "Take a look at how Orca Slicer does both their layout and preview panels and see if
   there's anything you can learn from that ... some of the folks that did Orca Slicer
   spent some time on this."

## The four questions

**A. A bigger surface for advanced mode inside Onshape.** What can an application that
lives in Onshape's right panel open that is larger than the panel? Check Onshape's
developer documentation for the extension locations and the messages a panel application
may send, and whether any of them shows application content in a large dialog or a tab.
Check what PenguinCAM already does (it opens a browser popup window for sign-in). Compare
the realistic options: a separate browser window opened from the panel and kept in step
with it (how the two would talk, what happens if popups are blocked, what happens when the
panel reloads), a full Onshape tab for the application, widening nothing and improving the
narrow view. Recommend one, and say how the mockup can imitate it honestly.

**B. Choosing how each part lies, automatically.** How does Orca Slicer choose an
orientation (its auto-orient command) and what does it optimise (bed contact area,
overhang, height)? Find the algorithm and its source (Orca's orientation code descends
from the Tweaker-3 project). Is there a JavaScript implementation or a small one to write:
for example, score each candidate face of the part's convex hull by contact area, by the
area of faces that would overhang, and by height, and pick the best? State the candidate
set, the score, the cost for a part of 100,000 triangles in a browser, and where the
simple approach goes wrong (parts that need supports whichever way they lie, round parts,
parts whose strongest direction matters: a layer line across a thin rib is weak). The
owner's test case is a long curved rib standing on its end.

**C. Arranging the parts on the plate, automatically.** How does Orca arrange (its
arrange command is built on the libnest2d library): what does it place, with what
rotations, toward what goal? What exists for JavaScript that runs in a browser with no
server (for example ports or relatives of SVGnest and Deepnest, rectangle packers, or a
small bottom-left placement of convex hulls with a few rotations each)? Recommend the
simplest approach that beats the mockup's current Arrange, for at most 25 copies on one
plate, with a spacing between copies, and say what it costs and when it fails. If nothing
simple is good enough, say so plainly.

**D. Interaction without modes, and what Orca's two main views do.** Describe, from
Orca's source and documentation, how its Prepare view handles selecting, moving, rotating,
laying a part on a face, auto-orient and arrange: which are tools that stay switched on
(modes), which are single actions, which appear on the selected part itself, and what the
mouse buttons and wheel do. Then describe its Preview view: the layer slider, the
horizontal slider within a layer, the colour schemes and legend, and what a user can turn
on and off. From that, propose two or three concrete ways the mockup could offer "lay
this part on that face" with no mode switch (for example: when a copy is selected, its
candidate faces show as markers on the part and one click on a marker lays it down, as a
rotation handle appears on a selected copy; or a small strip of thumbnails, one per stable
resting position, under the view), with the trade-offs of each at 320 px, and recommend
one. Say which other ideas from Orca's two views are worth taking and which are not, for a
tool whose common case is "pick a profile and print".

## The research file

Start with a short answer of at most ten lines: the recommendation for each of A to D.
Then a section per question with its evidence. Then a list "For the mockup": the concrete
changes you recommend, each one sentence, most valuable first. Then "Not verified".
Do the work yourself; you have no sub-agents. End your reply with one status line
(`DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT`, `BLOCKED`) and at most 14 more lines.

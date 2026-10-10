# Running an Onshape checkpoint

**The development server in record mode in the agent container, Chrome on the Mac, the
PenguinCAM-chondl-dev panel inside real Onshape.**

An Onshape checkpoint is the manual fallback for the automated Onshape UI run: I run the
panel scenarios by hand in the Mac's Chrome while PenguinCAM records. Use it when Onshape's
bot checks stop an automated Onshape UI run, or when I want to watch the panel myself. The
recordings are the same as from an automated Onshape UI run. The terms are the ones in the
[test bed design spec](../specs/2026-10-09-onshape-test-bed-design.md), section 3; the
developer guide is [docs/ONSHAPE_TEST_BED.md](https://github.com/6238/PenguinCAM/blob/main/docs/ONSHAPE_TEST_BED.md)
in PenguinCAM (on `feature/onshape-test-bed` until it merges).

Every Onshape call the panel makes in record mode is a counted call against my EDU Student
allowance of 2,500 a year, and the test bed's share of it (250 by default). A checkpoint of
every panel scenario costs a few tens of calls.

## 1. Before I start (the agent does this)

1. Check the budget: `uv run python -m testbed ledger` in the worktree. The development
   server does not check the budget itself, so this is the check.
2. Check that `testbed/documents.json` exists and has no `pending` entry. If it does,
   `build-docs` has not finished (a document is outside the test folder; move it in
   Onshape, then run `build-docs` again).
3. Stop anything on port 6238 and start the development server in record mode from the
   worktree, from a shell that has `ONSHAPE_CLIENT_ID` and `ONSHAPE_CLIENT_SECRET` (the
   dev app's):

   ```
   PENGUINCAM_TESTBED=record EMBED_COOKIES=1 uv run python frc_cam_gui_app.py 2>&1 | tee <log>
   ```

   It refuses to start without the dev app's credentials or with the production app's id.
   Then run the three checks in the workspace's CLAUDE.md (the 200, the cookie line, the
   OAuth redirect) and tell me where the log is.

## 2. The checkpoint (I do this in the Mac's Chrome)

For each scenario the agent names:

1. **Open the test document** the scenario names (`tb-box`, `tb-two-parts` or
   `tb-assembly`, in the "PenguinCAM test bed" folder).
2. **Open the PenguinCAM-chondl-dev panel** in the right panel. Connect through OAuth when
   it asks.
3. **Choose 3D Printing.** The checklist strip appears at the top of the print page.
4. **Choose the scenario** in the checklist strip. For `panel-load` and `to-print`, which
   start on the CNC page, choose it once the print page has opened.
5. **Work through the steps.** Press each button the checklist strip offers. When a step
   asks for a selection, make it in Onshape's parts list or feature tree, or in Onshape's
   select dialog, never by clicking in the 3D view. Then press Next.
6. **Press Done** in the checklist strip. It shows where the message log and the cassette
   were saved. If it says the cassette was not saved, choose the scenario again and redo it.

The panel scenarios:

| Scenario | Test document | What I do |
|---|---|---|
| `panel-load` | `tb-box` | Open the panel, check the team config banner, choose 3D Printing |
| `to-print` | `tb-box` | Choose 3D Printing, then Back; the panel must return to `tb-box` |
| `part-select` | `tb-two-parts` | Ask for a part, select Cylinder; open the part dialog, select Box; close the dialog |
| `multi-select` | `tb-two-parts` | Ask for two parts, select Box and Cylinder; clear the selection; open the parts dialog, select Cylinder then Box; close the dialog |
| `assembly-select` | `tb-assembly` | Ask for a part, select Box <1>; open the part dialog, select Box <2>; close the dialog |

## 3. After (the agent does this)

1. Run `uv run python -m testbed drift` and report the drift report
   (`testbed/.fresh/drift-report.md`), the counted calls (`testbed ledger` again) and the
   remaining budget.
2. On a first recording, or when I agree the differences are real Onshape changes,
   `accept` the scenarios and commit the recordings with a message that says why.
3. Stop the record-mode server, and restart the ordinary development server if I want it
   back on 6238.

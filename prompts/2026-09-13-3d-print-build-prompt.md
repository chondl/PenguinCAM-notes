Build the 3D print slicing feature for PenguinCAM, stage 1, exactly as specified in
`docs/superpowers/specs/2026-09-13-3d-print-slicing-design.md`. Read the whole spec first,
including section 11, which has build notes, preserved artefacts and the end-to-end acceptance
steps. Brainstorming and adversarial review are done; do not reopen the design. Where the spec
says a fact is still to be confirmed (section 10), confirm it and record the answer in the docs
the spec names.

Process:

1. Split the work into these subfeatures, in order: (a) Orca install script, wrapper, Makefile
   and Dockerfile; (b) profile flattening, sample part and `print/slicer.py`; (c) job pool,
   routes, event stream and the two small touches to the Flask app; (d) the print wizard page,
   its JS, the viewer, and the two touches to the CNC wizard; (e) CI, documentation, and the
   Playwright acceptance run.
2. For each subfeature: write a plan with the superpowers writing-plans skill, then implement it
   with the superpowers subagent-driven-development skill. Test-driven development throughout.
   Run `make test-quick` after each task and `make test` at the end of each subfeature.
3. Use subagents pervasively: one per task for implementation, separate ones for review. Pass
   `model: "opus"` to every subagent unless a task needs Fable, and say why when it does. Keep
   the orchestrator on Fable and keep it out of the code: it plans, dispatches, reviews results,
   and decides.
4. After the automated tests pass, run the Playwright acceptance steps in spec section 11 against
   the real development server, started per the workspace `CLAUDE.md`. Treat every failure as a
   defect: fix it, rerun the automated tests, rerun the acceptance step. Keep the screenshots.
5. Work on a feature branch named `feature/3d-print-stage1` off `main`, committing after each
   subfeature. Never commit to or push `main`. Do not open a pull request unless asked.
6. Before finishing, promote durable learnings into the repository docs as the spec's section 12
   lists, and end with a summary that stands on its own: what was built, what `make test` printed,
   the acceptance results with screenshot paths, the server log path, and anything left open.

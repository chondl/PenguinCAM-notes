# Brief: fix the defects a review found

The dispatch line names the **component** (`slice` or `delivery`), the review file to work
from, and the result path.

- **Deliverable (REQUIRED):** the defects fixed in the component's folder in
  `/repos/popcornpenguins/penguin-slicer`, and a result file at the result path listing,
  per numbered defect: fixed (how, and the test that now proves it), or not fixed (why).
- **Stop condition (REQUIRED):** every defect in the review is fixed or answered, the fast
  suite passes 20 times in random order with 2 workers, and coverage has not fallen.
- **Budget (REQUIRED):** 90 minutes; no cloud spend.
- **Where this fits:** an independent reviewer checked this component and listed defects.
  A fresh reviewer will check your fixes.
- **Inputs:** [standing-rules.md](standing-rules.md) first, then the review file, then the
  component. For hardening work also the component's hardening brief.

Fix each defect at its cause, test first: write the test that shows the defect, see it
fail, then fix. If you believe a defect is wrong, say why with evidence instead of
changing code. Do not widen the work beyond the review's list, except that a defect of
the same kind found beside a listed one is fixed too and reported.

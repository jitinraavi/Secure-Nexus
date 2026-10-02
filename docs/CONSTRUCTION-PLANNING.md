# Construction planning module

Implemented on `upgrade/r1-modeling-core`, continuing from `6b6cfbdd34d1a8f73fa3b00dedac7f09559d2e85`. The separately pushed `566dedaa2420cf13868c0effe81b7a5c16ad4510` fixes the missing `Badge` import reported by lint. `Editor.tsx` already uses `revisionRef`; the earlier unused `revision` state and `setRevision` calls are absent from this branch.

## Schedule calculation and controls

Open **Schedule** in the primary editor's 4D planning bar. Select one activity to edit its whole calendar-day duration, earliest-start offset, finish-to-start predecessors, crew size, budget estimate, reported progress and actual cost. Add phases as needed. Set an optional project start date for calendar labels. Existing designs keep their manual percentage timeline; choose **Calculated dependency dates** to link the viewer to the dependency plan. Explicitly empty phase lists remain empty.

The iterative forward/backward CPM passes calculate earliest and latest starts/finishes, total float and critical activities. Independent activities overlap. A phase starts after every predecessor finishes and after its earliest-start offset. Default new-project phases retain the previous site/structure/envelope/fit-out sequence as explicit dependencies. Legacy saved phases without durations use their previous percentage-span estimate, with a warning; dependencies are not invented for saved phases.

The plan displays activity dates, critical bars, crew demand at the review day, total crew-days, peak simultaneous crew, budget, actual cost, reported progress, earned value and schedule/cost variances. Baselines preserve activity offsets and estimates. Variances include project-start-date changes when both plans have calendar dates. Added/removed activities are identified. CSV exports include dependencies, release offsets, early/late dates, float, status and baseline variances; JSON includes the report, crew intervals, units and assumptions. String cells are quoted and protected against spreadsheet formula interpretation.

## Model bindings

Phase selectors cover primary-room furniture, community towers/amenities/drafts/interior rooms, infrastructure facilities/drafts and primary-view MEP elements. Unassigned objects and references to deleted phases remain visible; missing references appear explicitly in selectors. Tower labels and MEP geometry follow the same phase filtering. Objects appear at activity start and remain visible after completion; this does not animate construction geometry or demolition. The separate room-furnishing modal remains timeline-neutral.

Phase filtering can be disabled independently of the schedule. Dependency mode reuses the calculation across time-only changes. Cycles, duplicate IDs, missing/self/repeated dependency links, invalid numeric values and invalid dates block calculated schedules and show diagnostics. Invalid dependency plans leave model phases visible. Malformed stored phase records are excluded from controls with an explicit diagnostic; saving visualization or phase edits removes those malformed records. There is no partial calculated plan.

## Assumptions and limits

- Whole calendar days include weekends; there are no working calendars, holidays, lagged links, start-to-start links or resource leveling.
- Supported bounds are 1,000 activities, 10,000 links, 36,500 days per activity and a 365,000-day project horizon. Numeric and date bounds are checked before producing a plan.
- Activity and model-phase selection lists show at most 1,000 entries. The panel edits one activity at a time to avoid quadratic dependency-option DOM. Oversized well-formed stored plans remain intact and show validation errors; their data is not silently truncated.
- Finish dates are exclusive boundaries: a one-day activity starting January 1 finishes at the January 2 boundary.
- Planned value accrues linearly over each activity. Entered progress and actual costs are the latest status snapshot, not a dated history. Review-time changes compare that snapshot with planned progress, without reconstructing historic actuals.
- Overall progress is budget-weighted when the total budget is positive; otherwise it is duration-weighted. Costs use a common project currency; no currency conversion or model quantity pricing is performed.
- Criticality reflects dependencies and release offsets, without resource constraints. Crew totals are demand summaries. Baseline replacement is explicit and preserves only the latest baseline.
- Community/infrastructure playback still rebuilds their scene geometry; large-model playback performance has not been measured. This module does not add a renderer/worker redesign.

## Inspection-only verification

Reviewed types, imports and callers, graph ordering, exclusive boundaries, baseline date shifts, resource interval ordering, cost/progress formulas and CSV quoting from repository text. Peer agents independently inspected the new schedule and its scene integration.

No application, test, lint/type checker, build, preview or repository code was executed. Compiler correctness, rendered controls, playback/save behavior, browser performance and numeric edge cases remain unverified. No claim of construction certification or professional scheduling validation is made.

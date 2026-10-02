# Live model documentation

The documentation module now resolves configured schedules to persisted model occurrences instead of exporting the schedule name and field list as placeholder rows. Schedule and sheet settings remain in `Design.documentation`; new settings are optional so older projects retain their defaults.

## Schedule workflow

Open **Docs / exports**, add a schedule and choose Objects, Rooms, Furniture, Levels or MEP. Objects includes persisted physical occurrences across room, community and infrastructure scopes, excluding level records. Use a `Scope` filter to limit the active context. The inventory includes explicit openings and nested room furniture/MEP, hidden MEP elements and infrastructure facility counts. It does not invent generated facade windows, inferred framing, catalog dimensions or fabrication quantities.

Enter comma-separated fields; they are committed when the field input loses focus. Available fields are shown beside the editor. Field names ignore case and repeated spaces. Family values can be read through `TypeParameter:key` and `InstanceParameter:key`. Unrecognized fields produce blank cells with a warning, preserving the saved field definition.

Filters are combined with AND. Contains and Equals compare text without case sensitivity. Greater than and Less than require a numeric model value and a finite numeric threshold. Sorting compares numeric values numerically and otherwise uses text/numeric collation, with record IDs as tie-breakers. Grouping collects equal values of one field: Quantity, Length m, Area m2, Volume m3 and Rated power kW sum when every contributing value is known. Other fields retain their common value or show `(varies)`. Unknown values stay blank rather than becoming zero. A grouped sort field must be displayed in the output.

The preview shows the first 12 rows. **Download CSV** and **Download JSON** include every output row. JSON also includes source IDs, selected fields, warnings and the schedule definition. CSV quotes fields, retains full values and prefixes formula-like text for spreadsheet safety. Numbers are rounded to four decimal places for presentation; calculations use the saved numeric inputs.

## Sheets, annotations and revisions

Each sheet can bind multiple views, selected schedules and selected revision records. Undefined schedule bindings preserve the legacy default of all schedules on schedule sheets; explicitly selecting none emits no schedules. Undefined revision bindings retain all project revisions; explicit selections determine that sheet's latest revision footer.

Multiple views produce separately labeled continuation pages under the sheet number. Schedule tables paginate vertically at 19 rows and horizontally at six fields, so long schedules and wide field sets retain every row/column. BOQ items, revision history, review notes, screening results and annotations also receive continuation pages. Long table cells are shortened for page layout; complete values remain in CSV/JSON.

Annotations can bind to a view and a model target ID. The target name is resolved from the current inventory at export time. Removed or ambiguous targets remain in the notes and produce warnings. Global annotations accompany the relevant sheet/view notes; these are textual continuation notes, not geometric leaders or associative dimensions. View deletion removes sheet bindings while retaining an annotation's stale binding for review. Schedule/revision deletion cleans their sheet bindings.

The documentation inspector reports unknown schedule fields, missing bindings, removed annotation targets and duplicate sheet numbers. PDF commands and header are ASCII, ensuring that string offsets match encoded byte offsets in the cross-reference table. Unsupported Unicode characters are represented as `?`; multilingual font embedding is not implemented.

## Scope and verification

PDF export rejects output above 500 pages, 10,000 commands per page or 8 MB of drawing commands. Schematic floor lines are capped at 300 per tower and runway symbols at 64. Export failures are surfaced in the menu. CSV protection also covers whitespace-prefixed formula text.

Geometry pages remain fitted schematic studies from the existing renderer. Requested scale/orientation are metadata and are labeled accordingly; this module does not claim production drawing scales, rotated projections, material-layer takeoffs or professional BIM certification. Envelope areas/volumes and MEP polyline lengths are planning quantities. Dimensions are expressed in SI regardless of the user's display-unit preference; tower dimensions use the codebase's existing `towerMeters` conversion.

Only source files were inspected and edited. No app, lint, TypeScript compiler, tests, build, PDF renderer or preview was run. TypeScript integration, PDF interoperability/layout, browser input behavior and large-model export responsiveness therefore remain unverified.

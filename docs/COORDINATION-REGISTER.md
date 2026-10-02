# Coordination issue register

Community and infrastructure reviews promote findings to persisted issues grouped by category and linked IDs. Repeated checks retain existing and resolved issues. The register adds workflow, assignee labels, due dates, comments, camera viewpoints, filters, pagination and CSV/JSON/BCF export. Assignee labels do not send notifications.

BCF import is bounded to 10 MB compressed, 64 MB expanded metadata, 8,000 ZIP entries, 2,000 topics and 1 MB per XML file. ZIP64, encryption, unsafe paths, DTDs and entities are rejected. Only supported topic/camera/component metadata is read. Snapshots and arbitrary attachments are not imported. Existing issues are preserved. Standard XML title, status, priority, comments and camera data take precedence over optional Groundwork metadata when an external editor changes a package.

Stable source IFC GUIDs map known components to local IDs. Unknown GUIDs remain attached to viewpoints without becoming selectable local IDs. Coordinates follow the current IFC export's X/Y-horizontal, Z-up convention; viewport coordinates use Y-up. Showing an issue restores position and direction, while retaining the viewport projection/FOV. Camera metadata is preserved for exchange.

BCF entry reads use JSZip's typed public `async("uint8array")` API and check actual expanded byte lengths before decoding. Archive central-directory limits are checked before loading. This API materializes each expanded entry before its actual-size check, so it is not a hard allocation ceiling for an archive with deliberately forged size headers.

Source inspection only: TypeScript integration, ZIP interoperability, BCF schema conformance and camera behavior have not been executed or independently validated. Clash findings remain geometric approximations.

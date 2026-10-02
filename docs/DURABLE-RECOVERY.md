# Durable draft recovery and conflict review

Edits are stored immediately before the autosave delay, with the last acknowledged design/name/type and revision as the merge base. Durable localStorage records are scoped by account, project and a fresh page identity; cloned browser tabs cannot overwrite the same record. A reload can offer a previous-page recovery explicitly. Session storage and memory provide bounded fallbacks, with quota/unavailable-storage messages and a local JSON download.

Recovery payloads are limited to 4,000,000 characters, including their merge base. Designs exceeding that bound remain in memory and can be downloaded. A recovered design is displayed immediately, so subsequent edits retain that work until retry, merge or explicit discard. Browser storage is plaintext on the current device/origin; it is not a server backup or encrypted vault. Older base-less records support download, retry and discard but cannot enter three-way comparison. Cleanup of a selected older record checks its saved timestamp to preserve newer edits by its owning tab.

The comparison merges independent JSON fields and unique-ID entity arrays. Coordinate and other non-ID arrays are atomic. Conflicting edits, deletion versus editing, different concurrent additions under the same ID and conflicting ordering require explicit local/remote choices. Comparison downloads retain complete values, while previews and pages are bounded. Merge input is capped at 4,000,000 characters, 150,000 values, 64 nesting levels and 5,000 conflicts.

Apply re-fetches the remote revision. A changed revision restarts review; the save still uses the server revision check and existing access/object-lock checks. HTTP 401/403/409/423 suspends automatic retry until an explicit retry or merge. Failed saves retain the local data and original base. This is whole-document reconciliation, not a CRDT or durable server operation queue.

The bounded JSON parser now accepts up to 8 MB for escaped project payloads; payment webhook bodies retain a 256 KB bound. Oversized requests return a readable 413 response.

Only source files were inspected and edited. No app, browser storage, compiler, tests, builds or previews were executed. Storage quota behavior, tab races, merge semantics, navigation races and server integration remain unverified.

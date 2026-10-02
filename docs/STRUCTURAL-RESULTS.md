# External structural result review

Structural exchange JSON includes a deterministic model/load fingerprint and the normalized result schema. The analysis panel imports bounded JSON containing solver name, run ID, solved-at timestamp, node displacements/rotations and member forces/moments for matching node/member/combination IDs. The empty template is a schema request and cannot be imported as a solved result.

The importer rejects stale fingerprints, wrong units/axes/sign convention, unknown or duplicate result IDs, nonfinite values and more than 20,000 rows or 6 MB. Imported results remain attached when the model changes; the review then reports them as stale. Node/member coverage and displacement magnitudes are shown. Member axial/flexural values are compared to existing gravity planning screens, with solver local axes and per-combination differences explicitly requiring review. Comparison JSON contains all rows; the UI paginates by 50.

This module does not execute a solver, authenticate its output, calculate regulatory design or change verification from not-verified. External schema adapters and professional review remain necessary. The fingerprint is a deterministic identity check, not a security signature.

Only source files were inspected and edited. No app, compiler, tests, builds, solver, import sample or preview was executed; numerical integration and external interoperability remain unverified.

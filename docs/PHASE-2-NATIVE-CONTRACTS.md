# Native adapter contracts

The Phase 2 adapters implement fixed native jobs, not arbitrary uploaded programs. The existing browser solvers and exported decks remain separate. No native application, build, test, preview or type checker was executed during this implementation. Operational acceptance and engineering benchmark validation remain deferred under the source-only instruction.

## Deployment boundary

Native processing is disabled by default and unavailable on Windows hosts. A deployment must provide an isolated Linux native account, with a numeric UID and GID different from the API account; an absolute administrator-controlled `prlimit` executable; pinned native executable paths; and an explicit operator acknowledgement of external confinement. The acknowledgement declares deployment policy and does not create a sandbox.

The native identity must have no network access, secrets access, project/database access or access to other users' files. Enforce that policy with a container or suitable AppArmor/SELinux/filesystem/network rules. Native account filesystem and network isolation is an external deployment prerequisite; Node's process API and resource limits alone do not provide it. Native tools and every ancestor of their resolved executable paths must be immutable to the native account and must not be group/world writable. The adapter checks those ownership/mode requirements before execution.

The supervisor needs permission to assign a private job working directory and input files to the native account, spawn that account, read its outputs and remove its directory. Use a dedicated tightly confined supervisor deployment rather than adding ambient privileges to a general web server. The private parent job directory belongs to the supervisor; each temporary child starts empty, is checked for symlinks, and receives mode `0700`. Inputs are created exclusively with `O_NOFOLLOW` and mode `0600`.

Processes use `shell: false`, fixed arguments, a minimal environment, a separate process group and these `prlimit` settings: 512 MiB address space, 60 seconds CPU, 32 MiB per file, 32 processes and 64 descriptors. The adapter's fallback application timeout is 60 seconds; the application's current worker configuration sets 90 seconds, with an absolute cap of 120 seconds. Input and the complete accepted output bundle are each capped at 32 MiB; stdout/stderr are capped together at 128 KiB. An interval checks only allowlisted ordinary single-link files; a final scan completes before accepting outputs. Timeout, cancellation, limits, unexpected files or failed exit reject the result. The process group is killed on termination. These are per-process limits and do not replace container CPU, memory, disk and process quotas.

Runtime failures expose fixed error codes and messages. Native diagnostic text is an authorized project output artifact, not an API error. The durable worker owns temporary directory cleanup and authorization/lease checks. It must not publish outputs from a stale or cancelled lease.

## LibreDWG 0.13.4

The fixed conversion contracts are:

| Kind | Program and arguments | Staged input | Expected output |
| --- | --- | --- | --- |
| `dwg-to-dxf` | `dwg2dxf --as=r2000 input.dwg` | Original DWG bytes | `input.dxf`, stored as `converted.dxf` |
| `dxf-to-dwg` | `dxf2dwg --as=r2000 input.dxf` | UTF-8 ASCII DXF bytes | `input.dwg`, stored as `converted.dwg` |

Each job first checks the converter's `--version` result against 0.13.4. Executable paths, options and input/output basenames are operator/server values; requests cannot supply command arguments or paths. The source SHA-256 is checked before staging and again after conversion. The encrypted source artifact remains immutable.

DWG input requires an AutoCAD version signature. DXF input requires bounded numeric group-code/value pairs, balanced sections, an entities section and a final EOF pair; binary DXF and other text encodings are excluded. Output DWG requires the R2000 `AC1015` signature, and converted DXF must meet the same text structure contract. These checks establish format structure, not full drawing fidelity. Original drawing units are preserved without inferred rescaling. There is no automatic conversion into parametric BIM elements.

The [GNU program manual](https://www.gnu.org/software/libredwg/manual/html_node/Programs.html) documents conversion in the working directory and experimental DWG writing. The pinned [dxf2dwg 0.13.4 program contract](https://github.com/LibreDWG/libredwg/blob/0.13.4/programs/dxf2dwg.1) and [dwg2dxf 0.13.4 program contract](https://github.com/LibreDWG/libredwg/blob/0.13.4/programs/dwg2dxf.1) support the chosen R2000 options. LibreDWG needs no Autodesk credentials; its [GNU project page](https://www.gnu.org/software/libredwg/) documents GPLv3-or-later and compatibility limitations. Review distribution/deployment obligations for the selected binaries before deploying them.

## OpenSees 3.8.0 planar static frames

Input is a JSON artifact containing `{ version: 1, model: FrameModel2D, combinationId?: string }`. The client normalizes the existing model to allowlisted fields. The server independently validates coordinates, section properties, IDs, references, restraints, load cases and combination factors; it generates the Tcl itself. User strings and uploaded scripts are never evaluated or inserted into Tcl. Integer solver tags preserve source IDs through the manifest.

Supported physics are planar 2D prismatic elastic Euler-Bernoulli members, three nodal degrees of freedom, rigid connections, zero restrained displacement, nodal loads and member-local uniform axial/transverse loads. One selected combination is run. `Linear` or elastic geometric `PDelta` transformations are supported. Material nonlinearity, releases, settlements, 3D stiffness, section classification and code design are excluded.

The native deck checks `[version]` against 3.8.0 before constructing the model. It uses `elasticBeamColumn`, `Plain` constraints, `RCM`, `BandGeneral`, `NormDispIncr 1e-10 40`, the Linear/Newton algorithm and ten `LoadControl 0.1` steps. The browser's relative tolerance/iteration options are not native convergence settings; the manifest declares the actual native settings and warns about this distinction. Input design criteria are preserved but are not assessed by this adapter.

An accepted run requires exit code zero, successful analysis status, load factor one and complete finite rows with each expected tag exactly once:

| Artifact | Row fields after the integer tag |
| --- | --- |
| `secure-nexus-node-displacements.txt` | `uxM uyM rotationRad` |
| `secure-nexus-node-reactions.txt` | `fxN fyN mzNm` for every node, after `reactions` |
| `secure-nexus-member-global-forces.txt` | Six global end-force components: start X/Y/moment and end X/Y/moment |
| `secure-nexus-run-status.txt` | Runtime version, analysis status, final load factor |

The generated Tcl queries each displacement, reaction and force component separately and inserts explicit spaces, avoiding the native vector formatter's adjacent fixed-width values. Native command numeric formatting remains the binary's contract; the Tcl/output precision settings do not imply a guarantee about every native response formatter. The generated Tcl, runtime status and bounded execution log are retained as outputs. The manifest binds the exact source artifact ID/SHA-256, deck SHA-256, every output byte length/hash, selected combination, planar dimension, SI units, restraints and solver/source tag mappings. `computed-unvalidated` means the configured native process produced structurally accepted output; it does not mean independently benchmarked engineering correctness or certification.

The browser result parser verifies those byte fingerprints and mappings against the immutable job source and, when supplied, the job's manifest fingerprint. It keeps the parsed result separate from current editable models and browser reports. A planar slice cannot verify the original 3D building or changed source data. Reaction/force signs, equilibrium, mesh, units and the different PDelta/browser initial-stress approximations need independent engineering review.

The pinned release comes from the [official OpenSees distribution](https://opensees.berkeley.edu/OpenSees/user/download.php). The [elasticBeamColumn definition](https://opensees.github.io/OpenSeesDocumentation/user/manual/model/elements/elasticBeamColumn.html), [analyze return contract](https://opensees.github.io/OpenSeesDocumentation/user/manual/analysis/analyze.html), [nodeDisp output](https://opensees.github.io/OpenSeesDocumentation/user/manual/misc/nodeDisp.html) and [OpenSees 3.8.0 Tcl command source](https://github.com/OpenSees/OpenSees/blob/v3.8.0/SRC/tcl/commands.cpp) provide the native contract. The pinned source registers both `version` and `setPrecision`; the latter controls the diagnostic stream rather than every scalar response's numeric formatting. LibreDWG's pinned [dwg2dxf source](https://github.com/LibreDWG/libredwg/blob/0.13.4/programs/dwg2dxf.c) and [dxf2dwg source](https://github.com/LibreDWG/libredwg/blob/0.13.4/programs/dxf2dwg.c) confirm that `--version` prints the program name followed by its package version.

OpenSees has University of California terms, not an assumed unrestricted commercial license. Its [pinned 3.8.0 copyright](https://github.com/OpenSees/OpenSees/blob/v3.8.0/COPYRIGHT) and [official copyright page](https://opensees.berkeley.edu/OpenSees/copyright.php) distinguish noncommercial educational/research/nonprofit uses, other entities' internal use, and commercial product permissions obtainable from the University. An operator must establish appropriate rights before enabling it in a commercial deployment. No OpenSees binary or upstream source is redistributed in this change. Installation, isolation, applicable deployment rights and fixtures are still required; no native tool was installed or run in this change.

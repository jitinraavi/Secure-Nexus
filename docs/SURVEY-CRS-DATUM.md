# Survey CRS, height units and datum provenance

Phase 5 extends `client/src/lib/surveyExchange.ts` with bounded source metadata retention and an explicit terrain declaration gate. It does not certify CRS correctness, survey accuracy, geoid choice or engineering suitability.

## Raw import and terrain preparation

`SurveyImport.points` retains source coordinates and heights. The existing property name `elevationM` is a compatibility alias at this stage; it does **not** mean the imported values have been converted to metres. Metadata marks `coordinateEncoding: "source-units"`. CSV, LAS and GeoTIFF readers never silently relabel feet as metres or choose a vertical datum.

Before constructing a TIN, mesh, contour, earthworks section or civil analysis, call `prepareSurveyForTerrain(survey, declaration)`. The declaration requires:

```json
{
  "version": 1,
  "horizontalCrs": "EPSG:32632",
  "horizontalUnit": "m",
  "axisOrder": "east-north",
  "elevationUnit": "us-survey-foot",
  "verticalDatum": "EPSG:6360",
  "source": "Survey delivery manifest, drawing revision and surveyor declaration"
}
```

This example only describes a source already containing that horizontal CRS and vertical reference. It does not request a datum transformation. A declaration must agree with supported source metadata; contradictory or unsupported metadata cannot be overridden through the declaration field. Unknown fields need traceable authored evidence. Legacy imports without metadata still require all declaration fields, and any legacy `crs` remains binding.

The gate supports metres, international feet (`0.3048 m`) and US survey feet (`1200/3937 m`). It normalizes explicit length units and returns provenance with the original declaration/source metadata, unit factors, `verticalTransformation: "none"` and `axisReordering: "none"`. It does not reorder latitude/northing-first coordinates. Geographic coordinates retain degrees until `transformSurveyPoint` applies the existing bounded horizontal transformation; TIN/civil geometry must receive projected metre coordinates. `LOCAL` accepts an explicitly declared local east/north frame and length unit, with no automatic conversion to an EPSG frame.

The horizontal subset remains EPSG:4326, EPSG:3857 and WGS84 UTM EPSG:32601–32660 / EPSG:32701–32760. Their canonical horizontal units must match. Datum grids, state-plane systems, other ellipsoids, geocentric coordinates and transformations between survey datums remain outside this module.

## Retained metadata and persistence

`SurveyCoordinateMetadata` retains format, raw encoding, interpreted CRS/unit/axis declarations, vertical reference identity, bounded source record descriptors and diagnostics. LAS metadata also retains version, point format and the WKT encoding flag. A malformed projection payload is retained as a `parseError` blocker rather than treated as an absent declaration.

The statuses mean:

| Status | Terrain consequence |
| --- | --- |
| `undeclared` | Authored evidence must complete the declaration. |
| `supported` | The supported metadata subset agrees internally; missing fields still require authored evidence. |
| `unsupported` | The retained definition needs an external supported conversion/repair before terrain use. |
| `ambiguous` | Concurrent/conflicting declarations must be resolved in the source before terrain use. |

`inspectSurveyCoordinateMetadata` validates persisted JSON bounds and regenerates interpreted fields and diagnostics from retained source definitions. It rejects summaries that disagree with those definitions. This is structural consistency checking, not an authenticity check or signature verification. A caller loading saved JSON must use the inspector, retain the raw source data and gate terrain use again.

## LAS subset

The reader accepts uncompressed LAS 1.1–1.4, version-compatible point formats 0–10, and 227-byte–64 MB input. LAS 1.3/1.4 extended header sizes and point counts are bounded, incompatible legacy/extended counts are rejected, and the point payload must fit the file. Files with more than 2000 points retain the original count and the existing deterministic uniform sample warning; this is not feature-aware reduction.

VLR and LAS 1.4 EVLR tables are checked separately against their header sizes, point boundaries and file bounds. Each table has a 128-record limit. Only the known `LASF_Projection` records 2111, 2112, 34735, 34736 and 34737 are interpreted/retained; unrelated records and records marked with other user IDs are skipped. The retained projection set is limited to 16 records and 256 KB of payload. EVLR lengths and counts must fit safe integers and the file. LAS 1.5, LAZ, waveform interpretation and arbitrary application-specific VLRs are unsupported.

GeoKey directories, double tables and ASCII citations are bounded and reference-checked. Duplicate active records, simultaneous active GeoKey/WKT sets, missing key directories, and encoding-flag disagreements prevent terrain use. The LAS 1.4 WKT flag is enforced, including the requirement for point formats 6–10. Math-transform WKT (2111) is preserved but blocks use because applying that transform is unsupported. The source must mark/remove superseded projection records rather than relying on first/last-record selection. These rules follow the [ASPRS LAS CRS section](https://raw.githubusercontent.com/ASPRSorg/LAS/1.4.R16/source/02.02_crs.sub) and [required projection records](https://raw.githubusercontent.com/ASPRSorg/LAS/1.4.R16/source/03_required_vlrs.txt).

WKT is decoded as null-terminated UTF-8, with a 64 KB record limit. The supported interpretation is strict WKT1 `GEOGCS`/`PROJCS`, optionally inside a horizontal-plus-vertical `COMPD_CS`. Definitions must contain literal EPSG component authorities, the supported WGS84 datum/ellipsoid, Greenwich meridian and explicit known unit definitions. UTM parameters and any method authority must agree with the named EPSG zone/hemisphere and Transverse Mercator method. Compound root authorities require unsupported registry reconciliation. Unknown child nodes, extensions, duplicate fields, datum transforms, WKT2 and noncanonical projection definitions are retained as unsupported. EPSG:3857 WKT variants are deliberately unsupported; a supported authority-only GeoKey declaration can still identify EPSG:3857.

Declared vertical CRS authority checking is limited to EPSG:4979 (WGS84 ellipsoidal height documented through GeoKeys), EPSG:5702 (NGVD29 height in US survey feet), EPSG:5703 (NAVD88 height in metres), and EPSG:6360 (NAVD88 height in US survey feet). Explicit unit/datum conflicts block use. Missing elevation units still require an authored declaration matching that authority. Other vertical CRS identifiers are preserved and marked unsupported; a vertical datum identifier/name without a CRS does not invent a transformation. The NAVD88 definitions are evidenced by the [EPSG NAVD88 operation definition](https://epsg.org/transformation/wkt/id/9166) and [USGS lidar specification examples](https://pubs.usgs.gov/tm/11b4/pdf/tm11-B4.pdf); the NGVD29 example is in the [IOGP position-data guide](https://www.iogp.org/bookstore/wp-content/uploads/sites/2/woocommerce_uploads/2017/01/483-1u-1.pdf). No geoid model is chosen or executed.

## GeoTIFF and CSV compatibility

The existing GeoTIFF DEM subset remains classic II/MM TIFF, one uncompressed north-up band in strips, 16/32-bit integer or 32/64-bit float samples, one tiepoint and pixel scale, within 64 MB and 16 million cells. Original cell counts, no-data handling, deterministic sampling to at most 2000 points and sampling warnings are retained. Duplicate TIFF tags are rejected. Nonidentity vertical tiepoint/pixel-scale transforms block terrain use rather than being silently ignored. BigTIFF, tiled/compressed/rotated rasters, multiple tiepoints, 16-bit floats, additional raster scale/offset metadata and external auxiliary files are unsupported.

GeoKey metadata now retains horizontal CRS/unit declarations, citations and keys 4096–4099 for vertical reference/unit declarations. It supports bounded numeric/ASCII parameter references, not only inline keys. A projected model cannot be relabelled with its base geographic EPSG identifier. Custom projection parameters, user-defined vertical CRS orientation, unsupported EPSG/unit codes and source inconsistencies produce blockers. The GeoKey parser supports at most 256 keys, 8192 directory words/doubles, 32 values per numeric reference, 8192 characters per citation, and 128 KB of retained citation text; persisted metadata also has aggregate bounds. Missing units remain unknown. Raw and prepared survey warning lists are bounded to 100 entries; the raw import retains any warnings omitted from the prepared list. The interpretation follows the [OGC GeoTIFF model, unit and vertical-reference requirements](https://docs.ogc.org/is/19-008r4/19-008r4.html), including its geographic longitude/latitude and projected east/north storage convention.

CSV retains the existing three-column reader and limits: 2 MB and 3–2000 points with an optional header. CSV has no embedded CRS/datum parser; coordinates and heights require the authored declaration. No numerical values are converted during CSV import.

## Validation status

This increment was reviewed by source inspection only under the user's no-run constraint. No application, sample importer, numerical routine, build, lint job, type checker or test was executed. Real-file interoperability, browser binary parsing, source TypeScript compilation and numerical accuracy remain unverified until execution is authorized. Format support is a bounded subset, with no ASPRS, OGC or EPSG conformance/certification claim. Primary specification material is referenced for implementation; no external parser/runtime dependency was added.

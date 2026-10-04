# IFC SI measure literals

This extension compares a bounded selection of typed `IfcPropertySingleValue` values with IDS `simpleValue` literals after SI normalization. It extends the existing metadata IDS subset; it is not full IDS, IFC schema validation, geometry validation, or certification. Original STEP values and units remain unchanged for export.

| Exact IFC datatype | IDS SI unit | Additional domain |
| --- | --- | --- |
| `IFCLENGTHMEASURE` | m | finite signed REAL |
| `IFCPOSITIVELENGTHMEASURE` | m | greater than zero |
| `IFCNONNEGATIVELENGTHMEASURE` | m | zero or greater; IFC4+ only |
| `IFCAREAMEASURE` | m2 | finite signed REAL |
| `IFCVOLUMEMEASURE` | m3 | finite signed REAL |
| `IFCMASSMEASURE` | kg | finite signed REAL |
| `IFCTIMEMEASURE` | s | finite signed REAL |
| `IFCPLANEANGLEMEASURE` | rad | finite signed REAL |
| `IFCPOSITIVEPLANEANGLEMEASURE` | rad | greater than zero |

Datatypes are exact uppercase names and must exist in the selected IFC schema. The positive plane-angle type is available in IFC2X3 as well as IFC4/IFC4.3. Existing IDS schema-version gates and the imported occurrence-class/property inheritance limits remain in force. The [IDS datatype matrix](https://github.com/buildingSMART/IDS/blob/master/Documentation/ImplementersDocumentation/DataTypes.md) and [published IFC2X3 EXPRESS](https://standards.buildingsmart.org/MVD/RELEASE/IFC2x3/TC1/CV2_0/CoordinationView_V2-0_EXPRESS_IFC2X3_Version-1-3.pdf) support these availability/domain checks.

Only a direct `IfcSIUnit` with the corresponding unit/name enumeration is supported. A property's explicit Unit overrides project defaults; an incompatible explicit unit never falls back. Without an explicit unit, the project assignment must provide exactly one matching unit. The resolver checks retained typed nominal values, STEP references, argument counts, unquoted enums, the derived `*` Dimensions marker, optional `$` Prefix/Unit markers, source spans, and metadata agreement. Missing, ambiguous, compound, conversion-based, offset, derived, and custom/context-dependent units are unsupported. The importer’s independent geometry-unit limits still apply.

All 16 IFC prefixes from ATTO through EXA are accepted by this resolver. A prefix multiplier is raised to power 1 for length, 2 for area, and 3 for volume. Mass prefixes attach to GRAM, followed by division by 1000 to obtain IDS kilograms: unprefixed GRAM is 0.001 kg and KILO GRAM is 1 kg. These rules follow the [IDS SI table](https://github.com/buildingSMART/IDS/blob/master/Documentation/UserManual/units.md), [IfcSIUnit](https://standards.buildingsmart.org/IFC/RELEASE/IFC4/ADD2_TC1/HTML/schema/ifcmeasureresource/lexical/ifcsiunit.htm), [explicit property-unit override](https://standards.buildingsmart.org/IFC/RELEASE/IFC4/ADD2_TC1/HTML/schema/ifcpropertyresource/lexical/ifcpropertysinglevalue.htm), and [BIPM SI Brochure §3](https://www.bipm.org/documents/20126/41483022/SI-Brochure-9.pdf).

Floating-point equality, including `IFCREAL`, uses the fixed published IDS rule with expected value `v`, actual SI value `x`, and `epsilon = 1e-6`:

```text
v - abs(v)*epsilon - epsilon < x < v + abs(v)*epsilon + epsilon
```

Both bounds are strict. Integer, boolean, and string values retain exact comparisons. The allowance is for floating-point rounding, not construction tolerances. Numeric ranges, enumerations, patterns, and other XML restrictions remain unsupported; ranges must never receive this equality allowance. See the [IDS tolerance specification](https://github.com/buildingSMART/IDS/blob/master/Documentation/ImplementersDocumentation/tolerance.md) and [property-facet interpretation](https://github.com/buildingSMART/IDS/blob/master/Documentation/UserManual/property-facet.md).

Expected datatype/literal checks precede candidate matching. Referenced actual property metadata and units are preflighted across the selected occurrence class before applicability filtering. Unsupported data therefore yields an incomplete report instead of disappearing into an empty match. A supported optional specification may still pass with no applicable objects. As published IDS specifies, a prohibited specification ignores its requirements.

`createIfcMeasureNormalizer(document)` returns a cached property resolver yielding either `{ supported: true, dataType, siValue, siUnit, factor, unitSource }` or `{ supported: false, message }`. `parseIdsMeasureLiteral`, `supportsIfcMeasureType`, and `idsFloatEquivalent` provide the matching gates. Nominal/expected/normalized magnitudes are at most `1e30`; factors must be positive finite within `1e-60..1e60`; overflow and nonzero-to-zero underflow are rejected. Bounds are 20 MB source, 100,000 entities, 64 assignment units, 20,000 characters per property record, 2,000 per unit record/literal, and 200,000 distinct property resolutions; existing IDS report/check budgets also remain.

Verification for this change is source inspection and primary-document review only. Repository code, numerical examples, tests, builds, typechecking, linting, and previews were not executed. Binary floating-point boundary behavior and browser execution remain unverified.

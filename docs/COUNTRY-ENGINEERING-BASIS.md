# Project country and engineering design basis

Reference catalog version: `country-basis-2026-10-03`.

The project country selects national publisher references. India presents BIS/NBC/IS references; the United States presents ICC, ASCE, ACI, AISC, ASHRAE and NFPA references. Other countries retain their actual country code and accept explicit references supplied by the user. They never inherit Indian or US coefficients implicitly.

## Adoption workflow

1. Select the **project's** country, state/region/municipality and authority having jurisdiction. The account's billing country does not decide engineering adoption.
2. Add applicable references. Selecting a reference leaves the edition blank. Choose the locally adopted edition and record the adoption instrument, approval reference, amendments, supplements and errata. Enter `none` only when verified.
3. Add a custom reference for another published edition, a local amendment, a standard absent from the catalog or another country. Supply its actual code, edition, HTTPS publisher/authority source and adoption reference.
4. Declare occupancy, risk/importance classification, structural/MEP systems, material grades/properties, geotechnical basis, load cases/combinations and hazard data. Explain excluded or inapplicable items explicitly.
5. Record approved numeric criteria with units and a source. A criterion that cites an adopted standard also needs its clause. Model input values drive numerical analysis; recording a criterion here does not automatically change model input or apply an entire code.
6. Record the adoption reviewer and confirm the declaration. Editing an input invalidates that confirmation. Country changes clear the prior adoption and criteria, preventing a previous country's values from surviving silently.

The declaration is versioned JSON. The parser accepts incomplete drafts while enforcing finite numeric criteria, bounded strings/collections and known schema choices. Completeness validation requires jurisdiction, adoption references, project declarations and confirmation. The comparison key is deterministic full JSON, including country, region, adopted editions, amendments, project declarations and criteria; it is not a cryptographic signature or proof of approval.

## Named published editions in the reference catalog

These are choices supported by publisher evidence, **not an assertion of the newest edition or local legal adoption**. Applicable local rules can require another edition. The catalog contains reference metadata, not copied standards, hazard tables, default design factors or national-code algorithms.

| Country | Reference choices | Publisher evidence |
| --- | --- | --- |
| India | NBC / SP 7:2016, including Part 4 fire, Part 8 electrical/mechanical and Part 9 plumbing references | [BIS NBC page and contents](https://www.bis.gov.in/standards/national-building-code/?lang=en) |
| India | IS 875 Part 1:1987 dead loads | [BIS scope preview](https://www.services.bis.gov.in/php/BIS_2.0/bisconnect/Group_wise_standards_list/show_scope?row=MTU5MzE%3D) |
| India | IS 875 Part 2:1987 imposed loads | [BIS standard details / cross references](https://standards.bis.gov.in/website/standard-details?encryptedId=eyJpdiI6InRsM1NSbVVXSi9YK2RhaE11cDJGOHc9PSIsInZhbHVlIjoiNC9iVXV0OEY0akZHVjFVWHpZZGxMdz09IiwibWFjIjoiMGRiY2ZiZjgxNjdlZTkwN2ZhMWQyMTc4M2Y2NjQyYjRiOTg2MTFjY2QxZmUwZTY2Mzc3MGFlOGQyYmNjMDJlNyIsInRhZyI6IiJ9) |
| India | IS 875 Part 3:2015 wind loads | [BIS standard details](https://standards.bis.gov.in/website/standard-details?encryptedId=eyJpdiI6Ik9ZZXZxVC9pWkJhZWorZjFBejJmb3c9PSIsInZhbHVlIjoidjZkeXJEeEpHeS9oT1dPQnR3cWVrdz09IiwibWFjIjoiMWZhYzY4MGUxOGRjNmZkNzQ5ZWUyZWNhM2NhMDZmM2IzNDIxMDc2NTdjMzJkYWEzMzc5ZjM5OTM5OGRkN2NlYSIsInRhZyI6IiJ9) |
| India | IS 1893 Part 1:2016 earthquake-resistant design | [BIS published amendment announcement](https://www.bis.gov.in/wp-content/uploads/2021/06/BIS-Dec-2017_Jan-2018-1.pdf) |
| India | IS 456:2000 concrete | [BIS published standard cross-reference](https://www.services.bis.gov.in/php/BIS_2.0/bisconnect/standard_review/Standard_review/Isdetails?ID=MTczMjY%3D) |
| India | IS 800:2007 steel | [BIS published standard cross-reference](https://standards.bis.gov.in/website/standard-details?encryptedId=eyJpdiI6Im43M0VEUlEzQzJCV1FONEhidC9pcEE9PSIsInZhbHVlIjoiZ0oyd0FvMVFwVFFuQ0g4WHRlNk11dz09IiwibWFjIjoiOWY2NDkwODc0ZjY0OThkOTQ0YTY5YWRlNzc4NTM5MWQ3ZDI4N2ZlZmU1YWU2YjlhOTAxNDc2M2Q3MTU0ZDlkZiIsInRhZyI6IiJ9) |
| United States | IBC, IMC and IPC:2024 | [ICC publication announcement](https://www.iccsafe.org/about/periodicals-and-newsroom/the-international-code-council-releases-2024-international-codes/) |
| United States | ASCE/SEI 7:2022 (designation ASCE/SEI 7-22) | [ASCE standard page, supplements and errata](https://www.asce.org/publications-and-news/asce-7) |
| United States | ACI CODE 318:2019, 2019 reapproved 2022 and 2025 | [ACI 318 portal](https://www.concrete.org/topicsinconcrete/318buildingcodeportal.aspx), [ACI reapproved edition listing](https://www.concrete.org/topicsinconcrete/topicdetail.aspx?search=31819) |
| United States | ANSI/AISC 360:2022 (designation ANSI/AISC 360-22) | [AISC publication announcement](https://www.aisc.org/news/aisc-releases-new-version-of-specification-for-structural-steel-buildings-ansiaisc-360-22/), [AISC errata](https://www.aisc.org/aisc/publications/revisions-and-errata/) |
| United States | ANSI/ASHRAE 62.1:2022 | [ASHRAE edition listing](https://www.ashrae.org/technical-resources/standards-and-guidelines/read-only-versions-of-ashrae-standards), [interpretations](https://www.ashrae.org/technical-resources/standards-and-guidelines/standards-interpretations/interpretations-for-standard-62-1-2022) |
| United States | NFPA 70 / NEC:2023 and 2026 | [NFPA code development and edition history](https://www.nfpa.org/codes-and-standards/nfpa-70-standard-development/70), [NFPA 2023 edition access](https://link.nfpa.org/free-access/publications/70/2023) |

BIS pages that use temporary encrypted detail URLs may change. The application links to [BIS Know Your Standard](https://www.bis.gov.in/know-your-standard/?lang=en) for those catalog entries so users can locate the exact standard number, amendments and current status. The source URLs were inspected on 2026-10-03; published versions are intentionally selected per project rather than updated silently.

## Applicability and current limits

National standards become project requirements through local adoption, contract requirements and authority decisions. Selecting a country or confirming this form records that basis; it does not certify design compliance. Structural, hydraulic, airflow, electrical, fire-flow and equipment reports must state the numerical methods and criteria actually evaluated. Material resistance equations, code load combinations, hazard interpolation, detailing, connection design, and discipline-specific prescriptions require their own explicitly implemented and verified rule coverage.

For example, ASHRAE 62.1 has a defined building scope; it cannot be applied to every residential or healthcare project merely because the project is in the US. NBC Part 4 and NFPA references likewise do not substitute for a complete fire design workflow. Use the relevant adopted reference and trace the entered criteria to the correct scope and clauses.

Implementation files: `client/src/lib/engineeringBasis.ts` and `client/src/components/EngineeringBasisPanel.tsx`. No application, compiler, tests, builds, previews or numerical executions were run under the user's source-only constraint. Reference metadata and source structure were reviewed by inspection.

The project control in all three editor modes saves the basis in the complete CAD design. Saving, draft recovery, project history, duplication and full design JSON preserve it. Concurrent basis changes are one atomic conflict, so a confirmed declaration cannot inherit fields from a separate review. Engineering workspace version 2 captures the basis with each report and solver bundle; legacy version 1 reports retain an undeclared basis. Source or basis changes hide stale current reports while preserving previous downloads.

Planar native source envelopes and output manifests preserve the same complete declaration and compare it during result import. The native adapter does not evaluate those criteria or national-code provisions. Existing CAD DXF/IFC/PDF and structural/BIM exchange schemas do not yet carry this country metadata; those authoring exchanges need explicit propagation in the later exchange modules. Keep the full saved design or workbench source/basis bundle as the provenance record in the meantime.

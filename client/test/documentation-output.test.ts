import assert from "node:assert/strict";
import test from "node:test";
import { defaultDesign } from "../src/types";
import { defaultDocumentation } from "../src/lib/documentation";
import { buildSheetPdf } from "../src/lib/sheets";
import { createCadObject } from "../src/lib/cadModel";

// Inspect the final PDF's page objects and referenced streams rather than renderer internals.
function pdfPages(bytes: Uint8Array): string[] {
  const source = new TextDecoder().decode(bytes);
  assert.ok(source.startsWith("%PDF-1.4"));
  assert.ok(source.trimEnd().endsWith("%%EOF"));
  const objects = new Map([...source.matchAll(/(\d+) 0 obj\n([\s\S]*?)\nendobj/g)].map(match => [Number(match[1]), match[2]]));
  const pages = [...objects.values()].filter(body => body.includes("/Type /Page "));
  assert.ok(pages.length > 0);
  return pages.map(page => {
    const contents = page.match(/\/Contents (\d+) 0 R/);
    assert.ok(contents, "each page references a content stream");
    const body = objects.get(Number(contents[1]));
    assert.ok(body?.includes("\nstream\n"), "each page's content exists");
    return body!.split("\nstream\n")[1].split("\nendstream")[0];
  });
}

test("every exported page remains visibly schematic and not for construction even when status is issued", () => {
  const design = defaultDesign();
  design.documentation = { ...defaultDocumentation(), status: "issued" };
  const pages = pdfPages(buildSheetPdf("Issued concept", design));
  assert.ok(pages.length >= 6, "exercise the cover, geometry, takeoff, schedule and declaration pages");
  for (const page of pages) {
    assert.ok(page.includes("(SCHEMATIC / NOT TO SCALE / NOT FOR CONSTRUCTION)"), "a separated sheet must retain its output limits");
    let textGray = 0;
    for (const command of page.split("\n")) {
      const shades = [...command.matchAll(/(-?\d+(?:\.\d+)?) g\b/g)];
      if (shades.length) textGray = Number(shades.at(-1)![1]);
      if (command.includes(" Tj ET")) assert.ok(textGray <= 0.25, "PDF text must remain dark and readable after shaded boxes");
    }
  }
});

test("separated sheets disclose authored CAD geometry omitted from schematic views", () => {
  const design = defaultDesign();
  design.drafts = [createCadObject("wall")];
  const before = structuredClone(design);
  const pages = pdfPages(buildSheetPdf("CAD concept", design));
  assert.ok(pages.every(page => page.includes("1 authored CAD object\\(s\\) are not drawn in PDF views.")));
  assert.deepEqual(design, before, "coverage disclosure does not change the authored model");
});

test("recorded scale and orientation remain identifiable metadata without changing the saved design", () => {
  const design = defaultDesign();
  const docs = defaultDocumentation();
  docs.views[0] = { ...docs.views[0], scale: "1:37", orientation: "west" };
  docs.sheets = [docs.sheets[1]];
  design.documentation = docs;
  const before = structuredClone(design);
  const pages = pdfPages(buildSheetPdf("Review (A)", design));
  assert.ok(pages.some(page => page.includes("(RECORDED METADATA ONLY: scale 1:37 / orientation west)")));
  assert.ok(pages.every(page => page.includes("NOT TO SCALE")));
  assert.ok(pages.every(page => !page.includes("WEST (schematic)")), "the title block must not suggest that the requested elevation was rendered");
  assert.deepEqual(design, before, "export preserves all legacy view metadata and model data");
});

test("continuation pages retain output limits when the set has no cover or generated geometry", () => {
  const design = defaultDesign();
  const docs = defaultDocumentation();
  docs.sheets = [{ id: "notes-only", number: "S-401", name: "Review notes", viewIds: [] }];
  docs.annotations = Array.from({ length: 45 }, (_, index) => ({
    id: "note-" + index,
    text: "Independent review note " + index + " " + "Review the stored assumptions and dimensions. ".repeat(4),
  }));
  design.documentation = docs;
  const pages = pdfPages(buildSheetPdf("Notes-only review", design));
  assert.ok(pages.length > 5, "exercise multiple annotation continuations");
  assert.ok(pages.every(page => page.includes("SCHEMATIC / NOT TO SCALE / NOT FOR CONSTRUCTION")));
});

test("hidden and unbound views still produce classified review pages without rewriting their bindings", () => {
  const design = defaultDesign();
  const docs = defaultDocumentation();
  docs.views[0].visible = false;
  docs.sheets = [
    { id: "hidden", number: "A-101", name: "Hidden view", viewIds: [docs.views[0].id] },
    { id: "unbound", number: "A-102", name: "Unbound view", viewIds: [] },
  ];
  design.documentation = docs;
  const before = structuredClone(design);
  const pages = pdfPages(buildSheetPdf("Incomplete review", design));
  assert.ok(pages.some(page => page.includes("VIEW HIDDEN: Overall plan")));
  assert.ok(pages.some(page => page.includes("No model view is bound")));
  assert.ok(pages.every(page => page.includes("NOT FOR CONSTRUCTION")));
  assert.deepEqual(design, before);
});

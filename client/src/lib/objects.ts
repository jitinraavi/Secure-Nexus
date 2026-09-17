import { catalogEntry } from "./catalog";
import { FACADES } from "./community";

/**
 * Offline intent → object generator.
 *
 * A deterministic, dependency-free natural-language matcher: it strips filler
 * words, reads an optional leading quantity and matches the remaining words
 * against a synonym lexicon. No network or model calls are involved, so it
 * keeps working offline and inside the packaged app.
 */

export interface FurnitureRecipe {
  kind: "furniture";
  /** CATALOG entry id */
  catalogId: string;
  name: string;
  keywords: string[];
}

export interface SiteObjectRecipe {
  kind: "outdoor";
  /** canonical key stored on the amenity as `kind` */
  key: string;
  name: string;
  shape: "box" | "cylinder" | "sphere" | "pyramid" | "lshape" | "frame";
  /** metres */
  w: number;
  d: number;
  h: number;
  color: string;
  keywords: string[];
}

export type ObjectRecipe = FurnitureRecipe | SiteObjectRecipe;

export interface GeneratedObject {
  recipe: ObjectRecipe;
  qty: number;
  /** Echo of the leftover words the matcher could not use. */
  unmatched: string[];
}

/* ------------------------------- Furniture ------------------------------- */

const F = (catalogId: string, name: string, keywords: string[]): FurnitureRecipe => ({
  kind: "furniture",
  catalogId,
  name,
  keywords,
});

export const FURNITURE_RECIPES: FurnitureRecipe[] = [
  F("sofa", "Sofa", ["sofa", "couch", "settee", "lounge", "three seater", "3 seater"]),
  F("armchair", "Armchair", ["armchair", "arm chair", "accent chair", "recliner", "single seater"]),
  F("bed", "Bed", ["bed", "double bed", "king bed", "queen bed", "single bed", "cot"]),
  F("dining-table", "Dining table", ["dining table", "dining", "breakfast table"]),
  F("dining-chair", "Dining chair", ["dining chair", "chair", "chairs"]),
  F("office-chair", "Office chair", ["office chair", "desk chair", "task chair", "computer chair"]),
  F("coffee-table", "Coffee table", ["coffee table", "centre table", "center table", "teapoy"]),
  F("desk", "Desk", ["desk", "study table", "work table", "writing table"]),
  F("wardrobe", "Wardrobe", ["wardrobe", "almirah", "closet", "cupboard"]),
  F("bookshelf", "Bookshelf", ["bookshelf", "book shelf", "shelf", "shelves", "rack"]),
  F("tv-unit", "TV unit", ["tv", "television", "tv unit", "television unit", "media console"]),
  F("kitchen-island", "Kitchen island", ["kitchen island", "island", "kitchen counter", "counter"]),
  F("floor-lamp", "Floor lamp", ["floor lamp", "lamp", "standing lamp", "light"]),
  F("plant", "Plant", ["plant", "planter", "pot", "greenery", "indoor plant"]),
  F("rug", "Rug", ["rug", "carpet", "mat", "dhurrie"]),
];

/* -------------------------------- Outdoors -------------------------------- */

const O = (
  key: string,
  name: string,
  shape: SiteObjectRecipe["shape"],
  w: number,
  d: number,
  h: number,
  color: string,
  keywords: string[],
): SiteObjectRecipe => ({ kind: "outdoor", key, name, shape, w, d, h, color, keywords });

export const SITE_RECIPES: SiteObjectRecipe[] = [
  O("tree", "Tree", "sphere", 4, 4, 6, "#2e7d32", ["tree", "sapling", "palm", "plants"]),
  O("car", "Car", "box", 1.9, 4.5, 1.5, "#1e88e5", ["car", "sedan", "suv", "vehicle", "automobile"]),
  O("bench", "Bench", "box", 1.8, 0.6, 0.45, "#8d6e63", ["bench", "seat", "garden bench"]),
  O("streetlight", "Street light", "cylinder", 0.4, 0.4, 6, "#90a4ae", ["street light", "streetlight", "lamp post", "pole", "light pole"]),
  O("fountain", "Fountain", "cylinder", 5, 5, 1.4, "#4fc3f7", ["fountain", "water feature", "waterbody"]),
  O("statue", "Statue", "pyramid", 1.6, 1.6, 2.6, "#b0a08a", ["statue", "sculpture", "monument", "idol"]),
  O("shed", "Shed", "lshape", 6, 4, 3, "#a1887f", ["shed", "kiosk", "store room", "guard room", "security cabin"]),
  O("fence", "Fence", "frame", 6, 0.2, 1.6, "#6d4c41", ["fence", "railing", "boundary", "compound wall"]),
  O("gazebo", "Gazebo", "frame", 4, 4, 3.2, "#8d6e63", ["gazebo", "pavilion", "pergola", "canopy"]),
  O("planter", "Planter box", "box", 2.4, 0.8, 0.6, "#795548", ["planter box", "flower bed", "flowerbed", "hedge"]),
];

export const ALL_RECIPES: ObjectRecipe[] = [...FURNITURE_RECIPES, ...SITE_RECIPES];

/* -------------------------------- Matching -------------------------------- */

const STOP_WORDS = new Set([
  "a", "an", "the", "add", "create", "make", "place", "put", "generate", "spawn",
  "draw", "insert", "of", "with", "and", "to", "for", "my", "some", "please",
  "new", "one", "another", "here", "there",
]);

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, a: 1, an: 1, couple: 2, few: 3, dozen: 12,
};

export function parseObjectQuery(input: string): GeneratedObject | null {
  const text = input.trim().toLowerCase();
  if (!text) return null;

  let qty = 1;
  const qtyMatch = text.match(/^\s*(?:x\s*)?(\d{1,3})\s+(.*)$/);
  let rest = text;
  if (qtyMatch) {
    qty = Math.max(1, parseInt(qtyMatch[1], 10));
    rest = qtyMatch[2];
  } else {
    const words = text.split(/\s+/);
    if (words.length > 1 && NUMBER_WORDS[words[0]] !== undefined) {
      qty = NUMBER_WORDS[words[0]];
      rest = words.slice(1).join(" ");
    }
  }

  const words = rest
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP_WORDS.has(w));

  let best: ObjectRecipe | null = null;
  let bestScore = 0;
  for (const recipe of ALL_RECIPES) {
    for (const kw of recipe.keywords) {
      const kwWords = kw.split(/\s+/);
      const hits = kwWords.filter((k) => words.includes(k)).length;
      if (hits === 0) continue;
      // Prefer multi-word matches and longer keyword coverage.
      const score = hits * 2 + kwWords.length + (words.join(" ").includes(kw) ? 3 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = recipe;
      }
    }
  }

  if (!best) return null;

  const used = new Set(best.keywords.flatMap((k) => k.split(/\s+/)));
  const unmatched = words.filter((w) => !used.has(w));
  return { recipe: best, qty, unmatched };
}

/** Parse a single facet material name (used by the right-click material menu). */
export function parseMaterialQuery(input: string): { key: string; color: string; label: string } | null {
  const text = input.trim().toLowerCase();
  if (!text) return null;
  const words = text.replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter(Boolean);
  let best: (typeof FACADES)[number] | null = null;
  let bestScore = 0;
  for (const f of FACADES) {
    const fWords = f.label.toLowerCase().split(/\s+/).concat([f.key]);
    const hits = fWords.filter((w) => words.includes(w)).length;
    if (hits === 0) continue;
    if (hits > bestScore || (hits === bestScore && best && f.label.length < best.label.length)) {
      bestScore = hits;
      best = f;
    }
  }
  return best ? { key: best.key, color: best.color, label: best.label } : null;
}

/** Human-readable one-liner describing what a query will create. */
export function describeObject(obj: GeneratedObject): string {
  const r = obj.recipe;
  const unit = r.kind === "furniture" ? "item" : "object";
  return `${obj.qty} × ${r.name} (${unit})`;
}

export function furnitureDimMm(catalogId: string): { w: number; d: number; h: number } {
  const entry = catalogEntry(catalogId);
  return entry ? { w: entry.w, d: entry.d, h: entry.h } : { w: 1000, d: 1000, h: 800 };
}

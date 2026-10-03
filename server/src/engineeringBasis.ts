import { z } from "zod";

// Mirror the client version-1 metadata contract without importing browser source.
// Draft declarations are valid inputs; adoption completeness and code checks are separate.
const text = (maximum: number) => z.string().max(maximum).refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value));
const standard = z.object({
  id: text(100), domain: z.enum(["building", "loads", "seismic", "concrete", "steel", "mechanical", "electrical", "plumbing", "fire", "other"]),
  code: text(160), edition: text(100), sourceUrl: text(2000), adoptionReference: text(2000), amendments: text(2000),
}).strict();
const criterion = z.object({
  id: text(100), module: z.enum(["frame", "water", "air", "electrical", "fire", "equipment"]), name: text(200),
  value: z.number().finite().min(-1e18).max(1e18), unit: text(100), source: text(2000), standardId: text(100).optional(), clause: text(200).optional(),
}).strict();
export const engineeringDesignBasisSchema = z.object({
  version: z.literal(1), profileVersion: text(100), countryCode: z.string().regex(/^(?:[A-Z]{2})?$/),
  region: text(500), authority: text(500), standards: z.array(standard).max(40),
  declaration: z.object({
    occupancy: text(2000), riskCategory: text(2000), structuralSystem: text(2000), material: text(2000), soil: text(2000), loads: text(4000), hazards: text(4000),
  }).strict(),
  criteria: z.array(criterion).max(64), confirmed: z.boolean(), reviewer: text(500), reviewNote: text(4000),
}).strict();

import { Router } from "express";
import { z } from "zod";
import { AI } from "../config.js";
import { asyncHandler, requireSession } from "../security.js";

const finiteNumber = z.number().finite();
const point = z.object({ x: finiteNumber, y: finiteNumber, z: finiteNumber }).strict();
const patch = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  x: finiteNumber.optional(), z: finiteNumber.optional(), rotY: finiteNumber.optional(),
  floors: finiteNumber.int().min(1).max(300).optional(),
  unitsPerFloor: finiteNumber.int().min(1).max(1000).optional(),
  unitWidth: finiteNumber.min(0.1).max(1000).optional(), unitDepth: finiteNumber.min(0.1).max(1000).optional(),
  floorHeight: finiteNumber.min(0.1).max(100).optional(),
  w: finiteNumber.min(0.01).max(10000).optional(), d: finiteNumber.min(0.01).max(10000).optional(),
  h: finiteNumber.min(0.01).max(10000).optional(), rotationDeg: finiteNumber.optional(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
}).strict();

const actions = z.discriminatedUnion("type", [
  z.object({ type: z.literal("set_plot_dimensions"), width: finiteNumber.min(0.1).max(1_000_000), depth: finiteNumber.min(0.1).max(1_000_000), unit: z.enum(["m", "yd", "ft"]) }).strict(),
  z.object({ type: z.literal("add_tower"), label: z.string().trim().min(1).max(120), x: finiteNumber, z: finiteNumber, floors: finiteNumber.int().min(1).max(300).optional(), unitsPerFloor: finiteNumber.int().min(1).max(1000).optional() }).strict(),
  z.object({ type: z.literal("remove_tower"), towerId: z.string().trim().min(1).max(160) }).strict(),
  z.object({ type: z.literal("update_tower"), towerId: z.string().trim().min(1).max(160), patch }).strict(),
  z.object({ type: z.literal("add_amenity"), kind: z.string().trim().min(1).max(80), x: finiteNumber, z: finiteNumber, w: finiteNumber.min(0.01).max(10000).optional(), d: finiteNumber.min(0.01).max(10000).optional(), h: finiteNumber.min(0.01).max(10000).optional() }).strict(),
  z.object({ type: z.literal("remove_amenity"), amenityId: z.string().trim().min(1).max(160) }).strict(),
  z.object({ type: z.literal("update_amenity"), amenityId: z.string().trim().min(1).max(160), patch: z.object({ x: finiteNumber.optional(), z: finiteNumber.optional(), rotY: finiteNumber.optional(), w: finiteNumber.min(0.01).max(10000).optional(), d: finiteNumber.min(0.01).max(10000).optional(), h: finiteNumber.min(0.01).max(10000).optional() }).strict() }).strict(),
  z.object({ type: z.literal("add_drafting_element"), kind: z.enum(["line", "rectangle", "circle", "dimension", "wall", "slab", "column", "roof"]), x: finiteNumber, z: finiteNumber, w: finiteNumber.min(0.01).max(10000), d: finiteNumber.min(0.01).max(10000), h: finiteNumber.min(0.01).max(10000).optional(), rotationDeg: finiteNumber.default(0), color: z.string().regex(/^#[0-9a-f]{6}$/i).default("#d6a84a"), label: z.string().trim().max(120).optional() }).strict(),
  z.object({ type: z.literal("update_room_opening"), roomId: z.string().trim().min(1).max(160), openingId: z.string().trim().min(1).max(160).optional(), roomPatch: z.object({ floor: finiteNumber.int().min(0).max(300).optional(), name: z.string().trim().max(120).optional(), type: z.string().trim().max(80).optional(), x: finiteNumber.optional(), z: finiteNumber.optional(), w: finiteNumber.min(0.01).max(1000).optional(), d: finiteNumber.min(0.01).max(1000).optional() }).strict().optional(), openingPatch: z.object({ kind: z.enum(["window", "door"]).optional(), wall: z.enum(["north", "east", "south", "west"]).optional(), offsetM: finiteNumber.min(-10000).max(10000).optional(), widthM: finiteNumber.min(0.01).max(100).optional(), heightM: finiteNumber.min(0.01).max(100).optional(), sillM: finiteNumber.min(0).max(100).optional() }).strict().optional() }).strict(),
  z.object({ type: z.literal("add_room_opening"), roomId: z.string().trim().min(1).max(160), kind: z.enum(["window", "door"]), wall: z.enum(["north", "east", "south", "west"]), offsetM: finiteNumber.min(-10000).max(10000), widthM: finiteNumber.min(0.01).max(100), heightM: finiteNumber.min(0.01).max(100), sillM: finiteNumber.min(0).max(100) }).strict(),
  z.object({ type: z.literal("add_room_furniture"), roomId: z.string().trim().min(1).max(160), catalogId: z.string().trim().min(1).max(120), name: z.string().trim().max(120).optional(), x: finiteNumber, z: finiteNumber, rotationDeg: finiteNumber.optional(), scale: finiteNumber.min(0.1).max(10).optional(), color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(), mount: z.enum(["unassigned", "floor", "wall", "ceiling"]).optional(), mountWall: z.enum(["north", "east", "south", "west"]).optional() }).strict(),
  z.object({ type: z.literal("update_room_furniture"), roomId: z.string().trim().min(1).max(160), furnitureId: z.string().trim().min(1).max(160), patch: z.object({ name: z.string().trim().min(1).max(120).optional(), x: finiteNumber.optional(), z: finiteNumber.optional(), rotationDeg: finiteNumber.optional(), scale: finiteNumber.min(0.1).max(10).optional(), color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(), mount: z.enum(["unassigned", "floor", "wall", "ceiling"]).optional(), mountWall: z.enum(["north", "east", "south", "west"]).optional(), mountHeightM: finiteNumber.min(0).max(100).optional() }).strict() }).strict(),
  z.object({ type: z.literal("add_mep_element"), kind: z.enum(["duct", "pipe", "cable-tray", "equipment", "fixture"]), name: z.string().trim().min(1).max(120), route: z.array(point).min(1).max(200), width: finiteNumber.min(0).max(100), height: finiteNumber.min(0).max(100), diameter: finiteNumber.min(0).max(100), ratedPowerKw: finiteNumber.min(0).max(100000).optional(), levelId: z.string().trim().max(160).optional() }).strict(),
  z.object({ type: z.literal("update_infrastructure"), parameters: z.object({ lanes: finiteNumber.min(0).max(1000).optional(), laneWidthM: finiteNumber.min(0).max(100).optional(), designSpeedKph: finiteNumber.min(0).max(1000).optional(), runways: finiteNumber.min(0).max(100).optional(), runwayLengthM: finiteNumber.min(0).max(100000).optional(), berths: finiteNumber.min(0).max(100).optional(), damType: z.enum(["gravity", "earthen", "rockfill", "arch"]).optional(), heightM: finiteNumber.min(0).max(10000).optional(), facilities: z.array(z.object({ id: z.string().max(160).optional(), kind: z.string().trim().min(1).max(80), count: finiteNumber.int().min(0).max(100000), lengthM: finiteNumber.min(0).max(1000000), widthM: finiteNumber.min(0).max(100000), heightM: finiteNumber.min(0).max(100000) }).strict()).max(200).optional() }).strict() }).strict(),
  z.object({ type: z.literal("generate_infrastructure_model") }).strict(),
  z.object({ type: z.literal("request_analysis"), scope: z.enum(["structural", "mep", "infrastructure", "site", "general"]), questions: z.array(z.string().trim().min(1).max(500)).max(20).default([]) }).strict(),
]);

const planSchema = z.object({
  summary: z.string().trim().min(1).max(2000),
  actions: z.array(actions).max(50),
  warnings: z.array(z.string().trim().min(1).max(500)).max(20),
}).strict();

const requestSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  context: z.record(z.unknown()).refine((value) => JSON.stringify(value).length <= 200_000, "Context is too large"),
}).strict();

const SAFETY = "Structural and MEP suggestions are preliminary coordination concepts only and require review by qualified licensed professionals before use.";
const SYSTEM_PROMPT = `You are Groundwork's design planning assistant. Return JSON only, with exactly {summary, actions, warnings}. Actions must use only the allowed action types and fields described by the user's current context. Never claim that a plan is code-compliant, safe, stamped, or construction-ready. Do not mutate data. ${SAFETY}`;

function endpointUrl(): string {
  if (AI.baseUrl.endsWith("/chat/completions") || AI.baseUrl.endsWith("/responses")) return AI.baseUrl;
  return `${AI.baseUrl}/chat/completions`;
}

function responseText(body: unknown): string {
  const value = body as { choices?: { message?: { content?: unknown } }[]; output_text?: unknown; output?: { content?: { text?: string }[] }[] };
  const chat = value.choices?.[0]?.message?.content;
  if (typeof chat === "string") return chat;
  if (Array.isArray(chat)) return chat.map((part) => typeof part === "object" && part && "text" in part ? String(part.text) : "").join("");
  if (typeof value.output_text === "string") return value.output_text;
  return value.output?.flatMap((item) => item.content ?? []).map((part) => part.text ?? "").join("") ?? "";
}

function parsePlan(text: string) {
  const json = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = planSchema.safeParse(JSON.parse(json));
  if (!parsed.success) throw new Error("The assistant returned an invalid action plan");
  return parsed.data;
}

const router = Router();
router.use(requireSession);
router.post("/plan", asyncHandler(async (req, res) => {
  const input = requestSchema.safeParse(req.body);
  if (!input.success) {
    res.status(400).json({ error: input.error.issues[0]?.message || "Invalid assistant request" });
    return;
  }
  if (!AI.apiKey) {
    res.json({ source: "offline", model: null, assistantMessage: "AI assistant configuration is required. Set AI_API_KEY, AI_MODEL, and optionally AI_BASE_URL on the server to request an AI-generated plan.", plan: { summary: "No AI plan generated because the provider is not configured.", actions: [], warnings: [SAFETY] } });
    return;
  }
  const endpoint = endpointUrl();
  const requestContent = JSON.stringify({ request: input.data.message, currentProjectContext: input.data.context });
  const provider = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${AI.apiKey}` },
    body: JSON.stringify(endpoint.endsWith("/responses")
      ? { model: AI.model || "default", temperature: 0.1, input: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: requestContent }], text: { format: { type: "json_object" } } }
      : { model: AI.model || "default", temperature: 0.1, response_format: { type: "json_object" }, messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: requestContent }] }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!provider.ok) {
    res.status(502).json({ error: "Assistant provider request failed" });
    return;
  }
  let body: unknown;
  try { body = await provider.json(); } catch { res.status(502).json({ error: "Assistant provider returned invalid JSON" }); return; }
  try {
    const plan = parsePlan(responseText(body));
    res.json({ source: "ai", model: AI.model || "default", assistantMessage: plan.summary, plan: { ...plan, warnings: [...new Set([...plan.warnings, SAFETY])] } });
  } catch (error) {
    console.error("[groundwork] Assistant plan validation failed:", error);
    res.status(502).json({ error: "Assistant returned an invalid action plan" });
  }
}));

export default router;

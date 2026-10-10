import JSZip from "jszip";
import type { Design, ReviewComment, ReviewMarker, ReviewViewpoint } from "../types";
import { ifcSourceGuid } from "./bim";
import { MAX_REVIEW_MARKERS, normalizeReviewComment, normalizeReviewMarker, normalizeReviewViewpoint, reviewWorkflow, validReviewDate } from "./coordination";
import { MAX_BCF_COMPRESSED_BYTES, MAX_BCF_ENTRIES, MAX_BCF_XML_BYTES, type BcfArchiveEntry } from "./bcfArchive";

const MAX_COMPRESSED_BYTES = 10 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_XML_BYTES = 1024 * 1024;
const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const xml = (value: string) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const guid = (seed: string) => {
  let h1 = 0x811c9dc5, h2 = 0x9e3779b9;
  for (let index = 0; index < seed.length; index++) { h1 = Math.imul(h1 ^ seed.charCodeAt(index), 0x01000193) >>> 0; h2 = Math.imul(h2 ^ seed.charCodeAt(index), 0x85ebca6b) >>> 0; }
  const hex = h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0") + h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};
const toIfc = (value: [number, number, number]): [number, number, number] => [value[0], value[2], value[1]];
const fromIfc = toIfc;
const vectorXml = (name: string, value: [number, number, number]) => `<${name}><X>${value[0]}</X><Y>${value[1]}</Y><Z>${value[2]}</Z></${name}>`;

export async function buildBcfRegisterZip(markers: ReviewMarker[], projectName = "Groundwork project", gridIds: string[] = []): Promise<Blob> {
  if (markers.length > MAX_REVIEW_MARKERS) throw new Error(`BCF export supports up to ${MAX_REVIEW_MARKERS} issues.`);
  const zip = new JSZip(), gridSet = new Set(gridIds), usedTopics = new Set<string>();
  const metadata: Array<{ topicGuid: string; marker: ReviewMarker }> = [];
  let exportedBytes = 0;
  const addFile = (path: string, value: string, maximum = MAX_XML_BYTES) => {
    const bytes = new TextEncoder().encode(value).byteLength;
    exportedBytes += bytes;
    if (bytes > maximum || exportedBytes > MAX_UNCOMPRESSED_BYTES) throw new Error("BCF export exceeds the bounded metadata size. Export fewer issues/comments.");
    zip.file(path, value);
  };
  addFile("bcf.version", '<?xml version="1.0" encoding="UTF-8"?><Version VersionId="3.0"/>');
  for (const value of markers) {
    const marker = normalizeReviewMarker(value);
    if (!marker) throw new Error("An issue has invalid coordinates or text. Correct it before BCF export.");
    const topicGuid = marker.bcfTopicGuid ?? guid(`groundwork:bcf:${marker.id}`);
    if (usedTopics.has(topicGuid)) throw new Error("Issues contain duplicate BCF topic identifiers.");
    usedTopics.add(topicGuid);
    const viewGuid = guid(`${topicGuid}:view`), workflow = reviewWorkflow(marker);
    const view = marker.viewpoint ?? { position: [marker.x, 8, marker.z + 8] as [number, number, number], direction: [0, -Math.SQRT1_2, -Math.SQRT1_2] as [number, number, number], up: [0, 1, 0] as [number, number, number], fieldOfView: 60, cameraType: "perspective" as const };
    const components = [...new Set([...(marker.targetIds ?? []).map(id => ifcSourceGuid(id, gridSet.has(id))), ...(view.componentGuids ?? [])])];
    const cameraType = view.cameraType === "orthographic" ? "OrthogonalCamera" : "PerspectiveCamera";
    addFile(`${topicGuid}/markup.bcf`, `<?xml version="1.0" encoding="UTF-8"?>
<Markup><Topic Guid="${topicGuid}" TopicType="Coordination" TopicStatus="${workflow === "resolved" ? "Closed" : workflow === "in-progress" ? "In Progress" : "Open"}">
<Title>${xml(marker.text)}</Title><Priority>${marker.severity === "blocker" ? "High" : marker.severity === "warning" ? "Normal" : "Low"}</Priority>
<CreationDate>${marker.createdAt ?? new Date().toISOString()}</CreationDate><CreationAuthor>Groundwork Design Studio</CreationAuthor>
${marker.updatedAt ? `<ModifiedDate>${marker.updatedAt}</ModifiedDate>` : ""}${marker.assignee ? `<AssignedTo>${xml(marker.assignee)}</AssignedTo>` : ""}${marker.dueDate ? `<DueDate>${marker.dueDate}T00:00:00Z</DueDate>` : ""}
<Description>${xml(`Groundwork review marker at (${marker.x.toFixed(3)}, ${marker.z.toFixed(3)}); category: ${marker.category ?? "manual"}.`)}</Description></Topic>
${(marker.comments ?? []).map(comment => `<Comment Guid="${uuidPattern.test(comment.id) ? comment.id : guid(comment.id)}"><Date>${comment.createdAt}</Date><Author>${xml(comment.author ?? "Groundwork reviewer")}</Author><Comment>${xml(comment.text)}</Comment></Comment>`).join("\n")}
<Viewpoints><ViewPoint Guid="${viewGuid}"><Viewpoint>viewpoint.bcfv</Viewpoint></ViewPoint></Viewpoints></Markup>`);
    addFile(`${topicGuid}/viewpoint.bcfv`, `<?xml version="1.0" encoding="UTF-8"?>
<VisualizationInfo Guid="${viewGuid}"><Components><Selection>${components.map(component => `<Component IfcGuid="${component}"/>`).join("")}</Selection></Components>
<${cameraType}>${vectorXml("CameraViewPoint", toIfc(view.position))}${vectorXml("CameraDirection", toIfc(view.direction))}${vectorXml("CameraUpVector", toIfc(view.up))}${cameraType === "OrthogonalCamera" ? `<ViewToWorldScale>${view.viewToWorldScale ?? 30}</ViewToWorldScale>` : `<FieldOfView>${view.fieldOfView ?? 60}</FieldOfView>`}</${cameraType}></VisualizationInfo>`);
    metadata.push({ topicGuid, marker });
  }
  addFile("groundwork-issues.json", JSON.stringify({ version: 1, units: "metres", axes: "x,y-up,z", markers: metadata }), 4 * MAX_XML_BYTES);
  addFile("project.bcfp", `<?xml version="1.0" encoding="UTF-8"?><ProjectExtension><Project ProjectId="${guid(projectName)}"><Name>${xml(projectName)}</Name></Project></ProjectExtension>`);
  const blob = await zip.generateAsync({ type: "blob", mimeType: "application/vnd.bcf+zip", compression: "DEFLATE" });
  if (blob.size > MAX_COMPRESSED_BYTES) throw new Error("BCF export exceeds the 10 MB package limit. Export fewer issues/comments.");
  return blob;
}

export function buildBcfZip(design: Design, projectName = "Groundwork project"): Promise<Blob> {
  return buildBcfRegisterZip(design.community?.review?.markers ?? design.infra?.review?.markers ?? [], projectName, (design.community?.structuralGrid ?? []).map(grid => grid.id));
}

export interface ImportedBcfTopic {
  guid: string; title: string; status: string; priority: string;
  assignee?: string; dueDate?: string; createdAt?: string; category?: string;
  comments: ReviewComment[]; componentGuids: string[]; viewpoint?: ReviewViewpoint;
  groundwork?: ReviewMarker;
}

/** The worker can be terminated even while an untrusted inflater is busy. */
function extractArchive(bytes: Uint8Array, signal?: AbortSignal): Promise<BcfArchiveEntry[]> {
  if (typeof Worker === "undefined") return Promise.reject(new Error("BCF import requires a browser with background worker support."));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./bcf.worker.ts", import.meta.url), { type: "module" });
    let settled = false;
    const finish = (error?: Error, entries?: BcfArchiveEntry[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); worker.terminate(); signal?.removeEventListener("abort", abort);
      if (error) reject(error); else resolve(entries!);
    };
    const abort = () => finish(new DOMException("BCF import cancelled.", "AbortError"));
    const timer = setTimeout(() => finish(new Error("BCF import took too long. Import a smaller archive.")), 30_000);
    worker.onmessage = ({ data }: MessageEvent<{ ok: boolean; entries?: BcfArchiveEntry[]; error?: string }>) => {
      if (!data?.ok || !Array.isArray(data.entries)) { finish(new Error(data?.error || "BCF archive could not be read.")); return; }
      finish(undefined, data.entries);
    };
    worker.onerror = () => finish(new Error("BCF background import failed."));
    worker.onmessageerror = () => finish(new Error("BCF background results could not be read."));
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener("abort", abort, { once: true });
    try { worker.postMessage(bytes, [bytes.buffer as ArrayBuffer]); } catch (error) { finish(error instanceof Error ? error : new Error("BCF import could not start.")); }
  });
}
function readEntry(entry: BcfArchiveEntry, maximum: number): string {
  if (entry.bytes.byteLength > maximum) throw new Error("BCF text exceeds the import limit.");
  return new TextDecoder().decode(entry.bytes);
}

const named = (element: Element, name: string) => element.localName.toLowerCase() === name.toLowerCase();
const child = (element: Element, name: string) => Array.from(element.children).find(value => named(value, name));
const descendants = (element: Element, name: string) => Array.from(element.getElementsByTagName("*")).filter(value => named(value, name));
const text = (element: Element, name: string, limit = 4000) => child(element, name)?.textContent?.trim().slice(0, limit) ?? "";
function parseXml(value: string): Element {
  if (/<!DOCTYPE|<!ENTITY/i.test(value)) throw new Error("BCF XML declarations containing DTDs or entities are unsupported.");
  const document = new DOMParser().parseFromString(value, "application/xml");
  if (named(document.documentElement, "parsererror") || descendants(document.documentElement, "parsererror").length) throw new Error("A BCF XML document is malformed.");
  return document.documentElement;
}
function vector(element: Element, name: string): [number, number, number] | undefined {
  const item = child(element, name);
  if (!item) return undefined;
  const values = ["X", "Y", "Z"].map(axis => { const value = text(item, axis); return value ? Number(value) : NaN; });
  return values.every(Number.isFinite) ? fromIfc(values as [number, number, number]) : undefined;
}
function parseViewpoint(value: string) {
  const root = parseXml(value);
  if (!named(root, "VisualizationInfo")) throw new Error("A BCF viewpoint has the wrong XML root.");
  const selection = descendants(root, "Selection")[0];
  const componentGuids = selection ? descendants(selection, "Component").map(component => component.getAttribute("IfcGuid") ?? "").filter(component => /^[0-9A-Za-z_$]{22}$/.test(component)).slice(0, 200) : [];
  const camera = child(root, "PerspectiveCamera") ?? child(root, "OrthogonalCamera");
  const viewpoint = camera ? normalizeReviewViewpoint({ position: vector(camera, "CameraViewPoint"), direction: vector(camera, "CameraDirection"), up: vector(camera, "CameraUpVector"), fieldOfView: Number(text(camera, "FieldOfView")), viewToWorldScale: Number(text(camera, "ViewToWorldScale")), cameraType: named(camera, "OrthogonalCamera") ? "orthographic" : "perspective", componentGuids }) : undefined;
  return { viewpoint, componentGuids };
}

export async function parseBcfZip(file: Blob, signal?: AbortSignal): Promise<ImportedBcfTopic[]> {
  if (file.size > MAX_BCF_COMPRESSED_BYTES) throw new Error("BCF import supports archives up to 10 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (signal?.aborted) throw new DOMException("BCF import cancelled.", "AbortError");
  const extracted = await extractArchive(bytes, signal), entries = new Map(extracted.map(entry => [entry.name, entry]));
  const topics: ImportedBcfTopic[] = [], metadata = new Map<string, ReviewMarker>();
  if (entries.size > MAX_BCF_ENTRIES) throw new Error("The BCF archive contains too many entries.");
  const metadataEntry = entries.get("groundwork-issues.json");
  if (metadataEntry) {
    const raw = JSON.parse(readEntry(metadataEntry, 4 * MAX_BCF_XML_BYTES)) as { version?: unknown; markers?: unknown } | null;
    if (raw?.version === 1 && Array.isArray(raw.markers)) for (const value of raw.markers.slice(0, MAX_REVIEW_MARKERS)) {
      if (!value || typeof value !== "object") continue;
      const record = value as { topicGuid?: unknown; marker?: unknown }, marker = normalizeReviewMarker(record.marker);
      if (marker && typeof record.topicGuid === "string" && uuidPattern.test(record.topicGuid)) metadata.set(record.topicGuid.toLowerCase(), marker);
    }
  }
  for (const [path, entry] of entries) {
    if (signal?.aborted) throw new DOMException("BCF import cancelled.", "AbortError");
    if (!/(?:^|\/)markup\.bcf$/i.test(path)) continue;
    if (topics.length >= MAX_REVIEW_MARKERS) throw new Error(`BCF import supports up to ${MAX_REVIEW_MARKERS} topics.`);
    const root = parseXml(readEntry(entry, MAX_BCF_XML_BYTES));
    if (!named(root, "Markup")) throw new Error("A BCF topic has the wrong XML root.");
    const topic = child(root, "Topic"), topicGuid = topic?.getAttribute("Guid") ?? "";
    if (!topic || !uuidPattern.test(topicGuid)) throw new Error("A BCF topic has a missing or invalid GUID.");
    const comments = Array.from(root.children).filter(value => named(value, "Comment")).map(comment => normalizeReviewComment({ id: comment.getAttribute("Guid"), text: text(comment, "Comment"), createdAt: text(comment, "Date"), author: text(comment, "Author", 120) })).filter((comment): comment is ReviewComment => Boolean(comment)).slice(0, 100);
    let view: ReturnType<typeof parseViewpoint> = { componentGuids: [], viewpoint: undefined };
    const folder = path.slice(0, path.lastIndexOf("/") + 1), references = descendants(root, "ViewPoint");
    const reference = references.map(item => text(item, "Viewpoint", 512)).find(Boolean);
    const viewPath = reference || "viewpoint.bcfv";
    if (viewPath.startsWith("/") || viewPath.includes("\\") || viewPath.split("/").includes("..")) throw new Error("A BCF viewpoint has an unsafe path.");
    const viewEntry = entries.get(`${folder}${viewPath}`);
    if (viewEntry) view = parseViewpoint(readEntry(viewEntry, MAX_BCF_XML_BYTES));
    const due = text(topic, "DueDate", 40).slice(0, 10);
    topics.push({ guid: topicGuid.toLowerCase(), title: text(topic, "Title") || "BCF topic", status: topic.getAttribute("TopicStatus") ?? "Open", priority: text(topic, "Priority", 100) || "Normal", assignee: text(topic, "AssignedTo", 120) || undefined, dueDate: validReviewDate(due) ? due : undefined, createdAt: text(topic, "CreationDate", 40) || undefined, category: text(topic, "TopicType", 100) || topic.getAttribute("TopicType") || "BCF", comments, ...view, groundwork: metadata.get(topicGuid.toLowerCase()) });
  }
  if (!topics.length) throw new Error("The archive contains no BCF topics.");
  return topics;
}

/** Unknown external component GUIDs survive exchange without becoming local object IDs. */
export function bcfTopicsToReviewMarkers(topics: ImportedBcfTopic[], modelIds: string[], gridIds: string[] = []): ReviewMarker[] {
  const gridSet = new Set(gridIds), localIds = new Set(modelIds), byGuid = new Map(modelIds.map(id => [ifcSourceGuid(id, gridSet.has(id)), id]));
  return topics.map(topic => {
    const source = topic.groundwork, viewpoint = topic.viewpoint ?? source?.viewpoint;
    const targetIds = [...new Set([...(source?.targetIds ?? []).filter(id => localIds.has(id)), ...topic.componentGuids.map(component => byGuid.get(component)).filter((id): id is string => Boolean(id))])];
    const resolved = /^(closed|resolved|done)$/i.test(topic.status), inProgress = /progress|active|started/i.test(topic.status);
    return normalizeReviewMarker({
      ...source, id: source?.id ?? `bcf-${topic.guid}`, bcfTopicGuid: topic.guid, text: topic.title,
      status: resolved ? "resolved" : "open", workflowStatus: resolved ? "resolved" : inProgress ? "in-progress" : "open",
      severity: /high|critical|urgent/i.test(topic.priority) ? "blocker" : /low/i.test(topic.priority) ? "note" : "warning",
      category: source?.category ?? topic.category ?? "BCF", assignee: topic.assignee, dueDate: topic.dueDate,
      createdAt: topic.createdAt ?? source?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString(), comments: topic.comments,
      x: source?.x ?? viewpoint?.position[0] ?? 0, z: source?.z ?? viewpoint?.position[2] ?? 0,
      targetIds, viewpoint: viewpoint ? { ...viewpoint, componentGuids: [...new Set([...(viewpoint.componentGuids ?? []), ...topic.componentGuids])] } : undefined,
    });
  }).filter((marker): marker is ReviewMarker => Boolean(marker));
}

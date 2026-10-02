import JSZip from "jszip";
import type { Design, ReviewComment, ReviewMarker, ReviewViewpoint } from "../types";
import { ifcSourceGuid } from "./bim";
import { MAX_REVIEW_MARKERS, normalizeReviewComment, normalizeReviewMarker, normalizeReviewViewpoint, reviewWorkflow, validReviewDate } from "./coordination";

const MAX_COMPRESSED_BYTES = 10 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 8000;
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

/** Preflight the central directory before any decompression. ZIP64/encryption are excluded. */
function inspectArchive(bytes: Uint8Array): void {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (data.getUint32(offset, true) === 0x06054b50 && offset + 22 + data.getUint16(offset + 20, true) === bytes.length) { end = offset; break; }
  }
  if (end < 0) throw new Error("The BCF ZIP directory is missing or malformed.");
  const count = data.getUint16(end + 10, true), size = data.getUint32(end + 12, true), start = data.getUint32(end + 16, true);
  if (data.getUint16(end + 4, true) || data.getUint16(end + 6, true) || data.getUint16(end + 8, true) !== count || count === 0xffff || size === 0xffffffff || start === 0xffffffff) throw new Error("Multi-volume and ZIP64 BCF archives are unsupported.");
  if (count > MAX_ZIP_ENTRIES || start + size > end) throw new Error("The BCF archive exceeds entry limits or has an invalid directory.");
  let cursor = start, unpacked = 0;
  const names = new Set<string>();
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > start + size || data.getUint32(cursor, true) !== 0x02014b50) throw new Error("The BCF archive contains a malformed entry.");
    const flags = data.getUint16(cursor + 8, true), method = data.getUint16(cursor + 10, true), compressed = data.getUint32(cursor + 20, true), expanded = data.getUint32(cursor + 24, true);
    const nameLength = data.getUint16(cursor + 28, true), extraLength = data.getUint16(cursor + 30, true), commentLength = data.getUint16(cursor + 32, true), local = data.getUint32(cursor + 42, true);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if ((flags & 1) || ![0, 8].includes(method) || next > start + size || compressed > bytes.length || expanded > 16 * 1024 * 1024 || local >= start || !nameLength || nameLength > 512) throw new Error("The BCF archive has an encrypted, unsupported, oversized or invalid entry.");
    const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    if (name.includes("\\") || name.includes("\0") || name.startsWith("/") || /^[a-z]:/i.test(name) || name.split("/").includes("..") || names.has(name)) throw new Error("The BCF archive has unsafe or duplicate paths.");
    names.add(name); unpacked += expanded;
    if (unpacked > MAX_UNCOMPRESSED_BYTES) throw new Error("The BCF archive expands beyond the 64 MB limit.");
    cursor = next;
  }
  if (cursor !== start + size) throw new Error("The BCF ZIP directory size is inconsistent.");
}

function readEntry(entry: JSZip.JSZipObject, maximum: number, budget: { used: number }): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let length = 0, settled = false;
    const stream = entry.internalStream("uint8array");
    stream.on("data", (chunk: Uint8Array) => {
      if (settled) return;
      length += chunk.byteLength; budget.used += chunk.byteLength;
      if (length > maximum || budget.used > MAX_UNCOMPRESSED_BYTES) { settled = true; stream.pause(); reject(new Error("BCF text or expanded data exceeds the import limit.")); return; }
      chunks.push(chunk);
    });
    stream.on("error", (error: Error) => { if (!settled) { settled = true; reject(error); } });
    stream.on("end", () => {
      if (settled) return;
      settled = true;
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      resolve(new TextDecoder().decode(bytes));
    });
    stream.resume();
  });
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

export async function parseBcfZip(file: Blob): Promise<ImportedBcfTopic[]> {
  if (file.size > MAX_COMPRESSED_BYTES) throw new Error("BCF import supports archives up to 10 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  inspectArchive(bytes);
  const zip = await JSZip.loadAsync(bytes), budget = { used: 0 }, topics: ImportedBcfTopic[] = [], metadata = new Map<string, ReviewMarker>();
  if (Object.keys(zip.files).length > MAX_ZIP_ENTRIES) throw new Error("The BCF archive contains too many entries.");
  const metadataEntry = zip.file("groundwork-issues.json");
  if (metadataEntry) {
    const raw = JSON.parse(await readEntry(metadataEntry, 4 * MAX_XML_BYTES, budget)) as { version?: unknown; markers?: unknown } | null;
    if (raw?.version === 1 && Array.isArray(raw.markers)) for (const value of raw.markers.slice(0, MAX_REVIEW_MARKERS)) {
      if (!value || typeof value !== "object") continue;
      const record = value as { topicGuid?: unknown; marker?: unknown }, marker = normalizeReviewMarker(record.marker);
      if (marker && typeof record.topicGuid === "string" && uuidPattern.test(record.topicGuid)) metadata.set(record.topicGuid.toLowerCase(), marker);
    }
  }
  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir || !/(?:^|\/)markup\.bcf$/i.test(path)) continue;
    if (topics.length >= MAX_REVIEW_MARKERS) throw new Error(`BCF import supports up to ${MAX_REVIEW_MARKERS} topics.`);
    const root = parseXml(await readEntry(entry, MAX_XML_BYTES, budget));
    if (!named(root, "Markup")) throw new Error("A BCF topic has the wrong XML root.");
    const topic = child(root, "Topic"), topicGuid = topic?.getAttribute("Guid") ?? "";
    if (!topic || !uuidPattern.test(topicGuid)) throw new Error("A BCF topic has a missing or invalid GUID.");
    const comments = Array.from(root.children).filter(value => named(value, "Comment")).map(comment => normalizeReviewComment({ id: comment.getAttribute("Guid"), text: text(comment, "Comment"), createdAt: text(comment, "Date"), author: text(comment, "Author", 120) })).filter((comment): comment is ReviewComment => Boolean(comment)).slice(0, 100);
    let view: ReturnType<typeof parseViewpoint> = { componentGuids: [], viewpoint: undefined };
    const folder = path.slice(0, path.lastIndexOf("/") + 1), references = descendants(root, "ViewPoint");
    const reference = references.map(item => text(item, "Viewpoint", 512)).find(Boolean);
    const viewPath = reference || "viewpoint.bcfv";
    if (viewPath.startsWith("/") || viewPath.includes("\\") || viewPath.split("/").includes("..")) throw new Error("A BCF viewpoint has an unsafe path.");
    const viewEntry = zip.file(`${folder}${viewPath}`);
    if (viewEntry) view = parseViewpoint(await readEntry(viewEntry, MAX_XML_BYTES, budget));
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


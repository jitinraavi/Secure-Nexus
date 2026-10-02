import JSZip from "jszip";
import type { Design, ReviewMarker } from "../types";

const xml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const guid = (seed: string) => {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < seed.length; i += 1) {
    h1 = Math.imul(h1 ^ seed.charCodeAt(i), 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ seed.charCodeAt(i), 0x85ebca6b) >>> 0;
  }
  const hex = (h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0") + h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0")).slice(0, 32);
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;
};

function markers(design: Design): ReviewMarker[] {
  return design.community?.review?.markers ?? design.infra?.review?.markers ?? [];
}

export async function buildBcfZip(design: Design, projectName = "Groundwork project"): Promise<Blob> {
  const zip = new JSZip();
  zip.file("bcf.version", `<?xml version="1.0" encoding="UTF-8"?><Version VersionId="3.0" DetailedVersion="3.0"/>`);
  const list = markers(design);
  for (const marker of list) {
    const topicGuid = guid(`groundwork:bcf:${marker.id}`);
    const folder = zip.folder(topicGuid)!;
    const title = marker.text || "Coordination issue";
    folder.file("markup.bcf", `<?xml version="1.0" encoding="UTF-8"?>
<Markup xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Topic Guid="${topicGuid}" TopicType="Coordination" TopicStatus="${marker.status === "resolved" ? "Closed" : "Open"}">
    <Title>${xml(title)}</Title>
    <Priority>${marker.severity === "blocker" ? "High" : marker.severity === "warning" ? "Normal" : "Low"}</Priority>
    <Description>${xml(`Groundwork review marker at (${marker.x.toFixed(3)}, ${marker.z.toFixed(3)})`)}</Description>
    <CreationAuthor>Groundwork Design Studio</CreationAuthor>
    <CreationDate>${new Date().toISOString()}</CreationDate>
  </Topic>
  <Viewpoints><ViewPoint Guid="${guid(`${marker.id}:view`)}"><Viewpoint>viewpoint.bcfv</Viewpoint></ViewPoint></Viewpoints>
</Markup>`);
    folder.file("viewpoint.bcfv", `<?xml version="1.0" encoding="UTF-8"?>
<VisualizationInfo Guid="${guid(`${marker.id}:view`)}">
  <PerspectiveCamera>
    <CameraViewPoint><X>${marker.x}</X><Y>8</Y><Z>${marker.z + 8}</Z></CameraViewPoint>
    <CameraDirection><X>0</X><Y>-0.7</Y><Z>-0.7</Z></CameraDirection>
    <CameraUpVector><X>0</X><Y>1</Y><Z>0</Z></CameraUpVector>
    <FieldOfView>60</FieldOfView>
  </PerspectiveCamera>
  <Components><Selection>${(marker.targetIds ?? []).map((id) => `<Component IfcGuid="${guid(`entity:${id}`)}"/>`).join("")}</Selection></Components>
</VisualizationInfo>`);
  }
  zip.file("project.bcfp", `<?xml version="1.0" encoding="UTF-8"?><ProjectExtension><Project ProjectId="${guid(projectName)}"><Name>${xml(projectName)}</Name></Project></ProjectExtension>`);
  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.bcf+zip", compression: "DEFLATE" });
}

export interface ImportedBcfTopic {
  guid: string;
  title: string;
  status: string;
  priority: string;
}

export async function parseBcfZip(file: Blob): Promise<ImportedBcfTopic[]> {
  const zip = await JSZip.loadAsync(file);
  const topics: ImportedBcfTopic[] = [];
  for (const [path, entry] of Object.entries(zip.files)) {
    if (!path.endsWith("/markup.bcf") || entry.dir) continue;
    const content = await entry.async("text");
    const topic = content.match(/<Topic\s+Guid="([^"]+)"[^>]*TopicStatus="([^"]*)"[^>]*>/i);
    const title = content.match(/<Title>([\s\S]*?)<\/Title>/i)?.[1] ?? "BCF topic";
    const priority = content.match(/<Priority>([\s\S]*?)<\/Priority>/i)?.[1] ?? "Normal";
    if (topic) topics.push({ guid: topic[1], status: topic[2], title: title.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"), priority });
  }
  return topics;
}

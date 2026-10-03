import { engineeringRecord, finiteNumber, identifier, requireFinite, solvePositiveSystem } from "./engineeringNumerics";

export type Vector3D = [number, number, number];
export type FrameRestraints3D = [boolean, boolean, boolean, boolean, boolean, boolean];
export interface FrameNode3D { id: string; xM: number; yM: number; zM: number; restraints: FrameRestraints3D }
export interface FrameUserCriteria3D {
  allowableAxialN: number; allowableShearYN: number; allowableShearZN: number; allowableTorsionNm: number;
  allowableMomentYNm: number; allowableMomentZNm: number; allowableChordDeflectionRatio: number;
}
export interface FrameMember3D {
  id: string; start: string; end: string; areaM2: number; inertiaYM4: number; inertiaZM4: number;
  torsionConstantM4: number; elasticModulusPa: number; shearModulusPa: number;
  /** Global reference vector projected perpendicular to the start-to-end local x axis. */
  localYAxis: Vector3D; design?: FrameUserCriteria3D;
}
export interface FrameNodalLoad3D { node: string; fxN: number; fyN: number; fzN: number; mxNm: number; myNm: number; mzNm: number }
export interface FrameUniformLoad3D { member: string; axialNPerM: number; yNPerM: number; zNPerM: number }
export interface FrameLoadCase3D { id: string; nodal: FrameNodalLoad3D[]; uniform: FrameUniformLoad3D[] }
export interface FrameCombination3D { id: string; factors: Record<string, number> }
export interface FrameModel3D {
  version: 1; analysis?: "linear"; nodes: FrameNode3D[]; members: FrameMember3D[];
  loadCases: FrameLoadCase3D[]; combinations?: FrameCombination3D[];
}
export interface FrameDisplacement3D { nodeId: string; uxM: number; uyM: number; uzM: number; rxRad: number; ryRad: number; rzRad: number }
export interface FrameReaction3D { nodeId: string; fxN: number; fyN: number; fzN: number; mxNm: number; myNm: number; mzNm: number }
export interface FrameMemberResult3D {
  memberId: string; localEndForces: number[];
  maxAxialTensionN: number; maxAxialCompressionN: number; maxShearYN: number; maxShearZN: number;
  maxTorsionNm: number; maxMomentYNm: number; maxMomentZNm: number; maxChordDeflectionM: number; chordDeflectionUpperBoundM: number;
  design?: { axialBendingUtilization: number; shearYUtilization: number; shearZUtilization: number;
    torsionUtilization: number; deflectionUtilization: number; satisfiesUserCriteria: boolean; basis: string };
}
export interface FrameEquilibrium3D {
  originM: Vector3D; fxN: number; fyN: number; fzN: number; mxNm: number; myNm: number; mzNm: number;
  relativeForceResidual: number; relativeMomentResidual: number;
}
export interface FrameCombinationResult3D {
  combinationId: string; status: "converged"; maxFreeForceResidualN: number; maxFreeMomentResidualNm: number;
  equilibrium: FrameEquilibrium3D; displacements: FrameDisplacement3D[]; reactions: FrameReaction3D[]; members: FrameMemberResult3D[];
}
export interface FramePeak3D { value: number; combinationId: string }
export interface FrameNodeEnvelope3D { nodeId: string; maxTranslationM: FramePeak3D; maxRotationRad: FramePeak3D }
export interface FrameMemberEnvelope3D {
  memberId: string; maxAxialTensionN: FramePeak3D; maxAxialCompressionN: FramePeak3D;
  maxShearYN: FramePeak3D; maxShearZN: FramePeak3D; maxTorsionNm: FramePeak3D;
  maxMomentYNm: FramePeak3D; maxMomentZNm: FramePeak3D; maxChordDeflectionM: FramePeak3D; chordDeflectionUpperBoundM: FramePeak3D;
}
export interface FrameAnalysisReport3D {
  version: 1; method: string; verification: "unverified"; results: FrameCombinationResult3D[];
  envelopes: { nodes: FrameNodeEnvelope3D[]; members: FrameMemberEnvelope3D[] }; warnings: string[];
}

const dot = (a: Vector3D, b: Vector3D): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vector3D, b: Vector3D): Vector3D => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const magnitude = (a: Vector3D): number => Math.hypot(...a);
const normalize = (a: Vector3D): Vector3D => { const length = magnitude(a); return [a[0] / length, a[1] / length, a[2] / length]; };
const multiply = (matrix: number[][], vector: number[]): number[] => matrix.map(row => row.reduce((sum, value, i) => sum + value * vector[i], 0));
const matrixOf = (size: number): number[][] => Array.from({ length: size }, () => Array<number>(size).fill(0));

function fields(value: Record<string, unknown>, allowed: string[], label: string): void {
  const unknown = Object.keys(value).find(key => !allowed.includes(key));
  if (unknown) throw new Error(`${label}.${unknown} is not supported by the linear 3D frame schema.`);
}

function memberAxes(a: FrameNode3D, b: FrameNode3D, reference: Vector3D, id: string) {
  const delta: Vector3D = [b.xM - a.xM, b.yM - a.yM, b.zM - a.zM], length = magnitude(delta);
  if (length < 1e-5) throw new Error(`${id} is shorter than 0.00001 m.`);
  const x = normalize(delta), input = normalize(reference), projection = dot(x, input);
  const projected: Vector3D = [input[0] - projection * x[0], input[1] - projection * x[1], input[2] - projection * x[2]];
  if (!Number.isFinite(magnitude(projected)) || magnitude(projected) < 1e-6) throw new Error(`${id}.localYAxis must not be parallel to the member axis.`);
  const y = normalize(projected), z = normalize(cross(x, y));
  return { length, axes: [x, y, z] };
}

/** Strict SI JSON validation; unsupported analysis features cannot be silently ignored. */
export function parseFrameModel3D(value: unknown): FrameModel3D {
  if (!engineeringRecord(value) || value.version !== 1) throw new Error("3D frame input requires version 1.");
  fields(value, ["version", "analysis", "nodes", "members", "loadCases", "combinations"], "frame");
  if (value.analysis !== undefined && value.analysis !== "linear") throw new Error("3D frames support linear static elastic analysis only.");
  if (!Array.isArray(value.nodes) || !value.nodes.length || value.nodes.length > 30) throw new Error("3D frame requires 1-30 nodes.");
  if (!Array.isArray(value.members) || !value.members.length || value.members.length > 60) throw new Error("3D frame requires 1-60 members.");
  const nodeIds = new Set<string>(), memberIds = new Set<string>(), caseIds = new Set<string>(), connectedNodes = new Set<string>();
  for (const node of value.nodes) {
    if (!engineeringRecord(node) || !identifier(node.id) || nodeIds.has(node.id)) throw new Error("3D node identifiers must be unique.");
    fields(node, ["id", "xM", "yM", "zM", "restraints"], node.id); nodeIds.add(node.id);
    for (const key of ["xM", "yM", "zM"]) requireFinite(node[key], `${node.id}.${key}`, -1e6, 1e6);
    if (!Array.isArray(node.restraints) || node.restraints.length !== 6 || node.restraints.some(item => typeof item !== "boolean")) throw new Error(`${node.id} requires [UX, UY, UZ, RX, RY, RZ] boolean restraints.`);
  }
  for (const member of value.members) {
    if (!engineeringRecord(member) || !identifier(member.id) || memberIds.has(member.id)) throw new Error("3D member identifiers must be unique.");
    fields(member, ["id", "start", "end", "areaM2", "inertiaYM4", "inertiaZM4", "torsionConstantM4", "elasticModulusPa", "shearModulusPa", "localYAxis", "design"], member.id);
    memberIds.add(member.id);
    if (typeof member.start !== "string" || typeof member.end !== "string" || !nodeIds.has(member.start) || !nodeIds.has(member.end) || member.start === member.end) throw new Error(`${member.id} has invalid end nodes.`);
    connectedNodes.add(member.start); connectedNodes.add(member.end);
    requireFinite(member.areaM2, `${member.id}.areaM2`, 1e-8, 1e4);
    for (const key of ["inertiaYM4", "inertiaZM4", "torsionConstantM4"]) requireFinite(member[key], `${member.id}.${key}`, 1e-14, 1e6);
    for (const key of ["elasticModulusPa", "shearModulusPa"]) requireFinite(member[key], `${member.id}.${key}`, 1e3, 1e13);
    if (!Array.isArray(member.localYAxis) || member.localYAxis.length !== 3) throw new Error(`${member.id}.localYAxis requires three global reference components.`);
    member.localYAxis.forEach(component => requireFinite(component, `${member.id}.localYAxis`, -1e6, 1e6));
    if (Math.hypot(...(member.localYAxis as number[])) < 1e-12) throw new Error(`${member.id}.localYAxis cannot be zero.`);
    if (member.design !== undefined) {
      if (!engineeringRecord(member.design)) throw new Error(`${member.id}.design must be an object.`);
      const capacityKeys = ["allowableAxialN", "allowableShearYN", "allowableShearZN", "allowableTorsionNm", "allowableMomentYNm", "allowableMomentZNm", "allowableChordDeflectionRatio"];
      fields(member.design, capacityKeys, `${member.id}.design`);
      for (const key of capacityKeys) requireFinite(member.design[key], `${member.id}.design.${key}`, 1e-12, 1e15);
      requireFinite(member.design.allowableChordDeflectionRatio, `${member.id}.design.allowableChordDeflectionRatio`, 1e-8, 1);
    }
  }
  if (value.nodes.some(node => !connectedNodes.has((node as Record<string, unknown>).id as string))) throw new Error("3D frame contains nodes without connected members.");
  if (!Array.isArray(value.loadCases) || !value.loadCases.length || value.loadCases.length > 20) throw new Error("3D frame requires 1-20 load cases.");
  for (const loadCase of value.loadCases) {
    if (!engineeringRecord(loadCase) || !identifier(loadCase.id) || caseIds.has(loadCase.id)) throw new Error("3D load case identifiers must be unique.");
    fields(loadCase, ["id", "nodal", "uniform"], loadCase.id); caseIds.add(loadCase.id);
    if (!Array.isArray(loadCase.nodal) || loadCase.nodal.length > 1000 || !Array.isArray(loadCase.uniform) || loadCase.uniform.length > 1000) throw new Error("3D load cases require bounded nodal and uniform arrays.");
    for (const load of loadCase.nodal) {
      if (!engineeringRecord(load) || typeof load.node !== "string" || !nodeIds.has(load.node)) throw new Error("3D nodal load references a missing node.");
      fields(load, ["node", "fxN", "fyN", "fzN", "mxNm", "myNm", "mzNm"], "nodalLoad");
      for (const key of ["fxN", "fyN", "fzN", "mxNm", "myNm", "mzNm"]) requireFinite(load[key], key, -1e12, 1e12);
    }
    for (const load of loadCase.uniform) {
      if (!engineeringRecord(load) || typeof load.member !== "string" || !memberIds.has(load.member)) throw new Error("3D uniform load references a missing member.");
      fields(load, ["member", "axialNPerM", "yNPerM", "zNPerM"], "uniformLoad");
      for (const key of ["axialNPerM", "yNPerM", "zNPerM"]) requireFinite(load[key], key, -1e12, 1e12);
    }
  }
  if (value.combinations !== undefined) {
    if (!Array.isArray(value.combinations) || !value.combinations.length || value.combinations.length > 20) throw new Error("Provide 1-20 3D combinations or omit combinations.");
    const combinationIds = new Set<string>();
    for (const combination of value.combinations) {
      if (!engineeringRecord(combination) || !identifier(combination.id) || combinationIds.has(combination.id) || !engineeringRecord(combination.factors) || !Object.keys(combination.factors).length) throw new Error("Invalid 3D combination identifiers or factors.");
      fields(combination, ["id", "factors"], "combination"); combinationIds.add(combination.id);
      for (const [caseId, factor] of Object.entries(combination.factors)) if (!caseIds.has(caseId) || !finiteNumber(factor) || Math.abs(factor) > 100) throw new Error("3D combination references an unknown case or invalid factor.");
    }
  }
  const model = value as unknown as FrameModel3D;
  for (const member of model.members) memberAxes(model.nodes.find(node => node.id === member.start)!, model.nodes.find(node => node.id === member.end)!, member.localYAxis, member.id);
  return model;
}

export function frameLoadCombinations3D(model: FrameModel3D): FrameCombination3D[] {
  return model.combinations ?? model.loadCases.map(loadCase => ({ id: loadCase.id, factors: { [loadCase.id]: 1 } }));
}
function factorOf(combination: FrameCombination3D, caseId: string): number {
  return Object.prototype.hasOwnProperty.call(combination.factors, caseId) ? combination.factors[caseId] : 0;
}

function elementData(model: FrameModel3D, member: FrameMember3D) {
  const i = model.nodes.findIndex(node => node.id === member.start), j = model.nodes.findIndex(node => node.id === member.end);
  const { length, axes } = memberAxes(model.nodes[i], model.nodes[j], member.localYAxis, member.id);
  const transform = matrixOf(12), elastic = matrixOf(12);
  // Proper orthonormal rotation is identical for polar translations and axial rotations.
  for (let block = 0; block < 4; block++) for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) transform[block * 3 + row][block * 3 + col] = axes[row][col];
  const axial = member.elasticModulusPa * member.areaM2 / length, torsion = member.shearModulusPa * member.torsionConstantM4 / length;
  for (const [a, b, stiffness] of [[0, 6, axial], [3, 9, torsion]]) {
    elastic[a][a] = stiffness; elastic[b][b] = stiffness; elastic[a][b] = -stiffness; elastic[b][a] = -stiffness;
  }
  const addBending = (indices: number[], ei: number, signs: number[]): void => {
    const a = 12 * ei / length ** 3, b = 6 * ei / length ** 2, c = 4 * ei / length, d = 2 * ei / length;
    const bending = [[a, b, -a, b], [b, c, -b, d], [-a, -b, a, -b], [b, d, -b, c]];
    for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) elastic[indices[row]][indices[col]] += signs[row] * bending[row][col] * signs[col];
  };
  addBending([1, 5, 7, 11], member.elasticModulusPa * member.inertiaZM4, [1, 1, 1, 1]);
  // Right-hand rotation about local y is the negative slope of displacement in z.
  addBending([2, 4, 8, 10], member.elasticModulusPa * member.inertiaYM4, [1, -1, 1, -1]);
  const global = matrixOf(12);
  for (let row = 0; row < 12; row++) for (let col = 0; col < 12; col++) for (let a = 0; a < 12; a++) for (let b = 0; b < 12; b++) global[row][col] += transform[a][row] * elastic[a][b] * transform[b][col];
  return { length, transform, elastic, global, dofs: Array.from({ length: 12 }, (_, dof) => (dof < 6 ? i : j) * 6 + dof % 6) };
}

function equilibriumOf(model: FrameModel3D, applied: number[], reaction: number[]): FrameEquilibrium3D {
  const originM: Vector3D = [model.nodes[0].xM, model.nodes[0].yM, model.nodes[0].zM];
  const total = Array<number>(6).fill(0); let forceScale = 0, momentScale = 0;
  for (let i = 0; i < model.nodes.length; i++) {
    const node = model.nodes[i], arm: Vector3D = [node.xM - originM[0], node.yM - originM[1], node.zM - originM[2]];
    for (const vector of [applied, reaction]) {
      const force: Vector3D = [vector[i * 6], vector[i * 6 + 1], vector[i * 6 + 2]], moment = cross(arm, force);
      for (let axis = 0; axis < 3; axis++) { total[axis] += force[axis]; total[axis + 3] += moment[axis] + vector[i * 6 + axis + 3]; }
      forceScale += magnitude(force); momentScale += magnitude(moment) + Math.hypot(vector[i * 6 + 3], vector[i * 6 + 4], vector[i * 6 + 5]);
    }
  }
  return { originM, fxN: total[0], fyN: total[1], fzN: total[2], mxNm: total[3], myNm: total[4], mzNm: total[5],
    relativeForceResidual: Math.hypot(total[0], total[1], total[2]) / Math.max(1, forceScale),
    relativeMomentResidual: Math.hypot(total[3], total[4], total[5]) / Math.max(1, momentScale) };
}

function assertFiniteTree(value: unknown): void {
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("3D analysis overflowed; results rejected.");
  if (Array.isArray(value)) value.forEach(assertFiniteTree);
  else if (engineeringRecord(value)) Object.values(value).forEach(assertFiniteTree);
}

/** Bounded dense direct stiffness; intentionally no geometric or material nonlinearity. */
export function analyzeFrame3D(input: FrameModel3D): FrameAnalysisReport3D {
  const model = parseFrameModel3D(input), size = model.nodes.length * 6, data = model.members.map(member => elementData(model, member));
  const matrix = matrixOf(size), free = Array.from({ length: size }, (_, dof) => dof).filter(dof => !model.nodes[Math.floor(dof / 6)].restraints[dof % 6]);
  for (const item of data) for (let row = 0; row < 12; row++) for (let col = 0; col < 12; col++) matrix[item.dofs[row]][item.dofs[col]] += item.global[row][col];
  const results = frameLoadCombinations3D(model).map((combination): FrameCombinationResult3D => {
    const applied = Array<number>(size).fill(0), equivalent = model.members.map(() => Array<number>(12).fill(0));
    const uniform = model.members.map((): Vector3D => [0, 0, 0]);
    for (const loadCase of model.loadCases) {
      const factor = factorOf(combination, loadCase.id);
      for (const load of loadCase.nodal) {
        const start = model.nodes.findIndex(node => node.id === load.node) * 6;
        [load.fxN, load.fyN, load.fzN, load.mxNm, load.myNm, load.mzNm].forEach((value, offset) => { applied[start + offset] += value * factor; });
      }
      for (const load of loadCase.uniform) {
        const index = model.members.findIndex(member => member.id === load.member);
        uniform[index][0] += load.axialNPerM * factor; uniform[index][1] += load.yNPerM * factor; uniform[index][2] += load.zNPerM * factor;
      }
    }
    for (const [index, item] of data.entries()) {
      const [qx, qy, qz] = uniform[index], l = item.length;
      equivalent[index] = [qx * l / 2, qy * l / 2, qz * l / 2, 0, -qz * l * l / 12, qy * l * l / 12,
        qx * l / 2, qy * l / 2, qz * l / 2, 0, qz * l * l / 12, -qy * l * l / 12];
      for (let col = 0; col < 12; col++) for (let row = 0; row < 12; row++) applied[item.dofs[col]] += item.transform[row][col] * equivalent[index][row];
    }
    assertFiniteTree(matrix); assertFiniteTree(applied);
    const reduced = solvePositiveSystem(free.map(row => free.map(col => matrix[row][col])), free.map(dof => applied[dof]));
    const displacement = Array<number>(size).fill(0); free.forEach((dof, index) => { displacement[dof] = reduced[index]; });
    const residual = multiply(matrix, displacement).map((value, dof) => value - applied[dof]);
    const reaction = residual.map((value, dof) => model.nodes[Math.floor(dof / 6)].restraints[dof % 6] ? value : 0);
    const maxFreeForceResidualN = Math.max(0, ...free.filter(dof => dof % 6 < 3).map(dof => Math.abs(residual[dof])));
    const maxFreeMomentResidualNm = Math.max(0, ...free.filter(dof => dof % 6 >= 3).map(dof => Math.abs(residual[dof])));
    const freeForceScale = Math.max(1, ...free.filter(dof => dof % 6 < 3).map(dof => Math.abs(applied[dof])));
    const freeMomentScale = Math.max(1, ...free.filter(dof => dof % 6 >= 3).map(dof => Math.abs(applied[dof])));
    const equilibrium = equilibriumOf(model, applied, reaction);
    if (maxFreeForceResidualN / freeForceScale > 1e-7 || maxFreeMomentResidualNm / freeMomentScale > 1e-7 || equilibrium.relativeForceResidual > 1e-7 || equilibrium.relativeMomentResidual > 1e-7) throw new Error(`${combination.id}: force or moment equilibrium tolerance exceeded; results rejected.`);
    const members = model.members.map((member, index): FrameMemberResult3D => {
      const item = data[index], l = item.length, localU = multiply(item.transform, item.dofs.map(dof => displacement[dof]));
      const ends = multiply(item.elastic, localU).map((value, dof) => value - equivalent[index][dof]);
      const [qx, qy, qz] = uniform[index];
      const axialAt = (x: number): number => -ends[0] - qx * x;
      const momentYAt = (x: number): number => -ends[4] - ends[2] * x - qz * x * x / 2;
      const momentZAt = (x: number): number => -ends[5] + ends[1] * x + qy * x * x / 2;
      const momentYStations = [0, l], momentZStations = [0, l];
      if (qz !== 0 && -ends[2] / qz > 0 && -ends[2] / qz < l) momentYStations.push(-ends[2] / qz);
      if (qy !== 0 && -ends[1] / qy > 0 && -ends[1] / qy < l) momentZStations.push(-ends[1] / qy);
      const maxAxialTensionN = Math.max(0, axialAt(0), axialAt(l)), maxAxialCompressionN = Math.max(0, -axialAt(0), -axialAt(l));
      const maxShearYN = Math.max(Math.abs(ends[1]), Math.abs(-ends[1] - qy * l)), maxShearZN = Math.max(Math.abs(ends[2]), Math.abs(-ends[2] - qz * l));
      const maxTorsionNm = Math.max(Math.abs(ends[3]), Math.abs(ends[9]));
      const maxMomentYNm = Math.max(...momentYStations.map(x => Math.abs(momentYAt(x)))), maxMomentZNm = Math.max(...momentZStations.map(x => Math.abs(momentZAt(x))));
      let maxChordDeflectionM = 0;
      for (let station = 0; station <= 100; station++) {
        const t = station / 100, x = t * l, h1 = 1 - 3 * t * t + 2 * t ** 3, h2 = l * (t - 2 * t * t + t ** 3), h3 = 3 * t * t - 2 * t ** 3, h4 = l * (-t * t + t ** 3);
        const v = h1 * localU[1] + h2 * localU[5] + h3 * localU[7] + h4 * localU[11] + qy * x * x * (l - x) ** 2 / (24 * member.elasticModulusPa * member.inertiaZM4);
        const w = h1 * localU[2] - h2 * localU[4] + h3 * localU[8] - h4 * localU[10] + qz * x * x * (l - x) ** 2 / (24 * member.elasticModulusPa * member.inertiaYM4);
        maxChordDeflectionM = Math.max(maxChordDeflectionM, Math.hypot(v - (1 - t) * localU[1] - t * localU[7], w - (1 - t) * localU[2] - t * localU[8]));
      }
      // Quartic Bezier representation of chord-relative v/w. Bernstein weights are
      // nonnegative and sum to one; the largest paired control norm bounds the curve.
      const chordControls = (start: number, end: number, startSlope: number, endSlope: number, q: number, ei: number): number[] => {
        const a = l * startSlope + start - end, b = l * endSlope + start - end, particular = q * l ** 4 / (24 * ei);
        return [0, a / 4, (a - b + particular) / 6, -b / 4, 0];
      };
      const vControls = chordControls(localU[1], localU[7], localU[5], localU[11], qy, member.elasticModulusPa * member.inertiaZM4);
      const wControls = chordControls(localU[2], localU[8], -localU[4], -localU[10], qz, member.elasticModulusPa * member.inertiaYM4);
      const chordDeflectionUpperBoundM = Math.max(maxChordDeflectionM, ...vControls.map((value, station) => Math.hypot(value, wControls[station]))) * (1 + 1e-12);
      const design = member.design && {
        axialBendingUtilization: Math.max(maxAxialTensionN, maxAxialCompressionN) / member.design.allowableAxialN + maxMomentYNm / member.design.allowableMomentYNm + maxMomentZNm / member.design.allowableMomentZNm,
        shearYUtilization: maxShearYN / member.design.allowableShearYN, shearZUtilization: maxShearZN / member.design.allowableShearZN,
        torsionUtilization: maxTorsionNm / member.design.allowableTorsionNm, deflectionUtilization: chordDeflectionUpperBoundM / (l * member.design.allowableChordDeflectionRatio),
        satisfiesUserCriteria: false, basis: "Explicit user capacities; conservative sum of independent axial and biaxial moment peaks, separate shear/torsion limits and a quartic Bezier convex-hull upper bound on resultant chord deflection. No national-code, buckling, stability or detailing check.",
      };
      if (design) design.satisfiesUserCriteria = Math.max(design.axialBendingUtilization, design.shearYUtilization, design.shearZUtilization, design.torsionUtilization, design.deflectionUtilization) <= 1;
      return { memberId: member.id, localEndForces: ends, maxAxialTensionN, maxAxialCompressionN, maxShearYN, maxShearZN, maxTorsionNm, maxMomentYNm, maxMomentZNm, maxChordDeflectionM, chordDeflectionUpperBoundM, design };
    });
    const result: FrameCombinationResult3D = {
      combinationId: combination.id, status: "converged", maxFreeForceResidualN, maxFreeMomentResidualNm, equilibrium,
      displacements: model.nodes.map((node, i) => ({ nodeId: node.id, uxM: displacement[i * 6], uyM: displacement[i * 6 + 1], uzM: displacement[i * 6 + 2], rxRad: displacement[i * 6 + 3], ryRad: displacement[i * 6 + 4], rzRad: displacement[i * 6 + 5] })),
      reactions: model.nodes.filter(node => node.restraints.some(Boolean)).map(node => { const i = model.nodes.findIndex(item => item.id === node.id) * 6; return { nodeId: node.id, fxN: reaction[i], fyN: reaction[i + 1], fzN: reaction[i + 2], mxNm: reaction[i + 3], myNm: reaction[i + 4], mzNm: reaction[i + 5] }; }), members,
    };
    assertFiniteTree(result); return result;
  });
  const peak = (read: (result: FrameCombinationResult3D) => number): FramePeak3D => results.reduce((maximum, result) => { const value = read(result); return value > maximum.value ? { value, combinationId: result.combinationId } : maximum; }, { value: -1, combinationId: "" });
  const envelopes = {
    nodes: model.nodes.map((node, index): FrameNodeEnvelope3D => ({ nodeId: node.id,
      maxTranslationM: peak(result => { const u = result.displacements[index]; return Math.hypot(u.uxM, u.uyM, u.uzM); }),
      maxRotationRad: peak(result => { const u = result.displacements[index]; return Math.hypot(u.rxRad, u.ryRad, u.rzRad); }) })),
    members: model.members.map((member, index): FrameMemberEnvelope3D => ({ memberId: member.id,
      maxAxialTensionN: peak(result => result.members[index].maxAxialTensionN), maxAxialCompressionN: peak(result => result.members[index].maxAxialCompressionN),
      maxShearYN: peak(result => result.members[index].maxShearYN), maxShearZN: peak(result => result.members[index].maxShearZN), maxTorsionNm: peak(result => result.members[index].maxTorsionNm),
      maxMomentYNm: peak(result => result.members[index].maxMomentYNm), maxMomentZNm: peak(result => result.members[index].maxMomentZNm), maxChordDeflectionM: peak(result => result.members[index].maxChordDeflectionM), chordDeflectionUpperBoundM: peak(result => result.members[index].chordDeflectionUpperBoundM) })),
  };
  return { version: 1, method: "3D linear elastic Euler-Bernoulli direct stiffness; axial, Saint-Venant torsion and biaxial bending", verification: "unverified", results, envelopes,
    warnings: ["Prismatic straight members, rigid connections, zero support displacement, principal section axes, linear static small displacement only; no shear deformation or warping torsion.",
      "Member reference vectors and local uniform loads are authored explicitly; no automatic self-weight or load generation.",
      "Axial/shear/moment envelopes include exact extrema for constant loads. Sampled chord deflection can underestimate the maximum; design ratios use a conservative quartic Bezier convex-hull upper bound, which may overestimate it.",
      "End forces act on the member in local [FX, FY, FZ, MX, MY, MZ] order at I then J. Global reaction moments are reported at each support node.",
      "Rigid-body mechanisms, ill-conditioned stiffness and unacceptable equilibrium residuals are rejected. Numerical acceptance does not establish engineering validation.",
      "User capacity ratios are screening criteria; country selection does not supply unimplemented national-code resistance, buckling, seismic, connection or detailing calculations.",
      "Source reviewed only. Benchmark execution and independent solver comparison remain required before engineering use."] };
}

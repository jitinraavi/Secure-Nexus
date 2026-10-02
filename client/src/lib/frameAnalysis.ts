import { engineeringRecord, finiteNumber, identifier, requireFinite, solvePositiveSystem } from "./engineeringNumerics";

export interface FrameNode2D { id: string; xM: number; yM: number; restraints: [boolean, boolean, boolean] }
export interface FrameMember2D {
  id: string; start: string; end: string; areaM2: number; inertiaM4: number; elasticModulusPa: number;
  /** Explicit user capacities; no implicit jurisdiction or section classification. */
  design?: { sectionModulusM3: number; allowableStressPa: number; effectiveLengthFactor: number; bucklingSafetyFactor: number; allowableDeflectionRatio: number };
}
export interface FrameNodalLoad { node: string; fxN: number; fyN: number; mzNm: number }
export interface FrameUniformLoad { member: string; axialNPerM: number; transverseNPerM: number }
export interface FrameLoadCase { id: string; nodal: FrameNodalLoad[]; uniform: FrameUniformLoad[] }
export interface FrameCombination { id: string; factors: Record<string, number> }
export interface FrameModel2D {
  version: 1; nodes: FrameNode2D[]; members: FrameMember2D[]; loadCases: FrameLoadCase[];
  combinations?: FrameCombination[]; analysis?: "linear" | "p-delta";
  options?: { tolerance?: number; maxIterations?: number };
}
export interface FrameMemberResult {
  memberId: string; localEndForces: number[]; axialTensionN: number; maxMomentNm: number; maxShearN: number;
  maxChordDeflectionM: number;
  design?: { axialBendingUtilization: number; eulerBucklingUtilization: number; deflectionUtilization: number; satisfiesUserCriteria: boolean; basis: string };
}
export interface FrameCombinationResult {
  combinationId: string; status: "converged" | "not-converged"; iterations: number; relativeChange: number; maxFreeForceResidualN: number; maxFreeMomentResidualNm: number;
  displacements: { nodeId: string; uxM: number; uyM: number; rotationRad: number }[];
  reactions: { nodeId: string; fxN: number; fyN: number; mzNm: number }[];
  members: FrameMemberResult[];
}
export interface FrameAnalysisReport { method: string; verification: "unverified"; results: FrameCombinationResult[]; warnings: string[] }

/** Validates untrusted JSON before the algorithms access typed fields. */
export function parseFrameModel(value: unknown): FrameModel2D {
  if (!engineeringRecord(value) || value.version !== 1) throw new Error("Frame input requires version 1.");
  if (value.analysis !== undefined && value.analysis !== "linear" && value.analysis !== "p-delta") throw new Error("Only elastic linear or elastic geometric P-delta analysis is supported.");
  if (value.materialNonlinear || value.releases || value.settlements) throw new Error("Material nonlinear behavior, releases, and prescribed settlements are unsupported.");
  if (!Array.isArray(value.nodes) || !value.nodes.length || value.nodes.length > 60) throw new Error("Frame requires 1–60 nodes.");
  if (!Array.isArray(value.members) || !value.members.length || value.members.length > 120) throw new Error("Frame requires 1–120 members.");
  const nodeIds = new Set<string>(), memberIds = new Set<string>(), caseIds = new Set<string>();
  for (const node of value.nodes) {
    if (!engineeringRecord(node) || !identifier(node.id) || nodeIds.has(node.id)) throw new Error("Frame node identifiers must be unique.");
    nodeIds.add(node.id);
    requireFinite(node.xM, `${node.id}.xM`, -1e6, 1e6); requireFinite(node.yM, `${node.id}.yM`, -1e6, 1e6);
    if (!Array.isArray(node.restraints) || node.restraints.length !== 3 || node.restraints.some(v => typeof v !== "boolean")) throw new Error(`${node.id} requires [UX, UY, RZ] boolean restraints.`);
  }
  for (const member of value.members) {
    if (!engineeringRecord(member) || !identifier(member.id) || memberIds.has(member.id)) throw new Error("Member identifiers must be unique.");
    memberIds.add(member.id);
    if (typeof member.start !== "string" || typeof member.end !== "string" || !nodeIds.has(member.start) || !nodeIds.has(member.end) || member.start === member.end) throw new Error(`${member.id} has invalid end nodes.`);
    if (member.releases || member.materialNonlinear) throw new Error(`${member.id}: moment releases and material nonlinear behavior are unsupported.`);
    requireFinite(member.areaM2, `${member.id}.areaM2`, 1e-8, 1e4); requireFinite(member.inertiaM4, `${member.id}.inertiaM4`, 1e-14, 1e6);
    requireFinite(member.elasticModulusPa, `${member.id}.elasticModulusPa`, 1e3, 1e13);
    if (member.design !== undefined) {
      if (!engineeringRecord(member.design)) throw new Error(`${member.id}.design must be an object.`);
      for (const key of ["sectionModulusM3", "allowableStressPa", "effectiveLengthFactor", "bucklingSafetyFactor", "allowableDeflectionRatio"]) requireFinite(member.design[key], `${member.id}.design.${key}`, 1e-12, 1e13);
      if (Number(member.design.bucklingSafetyFactor) < 1) throw new Error("Buckling safety factor must be at least 1.");
    }
  }
  if (!Array.isArray(value.loadCases) || !value.loadCases.length || value.loadCases.length > 20) throw new Error("Frame requires 1–20 load cases.");
  for (const loadCase of value.loadCases) {
    if (!engineeringRecord(loadCase) || !identifier(loadCase.id) || caseIds.has(loadCase.id)) throw new Error("Load case identifiers must be unique.");
    caseIds.add(loadCase.id);
    if (!Array.isArray(loadCase.nodal) || loadCase.nodal.length > 1000 || !Array.isArray(loadCase.uniform) || loadCase.uniform.length > 1000) throw new Error("Load cases require bounded nodal and uniform arrays.");
    for (const load of loadCase.nodal) {
      if (!engineeringRecord(load) || typeof load.node !== "string" || !nodeIds.has(load.node)) throw new Error("Nodal load references a missing node.");
      for (const key of ["fxN", "fyN", "mzNm"]) requireFinite(load[key], key, -1e15, 1e15);
    }
    for (const load of loadCase.uniform) {
      if (!engineeringRecord(load) || typeof load.member !== "string" || !memberIds.has(load.member)) throw new Error("Uniform load references a missing member.");
      requireFinite(load.axialNPerM, "axialNPerM", -1e15, 1e15); requireFinite(load.transverseNPerM, "transverseNPerM", -1e15, 1e15);
    }
  }
  if (value.combinations !== undefined) {
    if (!Array.isArray(value.combinations) || !value.combinations.length || value.combinations.length > 20) throw new Error("Provide 1–20 load combinations or omit combinations.");
    const combinationIds = new Set<string>();
    for (const combination of value.combinations) {
      if (!engineeringRecord(combination) || !identifier(combination.id) || combinationIds.has(combination.id) || !engineeringRecord(combination.factors) || !Object.keys(combination.factors).length) throw new Error("Invalid combination identifiers or factors.");
      combinationIds.add(combination.id);
      for (const [key, factor] of Object.entries(combination.factors)) if (!caseIds.has(key) || !finiteNumber(factor) || Math.abs(factor) > 100) throw new Error("Combination references an unknown load case or invalid factor.");
    }
  }
  if (value.options !== undefined) {
    if (!engineeringRecord(value.options)) throw new Error("Invalid frame options.");
    if (value.options.tolerance !== undefined) requireFinite(value.options.tolerance, "tolerance", 1e-10, 0.01);
    if (value.options.maxIterations !== undefined) {
      const iterations = requireFinite(value.options.maxIterations, "maxIterations", 2, 40);
      if (!Number.isInteger(iterations)) throw new Error("maxIterations must be an integer.");
    }
  }
  const model = value as unknown as FrameModel2D;
  for (const member of model.members) {
    const a = model.nodes.find(n => n.id === member.start)!, b = model.nodes.find(n => n.id === member.end)!;
    if (Math.hypot(b.xM - a.xM, b.yM - a.yM) < 1e-5) throw new Error(`${member.id} is shorter than 0.00001 m.`);
  }
  return model;
}

const matrix6 = () => Array.from({ length: 6 }, () => Array<number>(6).fill(0));
const multiply = (matrix: number[][], vector: number[]) => matrix.map(row => row.reduce((sum, value, i) => sum + value * vector[i], 0));
export function frameLoadCombinations(model: FrameModel2D): FrameCombination[] { return model.combinations ?? model.loadCases.map(loadCase => ({ id: loadCase.id, factors: { [loadCase.id]: 1 } })); }
export function frameCombinationFactor(combination: FrameCombination, caseId: string): number { return Object.prototype.hasOwnProperty.call(combination.factors, caseId) ? combination.factors[caseId] : 0; }

function elementData(model: FrameModel2D, member: FrameMember2D) {
  const i = model.nodes.findIndex(n => n.id === member.start), j = model.nodes.findIndex(n => n.id === member.end);
  const dx = model.nodes[j].xM - model.nodes[i].xM, dy = model.nodes[j].yM - model.nodes[i].yM, length = Math.hypot(dx, dy), c = dx / length, s = dy / length;
  const transform = [[c, s, 0, 0, 0, 0], [-s, c, 0, 0, 0, 0], [0, 0, 1, 0, 0, 0], [0, 0, 0, c, s, 0], [0, 0, 0, -s, c, 0], [0, 0, 0, 0, 0, 1]];
  const ea = member.elasticModulusPa * member.areaM2 / length, ei = member.elasticModulusPa * member.inertiaM4;
  const a = 12 * ei / length ** 3, b = 6 * ei / length ** 2, d = 4 * ei / length, e = 2 * ei / length;
  const elastic = [[ea, 0, 0, -ea, 0, 0], [0, a, b, 0, -a, b], [0, b, d, 0, -b, e], [-ea, 0, 0, ea, 0, 0], [0, -a, -b, 0, a, -b], [0, b, e, 0, -b, d]];
  return { length, transform, elastic, dofs: [i * 3, i * 3 + 1, i * 3 + 2, j * 3, j * 3 + 1, j * 3 + 2] };
}

function tangentLocal(elastic: number[][], length: number, tension: number): number[][] {
  // Consistent initial-stress matrix, tension positive. Compression reduces stiffness.
  const result = elastic.map(row => [...row]), indices = [1, 2, 4, 5], l = length;
  const geometric = [[36, 3 * l, -36, 3 * l], [3 * l, 4 * l * l, -3 * l, -l * l], [-36, -3 * l, 36, -3 * l], [3 * l, -l * l, -3 * l, 4 * l * l]];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) result[indices[i]][indices[j]] += tension / (30 * l) * geometric[i][j];
  return result;
}

export function analyzeFrame2D(input: FrameModel2D): FrameAnalysisReport {
  const model = parseFrameModel(input), size = model.nodes.length * 3, data = model.members.map(member => elementData(model, member));
  const free = Array.from({ length: size }, (_, i) => i).filter(i => !model.nodes[Math.floor(i / 3)].restraints[i % 3]);
  const method = model.analysis === "p-delta" ? "elastic Euler–Bernoulli frame with iterated initial-stress geometric stiffness" : "linear elastic Euler–Bernoulli direct stiffness";
  const results = frameLoadCombinations(model).map((combination): FrameCombinationResult => {
    const force = Array<number>(size).fill(0), equivalent = model.members.map(() => Array<number>(6).fill(0));
    for (const loadCase of model.loadCases) {
      const factor = frameCombinationFactor(combination, loadCase.id);
      for (const load of loadCase.nodal) {
        const index = model.nodes.findIndex(node => node.id === load.node) * 3;
        force[index] += load.fxN * factor; force[index + 1] += load.fyN * factor; force[index + 2] += load.mzNm * factor;
      }
      for (const load of loadCase.uniform) {
        const index = model.members.findIndex(member => member.id === load.member), length = data[index].length;
        const axial = load.axialNPerM * factor, transverse = load.transverseNPerM * factor;
        const local = [axial * length / 2, transverse * length / 2, transverse * length ** 2 / 12, axial * length / 2, transverse * length / 2, -transverse * length ** 2 / 12];
        for (let i = 0; i < 6; i++) equivalent[index][i] += local[i];
      }
    }
    for (const [index, item] of data.entries()) for (let i = 0; i < 6; i++) for (let a = 0; a < 6; a++) force[item.dofs[i]] += item.transform[a][i] * equivalent[index][a];
    let displacement = Array<number>(size).fill(0), tension = model.members.map(() => 0), matrix: number[][] = [], localMatrices: number[][][] = [];
    let iterations = 0, relativeChange = Infinity, converged = false;
    const maxIterations = model.analysis === "p-delta" ? model.options?.maxIterations ?? 30 : 1;
    for (let iteration = 0; iteration < maxIterations; iteration++) {
      matrix = Array.from({ length: size }, () => Array<number>(size).fill(0));
      localMatrices = data.map((item, index) => tangentLocal(item.elastic, item.length, model.analysis === "p-delta" ? tension[index] : 0));
      for (const [index, item] of data.entries()) {
        const local = localMatrices[index], global = matrix6();
        for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) global[i][j] += item.transform[a][i] * local[a][b] * item.transform[b][j];
        for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) matrix[item.dofs[i]][item.dofs[j]] += global[i][j];
      }
      const reduced = solvePositiveSystem(free.map(i => free.map(j => matrix[i][j])), free.map(i => force[i]));
      const next = Array<number>(size).fill(0); free.forEach((index, i) => { next[index] = reduced[i]; });
      const nextTension = data.map((item, index) => {
        const localU = multiply(item.transform, item.dofs.map(dof => next[dof]));
        const end = multiply(item.elastic, localU).map((value, i) => value - equivalent[index][i]);
        return (end[3] - end[0]) / 2;
      });
      const change = Math.max(0, ...next.map((value, i) => Math.abs(value - displacement[i]))) / Math.max(1e-12, ...next.map(Math.abs));
      const forceChange = Math.max(0, ...nextTension.map((value, i) => Math.abs(value - tension[i]))) / Math.max(1, ...nextTension.map(Math.abs));
      relativeChange = Math.max(change, forceChange); displacement = next; tension = nextTension; iterations = iteration + 1;
      if (model.analysis !== "p-delta" || (iteration > 0 && relativeChange <= (model.options?.tolerance ?? 1e-7))) { converged = true; break; }
    }
    if (model.analysis !== "p-delta") relativeChange = 0;
    const residual = multiply(matrix, displacement).map((value, i) => value - force[i]);
    const members = model.members.map((member, index): FrameMemberResult => {
      const item = data[index], localU = multiply(item.transform, item.dofs.map(dof => displacement[dof]));
      const ends = multiply(localMatrices[index], localU).map((value, i) => value - equivalent[index][i]);
      // Cubic interpolation relative to the displaced end chord; distributed-load curvature correction.
      let maxChordDeflectionM = 0;
      const transverse = model.loadCases.reduce((sum, loadCase) => sum + frameCombinationFactor(combination, loadCase.id) * loadCase.uniform.filter(load => load.member === member.id).reduce((a, load) => a + load.transverseNPerM, 0), 0);
      let maxMomentNm = Math.max(Math.abs(ends[2]), Math.abs(ends[5]));
      const maxShearN = Math.max(Math.abs(ends[1]), Math.abs(ends[4]));
      for (let step = 0; step <= 40; step++) {
        const t = step / 40, x = t * item.length;
        const v = (1 - 3 * t ** 2 + 2 * t ** 3) * localU[1] + item.length * (t - 2 * t ** 2 + t ** 3) * localU[2] + (3 * t ** 2 - 2 * t ** 3) * localU[4] + item.length * (-(t ** 2) + t ** 3) * localU[5] + transverse * x ** 2 * (item.length - x) ** 2 / (24 * member.elasticModulusPa * member.inertiaM4);
        maxChordDeflectionM = Math.max(maxChordDeflectionM, Math.abs(v - ((1 - t) * localU[1] + t * localU[4])));
        maxMomentNm = Math.max(maxMomentNm, Math.abs(-ends[2] + ends[1] * x + transverse * x * x / 2));
      }
      const peakAxial = Math.max(Math.abs(ends[0]), Math.abs(ends[3])), compression = Math.max(0, ends[0], -ends[3]);
      const design = member.design && {
        axialBendingUtilization: (peakAxial / member.areaM2 + maxMomentNm / member.design.sectionModulusM3) / member.design.allowableStressPa,
        eulerBucklingUtilization: compression / (Math.PI ** 2 * member.elasticModulusPa * member.inertiaM4 / (member.design.effectiveLengthFactor * item.length) ** 2 / member.design.bucklingSafetyFactor),
        deflectionUtilization: maxChordDeflectionM / (item.length * member.design.allowableDeflectionRatio),
        satisfiesUserCriteria: false,
        basis: "User allowable stress, user effective length, Euler elastic buckling, sampled chord deflection; no code classification or lateral-torsional buckling check.",
      };
      if (design) design.satisfiesUserCriteria = converged && Math.max(design.axialBendingUtilization, design.eulerBucklingUtilization, design.deflectionUtilization) <= 1;
      return { memberId: member.id, localEndForces: ends, axialTensionN: tension[index], maxMomentNm, maxShearN, maxChordDeflectionM, design };
    });
    return { combinationId: combination.id, status: converged ? "converged" : "not-converged", iterations, relativeChange: model.analysis === "linear" ? 0 : relativeChange, maxFreeForceResidualN: Math.max(0, ...free.filter(i => i % 3 !== 2).map(i => Math.abs(residual[i]))), maxFreeMomentResidualNm: Math.max(0, ...free.filter(i => i % 3 === 2).map(i => Math.abs(residual[i]))), displacements: model.nodes.map((node, i) => ({ nodeId: node.id, uxM: displacement[i * 3], uyM: displacement[i * 3 + 1], rotationRad: displacement[i * 3 + 2] })), reactions: model.nodes.filter(node => node.restraints.some(Boolean)).map(node => { const i = model.nodes.findIndex(n => n.id === node.id) * 3; return { nodeId: node.id, fxN: node.restraints[0] ? residual[i] : 0, fyN: node.restraints[1] ? residual[i + 1] : 0, mzNm: node.restraints[2] ? residual[i + 2] : 0 }; }), members };
  });
  return { method, verification: "unverified", results, warnings: ["2D prismatic elastic members, rigid connections, zero restrained displacement, static nodal and local uniform loads only.", "Geometric stiffness is a small-displacement initial-stress approximation, not large-rotation or material nonlinear analysis.", "Section deflection and moment envelopes are sampled at 41 stations. Mesh refinement and independent solver comparison are required.", "User criteria checks do not implement a national design code, connection design, torsion, shear failure, or reinforced-concrete detailing."] };
}

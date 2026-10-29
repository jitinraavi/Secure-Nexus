import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defaultDesign } from '../client/src/types.ts';
import { createCadObject } from '../client/src/lib/cadModel.ts';
import { buildIfcStep, ifcSourceGuid } from '../client/src/lib/bim.ts';

// Expected dimensions use hand-authored metre fixtures, independently of the exporter.
const directory = path.resolve('artifacts/ifc-interop');
await mkdir(directory, { recursive: true });
const box = { ...createCadObject('column'), id: 'reference-box', label: 'Reference rotated column', x: 12, z: 7, w: .6, d: .5, h: 4.2, elevationM: 1.25, rotationDeg: 90, material: 'C30' };
const round = { ...createCadObject('circular-column'), id: 'reference-round', x: -4, z: 5, w: .6, d: .6, h: 4, elevationM: 0 };
const wall = { ...createCadObject('wall'), id: 'reference-wall', x: 0, z: 0, w: 4, d: .2, h: 3,
  openings: [{ id: 'reference-window', kind: 'window', offsetM: -.75, widthM: 1, heightM: 1, sillM: 1 }, { id: 'reference-void', kind: 'void', offsetM: .75, widthM: 1, heightM: 2, sillM: 0 }] };
const rotatedWall = { ...wall, id: 'reference-rotated-wall', x: -10, z: -8, rotationDeg: 37,
  family: { family: 'groundwork-cad', type: 'wall', levelId: 'reference-level', instanceParameters: { baseOffset: .4 } },
  openings: wall.openings.map(opening => ({ ...opening, id: 'rotated-' + opening.id })) };
const boundary = [{ x: -2, z: -1.5 }, { x: 2, z: -1.5 }, { x: 2, z: -.5 }, { x: 0, z: -.5 }, { x: 0, z: 1.5 }, { x: -2, z: 1.5 }];
const slab = { ...createCadObject('slab'), id: 'reference-polygon', x: 8, z: -6, w: 4, d: 3, h: .2, rotationDeg: 30, points: boundary,
  family: { family: 'groundwork-cad', type: 'slab', levelId: 'reference-level', instanceParameters: { baseOffset: .25 } } };
const design = { ...defaultDesign(), drafts: [box, round, wall, rotatedWall, slab], cad: { version: 1, revision: 1, levels: [{ id: 'reference-level', name: 'Reference upper level', elevation: 3.2, floorHeight: 3 }] } };
const theta = Math.PI / 6;
const xy = boundary.map(point => [8 + point.x * Math.cos(theta) + point.z * Math.sin(theta), -6 - point.x * Math.sin(theta) + point.z * Math.cos(theta)]);
const wallTheta = 37 * Math.PI / 180;
const wallXY = [-2, 2].flatMap(x => [-.1, .1].map(z => [-10 + x * Math.cos(wallTheta) + z * Math.sin(wallTheta), -8 - x * Math.sin(wallTheta) + z * Math.cos(wallTheta)]));
const canonical = {
  name: 'canonical-cad', schema: 'IFC4', units: 'metres',
  products: [
    { id: box.id, guid: ifcSourceGuid(box.id), type: 'IfcColumn', bounds: [[11.75, 12.25], [6.7, 7.3], [1.25, 5.45]], volume: .6 * .5 * 4.2, volumeTolerance: 1e-6, material: 'C30' },
    { id: round.id, guid: ifcSourceGuid(round.id), type: 'IfcColumn', bounds: [[-4.3, -3.7], [4.7, 5.3], [0, 4]], boundsTolerance: .001, radius: .3, volume: Math.PI * .3 ** 2 * 4, volumeTolerance: .005 },
    { id: wall.id, guid: ifcSourceGuid(wall.id), type: 'IfcWall', bounds: [[-2, 2], [-.1, .1], [0, 3]], volume: 4 * .2 * 3 - 1 * 1 * .2 - 1 * 2 * .2, volumeTolerance: 1e-6, voids: 2, fills: 1 },
    { id: rotatedWall.id, guid: ifcSourceGuid(rotatedWall.id), type: 'IfcWall', bounds: [[Math.min(...wallXY.map(p => p[0])), Math.max(...wallXY.map(p => p[0]))], [Math.min(...wallXY.map(p => p[1])), Math.max(...wallXY.map(p => p[1]))], [3.6, 6.6]], volume: 1.8, volumeTolerance: 1e-6, voids: 2, fills: 1, storey: 'Reference upper level' },
    { id: slab.id, guid: ifcSourceGuid(slab.id), type: 'IfcSlab', bounds: [[Math.min(...xy.map(p => p[0])), Math.max(...xy.map(p => p[0]))], [Math.min(...xy.map(p => p[1])), Math.max(...xy.map(p => p[1]))], [3.45, 3.65]], volume: 8 * .2, volumeTolerance: 1e-6, storey: 'Reference upper level' },
    { id: 'room-wall-east', guid: ifcSourceGuid('room-wall-east'), type: 'IfcWall', bounds: [[5.925, 6.075], [0, 4], [0, 2.7]], volume: .15 * 4 * 2.7, volumeTolerance: 1e-6 },
    { id: 'room', guid: ifcSourceGuid('room'), type: 'IfcSpace', bounds: [[0, 6], [0, 4], [0, 2.7]], volume: 6 * 4 * 2.7, volumeTolerance: 1e-6, aggregateStorey: 'Coordination level' },
  ],
};
await writeFile(path.join(directory, `${canonical.name}.ifc`), buildIfcStep(design));
await writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ version: 1, fixtures: [canonical] }, null, 2));
console.log('Generated synthetic metre/rotation/opening/level/polygon IFC acceptance fixtures.');

import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { cadObjectGeometry, cadMepGeometry, localCadAxis, rayAxisParameter, disposeCadObject } from "../src/lib/cadViewportGeometry";
import { createCadObject } from "../src/lib/cadModel";

test("camera-ray axis displacement is model-space exact across projections and view angles", () => {
  for (const orthographic of [false, true]) for (const position of [[9,8,12],[-10,4,7],[4,12,-9]]) for (const rotation of [0,37,90]) for (const axis of ["x","y","z"] as const) {
    const camera=orthographic?new THREE.OrthographicCamera(-8,8,6,-6,.01,1000):new THREE.PerspectiveCamera(45,1.3,.01,1000);
    camera.position.set(...position as [number,number,number]);camera.lookAt(0,1,0);camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
    const origin=new THREE.Vector3(.2,1,-.4),direction=localCadAxis(axis,rotation),first=origin.clone().addScaledVector(direction,.35),second=origin.clone().addScaledVector(direction,1.85);
    const raycaster=new THREE.Raycaster();
    const at=(point:THREE.Vector3)=>{const ndc=point.clone().project(camera);raycaster.setFromCamera(new THREE.Vector2(ndc.x,ndc.y),camera);return rayAxisParameter(raycaster.ray,origin,direction);};
    const a=at(first),b=at(second);if(a===null||b===null)continue;
    assert.ok(Math.abs((b-a)-1.5)<1e-8,`${orthographic}/${position}/${rotation}/${axis}`);
  }
});
test("near-parallel camera rays request numeric entry rather than unstable scaling",()=>{
  assert.equal(rayAxisParameter(new THREE.Ray(new THREE.Vector3(0,0,10),new THREE.Vector3(0,0,-1)),new THREE.Vector3(),new THREE.Vector3(0,0,1)),null);
});
test("wall openings are absent from the selectable and exported mesh solid",()=>{
  const draft={...createCadObject("wall"),w:5,d:.2,h:3,openings:[{id:"door",kind:"door" as const,offsetM:0,widthM:1,heightM:2.1,sillM:0}]};
  const root=cadObjectGeometry(draft);root.updateMatrixWorld(true);
  const raycaster=new THREE.Raycaster(new THREE.Vector3(draft.x,1,draft.z+5),new THREE.Vector3(0,0,-1));
  assert.equal(raycaster.intersectObject(root,true).filter(hit=>hit.object instanceof THREE.Mesh).length,0);
  raycaster.ray.origin.x=draft.x+1.5;
  assert.ok(raycaster.intersectObject(root,true).some(hit=>hit.object instanceof THREE.Mesh));
  disposeCadObject(root);
});
test("round columns preserve exact height and diameter in world-space export geometry",()=>{
  const draft={...createCadObject("circular-column"),w:.5,d:.5,h:4,x:2,z:-3,elevationM:1.2};
  const root=cadObjectGeometry(draft);root.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(root),size=box.getSize(new THREE.Vector3());
  assert.ok(Math.abs(size.x-.5)<1e-7);assert.ok(Math.abs(size.z-.5)<1e-7);assert.ok(Math.abs(size.y-4)<1e-7);assert.ok(Math.abs(box.min.y-1.2)<1e-7);disposeCadObject(root);
});
test("conduits remain circular containment while trays retain rectangular sections",()=>{
  const common={id:"route",kind:"cable-tray" as const,name:"Containment",route:[{x:0,y:1,z:0},{x:2,y:1,z:0}],width:.3,height:.08,diameter:.04,color:"#dddddd",visible:true};
  const conduit=cadMepGeometry({...common,family:{type:"conduit"}}),tray=cadMepGeometry({...common,family:{type:"tray"}});
  assert.equal((conduit.children[0] as THREE.Mesh).geometry.type,"CylinderGeometry");
  assert.equal((tray.children[0] as THREE.Mesh).geometry.type,"BoxGeometry");
  disposeCadObject(conduit);disposeCadObject(tray);
});
test("authored device mounting rotation changes its mesh orientation without moving its port position",()=>{
  const device={id:"device",kind:"equipment" as const,name:"Panel",route:[{x:3,y:1.5,z:-2}],width:.4,height:.8,diameter:.1,color:"#dddddd",visible:true};
  const root=cadMepGeometry(device,37),mesh=root.children[0] as THREE.Mesh;
  assert.ok(Math.abs(mesh.rotation.y-37*Math.PI/180)<1e-10);
  assert.deepEqual(mesh.position.toArray(),[3,1.5,-2]);disposeCadObject(root);
});

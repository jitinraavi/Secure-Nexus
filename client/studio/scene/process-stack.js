import * as THREE from 'three';

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const mix = (a, b, amount) => a + (b - a) * amount;
const smooth = (value) => value * value * (3 - 2 * value);

/** Five architectural studies assembled into a single small building. */
export function createProcessStack({ canvas, reducedMotion = false }) {
  if (!canvas) throw new Error('A canvas is required for the process scene.');
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-5.6, 5.6, 5.6, -5.6, 0.1, 80);
  camera.position.set(9, 8, 11);
  camera.lookAt(0, 2.3, 0);
  scene.add(new THREE.HemisphereLight('#fff9ee', '#a3927b', 2.5));
  const keyLight = new THREE.DirectionalLight('#fff5df', 3.2);
  keyLight.position.set(-5, 9, 7);
  scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight('#e8c6a4', 1.1);
  rimLight.position.set(7, 4, -6);
  scene.add(rimLight);

  const structure = new THREE.Group();
  scene.add(structure);
  const baseColor = new THREE.Color('#e6dfd1');
  const selectedColor = new THREE.Color('#d8c4a9');
  const copperColor = new THREE.Color('#ac7655');
  const edgeColor = new THREE.Color('#9d8c75');
  const stages = [];
  const textures = [];
  const hotspots = Array.from({ length: 5 }, () => ({ x: 0.5, y: 0.5, visible: true }));

  const definitions = [
    { center: [0, 0.18, 0], width: 5.8, height: 0.36, depth: 4.4 },
    { center: [-0.22, 1.14, 0.02], width: 4.9, height: 1.56, depth: 3.65 },
    { center: [0.18, 2.29, -0.02], width: 4.85, height: 0.74, depth: 3.42 },
    { center: [-0.62, 3.34, -0.22], width: 2.7, height: 1.36, depth: 2.72 },
    { center: [-0.24, 4.18, -0.1], width: 4.1, height: 0.32, depth: 3.65 },
  ];

  function box(stage, width, height, depth, x = 0, y = 0, z = 0, accent = false) {
    const geometry = new THREE.BoxGeometry(width, height, depth);
    const material = new THREE.MeshStandardMaterial({
      color: accent ? '#b47e5c' : baseColor,
      roughness: 0.9,
      metalness: accent ? 0.25 : 0.02,
      transparent: true,
      opacity: 1,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    stage.group.add(mesh);
    stage.solids.push({ mesh, accent });
    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry, 30),
      new THREE.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: 0.4, depthWrite: false }),
    );
    outline.position.copy(mesh.position);
    stage.group.add(outline);
    stage.edges.push(outline);
    return mesh;
  }

  definitions.forEach((definition, index) => {
    const group = new THREE.Group();
    group.position.fromArray(definition.center);
    structure.add(group);
    const stage = { group, solids: [], edges: [], definition, index };
    const { width, height, depth } = definition;
    if (index === 1) {
      // An open colonnade brings light through the maquette.
      box(stage, width, 0.22, depth, 0, height / 2 - 0.11);
      for (const x of [-width / 2 + 0.18, width / 2 - 0.18]) {
        for (const z of [-depth / 2 + 0.18, depth / 2 - 0.18]) box(stage, 0.24, height - 0.22, 0.24, x, -0.11, z);
      }
      box(stage, width * 0.51, height - 0.22, 0.16, -width * 0.23, -0.11, -depth / 2 + 0.08);
    } else if (index === 3) {
      // A deep opening in the front face gives the upper volume a human scale.
      box(stage, width, height, depth - 0.36, 0, 0, -0.18);
      box(stage, 0.38, height, 0.36, -width / 2 + 0.19, 0, depth / 2 - 0.18);
      box(stage, 0.38, height, 0.36, width / 2 - 0.19, 0, depth / 2 - 0.18);
      box(stage, width - 0.76, 0.2, 0.36, 0, height / 2 - 0.1, depth / 2 - 0.18);
      box(stage, width - 0.76, 0.2, 0.36, 0, -height / 2 + 0.1, depth / 2 - 0.18);
      box(stage, width - 0.8, 0.026, 0.05, 0, -height / 2 + 0.22, depth / 2 - 0.14, true);
    } else {
      box(stage, width, height, depth);
      if (index === 2) {
        // Fine vertical copper ribs sit proud of the long, low middle volume.
        for (let rib = 0; rib < 15; rib += 1) {
          box(stage, 0.022, height * 0.68, 0.026, -width / 2 + 0.25 + rib * (width - 0.5) / 14, 0, depth / 2 + 0.015, true);
        }
      }
      if (index === 4) box(stage, width * 0.84, 0.025, depth * 0.82, 0, height / 2 + 0.013, 0, true);
    }
    stages.push(stage);
  });

  // A procedural ambient shadow anchors the transparent scene without a floor.
  const shadowResolution = 64;
  const shadowData = new Uint8Array(shadowResolution * shadowResolution * 4);
  for (let y = 0; y < shadowResolution; y += 1) {
    for (let x = 0; x < shadowResolution; x += 1) {
      const distance = Math.hypot((x - 31.5) / 31.5, (y - 31.5) / 31.5);
      const alpha = Math.pow(Math.max(0, 1 - distance), 2) * 60;
      const offset = (y * shadowResolution + x) * 4;
      shadowData[offset] = 79;
      shadowData[offset + 1] = 65;
      shadowData[offset + 2] = 50;
      shadowData[offset + 3] = alpha;
    }
  }
  const shadowTexture = new THREE.DataTexture(shadowData, shadowResolution, shadowResolution, THREE.RGBAFormat);
  shadowTexture.needsUpdate = true;
  textures.push(shadowTexture);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(10.8, 8.2),
    new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -0.07;
  scene.add(shadow);

  const datumVertices = [];
  for (let x = -3.7; x <= 3.8; x += 0.75) datumVertices.push(x, -0.06, -3, x, -0.06, 3);
  for (let z = -3; z <= 3.1; z += 0.75) datumVertices.push(-3.7, -0.06, z, 3.8, -0.06, z);
  const datumGeometry = new THREE.BufferGeometry();
  datumGeometry.setAttribute('position', new THREE.Float32BufferAttribute(datumVertices, 3));
  const datum = new THREE.LineSegments(datumGeometry, new THREE.LineBasicMaterial({ color: '#b4a38c', transparent: true, opacity: 0.14, depthWrite: false }));
  scene.add(datum);

  let width = 0;
  let height = 0;
  let ratio = 1;
  let lost = false;
  let disposed = false;
  const projected = new THREE.Vector3();
  const hotspotLocal = new THREE.Vector3();

  function resize() {
    if (disposed) return;
    const nextWidth = Math.max(1, Math.round(canvas.clientWidth || canvas.getBoundingClientRect().width || 1));
    const nextHeight = Math.max(1, Math.round(canvas.clientHeight || canvas.getBoundingClientRect().height || 1));
    const nextRatio = Math.min(window.devicePixelRatio || 1, window.innerWidth < 768 ? 1.25 : 1.75);
    if (width === nextWidth && height === nextHeight && ratio === nextRatio) return;
    width = nextWidth;
    height = nextHeight;
    ratio = nextRatio;
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
    const halfHeight = width < 520 ? 4.7 : 4.8;
    const aspect = width / height;
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
  }

  function render({ time = 0, progress = 0, activeStage = 0 } = {}) {
    if (disposed || lost) return;
    resize();
    const selected = Math.round(clamp(activeStage, 0, 4));
    const construction = reducedMotion ? Math.max(Math.floor(clamp(progress) * 4) / 4, selected / 4) : Math.max(clamp(progress), selected / 4);
    structure.rotation.y = reducedMotion ? -0.1 : -0.1 + Math.sin(time * 0.18) * 0.035;

    stages.forEach((stage, index) => {
      const reveal = smooth(clamp(construction * 4 - index + 1));
      const isSelected = index === selected;
      stage.group.position.y = stage.definition.center[1] + (1 - reveal) * (0.7 + index * 0.17);
      stage.group.position.x = stage.definition.center[0] + (1 - reveal) * (index % 2 === 0 ? 0.12 : -0.12);
      stage.solids.forEach(({ mesh, accent }) => {
        mesh.visible = reveal > 0.015;
        mesh.material.opacity = reveal;
        mesh.material.depthWrite = reveal > 0.96;
        if (!accent) mesh.material.color.copy(baseColor).lerp(selectedColor, isSelected ? 0.55 : 0);
      });
      stage.edges.forEach((edge) => {
        edge.material.color.copy(isSelected ? copperColor : edgeColor);
        edge.material.opacity = isSelected ? 0.8 : mix(0.2, 0.34, reveal);
      });
    });

    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    stages.forEach((stage, index) => {
      // Place controls at the front-right edge, clear of the solid volume.
      hotspotLocal.set(stage.definition.width / 2 + 0.2, 0, stage.definition.depth / 2 + 0.07);
      projected.copy(hotspotLocal);
      stage.group.localToWorld(projected);
      projected.project(camera);
      hotspots[index].x = (projected.x + 1) / 2;
      hotspots[index].y = (1 - projected.y) / 2;
      hotspots[index].visible = projected.z > -1 && projected.z < 1 && Math.abs(projected.x) < 1.07 && Math.abs(projected.y) < 1.07;
    });
    renderer.render(scene, camera);
  }

  const onLost = (event) => { event.preventDefault(); lost = true; };
  const onRestored = () => { lost = false; width = 0; };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);
  resize();

  function dispose() {
    if (disposed) return;
    disposed = true;
    canvas.removeEventListener('webglcontextlost', onLost);
    canvas.removeEventListener('webglcontextrestored', onRestored);
    const geometries = new Set();
    const materials = new Set();
    scene.traverse((object) => {
      if (object.geometry) geometries.add(object.geometry);
      if (object.material) (Array.isArray(object.material) ? object.material : [object.material]).forEach((material) => materials.add(material));
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    textures.forEach((texture) => texture.dispose());
    renderer.dispose();
  }

  return { render, resize, dispose, getHotspots: () => hotspots };
}

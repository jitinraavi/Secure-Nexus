import * as THREE from 'three';

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const mix = (a, b, amount) => a + (b - a) * amount;
const smooth = (value) => value * value * (3 - 2 * value);

function randomSource(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let result = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    result ^= result + Math.imul(result ^ (result >>> 7), 61 | result);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function segment(points, ax, ay, az, bx, by, bz) {
  points.push(ax, ay, az, bx, by, bz);
}

function outlineBox(points, x, y, z, width, height, depth) {
  const left = x - width / 2;
  const right = x + width / 2;
  const back = z - depth / 2;
  const front = z + depth / 2;
  for (const level of [y, y + height]) {
    segment(points, left, level, back, right, level, back);
    segment(points, right, level, back, right, level, front);
    segment(points, right, level, front, left, level, front);
    segment(points, left, level, front, left, level, back);
  }
  for (const [cornerX, cornerZ] of [[left, back], [right, back], [right, front], [left, front]]) {
    segment(points, cornerX, y, cornerZ, cornerX, y + height, cornerZ);
  }
}

/** A deterministic architectural point survey. The owner controls the render loop. */
export function createHeroCity({ canvas, reducedMotion = false, framing = 'hero' }) {
  if (!canvas) throw new Error('A canvas is required for the city scene.');

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: false,
    powerPreference: 'low-power',
  });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 180);
  const city = new THREE.Group();
  scene.add(city);

  const mobile = window.innerWidth < 768;
  const random = randomSource(538731);
  const positions = [];
  const colors = [];
  const sizes = [];
  const opacities = [];
  const edges = [];
  const details = [];
  const groundLines = [];
  const copperLines = [];
  const spacing = mobile ? 0.225 : 0.155;
  const pointLimit = mobile ? 29000 : 72000;
  const dark = new THREE.Color('#5c5147');
  const mid = new THREE.Color('#897667');
  const warm = new THREE.Color('#a88c76');
  const copper = new THREE.Color('#b27453');

  function point(x, y, z, shade, opacity, size = 1) {
    if (sizes.length >= pointLimit) return;
    positions.push(x, y, z);
    colors.push(shade.r, shade.g, shade.b);
    sizes.push(size);
    opacities.push(opacity);
  }

  function surface(x, y, z, width, height, depth) {
    const left = x - width / 2;
    const back = z - depth / 2;
    const countX = Math.max(2, Math.ceil(width / spacing));
    const countZ = Math.max(2, Math.ceil(depth / spacing));
    const countY = Math.max(2, Math.ceil(height / spacing));

    // The slight sampling irregularity reads as a captured survey, not a voxel model.
    for (let row = 0; row <= countY; row += 1) {
      const pointY = y + (row / countY) * height;
      for (let column = 0; column <= countX; column += 1) {
        const pointX = left + (column / countX) * width;
        if (random() > 0.1) point(pointX, pointY, back + depth, dark, 0.55 + random() * 0.22, 0.8 + random() * 0.65);
        if (random() > 0.25) point(pointX, pointY, back, warm, 0.25 + random() * 0.2, 0.75 + random() * 0.45);
      }
      for (let column = 1; column < countZ; column += 1) {
        const pointZ = back + (column / countZ) * depth;
        if (random() > 0.12) point(left + width, pointY, pointZ, mid, 0.43 + random() * 0.2, 0.8 + random() * 0.65);
        if (random() > 0.25) point(left, pointY, pointZ, warm, 0.25 + random() * 0.2, 0.75 + random() * 0.45);
      }
    }
    for (let row = 0; row <= countZ; row += 1) {
      for (let column = 0; column <= countX; column += 1) {
        if (random() < 0.16) continue;
        point(left + (column / countX) * width, y + height, back + (row / countZ) * depth, mid, 0.36 + random() * 0.24, 0.8 + random() * 0.5);
      }
    }
    outlineBox(edges, x, y, z, width, height, depth);
    if (height > 2.2) {
      // Floor datums are sparse so the point cloud remains the main structure.
      for (let level = y + 0.7; level < y + height - 0.2; level += 0.86) {
        segment(details, left, level, back + depth, left + width, level, back + depth);
        segment(details, left + width, level, back, left + width, level, back + depth);
      }
    }
  }

  for (let row = 0; row < 7; row += 1) {
    for (let column = 0; column < 9; column += 1) {
      // A central avenue and two small voids make the city legible at a glance.
      if ((column === 4 && row > 0 && row < 6) || (column === 2 && row === 4) || (column === 6 && row === 2)) continue;
      const x = (column - 4) * 2.05 + (column > 4 ? 0.4 : 0);
      const z = (row - 3) * 2.05;
      const width = 1.18 + random() * 0.55;
      const depth = 1.18 + random() * 0.58;
      const centrality = Math.max(0, 1 - Math.hypot((column - 4.4) / 5.5, (row - 2.4) / 4.5));
      let height = 0.55 + random() * 1.75 + Math.pow(centrality, 1.8) * (2.5 + random() * 4.4);
      if ((column === 5 && row === 2) || (column === 3 && row === 3)) height = 8.2 + random() * 1.1;
      if (row === 6) height *= 0.73;

      if (height > 4.6) {
        const podiumHeight = 0.55 + random() * 0.42;
        surface(x, 0.06, z, width, podiumHeight, depth);
        surface(x + 0.08, podiumHeight + 0.06, z - 0.06, width * 0.76, height - podiumHeight, depth * 0.78);
        if (height > 7) {
          surface(x + 0.08, height + 0.06, z - 0.06, width * 0.47, 0.5, depth * 0.48);
          segment(copperLines, x + 0.08, height + 0.56, z - 0.06, x + 0.08, height + 1.28, z - 0.06);
        }
      } else {
        surface(x, 0.06, z, width, height, depth);
      }
      // Small roof equipment supplies another architectural scale reference.
      if (random() > 0.6 && height < 4.6) surface(x - width * 0.14, height + 0.06, z, width * 0.3, 0.17, depth * 0.35);
    }
  }

  // Extend the ground survey beyond the city edges with quiet broken points.
  for (let x = -10.6; x <= 10.6; x += 0.42) {
    for (let z = -8.2; z <= 8.2; z += 0.42) {
      if (random() < 0.44) point(x, 0, z, warm, 0.16 + random() * 0.13, 0.65 + random() * 0.3);
    }
  }
  for (let x = -10.4; x <= 10.5; x += 2.05) segment(groundLines, x, -0.015, -8.1, x, -0.015, 8.1);
  for (let z = -8.2; z <= 8.3; z += 2.05) segment(groundLines, -10.4, -0.015, z, 10.5, -0.015, z);
  segment(copperLines, -11.1, 0, 8.5, 10.9, 0, 8.5);
  segment(copperLines, 10.9, 0, 8.5, 10.9, 0, -8.6);
  for (let x = -10.2; x <= 10.3; x += 2.05) segment(copperLines, x, 0, 8.38, x, 0, 8.62);
  for (const [x, z] of [[-10.6, -8.2], [10.6, -8.2], [-10.6, 8.2], [10.6, 8.2]]) {
    segment(copperLines, x - 0.32, 0, z, x + 0.32, 0, z);
    segment(copperLines, x, 0, z - 0.32, x, 0, z + 0.32);
  }

  const pointGeometry = new THREE.BufferGeometry();
  pointGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  pointGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  pointGeometry.setAttribute('pointSize', new THREE.Float32BufferAttribute(sizes, 1));
  pointGeometry.setAttribute('pointOpacity', new THREE.Float32BufferAttribute(opacities, 1));
  const pointMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    vertexColors: true,
    uniforms: {
      pixelRatio: { value: 1 },
      scanHeight: { value: -3 },
      scanColor: { value: copper },
      scanStrength: { value: reducedMotion ? 0 : 1 },
    },
    vertexShader: `
      attribute float pointSize;
      attribute float pointOpacity;
      uniform float pixelRatio;
      uniform float scanHeight;
      uniform float scanStrength;
      uniform vec3 scanColor;
      varying vec3 vColor;
      varying float vOpacity;
      void main() {
        float scan = (1.0 - smoothstep(0.0, 0.34, abs(position.y - scanHeight))) * scanStrength;
        vColor = mix(color, scanColor, scan * 0.82);
        vOpacity = min(0.92, pointOpacity + scan * 0.24);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = max(0.8, (pointSize + scan * 0.36) * pixelRatio);
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vOpacity;
      void main() {
        float distanceToCenter = length(gl_PointCoord - vec2(0.5));
        float coverage = 1.0 - smoothstep(0.2, 0.5, distanceToCenter);
        if (coverage < 0.01) discard;
        gl_FragColor = vec4(vColor, coverage * vOpacity);
        #include <colorspace_fragment>
      }
    `,
  });
  city.add(new THREE.Points(pointGeometry, pointMaterial));

  function addLines(vertices, color, opacity) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
    const lines = new THREE.LineSegments(geometry, material);
    city.add(lines);
    return lines;
  }
  addLines(groundLines, '#a99a88', 0.16);
  addLines(edges, '#7e6a59', 0.17);
  addLines(details, '#8a7460', 0.1);
  addLines(copperLines, '#af7758', 0.34);

  const scanVertices = [];
  segment(scanVertices, -10.25, 0, -8.05, 10.25, 0, -8.05);
  segment(scanVertices, 10.25, 0, -8.05, 10.25, 0, 8.05);
  segment(scanVertices, 10.25, 0, 8.05, -10.25, 0, 8.05);
  segment(scanVertices, -10.25, 0, 8.05, -10.25, 0, -8.05);
  const scanOutline = addLines(scanVertices, '#b37a55', reducedMotion ? 0 : 0.13);

  let width = 0;
  let height = 0;
  let ratio = 1;
  let lost = false;
  let disposed = false;
  const target = new THREE.Vector3();

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
    pointMaterial.uniforms.pixelRatio.value = ratio;
  }

  function render({ time = 0, progress = 0, pointerX = 0, pointerY = 0 } = {}) {
    if (disposed || lost) return;
    resize();
    const isNarrow = width < 768;
    const travel = reducedMotion ? 0 : smooth(clamp(progress));
    const aspect = width / height;
    const halfHeight = framing === 'panel'
      ? Math.max(mix(9.7, 8.6, travel), 12.8 / aspect)
      : isNarrow ? mix(12.8, 8.6, travel) : mix(10.55, 5.9, travel);
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();

    const pointerStrength = reducedMotion ? 0 : 1;
    const yaw = mix(0.72, 0.17, travel) + clamp(pointerX, -1, 1) * 0.023 * pointerStrength;
    const offset = framing === 'panel' || isNarrow ? 0.15 : mix(7.3, 0.3, travel);
    target.set(-Math.cos(yaw) * offset, mix(2.5, 1.2, travel), Math.sin(yaw) * offset + travel * 2.1);
    camera.position.set(
      target.x + Math.sin(yaw) * 34,
      target.y + mix(21.8, 5.1, travel) + clamp(pointerY, -1, 1) * 0.2 * pointerStrength,
      target.z + Math.cos(yaw) * 34,
    );
    camera.lookAt(target);
    city.rotation.y = reducedMotion ? 0 : Math.sin(time * 0.055) * 0.012;
    const scanHeight = reducedMotion ? -3 : ((time * 0.35) % 14) - 1.5;
    pointMaterial.uniforms.scanHeight.value = scanHeight;
    scanOutline.position.y = scanHeight;
    scanOutline.material.opacity = reducedMotion ? 0 : 0.1 * (1 - smooth(clamp((scanHeight - 7.5) / 3)));
    renderer.render(scene, camera);
  }

  const onLost = (event) => {
    event.preventDefault();
    lost = true;
  };
  const onRestored = () => { lost = false; width = 0; };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);
  resize();

  function dispose() {
    if (disposed) return;
    disposed = true;
    canvas.removeEventListener('webglcontextlost', onLost);
    canvas.removeEventListener('webglcontextrestored', onRestored);
    scene.traverse((object) => {
      object.geometry?.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => material?.dispose());
    });
    renderer.dispose();
  }

  return { render, resize, dispose };
}

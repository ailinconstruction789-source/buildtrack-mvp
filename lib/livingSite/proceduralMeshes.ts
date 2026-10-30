import * as THREE from 'three';
import { HousePlot, SiteCharacter, BuildingStageName, GridCellInfo, GraphicQuality } from './types';
import { DEFAULT_CELL_SIZE } from './coordinates';

/**
 * Procedural Low-Poly 3D Mesh Generator for Living Construction Site.
 * Creates stylized architectural houses, modular stages, characters, tools,
 * and construction site props.
 */

// Shared color palette & materials for high rendering efficiency
export const PALETTE = {
  // Ground & Roads
  groundGrass: 0x8cb071,
  plotLawn: 0xa4c686,
  curbStone: 0xd6d3cc,
  asphaltRoad: 0x3d444e,
  roadMarking: 0xf3f4f6,
  dirtPath: 0xd9c29e,

  // Building Materials
  concreteFoundation: 0xc4c7cc,
  concreteColumns: 0xb5b9be,
  redBrick: 0xb95e47,
  mortar: 0xe5e7eb,
  timberTruss: 0x8b5a2b,
  roofTiles: 0x64748b, // Modern Architectural Slate Gray (#64748b)
  roofTilesSlate: 0x64748b,
  paintedWall: 0xf8f9fa,
  glassWindow: 0x6ba4b8,
  woodDoor: 0x6e4720,
  scaffoldingSteel: 0x94a3b8,
  scaffoldingPlank: 0xca8a04,

  // Hardhats & Roles
  whiteHardhat: 0xf8fafc,
  yellowHardhat: 0xf59e0b,
  orangeHardhat: 0xf97316,
  greenHardhat: 0x10b981,
  blueHardhat: 0x2563eb,
  vestOrange: 0xf97316,
  vestYellow: 0xeab308,
  skinTone: 0xf6d7b0,
  jeansPants: 0x2d3748,
  boots: 0x1f2937,

  // Status & FX
  selectionGlow: 0x38bdf8,
  defectPin: 0xef4444,
  successPin: 0x22c55e,
};

// Material cache
const matCache: Record<string, THREE.Material> = {};

function getMat(key: string, create: () => THREE.Material): THREE.Material {
  if (!matCache[key]) {
    matCache[key] = create();
  }
  return matCache[key];
}

// Helper to construct a straight beam between two 3D points
function createBeamBetweenPoints(
  p1: THREE.Vector3,
  p2: THREE.Vector3,
  thickness: number,
  material: THREE.Material
): THREE.Mesh {
  const dir = new THREE.Vector3().subVectors(p2, p1);
  const length = dir.length();
  const geo = new THREE.BoxGeometry(thickness, thickness, Math.max(0.01, length));
  const mesh = new THREE.Mesh(geo, material);

  // Position at midpoint between p1 and p2
  mesh.position.addVectors(p1, p2).multiplyScalar(0.5);

  // Orient towards dir (Three.js BoxGeometry length is along Z axis)
  const norm = dir.clone().normalize();
  const defaultDir = new THREE.Vector3(0, 0, 1);
  if (Math.abs(norm.dot(defaultDir)) > 0.9999) {
    if (norm.z < 0) mesh.rotation.y = Math.PI;
  } else {
    mesh.quaternion.setFromUnitVectors(defaultDir, norm);
  }

  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Creates custom Hip / Gable roof mesh without arbitrary double-scaling.
 * Uses exact eave corner vertices and ridge endpoints for geometrically true slope.
 */
function createHipRoofMesh(
  baseW: number,
  baseD: number,
  overhang: number,
  roofH: number,
  roofBaseY: number,
  material: THREE.Material
): THREE.Mesh {
  const w = baseW + overhang * 2;
  const d = baseD + overhang * 2;
  const halfW = w / 2;
  const halfD = d / 2;
  // Half ridge length along X axis: short ridge for square houses, proportional for long rectangular houses
  const halfL = Math.max(0.3, (w - d * 0.75) / 2);

  // 4 Corner eaves vertices (Z > 0 is front, Z < 0 is back)
  const cFL = new THREE.Vector3(-halfW, roofBaseY, halfD);
  const cFR = new THREE.Vector3(halfW, roofBaseY, halfD);
  const cBR = new THREE.Vector3(halfW, roofBaseY, -halfD);
  const cBL = new THREE.Vector3(-halfW, roofBaseY, -halfD);

  // 2 Ridge endpoints at top
  const vRL = new THREE.Vector3(-halfL, roofBaseY + roofH, 0);
  const vRR = new THREE.Vector3(halfL, roofBaseY + roofH, 0);

  const vertices: number[] = [
    // Front slope (Trapezoid = 2 triangles)
    cFL.x, cFL.y, cFL.z,   cFR.x, cFR.y, cFR.z,   vRR.x, vRR.y, vRR.z,
    cFL.x, cFL.y, cFL.z,   vRR.x, vRR.y, vRR.z,   vRL.x, vRL.y, vRL.z,
    // Back slope (Trapezoid = 2 triangles)
    cBR.x, cBR.y, cBR.z,   cBL.x, cBL.y, cBL.z,   vRL.x, vRL.y, vRL.z,
    cBR.x, cBR.y, cBR.z,   vRL.x, vRL.y, vRL.z,   vRR.x, vRR.y, vRR.z,
    // Left hip triangle
    cBL.x, cBL.y, cBL.z,   cFL.x, cFL.y, cFL.z,   vRL.x, vRL.y, vRL.z,
    // Right hip triangle
    cFR.x, cFR.y, cFR.z,   cBR.x, cBR.y, cBR.z,   vRR.x, vRR.y, vRR.z,
    // Bottom ceiling (Flat quad = 2 triangles)
    cBL.x, cBL.y, cBL.z,   cBR.x, cBR.y, cBR.z,   cFR.x, cFR.y, cFR.z,
    cBL.x, cBL.y, cBL.z,   cFR.x, cFR.y, cFR.z,   cFL.x, cFL.y, cFL.z,
  ];

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Creates geometrically accurate exposed steel roof truss framework (โครงสร้างหลังคา).
 * Rafters connect from eaves up to the central ridge without reversing or warping.
 */
function createRoofFramework(
  baseW: number,
  baseD: number,
  overhang: number,
  roofH: number,
  roofBaseY: number,
  steelMat: THREE.Material
): THREE.Group {
  const g = new THREE.Group();
  g.name = 'roof_truss_framework';

  const w = baseW + overhang * 2;
  const d = baseD + overhang * 2;
  const halfW = w / 2;
  const halfD = d / 2;
  const halfL = Math.max(0.3, (w - d * 0.75) / 2);

  const cFL = new THREE.Vector3(-halfW, roofBaseY, halfD);
  const cFR = new THREE.Vector3(halfW, roofBaseY, halfD);
  const cBR = new THREE.Vector3(halfW, roofBaseY, -halfD);
  const cBL = new THREE.Vector3(-halfW, roofBaseY, -halfD);

  const vRL = new THREE.Vector3(-halfL, roofBaseY + roofH, 0);
  const vRR = new THREE.Vector3(halfL, roofBaseY + roofH, 0);

  // 1. Main Ridge Beam (อกไก่เหล็ก)
  g.add(createBeamBetweenPoints(vRL, vRR, 0.12, steelMat));

  // 2. King Posts (ดั้งเหล็กรับสัน)
  g.add(createBeamBetweenPoints(new THREE.Vector3(-halfL, roofBaseY, 0), vRL, 0.1, steelMat));
  g.add(createBeamBetweenPoints(new THREE.Vector3(halfL, roofBaseY, 0), vRR, 0.1, steelMat));

  // 3. 4 Corner Hip Rafters (ตะเเข่สัน) - connect corner eaves to ridge ends
  g.add(createBeamBetweenPoints(cFL, vRL, 0.08, steelMat));
  g.add(createBeamBetweenPoints(cBL, vRL, 0.08, steelMat));
  g.add(createBeamBetweenPoints(cFR, vRR, 0.08, steelMat));
  g.add(createBeamBetweenPoints(cBR, vRR, 0.08, steelMat));

  // 4. Intermediate Common Rafters (จันทัน) - start at eaves and rise up to ridge
  const divisions = 4;
  for (let i = -divisions; i <= divisions; i++) {
    const frac = i / divisions;
    const x = frac * halfL;

    // Front rafter (from front eaves to ridge)
    const pFrontEaves = new THREE.Vector3(x, roofBaseY, halfD);
    const pRidge = new THREE.Vector3(x, roofBaseY + roofH, 0);
    g.add(createBeamBetweenPoints(pFrontEaves, pRidge, 0.07, steelMat));

    // Back rafter (from back eaves to ridge)
    const pBackEaves = new THREE.Vector3(x, roofBaseY, -halfD);
    g.add(createBeamBetweenPoints(pBackEaves, pRidge, 0.07, steelMat));
  }

  // 5. Purlins (แปเหล็ก) - horizontal members along slopes
  const purlinMat = getMat('purlinSteel', () => new THREE.MeshLambertMaterial({ color: 0x475569 }));
  const pFrontMid1 = new THREE.Vector3(-halfW * 0.85, roofBaseY + roofH * 0.5, halfD * 0.5);
  const pFrontMid2 = new THREE.Vector3(halfW * 0.85, roofBaseY + roofH * 0.5, halfD * 0.5);
  g.add(createBeamBetweenPoints(pFrontMid1, pFrontMid2, 0.05, purlinMat));

  const pBackMid1 = new THREE.Vector3(-halfW * 0.85, roofBaseY + roofH * 0.5, -halfD * 0.5);
  const pBackMid2 = new THREE.Vector3(halfW * 0.85, roofBaseY + roofH * 0.5, -halfD * 0.5);
  g.add(createBeamBetweenPoints(pBackMid1, pBackMid2, 0.05, purlinMat));

  return g;
}

/**
 * Builds the ground lawn tiles and stone curb borders for a plot parcel.
 * If individual grid cells are provided, generates exact boundary matching the 2D layout
 * (supporting L-shaped, narrow, or stepped parcels) with exterior-only stone curbs.
 */
export function buildPlotParcelMeshes(house: HousePlot): THREE.Object3D[] {
  const meshes: THREE.Object3D[] = [];
  const lawnMat = getMat('plotLawn', () => new THREE.MeshLambertMaterial({ color: PALETTE.plotLawn }));
  const curbMat = getMat('curbStone', () => new THREE.MeshLambertMaterial({ color: PALETTE.curbStone }));

  if (house.cells && house.cells.length > 0) {
    const cellSize = DEFAULT_CELL_SIZE;
    const cellKeySet = new Set(house.cells.map(c => `${c.x},${c.y}`));

    let sumGx = 0;
    let sumGy = 0;
    for (const c of house.cells) {
      sumGx += c.x;
      sumGy += c.y;
    }
    const avgGx = sumGx / house.cells.length;
    const avgGy = sumGy / house.cells.length;

    const curbThickness = 0.16;
    const curbHeight = 0.1;

    for (const cell of house.cells) {
      const relX = (cell.x - avgGx) * cellSize;
      const relZ = (cell.y - avgGy) * cellSize;

      const lawnGeo = new THREE.BoxGeometry(cellSize - 0.04, 0.15, cellSize - 0.04);
      const lawnMesh = new THREE.Mesh(lawnGeo, lawnMat);
      lawnMesh.name = 'plot_lawn_mesh';
      lawnMesh.position.set(relX, 0.075, relZ);
      lawnMesh.receiveShadow = true;
      meshes.push(lawnMesh);

      // Curbs on exterior edges only
      const hasTop = cellKeySet.has(`${cell.x},${cell.y - 1}`);
      const hasBottom = cellKeySet.has(`${cell.x},${cell.y + 1}`);
      const hasLeft = cellKeySet.has(`${cell.x - 1},${cell.y}`);
      const hasRight = cellKeySet.has(`${cell.x + 1},${cell.y}`);

      if (!hasTop) {
        const c = new THREE.Mesh(new THREE.BoxGeometry(cellSize, curbHeight, curbThickness), curbMat);
        c.position.set(relX, 0.05, relZ - cellSize / 2 + curbThickness / 2);
        c.receiveShadow = true;
        meshes.push(c);
      }
      if (!hasBottom) {
        const c = new THREE.Mesh(new THREE.BoxGeometry(cellSize, curbHeight, curbThickness), curbMat);
        c.position.set(relX, 0.05, relZ + cellSize / 2 - curbThickness / 2);
        c.receiveShadow = true;
        meshes.push(c);
      }
      if (!hasLeft) {
        const c = new THREE.Mesh(new THREE.BoxGeometry(curbThickness, curbHeight, cellSize), curbMat);
        c.position.set(relX - cellSize / 2 + curbThickness / 2, 0.05, relZ);
        c.receiveShadow = true;
        meshes.push(c);
      }
      if (!hasRight) {
        const c = new THREE.Mesh(new THREE.BoxGeometry(curbThickness, curbHeight, cellSize), curbMat);
        c.position.set(relX + cellSize / 2 - curbThickness / 2, 0.05, relZ);
        c.receiveShadow = true;
        meshes.push(c);
      }
    }
  } else {
    // Fallback if no cell array (e.g. legacy test data)
    const w = house.width;
    const d = house.depth;
    const lawnGeo = new THREE.BoxGeometry(w, 0.15, d);
    const lawnMesh = new THREE.Mesh(lawnGeo, lawnMat);
    lawnMesh.name = 'plot_lawn_mesh';
    lawnMesh.position.y = 0.075;
    lawnMesh.receiveShadow = true;
    meshes.push(lawnMesh);

    const curbGeo = new THREE.BoxGeometry(w + 0.3, 0.1, d + 0.3);
    const curbMesh = new THREE.Mesh(curbGeo, curbMat);
    curbMesh.position.y = 0.05;
    curbMesh.receiveShadow = true;
    meshes.push(curbMesh);
  }

  return meshes;
}

/**
 * Creates neutral survey representation for house types with unspecified floor count (floor_count = null).
 * Never implies a 1-storey or 2-storey house. Displays clear land boundary pegs, outline, and stand.
 */
function createUnspecifiedHouseMesh(house: HousePlot, quality: GraphicQuality = 'medium'): THREE.Group {
  const group = new THREE.Group();
  group.name = `house_${house.id}_unspecified`;
  group.position.set(house.worldX, 0, house.worldZ);

  // 1. Plot Base & Curbs
  const parcelMeshes = buildPlotParcelMeshes(house);
  parcelMeshes.forEach(m => group.add(m));

  // 2. Building Subgroup for Placement (Offset & Rotation)
  const buildingGroup = new THREE.Group();
  buildingGroup.name = 'building_subgroup';
  buildingGroup.position.set(house.placementOffset?.x || 0, 0, house.placementOffset?.z || 0);
  buildingGroup.rotation.y = house.placementRotation ?? (house.rotation || 0);

  // Decoupled building size (from house_type, NOT plot size)
  const baseW = house.buildingWidth || house.width * 0.72;
  const baseD = house.buildingDepth || house.depth * 0.72;

  // Footprint Chalk / Foundation Outline
  const lineMat = getMat('outlinePeg', () => new THREE.MeshLambertMaterial({ color: 0xf59e0b }));
  const outlineGeo = new THREE.BoxGeometry(baseW, 0.04, baseD);
  const outline = new THREE.Mesh(outlineGeo, lineMat);
  outline.position.y = 0.16;
  buildingGroup.add(outline);

  // 4 Red-and-White Land Survey Boundary Pegs (หลักหมุดที่ดิน)
  const pegGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.45, 8);
  const pegMat = getMat('pegBody', () => new THREE.MeshLambertMaterial({ color: 0xffffff }));
  const capGeo = new THREE.CylinderGeometry(0.082, 0.082, 0.12, 8);
  const capMat = getMat('pegCap', () => new THREE.MeshLambertMaterial({ color: 0xef4444 }));

  const halfX = baseW / 2;
  const halfZ = baseD / 2;
  const corners = [
    [-halfX, -halfZ], [halfX, -halfZ],
    [-halfX, halfZ], [halfX, halfZ]
  ];

  for (const [cx, cz] of corners) {
    const pegGroup = new THREE.Group();
    pegGroup.position.set(cx, 0.15, cz);

    const body = new THREE.Mesh(pegGeo, pegMat);
    body.position.y = 0.22;
    body.castShadow = true;
    pegGroup.add(body);

    const cap = new THREE.Mesh(capGeo, capMat);
    cap.position.y = 0.38;
    pegGroup.add(cap);

    buildingGroup.add(pegGroup);
  }

  // Center Surveyor Easel / Notice Stand
  const standGroup = new THREE.Group();
  standGroup.position.set(0, 0.15, 0);

  // Tripod Legs
  const legGeo = new THREE.CylinderGeometry(0.03, 0.03, 1.4, 6);
  const legMat = getMat('tripod', () => new THREE.MeshLambertMaterial({ color: PALETTE.timberTruss }));

  const leg1 = new THREE.Mesh(legGeo, legMat);
  leg1.position.set(0, 0.65, 0.35);
  leg1.rotation.x = -0.28;
  standGroup.add(leg1);

  const leg2 = new THREE.Mesh(legGeo, legMat);
  leg2.position.set(-0.35, 0.65, -0.2);
  leg2.rotation.z = 0.25;
  leg2.rotation.x = 0.15;
  standGroup.add(leg2);

  const leg3 = new THREE.Mesh(legGeo, legMat);
  leg3.position.set(0.35, 0.65, -0.2);
  leg3.rotation.z = -0.25;
  leg3.rotation.x = 0.15;
  standGroup.add(leg3);

  // Notice Board: "ยังไม่ระบุจำนวนชั้น"
  const boardGeo = new THREE.BoxGeometry(2.0, 1.1, 0.08);
  const boardMat = getMat('noticeBoard', () => new THREE.MeshLambertMaterial({ color: 0x1e293b }));
  const board = new THREE.Mesh(boardGeo, boardMat);
  board.position.set(0, 1.25, 0);
  board.rotation.x = -0.15;
  board.castShadow = true;
  standGroup.add(board);

  // Inner Amber Accent / Warning icon badge
  const plateGeo = new THREE.BoxGeometry(1.7, 0.8, 0.02);
  const plateMat = getMat('amberPlate', () => new THREE.MeshLambertMaterial({
    color: 0xf59e0b,
    emissive: 0x78350f,
    emissiveIntensity: 0.3
  }));
  const plate = new THREE.Mesh(plateGeo, plateMat);
  plate.position.set(0, 1.25, 0.05);
  plate.rotation.x = -0.15;
  standGroup.add(plate);

  buildingGroup.add(standGroup);

  // Plot Sign Post
  const signGroup = createPlotSign(house.plotName);
  signGroup.position.set(baseW / 2 + 0.35, 0, baseD / 2 - 0.2);
  buildingGroup.add(signGroup);

  // Out-of-bounds warning indicator if placement is invalid
  if (house.isPlacementValid === false) {
    const warnGeo = new THREE.BoxGeometry(baseW + 0.6, 0.08, baseD + 0.6);
    const warnMat = getMat('placementViolation', () => new THREE.MeshLambertMaterial({
      color: 0xef4444,
      transparent: true,
      opacity: 0.65
    }));
    const warnMesh = new THREE.Mesh(warnGeo, warnMat);
    warnMesh.position.y = 0.2;
    buildingGroup.add(warnMesh);
  }

  group.add(buildingGroup);

  // Defect Alert Pin (if any)
  if (house.defectCount > 0) {
    const pinGroup = createDefectPin(house.defectCount);
    pinGroup.position.set(house.placementOffset?.x || 0, 2.2, house.placementOffset?.z || 0);
    group.add(pinGroup);
  }

  return group;
}

/**
 * Creates the entire 3D mesh representation for a house plot based on its stage and floor count.
 */
export function createHouseMesh(house: HousePlot, quality: GraphicQuality = 'medium'): THREE.Group {
  // If floor_count is unspecified (null/undefined), use neutral non-misleading surveyor model
  if (house.floorCount !== 1 && house.floorCount !== 2) {
    return createUnspecifiedHouseMesh(house, quality);
  }

  const group = new THREE.Group();
  group.name = `house_${house.id}`;
  group.position.set(house.worldX, 0, house.worldZ);

  // 1. Plot Base & Stone Curbs (Accurate Parcel Land)
  const parcelMeshes = buildPlotParcelMeshes(house);
  parcelMeshes.forEach(m => group.add(m));

  // 2. Building Subgroup for Placement (Offset & Rotation)
  const buildingGroup = new THREE.Group();
  buildingGroup.name = 'building_subgroup';
  buildingGroup.position.set(house.placementOffset?.x || 0, 0, house.placementOffset?.z || 0);
  buildingGroup.rotation.y = house.placementRotation ?? (house.rotation || 0);

  // Decoupled building size (from house_type, NOT plot size)
  const baseW = house.buildingWidth || house.width * 0.72;
  const baseD = house.buildingDepth || house.depth * 0.72;
  const isTwoStorey = house.floorCount === 2;

  const stage = house.currentStage;

  // 3. Foundation Stage (ฐานราก / ตอม่อ / พื้นคอนกรีตชั้น 1)
  const slabH = 0.35;
  const slabGeo = new THREE.BoxGeometry(baseW, slabH, baseD);
  const slabMat = getMat('foundation', () => new THREE.MeshLambertMaterial({ color: PALETTE.concreteFoundation }));
  const slabMesh = new THREE.Mesh(slabGeo, slabMat);
  slabMesh.position.y = 0.15 + slabH / 2;
  slabMesh.castShadow = true;
  slabMesh.receiveShadow = true;
  buildingGroup.add(slabMesh);

  // 3. Structure Stage - 1st Floor (เสาและคาน ชั้น 1)
  const floor1H = 2.4;
  const colSize = 0.28;
  const colGeo = new THREE.BoxGeometry(colSize, floor1H, colSize);
  const colMat = getMat('columns', () => new THREE.MeshLambertMaterial({ color: PALETTE.concreteColumns }));

  const halfX = baseW / 2 - colSize / 2;
  const halfZ = baseD / 2 - colSize / 2;
  const colPositions = [
    [-halfX, -halfZ], [halfX, -halfZ],
    [-halfX, halfZ], [halfX, halfZ],
    [0, -halfZ], [0, halfZ]
  ];

  if (stage !== 'foundation') {
    // 1st Floor Columns
    for (const [cx, cz] of colPositions) {
      const col = new THREE.Mesh(colGeo, colMat);
      col.position.set(cx, 0.15 + slabH + floor1H / 2, cz);
      col.castShadow = true;
      col.receiveShadow = true;
      buildingGroup.add(col);
    }

    // 1st Floor Perimeter Beams
    const beamLongGeo = new THREE.BoxGeometry(baseW, colSize, colSize);
    const beam1Top1 = new THREE.Mesh(beamLongGeo, colMat);
    beam1Top1.position.set(0, 0.15 + slabH + floor1H - colSize / 2, -halfZ);
    beam1Top1.castShadow = true;
    buildingGroup.add(beam1Top1);

    const beam1Top2 = new THREE.Mesh(beamLongGeo, colMat);
    beam1Top2.position.set(0, 0.15 + slabH + floor1H - colSize / 2, halfZ);
    beam1Top2.castShadow = true;
    buildingGroup.add(beam1Top2);

    const beamCrossGeo = new THREE.BoxGeometry(colSize, colSize, baseD);
    const beam1Side1 = new THREE.Mesh(beamCrossGeo, colMat);
    beam1Side1.position.set(-halfX, 0.15 + slabH + floor1H - colSize / 2, 0);
    beam1Side1.castShadow = true;
    buildingGroup.add(beam1Side1);

    const beam1Side2 = new THREE.Mesh(beamCrossGeo, colMat);
    beam1Side2.position.set(halfX, 0.15 + slabH + floor1H - colSize / 2, 0);
    beam1Side2.castShadow = true;
    buildingGroup.add(beam1Side2);

    // If 2-Storey: add real 2nd Floor Slab, 2nd Floor Columns, and 2nd Floor Beams!
    if (isTwoStorey) {
      const slab2Y = 0.15 + slabH + floor1H;
      const slab2H = 0.2;
      // Real 2nd Floor Concrete Floor Plate
      const floor2Geo = new THREE.BoxGeometry(baseW + 0.1, slab2H, baseD + 0.1);
      const floor2Mesh = new THREE.Mesh(floor2Geo, slabMat);
      floor2Mesh.name = 'second_floor_slab';
      floor2Mesh.position.set(0, slab2Y + slab2H / 2, 0);
      floor2Mesh.castShadow = true;
      floor2Mesh.receiveShadow = true;
      buildingGroup.add(floor2Mesh);

      // 2nd Floor Columns
      const floor2H = 2.4;
      const col2Geo = new THREE.BoxGeometry(colSize * 0.9, floor2H, colSize * 0.9);
      for (const [cx, cz] of colPositions) {
        const col2 = new THREE.Mesh(col2Geo, colMat);
        col2.position.set(cx, slab2Y + slab2H + floor2H / 2, cz);
        col2.castShadow = true;
        col2.receiveShadow = true;
        buildingGroup.add(col2);
      }

      // 2nd Floor Beams
      const beam2Top1 = new THREE.Mesh(beamLongGeo, colMat);
      beam2Top1.position.set(0, slab2Y + slab2H + floor2H - colSize / 2, -halfZ);
      beam2Top1.castShadow = true;
      buildingGroup.add(beam2Top1);

      const beam2Top2 = new THREE.Mesh(beamLongGeo, colMat);
      beam2Top2.position.set(0, slab2Y + slab2H + floor2H - colSize / 2, halfZ);
      beam2Top2.castShadow = true;
      buildingGroup.add(beam2Top2);

      const beam2Side1 = new THREE.Mesh(beamCrossGeo, colMat);
      beam2Side1.position.set(-halfX, slab2Y + slab2H + floor2H - colSize / 2, 0);
      beam2Side1.castShadow = true;
      buildingGroup.add(beam2Side1);

      const beam2Side2 = new THREE.Mesh(beamCrossGeo, colMat);
      beam2Side2.position.set(halfX, slab2Y + slab2H + floor2H - colSize / 2, 0);
      beam2Side2.castShadow = true;
      buildingGroup.add(beam2Side2);
    }
  }

  // 4. Masonry Stage (ผนังก่ออิฐ / ฉาบปูน)
  if (stage === 'masonry' || stage === 'roofing' || stage === 'finishing' || stage === 'completed') {
    const wall1H = 2.2;
    const isFinished = stage === 'finishing' || stage === 'completed';
    const wallMat = isFinished
      ? getMat('paintedWall', () => new THREE.MeshLambertMaterial({ color: PALETTE.paintedWall }))
      : getMat('brickWall', () => new THREE.MeshLambertMaterial({ color: PALETTE.redBrick }));

    // 1st Floor: Back wall
    const backWallGeo = new THREE.BoxGeometry(baseW - 0.5, wall1H, 0.2);
    const backWall1 = new THREE.Mesh(backWallGeo, wallMat);
    backWall1.position.set(0, 0.15 + slabH + wall1H / 2, -baseD / 2 + 0.15);
    backWall1.castShadow = true;
    buildingGroup.add(backWall1);

    // 1st Floor: Left wall
    const sideWallGeo = new THREE.BoxGeometry(0.2, wall1H, baseD - 0.5);
    const leftWall1 = new THREE.Mesh(sideWallGeo, wallMat);
    leftWall1.position.set(-baseW / 2 + 0.15, 0.15 + slabH + wall1H / 2, 0);
    leftWall1.castShadow = true;
    buildingGroup.add(leftWall1);

    // 1st Floor: Right wall
    const rightWall1 = new THREE.Mesh(sideWallGeo, wallMat);
    rightWall1.position.set(baseW / 2 - 0.15, 0.15 + slabH + wall1H / 2, 0);
    rightWall1.castShadow = true;
    buildingGroup.add(rightWall1);

    // 1st Floor: Front wall with door cutout
    const frontSecGeo = new THREE.BoxGeometry((baseW - 1.2) / 2, wall1H, 0.2);
    const frontLeft1 = new THREE.Mesh(frontSecGeo, wallMat);
    frontLeft1.position.set(-(baseW / 4), 0.15 + slabH + wall1H / 2, baseD / 2 - 0.15);
    frontLeft1.castShadow = true;
    buildingGroup.add(frontLeft1);

    const frontRight1 = new THREE.Mesh(frontSecGeo, wallMat);
    frontRight1.position.set(baseW / 4, 0.15 + slabH + wall1H / 2, baseD / 2 - 0.15);
    frontRight1.castShadow = true;
    buildingGroup.add(frontRight1);

    // If 2-Storey: build 2nd Floor Walls!
    if (isTwoStorey) {
      const slab2Y = 0.15 + slabH + floor1H + 0.2; // top of 2nd floor slab
      const wall2H = 2.2;

      const walls2Group = new THREE.Group();
      walls2Group.name = 'second_floor_walls';

      // 2nd Floor: Back wall
      const backWall2 = new THREE.Mesh(backWallGeo, wallMat);
      backWall2.position.set(0, slab2Y + wall2H / 2, -baseD / 2 + 0.15);
      backWall2.castShadow = true;
      walls2Group.add(backWall2);

      // 2nd Floor: Left wall
      const leftWall2 = new THREE.Mesh(sideWallGeo, wallMat);
      leftWall2.position.set(-baseW / 2 + 0.15, slab2Y + wall2H / 2, 0);
      leftWall2.castShadow = true;
      walls2Group.add(leftWall2);

      // 2nd Floor: Right wall
      const rightWall2 = new THREE.Mesh(sideWallGeo, wallMat);
      rightWall2.position.set(baseW / 2 - 0.15, slab2Y + wall2H / 2, 0);
      rightWall2.castShadow = true;
      walls2Group.add(rightWall2);

      // 2nd Floor: Front wall (with window voids)
      const frontLeft2 = new THREE.Mesh(frontSecGeo, wallMat);
      frontLeft2.position.set(-(baseW / 4), slab2Y + wall2H / 2, baseD / 2 - 0.15);
      frontLeft2.castShadow = true;
      walls2Group.add(frontLeft2);

      const frontRight2 = new THREE.Mesh(frontSecGeo, wallMat);
      frontRight2.position.set(baseW / 4, slab2Y + wall2H / 2, baseD / 2 - 0.15);
      frontRight2.castShadow = true;
      walls2Group.add(frontRight2);

      buildingGroup.add(walls2Group);
    }
  }

  // 5. Roofing Stage (โครงหลังคาเหล็ก และหลังคากระเบื้อง)
  // Compute true roof base level depending on 1 vs 2 storeys
  const roofBaseY = isTwoStorey
    ? 0.15 + slabH + floor1H + 0.2 + 2.4 // Above 2nd floor (~5.45m)
    : 0.15 + slabH + floor1H;             // Above 1st floor (~2.90m)

  const roofH = Math.max(1.4, Math.min(2.2, baseD * 0.32));
  const eavesOverhang = 0.45;

  if (stage === 'roofing' || stage === 'finishing' || stage === 'completed') {
    if (stage === 'roofing') {
      // Exposed Galvanized Steel Roof Truss Framework (จันทัน แป ดั้ง อกไก่)
      const steelMat = getMat('galvanizedSteel', () => new THREE.MeshLambertMaterial({
        color: PALETTE.scaffoldingSteel
      }));
      const trussFramework = createRoofFramework(baseW, baseD, eavesOverhang, roofH, roofBaseY, steelMat);
      buildingGroup.add(trussFramework);
    } else {
      // Completed Tiled Roof (Hip / Gable geometry without double scaling)
      // Honors custom roof color from house_types if defined, otherwise defaults to Slate Gray (#64748b)
      const customRoofColor = (house as any).roofColor;
      let roofColorHex = PALETTE.roofTiles;
      if (customRoofColor) {
        if (typeof customRoofColor === 'number') {
          roofColorHex = customRoofColor;
        } else if (typeof customRoofColor === 'string') {
          const parsed = parseInt(customRoofColor.replace('#', '0x'), 16);
          if (!isNaN(parsed)) roofColorHex = parsed;
        }
      }
      const matKey = customRoofColor ? `roofTiles_${customRoofColor}` : 'roofTiles_slate';
      const roofMat = getMat(matKey, () => new THREE.MeshLambertMaterial({ color: roofColorHex }));
      const tiledRoof = createHipRoofMesh(baseW, baseD, eavesOverhang, roofH, roofBaseY, roofMat);
      tiledRoof.name = 'hip_tiled_roof';
      buildingGroup.add(tiledRoof);
    }
  }

  // 6. Finishing Stage (ประตูไม้ หน้าต่างกระจก)
  if (stage === 'finishing' || stage === 'completed') {
    // 1st Floor Front Door
    const doorGeo = new THREE.BoxGeometry(0.8, 1.8, 0.08);
    const doorMat = getMat('woodDoor', () => new THREE.MeshLambertMaterial({ color: PALETTE.woodDoor }));
    const door = new THREE.Mesh(doorGeo, doorMat);
    door.position.set(0, 0.15 + slabH + 0.9, baseD / 2 - 0.1);
    buildingGroup.add(door);

    // Front Window glass
    const winGeo = new THREE.BoxGeometry(0.7, 0.9, 0.05);
    const winMat = getMat('glass', () => new THREE.MeshLambertMaterial({
      color: PALETTE.glassWindow,
      transparent: true,
      opacity: 0.85
    }));

    // 1st Floor Windows
    const win1 = new THREE.Mesh(winGeo, winMat);
    win1.position.set(-baseW / 3.2, 0.15 + slabH + 1.2, baseD / 2 - 0.1);
    buildingGroup.add(win1);

    const win2 = new THREE.Mesh(winGeo, winMat);
    win2.position.set(baseW / 3.2, 0.15 + slabH + 1.2, baseD / 2 - 0.1);
    buildingGroup.add(win2);

    // 2nd Floor Windows (if two-storey)
    if (isTwoStorey) {
      const slab2Y = 0.15 + slabH + floor1H + 0.2;
      const win2F1 = new THREE.Mesh(winGeo, winMat);
      win2F1.position.set(-baseW / 3.2, slab2Y + 1.2, baseD / 2 - 0.1);
      buildingGroup.add(win2F1);

      const win2F2 = new THREE.Mesh(winGeo, winMat);
      win2F2.position.set(baseW / 3.2, slab2Y + 1.2, baseD / 2 - 0.1);
      buildingGroup.add(win2F2);
    }
  }

  // 7. Plot Number Sign Post
  const signGroup = createPlotSign(house.plotName);
  signGroup.position.set(baseW / 2 + 0.35, 0, baseD / 2 - 0.2);
  buildingGroup.add(signGroup);

  // 8. Active Scaffolding (1-tier for 1-storey, 2-tier for 2-storey)
  if (stage === 'structure' || stage === 'masonry') {
    const scafHeight = isTwoStorey ? 5.2 : 2.6;
    const scaf = createScaffolding(baseW, scafHeight, isTwoStorey);
    scaf.position.set(0, 0.15 + slabH, -baseD / 2 - 0.35);
    buildingGroup.add(scaf);
  }

  // 9. Out-of-bounds warning indicator if placement is invalid
  if (house.isPlacementValid === false) {
    const warnGeo = new THREE.BoxGeometry(baseW + 0.6, 0.08, baseD + 0.6);
    const warnMat = getMat('placementViolation', () => new THREE.MeshLambertMaterial({
      color: 0xef4444,
      transparent: true,
      opacity: 0.65
    }));
    const warnMesh = new THREE.Mesh(warnGeo, warnMat);
    warnMesh.position.y = 0.2;
    buildingGroup.add(warnMesh);
  }

  group.add(buildingGroup);

  // 10. Defect Alert Pin (height proportional to floor count)
  if (house.defectCount > 0) {
    const pinGroup = createDefectPin(house.defectCount);
    pinGroup.position.set(house.placementOffset?.x || 0, isTwoStorey ? 6.8 : 4.4, house.placementOffset?.z || 0);
    group.add(pinGroup);
  }

  return group;
}

/**
 * Creates seamless road network mesh strictly from 2D road grid cells.
 * External kerbs only; connected adjacent road cells blend seamlessly without internal curbs.
 */
export function createRoadNetworkMesh(roadCells: GridCellInfo[], cellSize = DEFAULT_CELL_SIZE): THREE.Group {
  const group = new THREE.Group();
  group.name = 'road_network';

  const roadMat = getMat('asphaltRoad', () => new THREE.MeshLambertMaterial({ color: PALETTE.asphaltRoad }));
  const curbMat = getMat('curbStone', () => new THREE.MeshLambertMaterial({ color: PALETTE.curbStone }));
  const markMat = getMat('roadMarking', () => new THREE.MeshLambertMaterial({ color: PALETTE.roadMarking }));

  const curbThickness = 0.15;
  const curbHeight = 0.06;

  for (const rc of roadCells) {
    const rGeo = new THREE.BoxGeometry(cellSize, 0.04, cellSize);
    const rMesh = new THREE.Mesh(rGeo, roadMat);
    rMesh.position.set(rc.worldX, 0.02, rc.worldZ);
    rMesh.receiveShadow = true;
    group.add(rMesh);

    const adj = rc.adj || { top: false, bottom: false, left: false, right: false };

    // Outer boundary kerbs only
    if (!adj.top) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(cellSize, curbHeight, curbThickness), curbMat);
      c.position.set(rc.worldX, 0.05, rc.worldZ - cellSize / 2 + curbThickness / 2);
      c.receiveShadow = true;
      group.add(c);
    }
    if (!adj.bottom) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(cellSize, curbHeight, curbThickness), curbMat);
      c.position.set(rc.worldX, 0.05, rc.worldZ + cellSize / 2 - curbThickness / 2);
      c.receiveShadow = true;
      group.add(c);
    }
    if (!adj.left) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(curbThickness, curbHeight, cellSize), curbMat);
      c.position.set(rc.worldX - cellSize / 2 + curbThickness / 2, 0.05, rc.worldZ);
      c.receiveShadow = true;
      group.add(c);
    }
    if (!adj.right) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(curbThickness, curbHeight, cellSize), curbMat);
      c.position.set(rc.worldX + cellSize / 2 - curbThickness / 2, 0.05, rc.worldZ);
      c.receiveShadow = true;
      group.add(c);
    }

    // Road dashed centerline markings for straight sections
    if (adj.left && adj.right && !adj.top && !adj.bottom) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(cellSize * 0.6, 0.01, 0.12), markMat);
      m.position.set(rc.worldX, 0.045, rc.worldZ);
      group.add(m);
    } else if (adj.top && adj.bottom && !adj.left && !adj.right) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.01, cellSize * 0.6), markMat);
      m.position.set(rc.worldX, 0.045, rc.worldZ);
      group.add(m);
    }
  }

  return group;
}

/**
 * Creates green park / garden mesh strictly on park cells.
 * Stylized emerald green turf with small low-poly trees matching the 2D map.
 */
export function createParkNetworkMesh(parkCells: GridCellInfo[], cellSize = DEFAULT_CELL_SIZE): THREE.Group {
  const group = new THREE.Group();
  group.name = 'park_network';

  const parkMat = getMat('parkLawn', () => new THREE.MeshLambertMaterial({ color: 0x86efac }));

  for (const pc of parkCells) {
    const pGeo = new THREE.BoxGeometry(cellSize - 0.04, 0.03, cellSize - 0.04);
    const pMesh = new THREE.Mesh(pGeo, parkMat);
    pMesh.position.set(pc.worldX, 0.015, pc.worldZ);
    pMesh.receiveShadow = true;
    group.add(pMesh);

    // Staggered decorative pine tree
    const treeScale = ((pc.gx + pc.gy) % 2 === 0) ? 0.9 : 0.7;
    const tree = createLowPolyTree(pc.worldX, pc.worldZ, treeScale);
    group.add(tree);
  }

  return group;
}

/**
 * Creates neutral site compacted earth ground for unassigned cells within the project grid.
 */
export function createUnassignedGroundMesh(unassignedCells: GridCellInfo[], cellSize = DEFAULT_CELL_SIZE): THREE.Group {
  const group = new THREE.Group();
  group.name = 'unassigned_ground';

  const dirtMat = getMat('siteDirt', () => new THREE.MeshLambertMaterial({ color: PALETTE.dirtPath }));

  for (const uc of unassignedCells) {
    const dGeo = new THREE.BoxGeometry(cellSize, 0.02, cellSize);
    const dMesh = new THREE.Mesh(dGeo, dirtMat);
    dMesh.position.set(uc.worldX, 0.01, uc.worldZ);
    dMesh.receiveShadow = true;
    group.add(dMesh);
  }

  return group;
}

/**
 * Creates plot number sign post in front of property.
 */
function createPlotSign(plotName: string): THREE.Group {
  const g = new THREE.Group();
  const poleGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.8, 6);
  const poleMat = getMat('pole', () => new THREE.MeshLambertMaterial({ color: 0x475569 }));
  const pole = new THREE.Mesh(poleGeo, poleMat);
  pole.position.y = 0.4;
  g.add(pole);

  const boardGeo = new THREE.BoxGeometry(0.6, 0.35, 0.06);
  const boardMat = getMat('signBoard', () => new THREE.MeshLambertMaterial({ color: 0xffffff }));
  const board = new THREE.Mesh(boardGeo, boardMat);
  board.position.y = 0.8;
  g.add(board);

  return g;
}

/**
 * Creates floating alert pin for open defects.
 */
function createDefectPin(defectCount: number): THREE.Group {
  const g = new THREE.Group();
  g.name = 'defect_pin';

  const coneGeo = new THREE.ConeGeometry(0.28, 0.55, 8);
  const coneMat = getMat('defectMat', () => new THREE.MeshLambertMaterial({
    color: PALETTE.defectPin,
    emissive: 0x991b1b,
    emissiveIntensity: 0.35
  }));
  const cone = new THREE.Mesh(coneGeo, coneMat);
  cone.rotation.x = Math.PI;
  cone.position.y = 0.25;
  g.add(cone);

  const sphereGeo = new THREE.SphereGeometry(0.2, 8, 8);
  const sphere = new THREE.Mesh(sphereGeo, coneMat);
  sphere.position.y = 0.55;
  g.add(sphere);

  return g;
}

/**
 * Creates modular construction scaffolding.
 */
function createScaffolding(width: number, height: number, isTwoStorey: boolean = false): THREE.Group {
  const g = new THREE.Group();
  const poleGeo = new THREE.CylinderGeometry(0.035, 0.035, height, 6);
  const poleMat = getMat('scafPole', () => new THREE.MeshLambertMaterial({ color: PALETTE.scaffoldingSteel }));

  const p1 = new THREE.Mesh(poleGeo, poleMat);
  p1.position.set(-width / 2.5, height / 2, 0);
  p1.castShadow = true;
  g.add(p1);

  const p2 = new THREE.Mesh(poleGeo, poleMat);
  p2.position.set(width / 2.5, height / 2, 0);
  p2.castShadow = true;
  g.add(p2);

  // Planks
  const plankGeo = new THREE.BoxGeometry(width * 0.9, 0.06, 0.4);
  const plankMat = getMat('scafPlank', () => new THREE.MeshLambertMaterial({ color: PALETTE.scaffoldingPlank }));

  const plankLevels = isTwoStorey ? [0.25, 0.55, 0.85] : [0.45, 0.85];
  for (const lvl of plankLevels) {
    const plank = new THREE.Mesh(plankGeo, plankMat);
    plank.position.set(0, height * lvl, 0);
    plank.castShadow = true;
    g.add(plank);
  }

  return g;
}

/**
 * Creates Stylized Low-Poly Character Mesh with limbs for walk & work animations.
 */
export function createCharacterMesh(char: SiteCharacter): THREE.Group {
  const root = new THREE.Group();
  root.name = `char_${char.id}`;
  root.position.set(char.x, 0, char.z);
  root.rotation.y = char.rotationY || 0;

  // Base scale (approx 1.7m low-poly worker)
  const s = 0.48;
  root.scale.set(s, s, s);

  // 1. Torso (Vest & Shirt)
  const torsoGeo = new THREE.BoxGeometry(0.55, 0.7, 0.32);
  const vestColor = char.role === 'foreman' || char.role === 'engineer' ? PALETTE.vestYellow : PALETTE.vestOrange;
  const torsoMat = new THREE.MeshLambertMaterial({ color: vestColor });
  const torso = new THREE.Mesh(torsoGeo, torsoMat);
  torso.position.y = 1.25;
  torso.castShadow = true;
  root.add(torso);

  // 2. Head with Safety Hardhat
  const headGeo = new THREE.BoxGeometry(0.35, 0.38, 0.35);
  const headMat = getMat('skin', () => new THREE.MeshLambertMaterial({ color: PALETTE.skinTone }));
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.y = 1.85;
  head.castShadow = true;
  root.add(head);

  // Hardhat Color by Role
  let hardhatColor = PALETTE.yellowHardhat;
  if (char.role === 'foreman' || char.role === 'engineer') hardhatColor = PALETTE.whiteHardhat;
  else if (char.role === 'qc') hardhatColor = PALETTE.greenHardhat;
  else if (char.role === 'mep') hardhatColor = PALETTE.blueHardhat;
  else if (char.role === 'mason') hardhatColor = PALETTE.orangeHardhat;

  const helmetGeo = new THREE.CylinderGeometry(0.24, 0.28, 0.2, 8);
  const helmetMat = new THREE.MeshLambertMaterial({ color: hardhatColor });
  const helmet = new THREE.Mesh(helmetGeo, helmetMat);
  helmet.position.y = 2.05;
  helmet.castShadow = true;
  root.add(helmet);

  const brimGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.04, 8);
  const brim = new THREE.Mesh(brimGeo, helmetMat);
  brim.position.y = 1.96;
  root.add(brim);

  // 3. Left Arm (Shoulder Pivot)
  const armGeo = new THREE.BoxGeometry(0.18, 0.65, 0.18);
  const armMat = getMat('skin', () => new THREE.MeshLambertMaterial({ color: PALETTE.skinTone }));

  const leftArmPivot = new THREE.Group();
  leftArmPivot.name = 'leftArm';
  leftArmPivot.position.set(-0.38, 1.55, 0);
  const leftArm = new THREE.Mesh(armGeo, armMat);
  leftArm.position.y = -0.3;
  leftArm.castShadow = true;
  leftArmPivot.add(leftArm);
  root.add(leftArmPivot);

  // 4. Right Arm (Shoulder Pivot) + Tool Prop
  const rightArmPivot = new THREE.Group();
  rightArmPivot.name = 'rightArm';
  rightArmPivot.position.set(0.38, 1.55, 0);
  const rightArm = new THREE.Mesh(armGeo, armMat);
  rightArm.position.y = -0.3;
  rightArm.castShadow = true;
  rightArmPivot.add(rightArm);

  // Add Tool depending on Role
  if (char.role === 'qc' || char.role === 'foreman' || char.role === 'engineer') {
    // Clipboard / Tablet
    const clipGeo = new THREE.BoxGeometry(0.3, 0.4, 0.04);
    const clipMat = getMat('clipboard', () => new THREE.MeshLambertMaterial({ color: 0xffffff }));
    const clipboard = new THREE.Mesh(clipGeo, clipMat);
    clipboard.position.set(0, -0.45, 0.2);
    clipboard.rotation.x = -0.4;
    rightArmPivot.add(clipboard);
  } else if (char.role === 'mason') {
    // Trowel
    const trowelGeo = new THREE.BoxGeometry(0.15, 0.04, 0.25);
    const trowelMat = getMat('trowel', () => new THREE.MeshLambertMaterial({ color: 0x94a3b8 }));
    const trowel = new THREE.Mesh(trowelGeo, trowelMat);
    trowel.position.set(0, -0.6, 0.15);
    rightArmPivot.add(trowel);
  } else {
    // Hammer / Tool
    const handleGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.4, 6);
    const handleMat = getMat('timberTruss', () => new THREE.MeshLambertMaterial({ color: PALETTE.timberTruss }));
    const handle = new THREE.Mesh(handleGeo, handleMat);
    handle.position.set(0, -0.55, 0.15);
    rightArmPivot.add(handle);
  }
  root.add(rightArmPivot);

  // 5. Left Leg (Hip Pivot)
  const legGeo = new THREE.BoxGeometry(0.2, 0.85, 0.2);
  const legMat = getMat('pants', () => new THREE.MeshLambertMaterial({ color: PALETTE.jeansPants }));

  const leftLegPivot = new THREE.Group();
  leftLegPivot.name = 'leftLeg';
  leftLegPivot.position.set(-0.16, 0.9, 0);
  const leftLeg = new THREE.Mesh(legGeo, legMat);
  leftLeg.position.y = -0.42;
  leftLeg.castShadow = true;
  leftLegPivot.add(leftLeg);
  root.add(leftLegPivot);

  // 6. Right Leg (Hip Pivot)
  const rightLegPivot = new THREE.Group();
  rightLegPivot.name = 'rightLeg';
  rightLegPivot.position.set(0.16, 0.9, 0);
  const rightLeg = new THREE.Mesh(legGeo, legMat);
  rightLeg.position.y = -0.42;
  rightLeg.castShadow = true;
  rightLegPivot.add(rightLeg);
  root.add(rightLegPivot);

  return root;
}

/**
 * Animate character limb pivots based on their simulation activity.
 */
export function animateCharacter(mesh: THREE.Group, char: SiteCharacter, timeSec: number) {
  let limbs = mesh.userData.limbs;
  if (!limbs) {
    limbs = {
      leftArm: mesh.getObjectByName('leftArm'),
      rightArm: mesh.getObjectByName('rightArm'),
      leftLeg: mesh.getObjectByName('leftLeg'),
      rightLeg: mesh.getObjectByName('rightLeg')
    };
    mesh.userData.limbs = limbs;
  }
  const { leftArm, rightArm, leftLeg, rightLeg } = limbs;

  if (!leftArm || !rightArm || !leftLeg || !rightLeg) return;

  switch (char.simActivity) {
    case 'walking': {
      const walkFreq = 7.5;
      const swing = Math.sin(timeSec * walkFreq);
      leftLeg.rotation.x = swing * 0.6;
      rightLeg.rotation.x = -swing * 0.6;
      leftArm.rotation.x = -swing * 0.5;
      rightArm.rotation.x = swing * 0.5;
      // Slight vertical bounce
      mesh.position.y = Math.abs(Math.sin(timeSec * walkFreq * 2)) * 0.08;
      break;
    }

    case 'working_hammer': {
      mesh.position.y = 0;
      leftLeg.rotation.x = 0.15;
      rightLeg.rotation.x = -0.15;
      leftArm.rotation.x = 0.3;
      // Hammer strike motion
      const strike = Math.sin(timeSec * 6);
      rightArm.rotation.x = strike > 0 ? strike * 0.9 : strike * 0.2;
      break;
    }

    case 'working_trowel': {
      mesh.position.y = 0;
      leftLeg.rotation.x = 0;
      rightLeg.rotation.x = 0;
      leftArm.rotation.x = 0.2;
      // Smooth back and forth troweling motion
      rightArm.rotation.x = 0.5 + Math.sin(timeSec * 3) * 0.3;
      rightArm.rotation.z = Math.cos(timeSec * 3) * 0.2;
      break;
    }

    case 'working_inspect': {
      mesh.position.y = 0;
      leftLeg.rotation.x = 0;
      rightLeg.rotation.x = 0;
      // Hold clipboard up
      leftArm.rotation.x = 0.7;
      rightArm.rotation.x = 0.9 + Math.sin(timeSec * 2) * 0.1;
      break;
    }

    case 'resting': {
      // Relaxed idle
      mesh.position.y = 0;
      leftLeg.rotation.x = 0;
      rightLeg.rotation.x = 0;
      leftArm.rotation.x = Math.sin(timeSec * 1.5) * 0.08;
      rightArm.rotation.x = -Math.sin(timeSec * 1.5) * 0.08;
      break;
    }

    default: {
      mesh.position.y = 0;
      leftLeg.rotation.x = 0;
      rightLeg.rotation.x = 0;
      leftArm.rotation.x = 0;
      rightArm.rotation.x = 0;
      break;
    }
  }
}

/**
 * Creates Low-Poly Tree (Stylized Pine or Deciduous).
 */
export function createLowPolyTree(x: number, z: number, scale: number = 1.0): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.scale.set(scale, scale, scale);

  // Trunk
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.24, 1.2, 6);
  const trunkMat = getMat('trunk', () => new THREE.MeshLambertMaterial({ color: 0x5c3a21 }));
  const trunk = new THREE.Mesh(trunkGeo, trunkMat);
  trunk.position.y = 0.6;
  trunk.castShadow = true;
  g.add(trunk);

  // Foliage (stacked cones)
  const foliageMat = getMat('foliage', () => new THREE.MeshLambertMaterial({ color: 0x3e7b45 }));
  const f1 = new THREE.Mesh(new THREE.ConeGeometry(1.2, 1.4, 7), foliageMat);
  f1.position.y = 1.5;
  f1.castShadow = true;
  g.add(f1);

  const f2 = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.2, 7), foliageMat);
  f2.position.y = 2.2;
  f2.castShadow = true;
  g.add(f2);

  return g;
}

/**
 * Creates Rest Pavilion (จุดพักคนงาน).
 */
export function createRestPavilion(area: { x: number; z: number; width: number; depth: number; label: string }): THREE.Group {
  const g = new THREE.Group();
  g.name = 'facility_rest_pavilion';
  g.position.set(area.x, 0, area.z);
  (g as any).userData = {
    type: 'facility',
    id: 'demo_rest_pavilion',
    name: area.label || 'ศาลาพักคนงาน & ปฐมพยาบาล',
    source: 'demo_facility'
  };

  // Ground platform
  const platGeo = new THREE.BoxGeometry(area.width, 0.15, area.depth);
  const platMat = getMat('restPlat', () => new THREE.MeshLambertMaterial({ color: 0xe2e8f0 }));
  const plat = new THREE.Mesh(platGeo, platMat);
  plat.position.y = 0.075;
  plat.receiveShadow = true;
  g.add(plat);

  // Canopy Roof with 4 poles
  const poleMat = getMat('pole', () => new THREE.MeshLambertMaterial({ color: 0x475569 }));
  const poleGeo = new THREE.CylinderGeometry(0.08, 0.08, 2.2, 6);
  const px = area.width / 2 - 0.3;
  const pz = area.depth / 2 - 0.3;

  for (const [cx, cz] of [[-px, -pz], [px, -pz], [-px, pz], [px, pz]]) {
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(cx, 1.1, cz);
    pole.castShadow = true;
    g.add(pole);
  }

  // Fabric Canopy
  const canopyGeo = new THREE.ConeGeometry(Math.max(area.width, area.depth) * 0.7, 0.8, 4);
  const canopyMat = getMat('canopy', () => new THREE.MeshLambertMaterial({ color: 0x0284c7 }));
  const canopy = new THREE.Mesh(canopyGeo, canopyMat);
  canopy.position.set(0, 2.5, 0);
  canopy.rotation.y = Math.PI / 4;
  canopy.scale.set(area.width / 4, 1, area.depth / 4);
  canopy.castShadow = true;
  g.add(canopy);

  // Wooden Benches
  const benchGeo = new THREE.BoxGeometry(area.width * 0.6, 0.3, 0.4);
  const benchMat = getMat('bench', () => new THREE.MeshLambertMaterial({ color: 0xb45309 }));
  const bench = new THREE.Mesh(benchGeo, benchMat);
  bench.position.set(0, 0.25, 0);
  g.add(bench);

  return g;
}

/**
 * Creates Material Storage Yard (จุดรวมวัสดุ).
 */
export function createStorageYard(area: { x: number; z: number; width: number; depth: number }): THREE.Group {
  const g = new THREE.Group();
  g.name = 'facility_storage_yard';
  g.position.set(area.x, 0, area.z);
  (g as any).userData = {
    type: 'facility',
    id: 'demo_storage_yard',
    name: 'ลานรวมวัสดุ & พาเลตปูน-เหล็ก',
    source: 'demo_facility'
  };

  // Gravel floor
  const gravelGeo = new THREE.BoxGeometry(area.width, 0.1, area.depth);
  const gravelMat = getMat('gravel', () => new THREE.MeshLambertMaterial({ color: 0x94a3b8 }));
  const gravel = new THREE.Mesh(gravelGeo, gravelMat);
  gravel.position.y = 0.05;
  gravel.receiveShadow = true;
  g.add(gravel);

  // Wooden Pallets with Rebar & Brick stacks
  const palletMat = getMat('pallet', () => new THREE.MeshLambertMaterial({ color: 0xd97706 }));
  const brickMat = getMat('brick', () => new THREE.MeshLambertMaterial({ color: PALETTE.redBrick }));
  const rebarMat = getMat('rebar', () => new THREE.MeshLambertMaterial({ color: 0x1e293b }));

  // Pallet 1: Brick stacks
  const p1 = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.15, 1.2), palletMat);
  p1.position.set(-1.2, 0.15, -0.8);
  g.add(p1);
  const bricks = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.6, 1.0), brickMat);
  bricks.position.set(-1.2, 0.52, -0.8);
  bricks.castShadow = true;
  g.add(bricks);

  // Pallet 2: Steel rebar bundles
  const p2 = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.15, 0.8), palletMat);
  p2.position.set(1.0, 0.15, 0.8);
  g.add(p2);
  const rebars = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.8, 8), rebarMat);
  rebars.rotation.z = Math.PI / 2;
  rebars.position.set(1.0, 0.45, 0.8);
  rebars.castShadow = true;
  g.add(rebars);

  return g;
}


/**
 * Creates a 3D Inspection Flag / Beacon Mesh for plots with tasks waiting for inspection or rework.
 */
export function createInspectionFlagMesh(
  statusFor: 'Site Engineer' | 'QC' | 'Rework',
  isUrgent: boolean = false
): THREE.Group {
  const g = new THREE.Group();
  g.name = 'inspection_flag_marker';

  let color = 0xf59e0b; // Amber (Site Engineer)
  if (statusFor === 'QC') color = 0x10b981; // Emerald (QC)
  if (statusFor === 'Rework') color = 0xef4444; // Red (Rework)

  // 1. Thin Flag Pole
  const poleGeo = new THREE.CylinderGeometry(0.04, 0.04, 2.4, 8);
  const poleMat = getMat('flag_pole', () => new THREE.MeshBasicMaterial({ color: 0x64748b }));
  const pole = new THREE.Mesh(poleGeo, poleMat);
  pole.position.y = 1.2;
  g.add(pole);

  // 2. Triangular Flag Banner
  const flagShape = new THREE.Shape();
  flagShape.moveTo(0, 0);
  flagShape.lineTo(0.7, 0.25);
  flagShape.lineTo(0, 0.5);
  flagShape.closePath();

  const flagGeo = new THREE.ShapeGeometry(flagShape);
  const flagMat = new THREE.MeshBasicMaterial({
    color,
    side: THREE.DoubleSide
  });
  const flagMesh = new THREE.Mesh(flagGeo, flagMat);
  flagMesh.position.set(0.04, 1.8, 0);
  g.add(flagMesh);

  // 3. Top Glowing Beacon Orb
  const orbGeo = new THREE.SphereGeometry(isUrgent ? 0.16 : 0.12, 8, 8);
  const orbMat = new THREE.MeshBasicMaterial({ color });
  const orb = new THREE.Mesh(orbGeo, orbMat);
  orb.position.y = 2.45;
  g.add(orb);

  return g;
}

/**
 * Creates a Defect Alert Marker Mesh (3D Caution Diamond / Alert Beacon).
 */
export function createDefectMarkerMesh(count: number = 1, isCritical: boolean = false): THREE.Group {
  const g = new THREE.Group();
  g.name = 'defect_alert_marker';

  const color = isCritical ? 0xdc2626 : 0xf97316;

  // Diamond Octahedron
  const diamondGeo = new THREE.OctahedronGeometry(isCritical ? 0.35 : 0.28);
  const diamondMat = new THREE.MeshBasicMaterial({
    color,
    wireframe: false
  });
  const diamond = new THREE.Mesh(diamondGeo, diamondMat);
  diamond.position.y = 2.0;
  diamond.rotation.y = Math.PI / 4;
  g.add(diamond);

  // Support Stem
  const stemGeo = new THREE.CylinderGeometry(0.03, 0.03, 1.8, 8);
  const stemMat = getMat('defect_stem', () => new THREE.MeshBasicMaterial({ color: 0x475569 }));
  const stem = new THREE.Mesh(stemGeo, stemMat);
  stem.position.y = 0.9;
  g.add(stem);

  return g;
}

/**
 * Creates an Activity Pin Mesh (indicates earlier reports at this plot today).
 */
export function createActivityPinMesh(colorHex: string = '#38bdf8'): THREE.Group {
  const g = new THREE.Group();
  g.name = 'activity_pin_marker';

  const colNum = parseInt(colorHex.replace('#', '0x'), 16) || 0x38bdf8;

  // Disc footpad
  const discGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.04, 16);
  const discMat = new THREE.MeshBasicMaterial({
    color: colNum,
    transparent: true,
    opacity: 0.75
  });
  const disc = new THREE.Mesh(discGeo, discMat);
  disc.position.y = 0.05;
  g.add(disc);

  // Pin needle
  const needleGeo = new THREE.ConeGeometry(0.12, 0.45, 8);
  const needleMat = new THREE.MeshBasicMaterial({ color: colNum });
  const needle = new THREE.Mesh(needleGeo, needleMat);
  needle.rotation.x = Math.PI;
  needle.position.y = 0.32;
  g.add(needle);

  return g;
}

/**
 * Creates a 2D Billboard Canvas Sprite for Plot Summary Badges (Far Zoom LOD).
 */
export function createPlotSummaryBadgeSprite(
  plotName: string,
  badgeText: string,
  badgeType: 'defect' | 'inspection' | 'normal' = 'normal'
): THREE.Sprite {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    if (ctx) {
      // Rounded Card Background
      ctx.fillStyle = badgeType === 'defect'
        ? '#ef4444'
        : badgeType === 'inspection'
        ? '#f59e0b'
        : '#1e293b';
      ctx.beginPath();
      if (typeof (ctx as any).roundRect === 'function') {
        (ctx as any).roundRect(8, 8, 240, 112, 20);
      } else {
        ctx.rect(8, 8, 240, 112);
      }
      ctx.fill();

      // Border
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 4;
      ctx.stroke();

      // Plot Name Text
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 36px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(plotName, 128, 44);

      // Subtitle / Badge text
      ctx.font = '24px sans-serif';
      ctx.fillStyle = badgeType === 'normal' ? '#94a3b8' : '#ffffff';
      ctx.fillText(badgeText, 128, 86);

      const texture = new THREE.CanvasTexture(canvas);
      texture.minFilter = THREE.LinearFilter;
      const mat = new THREE.SpriteMaterial({ map: texture, depthTest: false });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.set(4.0, 2.0, 1);
      sprite.position.y = 3.6;
      sprite.name = 'lod_badge_' + plotName;
      return sprite;
    }
  } catch {
    // Fallback if canvas is unavailable
  }

  // Fallback Sprite
  const fallbackMat = new THREE.SpriteMaterial({ color: 0x38bdf8 });
  const fallbackSprite = new THREE.Sprite(fallbackMat);
  fallbackSprite.scale.set(3, 1.5, 1);
  fallbackSprite.position.y = 3.6;
  return fallbackSprite;
}

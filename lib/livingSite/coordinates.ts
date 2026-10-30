/**
 * Living Construction Site - Coordinate System & Spatial Transformation
 * 
 * Provides unified, mathematically consistent coordinate transformation between
 * 2D Grid coordinates (MapVisualizer) and 3D World coordinates (LivingSiteSimulation).
 * 
 * Coordinate Specification:
 * - 2D Grid:
 *   - Origin (0,0) at top-left cell.
 *   - gx in [0, gridCols - 1] (left to right)
 *   - gy in [0, gridRows - 1] (top to bottom)
 * - 3D World:
 *   - Center of grid: (Cx, Cz) = ((gridCols - 1) / 2, (gridRows - 1) / 2)
 *   - worldX = (gx - Cx) * cellSize3D (positive X = East / Right)
 *   - worldY = Elevation above ground (0 = ground plane)
 *   - worldZ = (gy - Cz) * cellSize3D (positive Z = South / Down)
 * - Scale:
 *   - Default cellSize3D = 3.5 units.
 *   - If scale_meters_per_cell is configured on project, 1 cell = scale_meters_per_cell meters.
 *   - Otherwise, scale is strictly flagged as "สัดส่วนจำลอง (Simulated scale)" without false claims.
 */

export const DEFAULT_CELL_SIZE = 3.5;
export const DEFAULT_ROOF_EAVES_OVERHANG = 0.35;

export interface GridCoord {
  x: number;
  y: number;
}

export interface WorldCoord {
  x: number;
  z: number;
}

export interface GridBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ProjectScaleInfo {
  metersPerCell: number | null;
  isSimulated: boolean;
  scaleLabel: string;
}

export interface HouseDimensions {
  width: number;
  depth: number;
  isEstimated: boolean;
  dimensionLabel: string;
}

export interface PlacementCheckResult {
  isValid: boolean;
  reason?: string;
  violatingCell?: { gx: number; gy: number };
}

/**
 * Converts 2D grid coordinates (gx, gy) to 3D world coordinates (x, z).
 * Guarantees that (0,0) is centered in the 3D scene.
 */
export function gridToWorld(
  gx: number,
  gy: number,
  cols: number,
  rows: number,
  cellSize: number = DEFAULT_CELL_SIZE
): WorldCoord {
  const cx = (cols - 1) / 2;
  const cz = (rows - 1) / 2;
  return {
    x: (gx - cx) * cellSize,
    z: (gy - cz) * cellSize
  };
}

/**
 * Converts 3D world coordinates (wx, wz) to the nearest 2D grid cell (gx, gy).
 */
export function worldToGrid(
  wx: number,
  wz: number,
  cols: number,
  rows: number,
  cellSize: number = DEFAULT_CELL_SIZE
): { gx: number; gy: number } {
  const cx = (cols - 1) / 2;
  const cz = (rows - 1) / 2;
  return {
    gx: Math.round(wx / cellSize + cx),
    gy: Math.round(wz / cellSize + cz)
  };
}

/**
 * Checks whether a grid coordinate is within valid grid bounds.
 */
export function isGridInBounds(gx: number, gy: number, cols: number, rows: number): boolean {
  return gx >= 0 && gx < cols && gy >= 0 && gy < rows;
}

/**
 * Resolves the project-level scale info honestly.
 * If not explicitly defined, marks it as simulated.
 */
export function resolveProjectScale(project: any): ProjectScaleInfo {
  const configuredScale = Number(
    project?.scale_meters_per_cell ||
    project?.visual_config?.scale_meters_per_cell ||
    project?.layout_config?.scale_meters_per_cell
  );

  if (configuredScale && configuredScale > 0) {
    return {
      metersPerCell: configuredScale,
      isSimulated: false,
      scaleLabel: `1 ช่อง = ${configuredScale} ม.`
    };
  }

  return {
    metersPerCell: null,
    isSimulated: true,
    scaleLabel: `สัดส่วนจำลอง (1 ช่อง = ${DEFAULT_CELL_SIZE} หน่วย)`
  };
}

/**
 * Resolves architectural building dimensions for a house type.
 * Core Principle: The building dimension is derived strictly from the house type,
 * NEVER scaled by the land plot's size.
 */
export function resolveBuildingDimensions(
  houseType: any,
  floorCount?: number | null
): HouseDimensions {
  // 1. Check if explicit dimensions exist in DB or visual config
  const customW = Number(
    houseType?.building_width ||
    houseType?.width_m ||
    houseType?.visual_config?.building_width
  );
  const customD = Number(
    houseType?.building_depth ||
    houseType?.depth_m ||
    houseType?.visual_config?.building_depth
  );

  if (customW > 0 && customD > 0) {
    return {
      width: customW,
      depth: customD,
      isEstimated: false,
      dimensionLabel: `${customW.toFixed(1)}m × ${customD.toFixed(1)}m`
    };
  }

  // 2. Standard nominal architectural footprint based on house type / floor count
  // Residential standard: ~5.2 - 5.6m width, ~5.0 - 5.4m depth
  let nominalW = 5.4;
  let nominalD = 5.2;

  if (floorCount === 1) {
    nominalW = 5.2;
    nominalD = 5.0;
  } else if (floorCount === 2) {
    nominalW = 5.6;
    nominalD = 5.4;
  } else {
    // Unspecified floor count surveyor footprint
    nominalW = 4.8;
    nominalD = 4.6;
  }

  return {
    width: nominalW,
    depth: nominalD,
    isEstimated: true,
    dimensionLabel: `ขนาดประมาณการ (${nominalW.toFixed(1)}m × ${nominalD.toFixed(1)}m)`
  };
}

/**
 * Checks if all cells in a plot form a contiguous region (not fragmented into disconnected islands).
 */
export function checkPlotContiguity(cells: GridCoord[]): { isContiguous: boolean; componentCount: number } {
  if (cells.length <= 1) return { isContiguous: true, componentCount: cells.length };

  const cellKeySet = new Set(cells.map(c => `${c.x},${c.y}`));
  const visited = new Set<string>();
  let componentCount = 0;

  for (const cell of cells) {
    const key = `${cell.x},${cell.y}`;
    if (!visited.has(key)) {
      componentCount++;
      // BFS flood fill
      const queue: GridCoord[] = [cell];
      visited.add(key);

      while (queue.length > 0) {
        const curr = queue.shift()!;
        const neighbors = [
          { x: curr.x + 1, y: curr.y },
          { x: curr.x - 1, y: curr.y },
          { x: curr.x, y: curr.y + 1 },
          { x: curr.x, y: curr.y - 1 }
        ];

        for (const nb of neighbors) {
          const nbKey = `${nb.x},${nb.y}`;
          if (cellKeySet.has(nbKey) && !visited.has(nbKey)) {
            visited.add(nbKey);
            queue.push(nb);
          }
        }
      }
    }
  }

  return {
    isContiguous: componentCount === 1,
    componentCount
  };
}

/**
 * Validates building placement inside a plot parcel.
 * Ensures the building footprint (including roof eaves overhang) fits entirely
 * inside the parcel's cells and does not encroach upon roads, neighboring plots, or out of grid.
 */
export function validateBuildingPlacement(params: {
  plotCells: GridCoord[];
  roadCells?: GridCoord[];
  anchorWorld: WorldCoord;
  offsetX: number;
  offsetZ: number;
  rotation: number;
  buildingWidth: number;
  buildingDepth: number;
  eavesOverhang?: number;
  cols: number;
  rows: number;
  cellSize?: number;
}): PlacementCheckResult {
  const {
    plotCells,
    roadCells = [],
    anchorWorld,
    offsetX,
    offsetZ,
    rotation,
    buildingWidth,
    buildingDepth,
    eavesOverhang = DEFAULT_ROOF_EAVES_OVERHANG,
    cols,
    rows,
    cellSize = DEFAULT_CELL_SIZE
  } = params;

  if (plotCells.length === 0) {
    return { isValid: false, reason: 'ไม่มีข้อมูลแปลงที่ดินในผัง' };
  }

  const plotCellKeys = new Set(plotCells.map(c => `${c.x},${c.y}`));
  const roadCellKeys = new Set(roadCells.map(c => `${c.x},${c.y}`));

  // Center of placed building in 3D world
  const bWorldX = anchorWorld.x + offsetX;
  const bWorldZ = anchorWorld.z + offsetZ;

  // Outer building envelope including eaves
  const halfW = buildingWidth / 2 + eavesOverhang;
  const halfD = buildingDepth / 2 + eavesOverhang;

  // Local sample corners and perimeter midpoints
  const localSamples = [
    { x: -halfW, z: -halfD }, // Corner NW
    { x: halfW, z: -halfD },  // Corner NE
    { x: halfW, z: halfD },   // Corner SE
    { x: -halfW, z: halfD },  // Corner SW
    { x: 0, z: -halfD },      // Edge N
    { x: 0, z: halfD },       // Edge S
    { x: -halfW, z: 0 },      // Edge W
    { x: halfW, z: 0 },       // Edge E
    { x: 0, z: 0 }            // Center
  ];

  const cosR = Math.cos(rotation);
  const sinR = Math.sin(rotation);

  for (const pt of localSamples) {
    // Rotated point
    const rotX = pt.x * cosR - pt.z * sinR;
    const rotZ = pt.x * sinR + pt.z * cosR;

    const sampleWorldX = bWorldX + rotX;
    const sampleWorldZ = bWorldZ + rotZ;

    const { gx, gy } = worldToGrid(sampleWorldX, sampleWorldZ, cols, rows, cellSize);

    // 1. Check if within project grid
    if (!isGridInBounds(gx, gy, cols, rows)) {
      return {
        isValid: false,
        reason: `ตัวบ้านหรือชายคาออกนอกขอบเขตโครงการที่ช่อง (${gx}, ${gy})`,
        violatingCell: { gx, gy }
      };
    }

    const cellKey = `${gx},${gy}`;

    // 2. Check if overlapping road
    if (roadCellKeys.has(cellKey)) {
      return {
        isValid: false,
        reason: `ตัวบ้านหรือชายคาทับแนวถนนที่ช่อง (${gx}, ${gy})`,
        violatingCell: { gx, gy }
      };
    }

    // 3. Check if inside plot cells
    if (!plotCellKeys.has(cellKey)) {
      return {
        isValid: false,
        reason: `ตัวบ้านหรือชายคาล้ำออกนอกแปลงที่ดินที่ช่อง (${gx}, ${gy})`,
        violatingCell: { gx, gy }
      };
    }
  }

  return { isValid: true };
}

/**
 * Suggests a default facing direction and rotation for a house
 * by inspecting which edges of the plot border adjacent road cells.
 */
export function suggestFacingFromRoads(
  plotCells: GridCoord[],
  roadCells: GridCoord[]
): { facing: 'north' | 'east' | 'south' | 'west'; rotation: number } {
  const roadKeys = new Set(roadCells.map(c => `${c.x},${c.y}`));
  let northRoads = 0;
  let southRoads = 0;
  let eastRoads = 0;
  let westRoads = 0;

  for (const cell of plotCells) {
    if (roadKeys.has(`${cell.x},${cell.y - 1}`)) northRoads++;
    if (roadKeys.has(`${cell.x},${cell.y + 1}`)) southRoads++;
    if (roadKeys.has(`${cell.x + 1},${cell.y}`)) eastRoads++;
    if (roadKeys.has(`${cell.x - 1},${cell.y}`)) westRoads++;
  }

  // Priority order by count of bordering road cells
  const counts = [
    { facing: 'south' as const, rotation: 0, count: southRoads },
    { facing: 'north' as const, rotation: Math.PI, count: northRoads },
    { facing: 'east' as const, rotation: -Math.PI / 2, count: eastRoads },
    { facing: 'west' as const, rotation: Math.PI / 2, count: westRoads }
  ];

  counts.sort((a, b) => b.count - a.count);

  if (counts[0].count > 0) {
    return { facing: counts[0].facing, rotation: counts[0].rotation };
  }

  // Default facing south (rotation 0)
  return { facing: 'south', rotation: 0 };
}

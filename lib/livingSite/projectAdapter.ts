import {
  LivingSiteWorld,
  HousePlot,
  SiteCharacter,
  SiteTeam,
  SiteEnvironment,
  BuildingStageName,
  WorkerRole,
  GridCellInfo
} from './types';
import {
  DEFAULT_CELL_SIZE,
  gridToWorld,
  resolveProjectScale,
  resolveBuildingDimensions,
  checkPlotContiguity,
  validateBuildingPlacement,
  suggestFacingFromRoads
} from './coordinates';
import {
  normalizeConstructionEvents,
  deriveInspectionQueueItems,
  deriveAttentionPoints,
  deriveSiteStateAtTime
} from './eventModel';

export interface AdaptProjectDataParams {
  projectName: string;
  selectedDate: string;
  plots: any[];
  plotBounds?: Record<string, { minX: number; minY: number; maxX: number; maxY: number }>;
  mapGrid?: any[];
  gridCols?: number;
  gridRows?: number;
  allUpdatesRecord?: any[];
  plotTaskAssignments?: any[];
  defects?: any[];
  taskTemplates?: any[];
  houseTypes?: any[];
  plotStatusCache?: Record<string, { planned: number; actual: number; status: string; label: string }>;
  getPlotOverallStatus?: (plotId: string) => any;
  plotsActiveToday?: Set<string>;
  selectedProject?: any;
}

/**
 * Adapter that maps real BuildTrack project records to the decoupled LivingSiteWorld.
 * 
 * Key Principles:
 * 1. 2D & 3D share the exact same grid coordinate origin and scaling.
 * 2. Plots are composed of their real grid cells (supporting rectangular, L-shaped, narrow shapes).
 * 3. Building dimensions are derived from HouseType, NEVER stretched by plot land size.
 * 4. Roads and Green spaces (parks) are rendered strictly from mapGrid cells.
 * 5. Synthetic demo decorations (e.g. blue-roof rest pavilion) are NOT displayed in real project mode.
 */
export function adaptBuildTrackProjectToLivingSite(params: AdaptProjectDataParams): LivingSiteWorld {
  const {
    projectName,
    selectedDate,
    plots = [],
    plotBounds = {},
    mapGrid = [],
    allUpdatesRecord = [],
    defects = [],
    taskTemplates = [],
    houseTypes = [],
    plotStatusCache = {},
    getPlotOverallStatus,
    plotsActiveToday = new Set(),
    selectedProject
  } = params;

  // 1. Resolve Grid Dimensions
  const gridConfig = mapGrid.find(c => c && c.type === 'config');
  const cols = Number(params.gridCols || gridConfig?.cols || 20);
  const rows = Number(params.gridRows || gridConfig?.rows || 16);
  const cellSize = DEFAULT_CELL_SIZE;

  // 2. Resolve Project Scale Honestly
  const scaleInfo = resolveProjectScale(selectedProject);

  // 3. Process Road Cells from mapGrid
  const rawRoadCells = mapGrid.filter(c => c && c.type === 'road' && typeof c.x === 'number' && typeof c.y === 'number');
  const roadCellKeySet = new Set(rawRoadCells.map(c => `${c.x},${c.y}`));
  const roadCoords = rawRoadCells.map(c => ({ x: c.x, y: c.y }));

  const roadCells: GridCellInfo[] = rawRoadCells.map(c => {
    const world = gridToWorld(c.x, c.y, cols, rows, cellSize);
    return {
      gx: c.x,
      gy: c.y,
      worldX: world.x,
      worldZ: world.z,
      adj: {
        top: roadCellKeySet.has(`${c.x},${c.y - 1}`),
        bottom: roadCellKeySet.has(`${c.x},${c.y + 1}`),
        left: roadCellKeySet.has(`${c.x - 1},${c.y}`),
        right: roadCellKeySet.has(`${c.x + 1},${c.y}`)
      }
    };
  });

  // 4. Process Park / Garden Cells from mapGrid
  const rawParkCells = mapGrid.filter(c => c && c.type === 'park' && typeof c.x === 'number' && typeof c.y === 'number');
  const parkCellKeySet = new Set(rawParkCells.map(c => `${c.x},${c.y}`));

  const parkCells: GridCellInfo[] = rawParkCells.map(c => {
    const world = gridToWorld(c.x, c.y, cols, rows, cellSize);
    return {
      gx: c.x,
      gy: c.y,
      worldX: world.x,
      worldZ: world.z,
      adj: {
        top: parkCellKeySet.has(`${c.x},${c.y - 1}`),
        bottom: parkCellKeySet.has(`${c.x},${c.y + 1}`),
        left: parkCellKeySet.has(`${c.x - 1},${c.y}`),
        right: parkCellKeySet.has(`${c.x + 1},${c.y}`)
      }
    };
  });

  // 5. Index Plot Cells by Plot ID
  const rawPlotCells = mapGrid.filter(c => c && c.type === 'plot' && typeof c.x === 'number' && typeof c.y === 'number');
  const plotCellsMap = new Map<string, { x: number; y: number }[]>();

  for (const c of rawPlotCells) {
    if (!c.plotId) continue;
    const pKey = String(c.plotId);
    if (!plotCellsMap.has(pKey)) plotCellsMap.set(pKey, []);
    plotCellsMap.get(pKey)!.push({ x: c.x, y: c.y });
  }

  // 6. Index Saved Placements from mapGrid / layout_data
  const savedPlacementsMap = new Map<string, any>();
  mapGrid.filter(c => c && c.type === 'placement').forEach(p => {
    if (p.plotId) savedPlacementsMap.set(String(p.plotId), p);
  });

  // 7. Find Unassigned Cells within Project Grid
  const assignedCellKeySet = new Set<string>();
  rawRoadCells.forEach(c => assignedCellKeySet.add(`${c.x},${c.y}`));
  rawParkCells.forEach(c => assignedCellKeySet.add(`${c.x},${c.y}`));
  rawPlotCells.forEach(c => assignedCellKeySet.add(`${c.x},${c.y}`));

  const unassignedCells: GridCellInfo[] = [];
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      if (!assignedCellKeySet.has(`${gx},${gy}`)) {
        const world = gridToWorld(gx, gy, cols, rows, cellSize);
        unassignedCells.push({
          gx,
          gy,
          worldX: world.x,
          worldZ: world.z
        });
      }
    }
  }

  // Determine stage from real tasks or overall progress
  const determineStage = (actualProgress: number, recentTaskName: string): BuildingStageName => {
    const taskLower = (recentTaskName || '').toLowerCase();
    if (actualProgress >= 100) return 'completed';
    if (taskLower.includes('สี') || taskLower.includes('ประตู') || taskLower.includes('หน้าต่าง') || taskLower.includes('สถาปัตย์') || actualProgress >= 85) {
      return 'finishing';
    }
    if (taskLower.includes('หลังคา') || taskLower.includes('มุง') || actualProgress >= 70) {
      return 'roofing';
    }
    if (taskLower.includes('ก่อ') || taskLower.includes('ฉาบ') || taskLower.includes('อิฐ') || taskLower.includes('ผนัง') || actualProgress >= 40) {
      return 'masonry';
    }
    if (taskLower.includes('โครงสร้าง') || taskLower.includes('คาน') || taskLower.includes('เสา') || actualProgress >= 20) {
      return 'structure';
    }
    return 'foundation';
  };

  // 8. Build HousePlots from real plots
  const houses: HousePlot[] = plots.map((p, index) => {
    const plotId = String(p.id || p.plot_name || `plot_${index}`);
    const plotName = p.plot_name || p.name || `แปลง ${index + 1}`;

    // Get cells belonging to this plot
    const cells = plotCellsMap.get(plotId)
      || plotCellsMap.get(plotName)
      || plotCellsMap.get(String(p.name))
      || [];

    // Check contiguity
    const contiguity = checkPlotContiguity(cells);
    const isFragmented = !contiguity.isContiguous;

    // Calculate Anchor and Bounding Dimensions of the plot land
    let worldX = 0;
    let worldZ = 0;
    let plotWidth = 7.0;
    let plotDepth = 7.0;
    let minGx = 0;
    let minGy = 0;

    if (cells.length > 0) {
      let sumGx = 0;
      let sumGy = 0;
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;

      for (const c of cells) {
        sumGx += c.x;
        sumGy += c.y;
        if (c.x < minX) minX = c.x;
        if (c.x > maxX) maxX = c.x;
        if (c.y < minY) minY = c.y;
        if (c.y > maxY) maxY = c.y;
      }

      minGx = minX;
      minGy = minY;
      const avgGx = sumGx / cells.length;
      const avgGy = sumGy / cells.length;
      const anchor = gridToWorld(avgGx, avgGy, cols, rows, cellSize);
      worldX = anchor.x;
      worldZ = anchor.z;

      plotWidth = Math.max(cellSize, (maxX - minX + 1) * cellSize);
      plotDepth = Math.max(cellSize, (maxY - minY + 1) * cellSize);
    } else {
      // Fallback if plot not yet drawn in mapGrid
      const bounds = plotBounds[plotId] || plotBounds[plotName];
      if (bounds) {
        minGx = bounds.minX;
        minGy = bounds.minY;
        const avgGx = (bounds.minX + bounds.maxX) / 2;
        const avgGy = (bounds.minY + bounds.maxY) / 2;
        const anchor = gridToWorld(avgGx, avgGy, cols, rows, cellSize);
        worldX = anchor.x;
        worldZ = anchor.z;
        plotWidth = Math.max(cellSize, (bounds.maxX - bounds.minX + 1) * cellSize);
        plotDepth = Math.max(cellSize, (bounds.maxY - bounds.minY + 1) * cellSize);
      } else {
        const row = Math.floor(index / 2);
        const col = index % 2;
        worldX = col === 0 ? -12 : 12;
        worldZ = (row - 2) * 10;
        minGx = col === 0 ? 2 : 14;
        minGy = row * 3;
      }
    }

    // Progress & Status
    let actualProgress = 0;
    if (plotStatusCache[plotId]) {
      actualProgress = plotStatusCache[plotId].actual;
    } else if (getPlotOverallStatus) {
      const st = getPlotOverallStatus(plotId);
      if (st && typeof st.actual === 'number') actualProgress = st.actual;
    }

    // Find latest update for this plot
    const plotUpdates = allUpdatesRecord.filter(u => String(u.plot_id) === plotId || u.plot_name === plotName);
    const latestUpdate = plotUpdates.length > 0 ? plotUpdates[plotUpdates.length - 1] : null;

    let taskName = '';
    if (latestUpdate) {
      const template = taskTemplates.find(t => t.id === latestUpdate.task_template_id);
      taskName = template ? template.task_name : (latestUpdate.action || 'งานก่อสร้างประจำวัน');
    }

    const currentStage = determineStage(actualProgress, taskName);
    const plotDefects = defects.filter(d => String(d.plot_id) === plotId);

    // Resolve House Type
    const hType = houseTypes.find(ht => String(ht.id) === String(p.house_type_id));
    const houseTypeName = hType?.type_name
      || p.house_types?.type_name
      || hType?.name
      || (p.house_type ? p.house_type : 'แบบบ้านมาตรฐาน BuildTrack');

    // Read floor count strictly from database record
    const rawFloor = hType?.floor_count ?? p.house_types?.floor_count;
    const floorCount: number | null = (rawFloor === 1 || rawFloor === 2) ? rawFloor : null;

    const hasPerFloorData = Boolean(
      taskName && (taskName.includes('ชั้น 1') || taskName.includes('ชั้น 2') || taskName.includes('ชั้นล่าง') || taskName.includes('ชั้นบน'))
    );

    const customRoofColor = hType?.roof_color || hType?.visual_config?.roof_color || (p as any)?.roof_color;

    // 🌟 Decouple Building Dimensions from Land Plot Size
    const houseDims = resolveBuildingDimensions(hType, floorCount);
    const buildingWidth = houseDims.width;
    const buildingDepth = houseDims.depth;

    // 🌟 Placement & Orientation inside the parcel
    const savedPlacement = savedPlacementsMap.get(plotId)
      || savedPlacementsMap.get(plotName)
      || p.house_placement;

    let offsetX = 0;
    let offsetZ = 0;
    let rotation = 0;
    let facingDirection: 'north' | 'east' | 'south' | 'west' = 'south';

    if (savedPlacement) {
      offsetX = Number(savedPlacement.offsetX || savedPlacement.offset_x) || 0;
      offsetZ = Number(savedPlacement.offsetZ || savedPlacement.offset_z) || 0;
      rotation = Number(savedPlacement.rotation) || 0;
      facingDirection = savedPlacement.facing || 'south';
    } else {
      // Suggest intelligent facing based on adjacent road cells
      const suggested = suggestFacingFromRoads(cells, roadCoords);
      rotation = suggested.rotation;
      facingDirection = suggested.facing;
    }

    // Validate placement footprint against parcel cells
    const placementValidation = cells.length > 0
      ? validateBuildingPlacement({
          plotCells: cells,
          roadCells: roadCoords,
          anchorWorld: { x: worldX, z: worldZ },
          offsetX,
          offsetZ,
          rotation,
          buildingWidth,
          buildingDepth,
          cols,
          rows,
          cellSize
        })
      : { isValid: true };

    const buildingWorldX = worldX + offsetX;
    const buildingWorldZ = worldZ + offsetZ;

    // Calculate entrance position relative to facing direction
    let entX = buildingWorldX;
    let entZ = buildingWorldZ;
    if (facingDirection === 'south') {
      entZ += buildingDepth / 2 + 0.9;
    } else if (facingDirection === 'north') {
      entZ -= buildingDepth / 2 + 0.9;
    } else if (facingDirection === 'east') {
      entX += buildingWidth / 2 + 0.9;
    } else if (facingDirection === 'west') {
      entX -= buildingWidth / 2 + 0.9;
    }

    return {
      id: plotId,
      plotName,
      houseType: houseTypeName,
      houseTypeId: p.house_type_id,
      floorCount,
      stageDetailsComplete: hasPerFloorData,
      cells,
      isFragmented,
      gridX: minGx,
      gridZ: minGy,
      worldX,
      worldZ,
      width: plotWidth,
      depth: plotDepth,
      rotation,
      buildingWidth,
      buildingDepth,
      isBuildingDimensionEstimated: houseDims.isEstimated,
      buildingDimensionLabel: houseDims.dimensionLabel,
      roofColor: customRoofColor,
      buildingWorldX,
      buildingWorldZ,
      placementOffset: { x: offsetX, z: offsetZ },
      placementRotation: rotation,
      facingDirection,
      isPlacementValid: placementValidation.isValid,
      placementViolationText: placementValidation.reason,
      currentStage,
      stageProgress: {
        foundation: Math.min(100, Math.max(0, actualProgress * 5)),
        structure: Math.min(100, Math.max(0, (actualProgress - 20) * 3.5)),
        masonry: Math.min(100, Math.max(0, (actualProgress - 40) * 3.3)),
        roofing: Math.min(100, Math.max(0, (actualProgress - 70) * 6.6)),
        finishing: Math.min(100, Math.max(0, (actualProgress - 85) * 6.6))
      },
      overallProgress: actualProgress,
      assignedTeamName: latestUpdate ? `ทีม ${latestUpdate.user_name || 'ช่างประจำแปลง'}` : undefined,
      activeWorkerIds: [],
      defectCount: plotDefects.length,
      defects: plotDefects.map(d => ({
        id: String(d.id),
        title: d.title || d.description || 'รายการแก้ไขหน้างาน',
        severity: d.severity || 'minor',
        status: d.status || 'open'
      })),
      lastUpdateText: latestUpdate ? (latestUpdate.action || taskName) : 'ไม่มีรายงานใหม่',
      lastUpdateTime: latestUpdate?.created_at
        ? new Date(latestUpdate.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
        : '-',
      latestPhotoUrl: latestUpdate?.image_url,
      entrancePos: { x: entX, z: entZ },
      workSpots: [
        { x: entX, z: entZ },
        { x: buildingWorldX + buildingWidth / 2 + 0.5, z: buildingWorldZ }
      ]
    };
  });

  // Calculate site bounding box for environment
  const envWidth = Math.max(50, cols * cellSize + 12);
  const envDepth = Math.max(40, rows * cellSize + 12);

  // 🌟 Strictly Honest Environment:
  // In real project mode, do NOT display synthetic demo rest pavilions or arbitrary cross roads!
  const environment: SiteEnvironment = {
    width: envWidth,
    depth: envDepth,
    gridCols: cols,
    gridRows: rows,
    cellSize,
    scaleMetersPerCell: scaleInfo.metersPerCell,
    scaleLabel: scaleInfo.scaleLabel,
    isScaleSimulated: scaleInfo.isSimulated,
    roadCells,
    parkCells,
    unassignedCells,
    demoDecorationsEnabled: false,
    facilities: [],
    // Legacy fallback properties preserved for backward compatibility
    restArea: { x: 0, z: 0, width: 0, depth: 0, label: 'ศาลาพักคนงาน' },
    storageArea: { x: 0, z: 0, width: 0, depth: 0, label: 'ลานเก็บวัสดุ' },
    entranceGate: { x: 0, z: (rows / 2) * cellSize, label: 'ทางเข้าโครงการ' },
    roads: [],
    trees: [],
    scaffoldings: [],
    materialPallets: []
  };

  // 9. Normalize real construction events & inspections
  const normalizedEvents = normalizeConstructionEvents({
    taskUpdates: allUpdatesRecord,
    plotTaskAssignments: params.plotTaskAssignments || [],
    defects,
    plots,
    taskTemplates,
    selectedDate
  });

  const pendingInspections = deriveInspectionQueueItems(
    params.plotTaskAssignments || [],
    plots,
    taskTemplates
  );

  const attentionPoints = deriveAttentionPoints(
    defects,
    pendingInspections,
    plots
  );

  // Derive truthful site state (1 avatar per actor at latest reported plot)
  const { characters: derivedCharacters, updatedHouses } = deriveSiteStateAtTime({
    events: normalizedEvents,
    houses
  });

  // Attach inspection queues & attention indicators to houses
  const finalHouses = updatedHouses.map(h => {
    const plotPending = pendingInspections.filter(p => p.plotId === h.id || p.plotName === h.plotName);
    const hasCriticalDefect = h.defects?.some(d => d.severity === 'critical');
    const hasRework = plotPending.some(p => p.statusFor === 'Rework');
    const hasPendingInspection = plotPending.length > 0;
    const hasOpenDefects = (h.defectCount || 0) > 0;

    let attentionPriority: 'critical' | 'warning' | 'info' | null = null;
    if (hasCriticalDefect || hasRework) {
      attentionPriority = 'critical';
    } else if (hasOpenDefects || hasPendingInspection) {
      attentionPriority = 'warning';
    }

    return {
      ...h,
      pendingInspections: plotPending,
      hasPendingInspection,
      hasOpenDefects,
      hasRework,
      attentionPriority
    };
  });

  let characters: SiteCharacter[] = derivedCharacters;

  // Standby staff if no character reports
  if (characters.length === 0 && finalHouses.length > 0) {
    const demoTeam = [
      { name: 'สมศักดิ์ (โฟร์แมนประจำไซต์)', role: 'foreman' as WorkerRole, label: 'โฟร์แมน', color: '#ffffff' },
      { name: 'ธีระ (วิศวกรโครงการ)', role: 'engineer' as WorkerRole, label: 'วิศวกร', color: '#ffffff' },
      { name: 'ประสิทธิ์ (หัวหน้าช่าง)', role: 'mason' as WorkerRole, label: 'ช่างก่อสร้าง', color: '#f97316' }
    ];

    demoTeam.forEach((mem, idx) => {
      const targetHouse = finalHouses[idx % finalHouses.length];
      characters.push({
        id: `standby_char_${idx}`,
        name: mem.name,
        role: mem.role,
        roleLabel: mem.label,
        teamId: `team_standby_${idx}`,
        teamName: 'ฝ่ายบริหารไซต์งาน',
        color: mem.color,
        currentPlotId: targetHouse?.id,
        targetPlotId: targetHouse?.id,
        x: targetHouse ? targetHouse.entrancePos.x : idx * 3,
        y: 0,
        z: targetHouse ? targetHouse.entrancePos.z : 12,
        rotationY: 0,
        businessState: 'in_progress',
        simActivity: 'working_inspect',
        path: [],
        pathIndex: 0,
        speed: 1.8,
        taskName: 'ตรวจเช็กความพร้อมหน้างาน',
        actionDetail: 'สแตนด์บายประสานงานประจำโครงการ',
        speechText: 'พร้อมรับรายงานประจำวัน',
        lastReportTime: 'วันนี้',
        isSimulated: true
      });
    });
  }

  // Create Teams summary
  const teams: SiteTeam[] = [];
  const teamGroups = new Map<string, SiteCharacter[]>();
  characters.forEach(c => {
    const tName = c.teamName || 'ฝ่ายปฏิบัติการ';
    const list = teamGroups.get(tName) || [];
    list.push(c);
    teamGroups.set(tName, list);
  });

  for (const [tName, members] of teamGroups.entries()) {
    const leader = members[0];
    teams.push({
      id: `team_${tName}`,
      name: tName,
      trade: leader.roleLabel,
      leaderName: leader.name,
      leaderRole: leader.role,
      color: leader.color,
      businessState: 'in_progress',
      memberCount: members.length
    });
  }

  return {
    projectName: projectName || 'โครงการ BuildTrack',
    dateStr: selectedDate,
    isDemoMode: false,
    environment,
    houses: finalHouses,
    characters,
    teams,
    updatedAt: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }),
    events: normalizedEvents,
    attentionPoints,
    pendingInspections
  };
}

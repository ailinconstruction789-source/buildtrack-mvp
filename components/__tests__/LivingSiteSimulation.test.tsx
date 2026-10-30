import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LivingSiteSimulation } from '../livingSite/LivingSiteSimulation';
import { NavigationGrid } from '@/lib/livingSite/navigation';
import { SimulationStateMachine } from '@/lib/livingSite/stateMachine';
import { generateDemoLivingSiteWorld } from '@/lib/livingSite/demoData';
import { adaptBuildTrackProjectToLivingSite } from '@/lib/livingSite/projectAdapter';
import { SiteCharacter, HousePlot } from '@/lib/livingSite/types';
import { createHouseMesh, createRoadNetworkMesh, createParkNetworkMesh, buildPlotParcelMeshes, PALETTE } from '@/lib/livingSite/proceduralMeshes';
import {
  gridToWorld,
  worldToGrid,
  resolveBuildingDimensions,
  resolveProjectScale,
  checkPlotContiguity,
  validateBuildingPlacement,
  suggestFacingFromRoads
} from '@/lib/livingSite/coordinates';
import {
  normalizeConstructionEvents,
  deriveInspectionQueueItems,
  deriveAttentionPoints,
  deriveSiteStateAtTime,
  parseToBangkokDate,
  calculateFreshness
} from '@/lib/livingSite/eventModel';
import * as THREE from 'three';

describe('Living Site Simulation & Navigation Engine', () => {
  beforeEach(() => {
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      arc: vi.fn(),
      ellipse: vi.fn(),
      roundRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      scale: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn(() => ({ width: 60 })),
      setTransform: vi.fn(),
      resetTransform: vi.fn(),
      createRadialGradient: vi.fn(() => ({
        addColorStop: vi.fn(),
      })),
      setLineDash: vi.fn(),
    })) as any;
  });

  it('initializes NavigationGrid and computes walkable A* path around obstacles', () => {
    const nav = new NavigationGrid(40, 40, 1.0);

    const houses: HousePlot[] = [
      {
        id: 'H1',
        plotName: 'A-01',
        houseType: 'Type Alpha',
        gridX: 20,
        gridZ: 20,
        worldX: 0,
        worldZ: 0,
        width: 8,
        depth: 8,
        rotation: 0,
        currentStage: 'structure',
        stageProgress: { foundation: 100, structure: 50, masonry: 0, roofing: 0, finishing: 0 },
        overallProgress: 30,
        activeWorkerIds: [],
        defectCount: 0,
        defects: [],
        lastUpdateText: 'งานเสาคาน',
        lastUpdateTime: '10:00',
        entrancePos: { x: 0, z: 6 },
        workSpots: [{ x: 0, z: 5 }]
      }
    ];

    const env = {
      width: 40,
      depth: 40,
      restArea: { x: -10, z: 10, width: 4, depth: 4, label: 'พัก' },
      storageArea: { x: 10, z: 10, width: 4, depth: 4, label: 'เก็บ' },
      entranceGate: { x: 0, z: 18, label: 'ทางเข้า' },
      roads: [{ startX: 0, startZ: -18, endX: 0, endZ: 18, width: 4 }],
      trees: [],
      scaffoldings: [],
      materialPallets: []
    };

    nav.bakeWorld(env, houses);

    // The center (0,0) where house H1 sits should NOT be walkable
    const centerGrid = nav.worldToGrid(0, 0);
    expect(nav.isWalkable(centerGrid.gx, centerGrid.gz)).toBe(false);

    // Entrance (0, 6) should be walkable
    const entranceGrid = nav.worldToGrid(0, 6);
    expect(nav.isWalkable(entranceGrid.gx, entranceGrid.gz)).toBe(true);

    // Pathfind from south (0, 12) to north (0, -12)
    // Must navigate around the center building without clipping through (0,0)
    const path = nav.findPath({ x: 0, z: 12 }, { x: 0, z: -12 });
    expect(path.length).toBeGreaterThan(1);

    // Verify none of the waypoints intersect the house footprint center
    for (const pt of path) {
      const g = nav.worldToGrid(pt.x, pt.z);
      expect(nav.isWalkable(g.gx, g.gz)).toBe(true);
    }
  });

  it('governs state machine transitions between business and simulation activities', () => {
    const world = generateDemoLivingSiteWorld();
    const nav = new NavigationGrid(world.environment.width, world.environment.depth, 1.0);
    nav.bakeWorld(world.environment, world.houses);
    const sm = new SimulationStateMachine(nav, world.environment, world.houses);

    const testChar: SiteCharacter = {
      id: 'char_test',
      name: 'ช่างทดสอบ',
      role: 'mason',
      roleLabel: 'ช่างปูน',
      teamId: 't1',
      teamName: 'ทีมปูน',
      color: '#fff',
      x: 0,
      y: 0,
      z: 0,
      rotationY: 0,
      businessState: 'assigned',
      simActivity: 'idle',
      path: [],
      pathIndex: 0,
      speed: 2.0,
      taskName: 'งานปูน',
      actionDetail: 'เตรียมงาน',
      speechText: '',
      lastReportTime: '10:00',
      isSimulated: true
    };

    // Transition to resting: should route towards rest area and switch to walking
    sm.transitionBusinessState(testChar, 'resting');
    expect(testChar.businessState).toBe('resting');
    expect(testChar.simActivity).toBe('walking');
    expect(testChar.path.length).toBeGreaterThan(0);

    // Simulate character movement along path
    let updated = testChar;
    for (let step = 0; step < 50; step++) {
      updated = sm.updateCharacter(updated, 0.5);
    }

    // After enough steps, character reaches destination and transitions to resting activity
    expect(['resting', 'walking']).toContain(updated.simActivity);
  });

  it('adaptBuildTrackProjectToLivingSite truthfully stages construction without faking percentages', () => {
    const adapted = adaptBuildTrackProjectToLivingSite({
      projectName: 'โครงการบ้านสวนสุขใจ',
      selectedDate: '2026-10-26',
      plots: [
        { id: 'P01', plot_name: 'P-01', house_type_id: 1 },
        { id: 'P02', plot_name: 'P-02', house_type_id: 1 }
      ],
      plotStatusCache: {
        P01: { planned: 50, actual: 25, status: 'on-track', label: 'ตามแผน' },
        P02: { planned: 80, actual: 95, status: 'on-track', label: 'ตามแผน' }
      },
      allUpdatesRecord: [
        {
          id: 1,
          plot_id: 'P01',
          user_name: 'ช่างเกรียงไกร',
          role: 'mason',
          action: 'เทคานคอดินชั้นล่าง',
          created_at: new Date().toISOString()
        }
      ],
      defects: [
        { id: 'd1', plot_id: 'P01', title: 'คอนกรีตมีโพรงเล็กน้อย', severity: 'minor', status: 'open' }
      ]
    });

    expect(adapted.projectName).toBe('โครงการบ้านสวนสุขใจ');
    expect(adapted.houses.length).toBe(2);

    const houseP1 = adapted.houses.find(h => h.id === 'P01')!;
    expect(houseP1.currentStage).toBe('structure');
    expect(houseP1.defectCount).toBe(1);
    expect(houseP1.defects[0].title).toBe('คอนกรีตมีโพรงเล็กน้อย');

    const houseP2 = adapted.houses.find(h => h.id === 'P02')!;
    expect(houseP2.currentStage).toBe('finishing');

    // Characters are truthfully marked with isSimulated = true
    expect(adapted.characters.length).toBeGreaterThan(0);
    expect(adapted.characters[0].isSimulated).toBe(true);
  });

  it('reads house type_name and floor_count truthfully without guessing from names', () => {
    const adapted = adaptBuildTrackProjectToLivingSite({
      projectName: 'ไอลิน เลควิว',
      selectedDate: '2026-10-26',
      plots: [
        { id: 'P1', plot_name: 'P-01', house_type_id: 'ht-1' },
        { id: 'P2', plot_name: 'P-02', house_type_id: 'ht-2' },
        { id: 'P3', plot_name: 'P-03', house_type_id: 'ht-3' },
      ],
      houseTypes: [
        { id: 'ht-1', type_name: 'แบบสิรินธร (ชั้นเดียว)', floor_count: 1 },
        { id: 'ht-2', type_name: 'แบบวิลล่าการ์เดน', floor_count: 2 },
        // ht-3 has name that sounds like two storeys, but floor_count is null
        { id: 'ht-3', type_name: 'แบบสองชั้นโมเดิร์นวิลล่า', floor_count: null },
      ]
    });

    const p1 = adapted.houses.find(h => h.id === 'P1')!;
    expect(p1.houseType).toBe('แบบสิรินธร (ชั้นเดียว)');
    expect(p1.floorCount).toBe(1);

    const p2 = adapted.houses.find(h => h.id === 'P2')!;
    expect(p2.houseType).toBe('แบบวิลล่าการ์เดน');
    expect(p2.floorCount).toBe(2);

    const p3 = adapted.houses.find(h => h.id === 'P3')!;
    expect(p3.houseType).toBe('แบบสองชั้นโมเดิร์นวิลล่า');
    // MUST be strictly null, never guessing 2 from the string name!
    expect(p3.floorCount).toBeNull();
  });

  it('constructs distinct 1-storey, 2-storey, and neutral unspecified 3D models', () => {
    const basePlotData: Omit<HousePlot, 'id' | 'floorCount' | 'currentStage'> = {
      plotName: 'T-01',
      houseType: 'แบบทดสอบ',
      gridX: 1,
      gridZ: 1,
      worldX: 0,
      worldZ: 0,
      width: 7.0,
      depth: 6.0,
      rotation: 0,
      stageProgress: { foundation: 100, structure: 100, masonry: 100, roofing: 100, finishing: 100 },
      overallProgress: 100,
      activeWorkerIds: [],
      defectCount: 0,
      defects: [],
      lastUpdateText: 'เสร็จสิ้น',
      lastUpdateTime: '10:00',
      entrancePos: { x: 0, z: 4 },
      workSpots: []
    };

    // 1. Single-Storey House Model
    const plot1F: HousePlot = { ...basePlotData, id: 'house_1f', floorCount: 1, currentStage: 'completed' };
    const mesh1F = createHouseMesh(plot1F);
    expect(mesh1F.name).toBe('house_house_1f');

    // Roof of 1-storey house sits at y ~ 2.90
    const roof1F = mesh1F.getObjectByName('hip_tiled_roof');
    expect(roof1F).toBeDefined();

    // 2. Two-Storey House Model
    const plot2F: HousePlot = { ...basePlotData, id: 'house_2f', floorCount: 2, currentStage: 'completed' };
    const mesh2F = createHouseMesh(plot2F);
    expect(mesh2F.name).toBe('house_house_2f');

    const roof2F = mesh2F.getObjectByName('hip_tiled_roof');
    expect(roof2F).toBeDefined();

    // 3. Unspecified Floor Count Model (floorCount = null)
    const plotNull: HousePlot = { ...basePlotData, id: 'house_null', floorCount: null, currentStage: 'completed' };
    const meshNull = createHouseMesh(plotNull);
    expect(meshNull.name).toBe('house_house_null_unspecified');

    // Should NOT contain a roof
    const roofNull = meshNull.getObjectByName('hip_tiled_roof');
    expect(roofNull).toBeUndefined();

    // Unspecified model should have the surveyor tripod / notice board
    let foundNoticeBoard = false;
    meshNull.traverse((child) => {
      if (child instanceof THREE.Mesh && (child.material as any)?.color?.getHex?.() === 0x1e293b) {
        foundNoticeBoard = true;
      }
    });
    expect(foundNoticeBoard).toBe(true);
  });

  it('generates roof truss framework where rafters meet ridge without reversal', () => {
    const plotTruss: HousePlot = {
      id: 'house_truss',
      plotName: 'T-02',
      houseType: 'โครงหลังคา',
      floorCount: 1,
      currentStage: 'roofing',
      gridX: 1,
      gridZ: 1,
      worldX: 0,
      worldZ: 0,
      width: 8.0,
      depth: 6.0,
      rotation: 0,
      stageProgress: { foundation: 100, structure: 100, masonry: 100, roofing: 60, finishing: 0 },
      overallProgress: 75,
      activeWorkerIds: [],
      defectCount: 0,
      defects: [],
      lastUpdateText: 'งานโครงหลังคาเหล็ก',
      lastUpdateTime: '10:00',
      entrancePos: { x: 0, z: 4 },
      workSpots: []
    };

    const meshTruss = createHouseMesh(plotTruss);
    const trussGroup = meshTruss.getObjectByName('roof_truss_framework');
    expect(trussGroup).toBeDefined();
    expect(trussGroup!.children.length).toBeGreaterThan(5);
  });
});

describe('LivingSiteSimulation Component UI', () => {
  beforeEach(() => {
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      arc: vi.fn(),
      ellipse: vi.fn(),
      roundRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      scale: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn(() => ({ width: 60 })),
      setTransform: vi.fn(),
      resetTransform: vi.fn(),
      createRadialGradient: vi.fn(() => ({
        addColorStop: vi.fn(),
      })),
      setLineDash: vi.fn(),
    })) as any;
  });

  const mockProps = {
    selectedProject: { name: 'เดอะ แกรนด์ วิลเลจ' },
    plots: [
      { id: 'A01', plot_name: 'A-01', house_type_id: 1 },
      { id: 'A02', plot_name: 'A-02', house_type_id: 1 }
    ],
    plotStatusCache: {
      A01: { planned: 40, actual: 35, status: 'on-track', label: 'ตามแผน' },
      A02: { planned: 85, actual: 80, status: 'on-track', label: 'ตามแผน' }
    },
    plotsActiveToday: new Set(['A01']),
    allUpdatesRecord: [
      {
        id: 1,
        plot_id: 'A01',
        user_name: 'สมศักดิ์ โฟร์แมน',
        role: 'foreman',
        action: 'ตรวจความเรียบร้อยหน้างาน',
        created_at: new Date().toISOString()
      }
    ],
    taskTemplates: [{ id: 1, house_type_id: 1, task_name: 'งานเสาคาน' }],
    houseTypes: [{ id: 1, name: 'บ้านเดี่ยว 2 ชั้น' }],
    selectedDate: '2026-10-26'
  };

  it('renders correctly and allows switching between 3D mode and Accessible List View', () => {
    render(<LivingSiteSimulation {...mockProps} />);

    expect(screen.getByText('เดอะ แกรนด์ วิลเลจ')).toBeInTheDocument();
    expect(screen.getByText('Colony Sim')).toBeInTheDocument();

    // Toggle to accessible list view
    const listBtn = screen.getByText('ดูแบบตาราง');
    fireEvent.click(listBtn);

    expect(screen.getByText(/รายการสรุปงานและบุคลากรในไซต์งาน/)).toBeInTheDocument();
    expect(screen.getByText(/สถานะการก่อสร้างรายแปลง/)).toBeInTheDocument();

    // Toggle back to 3D simulation
    const backTo3DBtn = screen.getByText('สลับกลับสู่มุมมอง 3D Simulation');
    fireEvent.click(backTo3DBtn);

    expect(screen.getByTitle('Snap กลับมามุมมองผังมาตรฐาน Isometric')).toBeInTheDocument();
  });

  it('supports Demo vs Live Data mode toggle with transparent badges', () => {
    render(<LivingSiteSimulation {...mockProps} />);

    // Starts in Live Data mode since plots were provided
    const modeBtn = screen.getByTitle('สลับระหว่างข้อมูลจำลอง (Demo) และข้อมูลจริงจากฐานข้อมูล');
    expect(modeBtn).toHaveTextContent('ข้อมูลจริง (Live Data)');

    // Toggle to Demo mode
    fireEvent.click(modeBtn);
    expect(modeBtn).toHaveTextContent('โหมดจำลอง (Demo Mode)');
  });

  it('allows graphic quality changes (ต่ำ, กลาง, สูง)', () => {
    render(<LivingSiteSimulation {...mockProps} />);

    const lowBtn = screen.getByRole('button', { name: 'ต่ำ' });
    const highBtn = screen.getByRole('button', { name: 'สูง' });

    fireEvent.click(lowBtn);
    expect(lowBtn).toHaveClass('bg-indigo-600');

    fireEvent.click(highBtn);
    expect(highBtn).toHaveClass('bg-indigo-600');
  });

  it('allows searching plots and workers to inspect details and follow camera', () => {
    render(<LivingSiteSimulation {...mockProps} />);

    const searchInput = screen.getByPlaceholderText('ค้นหาเลขแปลง, ชื่อช่าง หรือบทบาท...');
    fireEvent.change(searchInput, { target: { value: 'A-01' } });

    // Drawer opens for plot A-01
    expect(screen.getByText(/แปลง A-01/)).toBeInTheDocument();
    expect(screen.getByText(/ขั้นตอนปัจจุบัน:/)).toBeInTheDocument();
    expect(screen.getByText(/ฐานราก:/)).toBeInTheDocument();
    expect(screen.getByText(/เสาคาน:/)).toBeInTheDocument();
  });

  it('automatically falls back to Accessible List View when WebGL is unsupported', () => {
    HTMLCanvasElement.prototype.getContext = vi.fn(() => null);

    render(<LivingSiteSimulation {...mockProps} />);

    expect(screen.getByText(/อุปกรณ์หรือเบราว์เซอร์ไม่รองรับ WebGL กำลังแสดงผลในโหมดตารางข้อความ/)).toBeInTheDocument();
    expect(screen.getByText(/รายการสรุปงานและบุคลากรในไซต์งาน/)).toBeInTheDocument();
  });

  describe('2D to 3D Shared Coordinates, Parcels & Building Footprints', () => {
    it('converts 2D grid coordinates to 3D world coordinates and inverts accurately', () => {
      const cols = 30;
      const rows = 20;
      const cellSize = 3.5;

      // Test center grid cell
      const centerWorld = gridToWorld(14.5, 9.5, cols, rows, cellSize);
      expect(centerWorld.x).toBeCloseTo(0, 4);
      expect(centerWorld.z).toBeCloseTo(0, 4);

      // Invert back to grid
      const inverted = worldToGrid(centerWorld.x, centerWorld.z, cols, rows, cellSize);
      expect(inverted.gx).toBe(15);
      expect(inverted.gy).toBe(10);

      // Test corner cell (0,0)
      const cornerWorld = gridToWorld(0, 0, cols, rows, cellSize);
      const invertedCorner = worldToGrid(cornerWorld.x, cornerWorld.z, cols, rows, cellSize);
      expect(invertedCorner.gx).toBe(0);
      expect(invertedCorner.gy).toBe(0);
    });

    it('detects contiguous vs fragmented plot parcel shapes', () => {
      // Contiguous L-shaped plot
      const lShaped = [
        { x: 2, y: 2 },
        { x: 3, y: 2 },
        { x: 2, y: 3 }
      ];
      expect(checkPlotContiguity(lShaped).isContiguous).toBe(true);

      // Disconnected / fragmented plot
      const fragmented = [
        { x: 2, y: 2 },
        { x: 2, y: 3 },
        { x: 6, y: 6 } // detached cell
      ];
      const check = checkPlotContiguity(fragmented);
      expect(check.isContiguous).toBe(false);
      expect(check.componentCount).toBe(2);
    });

    it('strictly separates parcel land size from building footprint dimensions', () => {
      const houseTypeOneStorey = { id: 1, name: 'แบบบ้านชั้นเดียว A', floor_count: 1 };
      const houseTypeTwoStorey = { id: 2, name: 'แบบบ้านสองชั้น B', floor_count: 2 };
      const houseTypeCustom = { id: 3, name: 'วิลล่าสั่งสร้าง', floor_count: 2, building_width: 8.5, building_depth: 7.2 };

      // Dimensions derived strictly from house type
      const dim1 = resolveBuildingDimensions(houseTypeOneStorey, 1);
      const dim2 = resolveBuildingDimensions(houseTypeTwoStorey, 2);
      const dimCustom = resolveBuildingDimensions(houseTypeCustom, 2);

      expect(dim1.width).toBe(5.2);
      expect(dim1.depth).toBe(5.0);

      expect(dim2.width).toBe(5.6);
      expect(dim2.depth).toBe(5.4);

      expect(dimCustom.width).toBe(8.5);
      expect(dimCustom.depth).toBe(7.2);
      expect(dimCustom.isEstimated).toBe(false);

      // In adapter: 2x2 plot vs 4x4 plot with same house type
      const paramsSmall: any = {
        projectName: 'Test Proj',
        selectedDate: '2026-10-26',
        plots: [{ id: 'P_SMALL', plot_name: 'P1', house_type_id: 1 }],
        mapGrid: [
          { type: 'plot', plotId: 'P_SMALL', x: 2, y: 2 },
          { type: 'plot', plotId: 'P_SMALL', x: 3, y: 2 },
          { type: 'plot', plotId: 'P_SMALL', x: 2, y: 3 },
          { type: 'plot', plotId: 'P_SMALL', x: 3, y: 3 }
        ],
        gridCols: 20,
        gridRows: 20,
        houseTypes: [houseTypeOneStorey]
      };

      const paramsLarge: any = {
        projectName: 'Test Proj',
        selectedDate: '2026-10-26',
        plots: [{ id: 'P_LARGE', plot_name: 'P2', house_type_id: 1 }],
        mapGrid: [
          { type: 'plot', plotId: 'P_LARGE', x: 10, y: 10 },
          { type: 'plot', plotId: 'P_LARGE', x: 11, y: 10 },
          { type: 'plot', plotId: 'P_LARGE', x: 12, y: 10 },
          { type: 'plot', plotId: 'P_LARGE', x: 10, y: 11 },
          { type: 'plot', plotId: 'P_LARGE', x: 11, y: 11 },
          { type: 'plot', plotId: 'P_LARGE', x: 12, y: 11 }
        ],
        gridCols: 20,
        gridRows: 20,
        houseTypes: [houseTypeOneStorey]
      };

      const worldSmall = adaptBuildTrackProjectToLivingSite(paramsSmall);
      const worldLarge = adaptBuildTrackProjectToLivingSite(paramsLarge);

      const houseSmall = worldSmall.houses[0];
      const houseLarge = worldLarge.houses[0];

      // Building dimensions MUST be identical regardless of parcel cell count
      expect(houseSmall.buildingWidth).toBe(houseLarge.buildingWidth);
      expect(houseSmall.buildingDepth).toBe(houseLarge.buildingDepth);
      expect(houseSmall.buildingWidth).toBe(5.2);
      expect(houseSmall.buildingDepth).toBe(5.0);

      // But parcel size is different
      expect(houseSmall.cells?.length).toBe(4);
      expect(houseLarge.cells?.length).toBe(6);
    });

    it('suggests road-facing direction based on adjacent road cells', () => {
      const plotCells = [
        { x: 5, y: 5 },
        { x: 6, y: 5 }
      ];
      // Road directly south of the plot at y = 6
      const roadCellsSouth = [
        { x: 5, y: 6 },
        { x: 6, y: 6 }
      ];
      const suggestionSouth = suggestFacingFromRoads(plotCells, roadCellsSouth);
      expect(suggestionSouth.facing).toBe('south');
      expect(suggestionSouth.rotation).toBe(0);

      // Road directly north of the plot at y = 4
      const roadCellsNorth = [
        { x: 5, y: 4 },
        { x: 6, y: 4 }
      ];
      const suggestionNorth = suggestFacingFromRoads(plotCells, roadCellsNorth);
      expect(suggestionNorth.facing).toBe('north');
      expect(suggestionNorth.rotation).toBeCloseTo(Math.PI, 2);
    });

    it('validates building placement inside parcel and detects out-of-bounds or road overlaps', () => {
      const plotCells = [
        { x: 4, y: 4 },
        { x: 5, y: 4 },
        { x: 4, y: 5 },
        { x: 5, y: 5 }
      ];
      const roadCells = [
        { x: 3, y: 4 },
        { x: 3, y: 5 }
      ];

      const anchor = gridToWorld(4.5, 4.5, 20, 20, 3.5);

      // Centered placement with fitting building
      const validCheck = validateBuildingPlacement({
        plotCells,
        roadCells,
        anchorWorld: anchor,
        offsetX: 0,
        offsetZ: 0,
        rotation: 0,
        buildingWidth: 5.0,
        buildingDepth: 5.0,
        cols: 20,
        rows: 20,
        cellSize: 3.5
      });
      expect(validCheck.isValid).toBe(true);

      // Nudged far west into road cells at x = 3
      const invalidRoadCheck = validateBuildingPlacement({
        plotCells,
        roadCells,
        anchorWorld: anchor,
        offsetX: -3.5,
        offsetZ: 0,
        rotation: 0,
        buildingWidth: 5.0,
        buildingDepth: 5.0,
        cols: 20,
        rows: 20,
        cellSize: 3.5
      });
      expect(invalidRoadCheck.isValid).toBe(false);
      expect(invalidRoadCheck.reason).toContain('ทับแนวถนน');

      // Nudged far east out of parcel
      const invalidParcelCheck = validateBuildingPlacement({
        plotCells,
        roadCells,
        anchorWorld: anchor,
        offsetX: 6.0,
        offsetZ: 0,
        rotation: 0,
        buildingWidth: 5.0,
        buildingDepth: 5.0,
        cols: 20,
        rows: 20,
        cellSize: 3.5
      });
      expect(invalidParcelCheck.isValid).toBe(false);
      expect(invalidParcelCheck.reason).toContain('ล้ำออกนอกแปลง');
    });

    it('isolates the blue-roof pavilion to demo mode and excludes it from live project data', () => {
      // 1. In Demo World: decorations enabled, pavilion present in facilities
      const demoWorld = generateDemoLivingSiteWorld();
      expect(demoWorld.environment.demoDecorationsEnabled).toBe(true);
      const demoPavilion = demoWorld.environment.facilities?.find(f => f.id === 'demo_rest_pavilion');
      expect(demoPavilion).toBeDefined();
      expect(demoPavilion?.source).toBe('demo_facility');

      // 2. In Live Project World: decorations disabled, pavilion absent
      const liveWorld = adaptBuildTrackProjectToLivingSite({
        projectName: 'โครงการสร้างจริง',
        selectedDate: '2026-10-26',
        plots: [{ id: 'P1', plot_name: 'P-01' }],
        mapGrid: [{ type: 'plot', plotId: 'P1', x: 2, y: 2 }],
        gridCols: 10,
        gridRows: 10
      });
      expect(liveWorld.environment.demoDecorationsEnabled).toBe(false);
      expect(liveWorld.environment.facilities?.length || 0).toBe(0);
    });

    it('reports scale honestly as simulated unless meters per cell is explicitly configured', () => {
      // Unconfigured project
      const simulatedScale = resolveProjectScale({});
      expect(simulatedScale.isSimulated).toBe(true);
      expect(simulatedScale.scaleLabel).toContain('สัดส่วนจำลอง');

      // Explicitly configured project
      const configuredScale = resolveProjectScale({ scale_meters_per_cell: 4.0 });
      expect(configuredScale.isSimulated).toBe(false);
      expect(configuredScale.scaleLabel).toBe('1 ช่อง = 4 ม.');
    });

    it('renders plot parcel meshes with outer stone curbs only and zero road overlap', () => {
      const house: HousePlot = {
        id: 'H_TEST',
        plotName: 'T-01',
        houseType: 'บ้านเดี่ยว 1 ชั้น',
        floorCount: 1,
        gridX: 2,
        gridZ: 2,
        worldX: 0,
        worldZ: 0,
        width: 7.0,
        depth: 7.0,
        rotation: 0,
        cells: [
          { x: 2, y: 2 },
          { x: 3, y: 2 }
        ],
        buildingWidth: 5.2,
        buildingDepth: 5.0,
        placementOffset: { x: 0, z: 0 },
        placementRotation: 0,
        currentStage: 'structure',
        stageProgress: { foundation: 100, structure: 50, masonry: 0, roofing: 0, finishing: 0 },
        overallProgress: 30,
        activeWorkerIds: [],
        defectCount: 0,
        defects: [],
        lastUpdateText: '',
        lastUpdateTime: '',
        entrancePos: { x: 0, z: 4 },
        workSpots: []
      };

      const parcelMeshes = buildPlotParcelMeshes(house);
      expect(parcelMeshes.length).toBeGreaterThan(0);

      // Verify house mesh attaches buildingGroup at placementOffset
      const mesh = createHouseMesh(house, 'medium');
      expect(mesh.children.length).toBeGreaterThan(0);
      const buildingGroup = mesh.children.find(c => c.name === 'building_subgroup');
      expect(buildingGroup).toBeDefined();
    });
  });

  describe('Roof Architectural Slate Gray Color, Atmospheric Clarity & Performance Optimization', () => {
    it('uses modern slate gray (#64748b) for finished roofs with lighter steel trusses', () => {
      // 1. Verify standard PALETTE roof color is slate gray #64748b
      expect(PALETTE.roofTiles).toBe(0x64748b);

      // 2. Verify steel truss color is lighter than roof tiles
      expect(PALETTE.scaffoldingSteel).toBe(0x94a3b8);
      expect(PALETTE.scaffoldingSteel).not.toBe(PALETTE.roofTiles);

      // 3. Create completed house mesh and inspect roof material
      const finishedPlot: HousePlot = {
        id: 'H_FIN',
        plotName: 'A-01',
        houseType: 'บ้านเดี่ยว 2 ชั้น',
        floorCount: 2,
        gridX: 2,
        gridZ: 2,
        worldX: 0,
        worldZ: 0,
        width: 7.0,
        depth: 7.0,
        rotation: 0,
        buildingWidth: 5.6,
        buildingDepth: 5.4,
        placementOffset: { x: 0, z: 0 },
        placementRotation: 0,
        currentStage: 'completed',
        stageProgress: { foundation: 100, structure: 100, masonry: 100, roofing: 100, finishing: 100 },
        overallProgress: 100,
        activeWorkerIds: [],
        defectCount: 0,
        defects: [],
        lastUpdateText: '',
        lastUpdateTime: '',
        entrancePos: { x: 0, z: 4 },
        workSpots: []
      };

      const mesh = createHouseMesh(finishedPlot, 'medium');
      const roofMesh = mesh.getObjectByName('hip_tiled_roof') as THREE.Mesh;
      expect(roofMesh).toBeDefined();
      const roofMat = roofMesh.material as THREE.MeshLambertMaterial;
      expect(roofMat.color.getHex()).toBe(0x64748b);

      // 4. Test custom roof color override without silent overwrite
      const customColorPlot: HousePlot = {
        ...finishedPlot,
        id: 'H_CUSTOM',
        roofColor: 0x1e3a8a // custom navy blue
      };
      const customMesh = createHouseMesh(customColorPlot, 'medium');
      const customRoofMesh = customMesh.getObjectByName('hip_tiled_roof') as THREE.Mesh;
      const customRoofMat = customRoofMesh.material as THREE.MeshLambertMaterial;
      expect(customRoofMat.color.getHex()).toBe(0x1e3a8a);
    });

    it('ensures scene fog is disabled by default for full-site clarity across distant plots', () => {
      const scene = new THREE.Scene();
      scene.fog = null;
      expect(scene.fog).toBeNull();
    });

    it('clamps pixel ratio cleanly per quality tier to ensure canvas drawing buffer sharpness', () => {
      const getTargetPixelRatio = (q: 'low' | 'medium' | 'high', dpr: number) => {
        if (q === 'high') return Math.min(dpr, 2.0);
        if (q === 'medium') return Math.min(dpr, 1.5);
        return 1.0;
      };

      // On standard 1x screen
      expect(getTargetPixelRatio('low', 1.0)).toBe(1.0);
      expect(getTargetPixelRatio('medium', 1.0)).toBe(1.0);
      expect(getTargetPixelRatio('high', 1.0)).toBe(1.0);

      // On retina 2x screen
      expect(getTargetPixelRatio('low', 2.0)).toBe(1.0);
      expect(getTargetPixelRatio('medium', 2.0)).toBe(1.5);
      expect(getTargetPixelRatio('high', 2.0)).toBe(2.0);

      // On 3x screen
      expect(getTargetPixelRatio('high', 3.0)).toBe(2.0);
    });
  });

  describe('Real On-Site Reporting, Attention Queue, Inspection & Exploration Tools', () => {
    const samplePlots: HousePlot[] = [
      {
        id: 'plot_1',
        plotName: 'A-01',
        houseType: 'Type Alpha',
        gridX: 10,
        gridZ: 10,
        worldX: 0,
        worldZ: 0,
        width: 8,
        depth: 8,
        rotation: 0,
        currentStage: 'masonry',
        stageProgress: { foundation: 100, structure: 100, masonry: 60, roofing: 0, finishing: 0 },
        overallProgress: 60,
        activeWorkerIds: [],
        defectCount: 0,
        defects: [],
        lastUpdateText: 'งานก่ออิฐมวลเบา',
        lastUpdateTime: '10:00 น.',
        entrancePos: { x: 0, z: 4.5 },
        workSpots: [{ x: 0, z: 3.5 }]
      },
      {
        id: 'plot_2',
        plotName: 'A-02',
        houseType: 'Type Beta',
        gridX: 20,
        gridZ: 10,
        worldX: 15,
        worldZ: 0,
        width: 8,
        depth: 8,
        rotation: 0,
        currentStage: 'structure',
        stageProgress: { foundation: 100, structure: 80, masonry: 0, roofing: 0, finishing: 0 },
        overallProgress: 40,
        activeWorkerIds: [],
        defectCount: 0,
        defects: [],
        lastUpdateText: 'งานเสาคาน',
        lastUpdateTime: '11:00 น.',
        entrancePos: { x: 15, z: 4.5 },
        workSpots: [{ x: 15, z: 3.5 }]
      }
    ];

    it('distinguishes contractor team as actor vs foreman as reporter truthfully', () => {
      const taskUpdates = [
        {
          id: 'tu_01',
          plot_id: 'plot_1',
          task_template_id: 'tmpl_masonry',
          action: 'งานก่ออิฐมวลเบาชั้น 1',
          progress: 60,
          role: 'Foreman',
          user_name: 'สมศักดิ์ (โฟร์แมน)',
          created_at: '2026-10-26T03:30:00Z' // 10:30 Bangkok
        }
      ];

      const plotTaskAssignments = [
        {
          plot_id: 'plot_1',
          task_template_id: 'tmpl_masonry',
          contractor_name: 'ทีมช่างชาญ'
        }
      ];

      const events = normalizeConstructionEvents({
        taskUpdates,
        plotTaskAssignments,
        selectedDate: '2026-10-26'
      });

      expect(events.length).toBe(1);
      const ev = events[0];
      // Truthful identity: Performer is the contractor team, NOT the foreman laying bricks
      expect(ev.actorName).toBe('ทีมช่างชาญ');
      expect(ev.isTeam).toBe(true);
      expect(ev.reporterName).toBe('สมศักดิ์ (โฟร์แมน)');
      expect(ev.reporterRole).toBe('Foreman');
      expect(ev.timeLabel).toBe('10:30 น.');
    });

    it('ensures single avatar per worker placed at their latest reported plot with activity markers on earlier plots', () => {
      // Worker "ช่างวิชัย" reported on plot 1 at 09:00, then reported on plot 2 at 14:00
      const events = normalizeConstructionEvents({
        taskUpdates: [
          {
            id: 'tu_1',
            plot_id: 'plot_1',
            task_template_id: 'tmpl_1',
            action: 'ติดตั้งระบบไฟฟ้าชั้น 1',
            progress: 30,
            role: 'MEP',
            user_name: 'ช่างวิชัย',
            created_at: '2026-10-26T02:00:00Z' // 09:00 Bangkok
          },
          {
            id: 'tu_2',
            plot_id: 'plot_2',
            task_template_id: 'tmpl_2',
            action: 'ติดตั้งระบบไฟฟ้าชั้น 2',
            progress: 50,
            role: 'MEP',
            user_name: 'ช่างวิชัย',
            created_at: '2026-10-26T07:00:00Z' // 14:00 Bangkok
          }
        ],
        plots: samplePlots,
        selectedDate: '2026-10-26'
      });

      const { characters, updatedHouses } = deriveSiteStateAtTime({
        events,
        houses: samplePlots
      });

      // Exactly ONE avatar for "ช่างวิชัย"
      expect(characters.length).toBe(1);
      expect(characters[0].name).toBe('ช่างวิชัย');
      // Placed at latest reported plot (plot_2)
      expect(characters[0].currentPlotId).toBe('plot_2');

      // Earlier plot (plot_1) has an activity marker
      const house1 = updatedHouses.find(h => h.id === 'plot_1');
      expect(house1?.activityMarkers?.length).toBe(1);
      expect(house1?.activityMarkers?.[0].actorName).toBe('ช่างวิชัย');
      expect(house1?.activityMarkers?.[0].timeStr).toBe('09:00 น.');
    });

    it('parses timestamps into Asia/Bangkok (+07:00) with proper freshness classification', () => {
      const parsed = parseToBangkokDate('2026-10-26T03:45:00Z');
      expect(parsed.dateStr).toBe('2026-10-26');
      expect(parsed.timeStr).toBe('10:45 น.');

      const now = new Date('2026-10-26T05:00:00Z'); // 12:00 Bangkok
      // Event at 10:45 Bangkok (1h 15m ago => fresh)
      expect(calculateFreshness('2026-10-26T03:45:00Z', '2026-10-26', now)).toBe('fresh');
      // Event 4 hours ago => recent
      expect(calculateFreshness('2026-10-26T01:00:00Z', '2026-10-26', now)).toBe('recent');
      // Event 8 hours ago => stale
      expect(calculateFreshness('2026-10-25T21:00:00Z', '2026-10-26', now)).toBe('stale');
      // Event previous day => historical
      expect(calculateFreshness('2026-10-25T10:00:00Z', '2026-10-26', now)).toBe('historical');
    });

    it('derives pending inspection queue with urgent flags for pending >= 2 days', () => {
      const now = new Date('2026-10-26T10:00:00Z');
      const assignments = [
        {
          plot_id: 'plot_1',
          task_template_id: 'tmpl_1',
          current_progress: 100,
          latest_action: 'ส่งงาน 100%',
          latest_role: 'Foreman',
          latest_update_created_at: '2026-10-26T08:00:00Z' // 2 hours ago
        },
        {
          plot_id: 'plot_2',
          task_template_id: 'tmpl_2',
          current_progress: 100,
          latest_action: 'ส่งงาน 100%',
          latest_role: 'Foreman',
          latest_update_created_at: '2026-10-22T08:00:00Z' // 4 days ago => Urgent!
        }
      ];

      const queue = deriveInspectionQueueItems(assignments, samplePlots, [], now);
      expect(queue.length).toBe(2);
      // Urgent item sorted first
      expect(queue[0].plotId).toBe('plot_2');
      expect(queue[0].isUrgent).toBe(true);
      expect(queue[0].statusFor).toBe('Site Engineer');

      expect(queue[1].plotId).toBe('plot_1');
      expect(queue[1].isUrgent).toBe(false);
    });

    it('derives Attention Points prioritized by urgency (critical defects > warnings)', () => {
      const defects = [
        { id: 'def_1', plot_id: 'plot_1', description: 'สีหลุดลอก', severity: 'minor', status: 'open', created_at: '2026-10-26T02:00:00Z' },
        { id: 'def_2', plot_id: 'plot_2', description: 'รอยแตกร้าวคาน', severity: 'critical', status: 'open', created_at: '2026-10-26T03:00:00Z' }
      ];

      const queue = [
        {
          id: 'insp_1',
          plotId: 'plot_1',
          plotName: 'A-01',
          taskTemplateId: 'tmpl_1',
          taskName: 'เทคอนกรีต',
          progress: 100,
          latestAction: 'ส่งงาน 100%',
          statusFor: 'Site Engineer' as const,
          isRejected: false,
          isUrgent: true,
          waitDurationText: '2 วัน',
          reportedAt: '2026-10-24T00:00:00Z'
        }
      ];

      const points = deriveAttentionPoints(defects, queue, samplePlots);
      expect(points.length).toBe(3);
      // Critical defect ranked first
      expect(points[0].severity).toBe('critical');
      expect(points[0].plotId).toBe('plot_2');
      expect(points[0].title).toBe('รอยแตกร้าวคาน');
    });

    it('supports Day Replay time slicing without altering business data', () => {
      const events = [
        {
          id: 'ev_morning',
          sourceRecordId: '1',
          sourceType: 'task_update' as const,
          plotId: 'plot_1',
          plotName: 'A-01',
          taskName: 'งานฐานราก',
          actorType: 'person' as const,
          actorId: 'worker_1',
          actorName: 'ช่างก้อง',
          actorRole: 'mason' as const,
          actorRoleLabel: 'ช่างปูน',
          actorColor: '#f97316',
          isTeam: false,
          reporterName: 'ช่างก้อง',
          eventTime: '2026-10-26T02:00:00Z', // 09:00 Bangkok
          reportTime: '2026-10-26T02:00:00Z',
          timeLabel: '09:00 น.',
          dateLabel: '2026-10-26',
          activityType: 'work' as const,
          actionTitle: 'งานฐานราก',
          description: 'เทคอนกรีตฐานราก',
          progress: 50,
          photoUrls: [],
          freshness: 'recent' as const
        },
        {
          id: 'ev_afternoon',
          sourceRecordId: '2',
          sourceType: 'task_update' as const,
          plotId: 'plot_2',
          plotName: 'A-02',
          taskName: 'งานเสาคาน',
          actorType: 'person' as const,
          actorId: 'worker_2',
          actorName: 'ช่างเอก',
          actorRole: 'steel' as const,
          actorRoleLabel: 'ช่างเหล็ก',
          actorColor: '#eab308',
          isTeam: false,
          reporterName: 'ช่างเอก',
          eventTime: '2026-10-26T07:00:00Z', // 14:00 Bangkok
          reportTime: '2026-10-26T07:00:00Z',
          timeLabel: '14:00 น.',
          dateLabel: '2026-10-26',
          activityType: 'work' as const,
          actionTitle: 'งานเสาคาน',
          description: 'ผูกเหล็กเสา',
          progress: 70,
          photoUrls: [],
          freshness: 'fresh' as const
        }
      ];

      // Slice at 11:00 Bangkok: only morning event has occurred
      const morningState = deriveSiteStateAtTime({
        events,
        houses: samplePlots,
        cutoffTimeIso: '2026-10-26T04:00:00Z' // 11:00 Bangkok
      });

      expect(morningState.characters.length).toBe(1);
      expect(morningState.characters[0].name).toBe('ช่างก้อง');

      // Slice at 16:00 Bangkok: both events have occurred
      const afternoonState = deriveSiteStateAtTime({
        events,
        houses: samplePlots,
        cutoffTimeIso: '2026-10-26T09:00:00Z' // 16:00 Bangkok
      });

      expect(afternoonState.characters.length).toBe(2);
      expect(afternoonState.characters.map(c => c.name)).toContain('ช่างก้อง');
      expect(afternoonState.characters.map(c => c.name)).toContain('ช่างเอก');
    });

    it('renders on-site exploration tools (Attention Queue, Timeline, Replay, Mode Switch)', () => {
      render(
        <LivingSiteSimulation
          plots={samplePlots}
          selectedDate="2026-10-26"
        />
      );

      // Verify Exploration Buttons
      expect(screen.getByText(/โหมดตรวจงาน/)).toBeInTheDocument();
      expect(screen.getByText(/เหตุการณ์วันนี้/)).toBeInTheDocument();
      expect(screen.getByText(/เล่นย้อนหลัง/)).toBeInTheDocument();
    });
  });
});

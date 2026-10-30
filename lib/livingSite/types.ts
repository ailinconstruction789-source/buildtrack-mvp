/**
 * Living Construction Site - Type Definitions
 * Represents the decoupled world data model, simulation states,
 * procedural building stages, characters, and navigation.
 */

export type BuildingStageName =
  | 'foundation' // ฐานราก/ตอม่อ
  | 'structure'  // เสาและคาน
  | 'masonry'    // ผนังและงานก่อฉาบ
  | 'roofing'    // โครงสร้างหลังคาและมุงกระเบื้อง
  | 'finishing'  // ประตู หน้าต่าง ทาสี งานสถาปัตย์
  | 'completed'; // บ้านสร้างเสร็จสมบูรณ์

export interface StageProgress {
  foundation: number; // 0 - 100%
  structure: number;  // 0 - 100%
  masonry: number;    // 0 - 100%
  roofing: number;    // 0 - 100%
  finishing: number;  // 0 - 100%
}

export type BusinessState =
  | 'unassigned'         // ยังไม่ได้รับมอบหมาย
  | 'assigned'           // ได้รับมอบหมายแล้ว (รอเริ่ม)
  | 'in_progress'        // กำลังดำเนินการ
  | 'resting'            // กำลังพัก
  | 'waiting_material'   // รอวัสดุ
  | 'waiting_inspection' // รอตอบรับการตรวจ
  | 'inspecting'         // กำลังตรวจงาน
  | 'blocked'            // ติดปัญหา / ดีเฟกต์
  | 'completed';         // เสร็จสมบูรณ์

export type SimulationActivity =
  | 'idle'               // ยืนพัก/พูดคุย
  | 'walking'            // กำลังเดินตามเส้นทางนำทาง A*
  | 'working_trowel'     // ฉาบปูน/ก่ออิฐ
  | 'working_hammer'     // ตอกตะปู/ขึ้นโครงสร้าง
  | 'working_inspect'    // ถือคลิปบอร์ด/ตรวจงาน
  | 'resting'            // นั่งพักที่ศาลาพักคนงาน
  | 'waiting_material'   // ยืนรอตรวจสต็อกที่ลานวัสดุ
  | 'blocked_warning';   // ติดขัดมีข้อความเตือน

export type WorkerRole =
  | 'foreman'    // โฟร์แมนควบคุมงาน (หมวกขาว)
  | 'engineer'   // วิศวกรโครงการ (หมวกขาว + แท็บเล็ต)
  | 'qc'         // ฝ่ายตรวจสอบคุณภาพ (หมวกเขียว + คลิปบอร์ด)
  | 'mason'      // ช่างก่อ/ฉาบ (หมวกเหลือง/ส้ม)
  | 'carpenter'  // ช่างไม้/โครงสร้าง (หมวกเหลือง)
  | 'steel'      // ช่างเหล็ก (หมวกเหลือง)
  | 'mep';       // ช่างระบบไฟฟ้า/ประปา (หมวกน้ำเงิน)

export type SiteFreshness = 'fresh' | 'recent' | 'stale' | 'historical';

export type ActivityEventType =
  | 'work'              // รายงานความคืบหน้างานก่อสร้าง
  | 'inspection_req'    // ส่งงาน 100% รอวิศวกร/QC ตรวจ
  | 'inspection_pass'   // ผ่านการตรวจสอบ
  | 'inspection_reject' // ไม่ผ่านการตรวจ / แจ้งแก้ไข
  | 'defect_new'        // เปิดรายการดีเฟกต์ใหม่
  | 'defect_fix'        // กำลังแก้ไขดีเฟกต์
  | 'defect_done';      // ปิดรายการดีเฟกต์

export interface ActivityMarker {
  id: string;
  plotId: string;
  actorId: string;
  actorName: string;
  role: WorkerRole;
  timeStr: string;
  timeIso: string;
  actionText: string;
  reporterName?: string;
  isTeam?: boolean;
}

export interface InspectionQueueItem {
  id: string;
  plotId: string;
  plotName: string;
  taskTemplateId: string;
  taskName: string;
  progress: number;
  latestAction: string;
  statusFor: 'Site Engineer' | 'QC' | 'Rework';
  isRejected: boolean;
  isUrgent: boolean;
  waitDurationText: string;
  reportedAt: string;
  reporterName?: string;
  contractorName?: string;
}

export interface AttentionPoint {
  id: string;
  plotId: string;
  plotName: string;
  type: 'defect' | 'pending_inspection' | 'rework' | 'blocked';
  title: string;
  subtitle: string;
  severity: 'critical' | 'warning' | 'info';
  waitDurationText: string;
  targetTaskId?: string;
  timestamp: string;
}

export interface SiteActivityEvent {
  id: string;
  sourceRecordId: string;
  sourceType: 'task_update' | 'defect' | 'inspection_queue' | 'assignment';
  plotId: string;
  plotName: string;
  taskTemplateId?: string;
  taskName: string;
  // Truthful Actor & Reporter separation:
  actorType: 'person' | 'team';
  actorId: string;
  actorName: string;
  actorRole: WorkerRole;
  actorRoleLabel: string;
  actorColor: string;
  isTeam: boolean;
  teamName?: string;
  reporterName: string;
  reporterRole?: string;
  isUnknownTeam?: boolean;
  // Timestamps (Bangkok UTC+7)
  eventTime: string; // ISO string of event
  reportTime: string; // ISO string of submission
  timeLabel: string; // Formatted 'HH:mm น.'
  dateLabel: string; // 'YYYY-MM-DD' in Asia/Bangkok
  // Action details
  activityType: ActivityEventType;
  actionTitle: string;
  description: string;
  progress?: number;
  isWorkerPresent?: boolean;
  photoUrls: string[];
  freshness: SiteFreshness;
}

export type SiteDisplayMode = 'presentation' | 'inspection';

export interface NavPoint {
  x: number;
  z: number;
}

export interface NavNode {
  gx: number;
  gz: number;
  walkable: boolean;
  cost: number;
  type: 'road' | 'path' | 'grass' | 'obstacle' | 'building' | 'workspot' | 'rest' | 'storage';
}

export interface SiteCharacter {
  id: string;
  name: string;
  role: WorkerRole;
  roleLabel: string;
  teamId: string;
  teamName: string;
  color: string;
  currentPlotId?: string;
  targetPlotId?: string;
  // World spatial coordinates
  x: number;
  y: number;
  z: number;
  rotationY: number;
  // Simulation & Business State
  businessState: BusinessState;
  simActivity: SimulationActivity;
  // Navigation
  path: NavPoint[];
  pathIndex: number;
  speed: number;
  targetPos?: NavPoint;
  // Work detail & UI metadata
  taskName: string;
  actionDetail: string;
  speechText: string;
  lastReportTime: string;
  photoUrl?: string;
  isSimulated: boolean;
  reporterName?: string;
  isTeam?: boolean;
  actorType?: 'person' | 'team';
  isUnknownTeam?: boolean;
  freshness?: SiteFreshness;
  sourceEventId?: string;
}

export interface SiteTeam {
  id: string;
  name: string;
  trade: string;
  leaderName: string;
  leaderRole: WorkerRole;
  color: string;
  assignedPlotId?: string;
  businessState: BusinessState;
  memberCount: number;
}

export interface HousePlot {
  id: string;
  plotName: string;
  houseType: string;
  houseTypeId?: string | number;
  floorCount?: number | null; // 1 = Single storey, 2 = Two storeys, null = Unspecified
  stageDetailsComplete?: boolean; // Truthful flag: whether stage detail has per-floor breakdown
  // 2D Grid cells belonging to this plot parcel
  cells?: { x: number; y: number }[];
  isFragmented?: boolean;
  // Spatial anchor of the plot parcel
  gridX: number;
  gridZ: number;
  worldX: number;
  worldZ: number;
  width: number;
  depth: number;
  rotation: number;
  parcelCenterX?: number;
  parcelCenterZ?: number;
  parcelWidth?: number;
  parcelDepth?: number;
  // Decoupled Building Dimensions (from house_type, NOT plot size)
  buildingWidth?: number;
  buildingDepth?: number;
  isBuildingDimensionEstimated?: boolean;
  buildingDimensionLabel?: string;
  roofColor?: string | number;
  // Placed building world coordinates & relative offsets
  buildingWorldX?: number;
  buildingWorldZ?: number;
  placementOffset?: { x: number; z: number };
  placementRotation?: number;
  facingDirection?: 'north' | 'east' | 'south' | 'west';
  isPlacementValid?: boolean;
  placementViolationText?: string;
  // Construction stage
  currentStage: BuildingStageName;
  stageProgress: StageProgress;
  overallProgress: number; // 0 - 100%
  // Associated entities
  assignedTeamId?: string;
  assignedTeamName?: string;
  activeWorkerIds: string[];
  defectCount: number;
  defects: {
    id: string;
    title: string;
    severity: 'minor' | 'major' | 'critical';
    status: 'open' | 'in_progress' | 'resolved';
  }[];
  lastUpdateText: string;
  lastUpdateTime: string;
  latestPhotoUrl?: string;
  // Inspection & Exploration cues
  pendingInspections?: InspectionQueueItem[];
  activityMarkers?: ActivityMarker[];
  hasPendingInspection?: boolean;
  hasOpenDefects?: boolean;
  hasRework?: boolean;
  attentionPriority?: 'critical' | 'warning' | 'info' | null;
  // Access points
  entrancePos: NavPoint;
  workSpots: NavPoint[];
}

export interface GridCellInfo {
  gx: number;
  gy: number;
  worldX: number;
  worldZ: number;
  adj?: { top: boolean; bottom: boolean; left: boolean; right: boolean };
}

export interface SiteFacility {
  id: string;
  name: string;
  type: string;
  worldX: number;
  worldZ: number;
  width: number;
  depth: number;
  isDemo: boolean;
  source: 'demo_facility' | 'project_infrastructure';
  description?: string;
}

export interface SiteEnvironment {
  width: number;
  depth: number;
  gridCols?: number;
  gridRows?: number;
  cellSize?: number;
  scaleMetersPerCell?: number | null;
  scaleLabel?: string;
  isScaleSimulated?: boolean;
  // Real grid cells from mapGrid
  roadCells?: GridCellInfo[];
  parkCells?: GridCellInfo[];
  unassignedCells?: GridCellInfo[];
  demoDecorationsEnabled?: boolean;
  facilities?: SiteFacility[];
  restArea: {
    x: number;
    z: number;
    width: number;
    depth: number;
    label: string;
  };
  storageArea: {
    x: number;
    z: number;
    width: number;
    depth: number;
    label: string;
  };
  entranceGate: {
    x: number;
    z: number;
    label: string;
  };
  roads: {
    startX: number;
    startZ: number;
    endX: number;
    endZ: number;
    width: number;
  }[];
  trees: { x: number; z: number; scale: number }[];
  scaffoldings: { x: number; z: number; plotId: string }[];
  materialPallets: { x: number; z: number; type: 'bricks' | 'rebar' | 'timber' | 'pipes' }[];
}

export interface HousePlacementConfig {
  plotId: string;
  offsetX: number;
  offsetZ: number;
  rotation: number;
  facing: 'north' | 'east' | 'south' | 'west';
}

export interface LivingSiteWorld {
  projectName: string;
  dateStr: string;
  isDemoMode: boolean;
  environment: SiteEnvironment;
  houses: HousePlot[];
  characters: SiteCharacter[];
  teams: SiteTeam[];
  updatedAt: string;
  events?: SiteActivityEvent[];
  attentionPoints?: AttentionPoint[];
  pendingInspections?: InspectionQueueItem[];
}

export type GraphicQuality = 'low' | 'medium' | 'high';

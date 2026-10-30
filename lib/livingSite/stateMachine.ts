import {
  SiteCharacter,
  BusinessState,
  SimulationActivity,
  NavPoint,
  HousePlot,
  SiteEnvironment
} from './types';
import { NavigationGrid } from './navigation';

/**
 * State Machine and Simulation Engine.
 * Governs character behaviors, path progression, business transitions,
 * and realistic speech/action messages.
 */
export class SimulationStateMachine {
  private navGrid: NavigationGrid;
  private environment: SiteEnvironment;
  private houses: HousePlot[];

  constructor(navGrid: NavigationGrid, environment: SiteEnvironment, houses: HousePlot[]) {
    this.navGrid = navGrid;
    this.environment = environment;
    this.houses = houses;
  }

  public updateWorld(houses: HousePlot[], environment: SiteEnvironment) {
    this.houses = houses;
    this.environment = environment;
  }

  /**
   * Update character simulation for a frame tick (dt in seconds).
   */
  public updateCharacter(
    char: SiteCharacter,
    dt: number,
    onSpeechChange?: (text: string) => void
  ): SiteCharacter {
    const updated = { ...char };

    // 1. If character has a path and is walking, move them along waypoints
    if (updated.path && updated.path.length > 0 && updated.pathIndex < updated.path.length) {
      const targetWaypoint = updated.path[updated.pathIndex];
      const dx = targetWaypoint.x - updated.x;
      const dz = targetWaypoint.z - updated.z;
      const dist = Math.hypot(dx, dz);

      // Facing direction
      if (dist > 0.05) {
        updated.rotationY = Math.atan2(dx, dz);
      }

      const moveStep = updated.speed * dt;

      if (dist <= moveStep) {
        // Reached current waypoint
        updated.x = targetWaypoint.x;
        updated.z = targetWaypoint.z;
        updated.pathIndex++;

        // If completed all waypoints
        if (updated.pathIndex >= updated.path.length) {
          updated.path = [];
          updated.pathIndex = 0;
          this.onArrivedAtDestination(updated);
        }
      } else {
        // Step forward along path
        updated.x += (dx / dist) * moveStep;
        updated.z += (dz / dist) * moveStep;
        updated.simActivity = 'walking';
      }
      return updated;
    }

    // 2. Stationary Activity behaviors
    this.updateStationaryActivity(updated, dt);

    return updated;
  }

  /**
   * Called when character reaches final waypoint of their current route.
   */
  private onArrivedAtDestination(char: SiteCharacter) {
    switch (char.businessState) {
      case 'in_progress':
        // Determine tool activity from role
        if (char.role === 'qc' || char.role === 'engineer' || char.role === 'foreman') {
          char.simActivity = 'working_inspect';
          char.speechText = 'ตรวจสอบความเรียบร้อยหน้างาน';
        } else if (char.role === 'mason') {
          char.simActivity = 'working_trowel';
          char.speechText = 'กำลังฉาบปูนและก่อผนัง';
        } else {
          char.simActivity = 'working_hammer';
          char.speechText = 'กำลังติดตั้งโครงสร้างและเหล็ก';
        }
        break;

      case 'resting':
        char.simActivity = 'resting';
        char.speechText = 'พักดื่มน้ำและคลายร้อน';
        break;

      case 'waiting_material':
        char.simActivity = 'waiting_material';
        char.speechText = 'รอรถขนส่งวัสดุและตรวจสต็อก';
        break;

      case 'waiting_inspection':
      case 'inspecting':
        char.simActivity = 'working_inspect';
        char.speechText = 'ถือแบบแปลนตรวจเช็กความถูกต้อง';
        break;

      case 'blocked':
        char.simActivity = 'blocked_warning';
        char.speechText = 'ติดปัญหาหน้างาน รอหัวหน้าสั่งการ';
        break;

      default:
        char.simActivity = 'idle';
        char.speechText = 'พร้อมปฏิบัติหน้าที่';
        break;
    }
  }

  /**
   * Handle stationary micro-actions, subtle fidgets, and periodic speech bubble changes.
   */
  private updateStationaryActivity(char: SiteCharacter, dt: number) {
    // If business state changed externally while idle, trigger routing
    if (char.businessState === 'resting' && char.simActivity !== 'resting') {
      this.routeToRestArea(char);
    } else if (char.businessState === 'waiting_material' && char.simActivity !== 'waiting_material') {
      this.routeToStorageArea(char);
    } else if (char.businessState === 'in_progress' && char.simActivity === 'resting') {
      if (char.targetPlotId) {
        this.routeToHouse(char, char.targetPlotId);
      }
    }
  }

  /**
   * Command character to route towards a specific house plot.
   */
  public routeToHouse(char: SiteCharacter, plotId: string): boolean {
    const house = this.houses.find(h => h.id === plotId || h.plotName === plotId);
    if (!house) return false;

    // Pick an available workspot or entrance
    const target = house.workSpots.length > 0 ? house.workSpots[0] : house.entrancePos;
    const path = this.navGrid.findPath({ x: char.x, z: char.z }, target);

    if (path.length > 0) {
      char.path = path;
      char.pathIndex = 0;
      char.targetPlotId = house.id;
      char.currentPlotId = undefined;
      char.simActivity = 'walking';
      char.speechText = `กำลังเดินทางไปแปลง ${house.plotName}`;
      return true;
    }
    return false;
  }

  /**
   * Command character to route towards the site rest pavilion.
   */
  public routeToRestArea(char: SiteCharacter): boolean {
    const rest = this.environment.restArea;
    // Offset slightly so workers don't pile on identical coordinate
    const offsetX = (Math.random() - 0.5) * (rest.width * 0.6);
    const offsetZ = (Math.random() - 0.5) * (rest.depth * 0.6);
    const target: NavPoint = { x: rest.x + offsetX, z: rest.z + offsetZ };

    const path = this.navGrid.findPath({ x: char.x, z: char.z }, target);
    if (path.length > 0) {
      char.path = path;
      char.pathIndex = 0;
      char.businessState = 'resting';
      char.simActivity = 'walking';
      char.speechText = 'เดินไปจุดพักคนงาน';
      return true;
    }
    return false;
  }

  /**
   * Command character to route towards the storage yard.
   */
  public routeToStorageArea(char: SiteCharacter): boolean {
    const storage = this.environment.storageArea;
    const offsetX = (Math.random() - 0.5) * (storage.width * 0.6);
    const offsetZ = (Math.random() - 0.5) * (storage.depth * 0.6);
    const target: NavPoint = { x: storage.x + offsetX, z: storage.z + offsetZ };

    const path = this.navGrid.findPath({ x: char.x, z: char.z }, target);
    if (path.length > 0) {
      char.path = path;
      char.pathIndex = 0;
      char.businessState = 'waiting_material';
      char.simActivity = 'walking';
      char.speechText = 'เดินทางไปลานเก็บวัสดุ';
      return true;
    }
    return false;
  }

  /**
   * Set business state with clean FSM validation and trigger appropriate actions.
   */
  public transitionBusinessState(char: SiteCharacter, newState: BusinessState) {
    if (char.businessState === newState) return;

    char.businessState = newState;

    switch (newState) {
      case 'resting':
        this.routeToRestArea(char);
        break;
      case 'waiting_material':
        this.routeToStorageArea(char);
        break;
      case 'in_progress':
        if (char.targetPlotId) {
          this.routeToHouse(char, char.targetPlotId);
        } else {
          char.simActivity = 'idle';
          char.speechText = 'ได้รับมอบหมายงานแล้ว';
        }
        break;
      case 'inspecting':
        if (char.targetPlotId) {
          this.routeToHouse(char, char.targetPlotId);
        } else {
          char.simActivity = 'working_inspect';
        }
        break;
      case 'blocked':
        char.path = [];
        char.pathIndex = 0;
        char.simActivity = 'blocked_warning';
        char.speechText = 'ติดปัญหาดีเฟกต์หน้างาน';
        break;
      case 'completed':
        char.simActivity = 'idle';
        char.speechText = 'งานประจำวันเสร็จสมบูรณ์';
        break;
      default:
        char.simActivity = 'idle';
        break;
    }
  }
}

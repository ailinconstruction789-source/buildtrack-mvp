import { NavPoint, NavNode, HousePlot, SiteEnvironment } from './types';

/**
 * 2D Navigation Grid and A* Pathfinding for Living Construction Site.
 * Characters walk strictly on walkable road/path/grass terrain and avoid
 * house footprints, fences, and obstacles.
 */
export class NavigationGrid {
  private width: number;
  private depth: number;
  private cellSize: number;
  private cols: number;
  private rows: number;
  private grid: NavNode[][];

  constructor(width: number, depth: number, cellSize: number = 1.0) {
    this.width = width;
    this.depth = depth;
    this.cellSize = cellSize;
    this.cols = Math.ceil(width / cellSize);
    this.rows = Math.ceil(depth / cellSize);
    this.grid = [];
    this.initGrid();
  }

  private initGrid() {
    this.grid = [];
    for (let gz = 0; gz < this.rows; gz++) {
      const row: NavNode[] = [];
      for (let gx = 0; gx < this.cols; gx++) {
        row.push({
          gx,
          gz,
          walkable: true,
          cost: 1.5, // default terrain (grass/field) cost
          type: 'grass'
        });
      }
      this.grid.push(row);
    }
  }

  /**
   * World to grid coordinate converter.
   * World center (0,0) maps to center of grid.
   */
  public worldToGrid(wx: number, wz: number): { gx: number; gz: number } {
    const halfW = this.width / 2;
    const halfD = this.depth / 2;
    const gx = Math.floor((wx + halfW) / this.cellSize);
    const gz = Math.floor((wz + halfD) / this.cellSize);
    return {
      gx: Math.max(0, Math.min(this.cols - 1, gx)),
      gz: Math.max(0, Math.min(this.rows - 1, gz))
    };
  }

  /**
   * Grid to world coordinate converter.
   */
  public gridToWorld(gx: number, gz: number): NavPoint {
    const halfW = this.width / 2;
    const halfD = this.depth / 2;
    return {
      x: (gx + 0.5) * this.cellSize - halfW,
      z: (gz + 0.5) * this.cellSize - halfD
    };
  }

  public isWalkable(gx: number, gz: number): boolean {
    if (gx < 0 || gx >= this.cols || gz < 0 || gz >= this.rows) return false;
    return this.grid[gz][gx].walkable;
  }

  /**
   * Bake environment and house obstacles into the navigation grid.
   */
  public bakeWorld(environment: SiteEnvironment, houses: HousePlot[]) {
    this.initGrid();

    // 1. Mark Roads from environment (either real roadCells or legacy road segments)
    if (environment.roadCells && environment.roadCells.length > 0) {
      const roadHalf = (environment.cellSize || 3.5) / 2;
      for (const rc of environment.roadCells) {
        const gMin = this.worldToGrid(rc.worldX - roadHalf, rc.worldZ - roadHalf);
        const gMax = this.worldToGrid(rc.worldX + roadHalf, rc.worldZ + roadHalf);
        for (let gz = gMin.gz; gz <= gMax.gz; gz++) {
          for (let gx = gMin.gx; gx <= gMax.gx; gx++) {
            if (gz >= 0 && gz < this.rows && gx >= 0 && gx < this.cols) {
              this.grid[gz][gx].walkable = true;
              this.grid[gz][gx].cost = 1.0;
              this.grid[gz][gx].type = 'road';
            }
          }
        }
      }
    } else if (environment.roads && environment.roads.length > 0) {
      for (const r of environment.roads) {
        const minX = Math.min(r.startX, r.endX) - r.width / 2;
        const maxX = Math.max(r.startX, r.endX) + r.width / 2;
        const minZ = Math.min(r.startZ, r.endZ) - r.width / 2;
        const maxZ = Math.max(r.startZ, r.endZ) + r.width / 2;

        const gStart = this.worldToGrid(minX, minZ);
        const gEnd = this.worldToGrid(maxX, maxZ);

        for (let gz = gStart.gz; gz <= gEnd.gz; gz++) {
          for (let gx = gStart.gx; gx <= gEnd.gx; gx++) {
            if (gz >= 0 && gz < this.rows && gx >= 0 && gx < this.cols) {
              this.grid[gz][gx].walkable = true;
              this.grid[gz][gx].cost = 1.0;
              this.grid[gz][gx].type = 'road';
            }
          }
        }
      }
    }

    // 2. Mark Park Cells (Walkable with gentle cost)
    if (environment.parkCells && environment.parkCells.length > 0) {
      const parkHalf = (environment.cellSize || 3.5) / 2;
      for (const pc of environment.parkCells) {
        const gMin = this.worldToGrid(pc.worldX - parkHalf, pc.worldZ - parkHalf);
        const gMax = this.worldToGrid(pc.worldX + parkHalf, pc.worldZ + parkHalf);
        for (let gz = gMin.gz; gz <= gMax.gz; gz++) {
          for (let gx = gMin.gx; gx <= gMax.gx; gx++) {
            if (gz >= 0 && gz < this.rows && gx >= 0 && gx < this.cols) {
              this.grid[gz][gx].walkable = true;
              this.grid[gz][gx].cost = 1.4;
              this.grid[gz][gx].type = 'grass';
            }
          }
        }
      }
    }

    // 3. Mark Special Zones (Only if demo decorations enabled or non-zero size)
    const markZone = (area: { x: number; z: number; width: number; depth: number }, type: 'rest' | 'storage') => {
      if (!area || area.width <= 0 || area.depth <= 0) return;
      const gMin = this.worldToGrid(area.x - area.width / 2, area.z - area.depth / 2);
      const gMax = this.worldToGrid(area.x + area.width / 2, area.z + area.depth / 2);
      for (let gz = gMin.gz; gz <= gMax.gz; gz++) {
        for (let gx = gMin.gx; gx <= gMax.gx; gx++) {
          if (gz >= 0 && gz < this.rows && gx >= 0 && gx < this.cols) {
            this.grid[gz][gx].walkable = true;
            this.grid[gz][gx].cost = 1.0;
            this.grid[gz][gx].type = type;
          }
        }
      }
    };
    if (environment.demoDecorationsEnabled) {
      markZone(environment.restArea, 'rest');
      markZone(environment.storageArea, 'storage');
    }

    // 4. Mark Placed Buildings as NON-walkable Obstacles
    // (Open plot lawn / setbacks remain walkable so workers can walk around)
    for (const house of houses) {
      const bCenterX = house.buildingWorldX ?? (house.worldX + (house.placementOffset?.x || 0));
      const bCenterZ = house.buildingWorldZ ?? (house.worldZ + (house.placementOffset?.z || 0));
      const bWidth = house.buildingWidth || house.width * 0.72;
      const bDepth = house.buildingDepth || house.depth * 0.72;

      // Inset footprint slightly so workers can walk right at exterior walls
      const halfW = (bWidth * 0.85) / 2;
      const halfD = (bDepth * 0.85) / 2;

      const gMin = this.worldToGrid(bCenterX - halfW, bCenterZ - halfD);
      const gMax = this.worldToGrid(bCenterX + halfW, bCenterZ + halfD);

      for (let gz = gMin.gz; gz <= gMax.gz; gz++) {
        for (let gx = gMin.gx; gx <= gMax.gx; gx++) {
          if (gz >= 0 && gz < this.rows && gx >= 0 && gx < this.cols) {
            this.grid[gz][gx].walkable = false;
            this.grid[gz][gx].cost = 999;
            this.grid[gz][gx].type = 'building';
          }
        }
      }

      // Ensure house entrance and workspots are explicitly WALKABLE
      const entGrid = this.worldToGrid(house.entrancePos.x, house.entrancePos.z);
      if (this.grid[entGrid.gz]?.[entGrid.gx]) {
        this.grid[entGrid.gz][entGrid.gx].walkable = true;
        this.grid[entGrid.gz][entGrid.gx].cost = 1.0;
        this.grid[entGrid.gz][entGrid.gx].type = 'workspot';
      }

      for (const sp of house.workSpots) {
        const spGrid = this.worldToGrid(sp.x, sp.z);
        if (this.grid[spGrid.gz]?.[spGrid.gx]) {
          this.grid[spGrid.gz][spGrid.gx].walkable = true;
          this.grid[spGrid.gz][spGrid.gx].cost = 1.0;
          this.grid[spGrid.gz][spGrid.gx].type = 'workspot';
        }
      }
    }
  }

  /**
   * Find nearest walkable grid cell if a target happens to be blocked.
   */
  public findNearestWalkable(gx: number, gz: number, maxRadius: number = 8): { gx: number; gz: number } {
    if (this.isWalkable(gx, gz)) return { gx, gz };

    for (let r = 1; r <= maxRadius; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) === r || Math.abs(dz) === r) {
            const nx = gx + dx;
            const nz = gz + dz;
            if (this.isWalkable(nx, nz)) {
              return { gx: nx, gz: nz };
            }
          }
        }
      }
    }
    return { gx, gz };
  }

  /**
   * A* Pathfinding from world start to world target.
   */
  public findPath(startPos: NavPoint, targetPos: NavPoint): NavPoint[] {
    const startGrid = this.worldToGrid(startPos.x, startPos.z);
    let targetGrid = this.worldToGrid(targetPos.x, targetPos.z);

    if (!this.isWalkable(targetGrid.gx, targetGrid.gz)) {
      targetGrid = this.findNearestWalkable(targetGrid.gx, targetGrid.gz);
    }

    if (startGrid.gx === targetGrid.gx && startGrid.gz === targetGrid.gz) {
      return [{ x: targetPos.x, z: targetPos.z }];
    }

    interface AStarNode {
      gx: number;
      gz: number;
      g: number;
      h: number;
      f: number;
      parent?: AStarNode;
    }

    const key = (x: number, z: number) => `${x},${z}`;
    const openSet: Map<string, AStarNode> = new Map();
    const closedSet: Set<string> = new Set();

    const heuristic = (ax: number, az: number, bx: number, bz: number) => {
      const dx = Math.abs(ax - bx);
      const dz = Math.abs(az - bz);
      // Octile distance heuristic
      return (dx + dz) + (Math.SQRT2 - 2) * Math.min(dx, dz);
    };

    const startNode: AStarNode = {
      gx: startGrid.gx,
      gz: startGrid.gz,
      g: 0,
      h: heuristic(startGrid.gx, startGrid.gz, targetGrid.gx, targetGrid.gz),
      f: 0
    };
    startNode.f = startNode.h;
    openSet.set(key(startGrid.gx, startGrid.gz), startNode);

    // 8-directional neighbors: straight (1) & diagonal (sqrt2)
    const neighbors = [
      { dx: 1, dz: 0, dist: 1.0 },
      { dx: -1, dz: 0, dist: 1.0 },
      { dx: 0, dz: 1, dist: 1.0 },
      { dx: 0, dz: -1, dist: 1.0 },
      { dx: 1, dz: 1, dist: 1.414 },
      { dx: -1, dz: 1, dist: 1.414 },
      { dx: 1, dz: -1, dist: 1.414 },
      { dx: -1, dz: -1, dist: 1.414 }
    ];

    let closestNode = startNode;
    let iterations = 0;
    const maxIterations = 2000;

    while (openSet.size > 0 && iterations++ < maxIterations) {
      // Pick node with lowest f
      let current: AStarNode | null = null;
      for (const node of openSet.values()) {
        if (!current || node.f < current.f) {
          current = node;
        }
      }

      if (!current) break;

      if (current.gx === targetGrid.gx && current.gz === targetGrid.gz) {
        // Goal reached!
        return this.reconstructPath(current, targetPos);
      }

      const currKey = key(current.gx, current.gz);
      openSet.delete(currKey);
      closedSet.add(currKey);

      if (current.h < closestNode.h) {
        closestNode = current;
      }

      for (const offset of neighbors) {
        const nx = current.gx + offset.dx;
        const nz = current.gz + offset.dz;
        const nKey = key(nx, nz);

        if (closedSet.has(nKey)) continue;
        if (!this.isWalkable(nx, nz)) continue;

        // Prevent corner cutting if both orthogonal neighbors are blocked
        if (offset.dx !== 0 && offset.dz !== 0) {
          if (!this.isWalkable(current.gx + offset.dx, current.gz) ||
              !this.isWalkable(current.gx, current.gz + offset.dz)) {
            continue;
          }
        }

        const terrainCost = this.grid[nz][nx].cost;
        const tentativeG = current.g + offset.dist * terrainCost;

        let neighborNode = openSet.get(nKey);
        if (!neighborNode) {
          neighborNode = {
            gx: nx,
            gz: nz,
            g: tentativeG,
            h: heuristic(nx, nz, targetGrid.gx, targetGrid.gz),
            f: 0,
            parent: current
          };
          neighborNode.f = neighborNode.g + neighborNode.h;
          openSet.set(nKey, neighborNode);
        } else if (tentativeG < neighborNode.g) {
          neighborNode.g = tentativeG;
          neighborNode.f = neighborNode.g + neighborNode.h;
          neighborNode.parent = current;
        }
      }
    }

    // Fallback to closest reached node if complete path is not found
    return this.reconstructPath(closestNode, targetPos);
  }

  private reconstructPath(endNode: any, finalTarget: NavPoint): NavPoint[] {
    const waypoints: NavPoint[] = [];
    let cur = endNode;
    while (cur) {
      waypoints.unshift(this.gridToWorld(cur.gx, cur.gz));
      cur = cur.parent;
    }

    if (waypoints.length > 0) {
      const targetGrid = this.worldToGrid(finalTarget.x, finalTarget.z);
      // Only snap to finalTarget if the target cell is actually walkable (never warp into buildings)
      if (this.isWalkable(targetGrid.gx, targetGrid.gz)) {
        waypoints[waypoints.length - 1] = { x: finalTarget.x, z: finalTarget.z };
      }
    }

    return this.smoothPath(waypoints);
  }

  /**
   * Path smoothing using raycasting line-of-sight across walkable grid.
   */
  private smoothPath(path: NavPoint[]): NavPoint[] {
    if (path.length <= 2) return path;

    const smoothed: NavPoint[] = [path[0]];
    let currentIndex = 0;

    while (currentIndex < path.length - 1) {
      let farthestVisible = currentIndex + 1;

      for (let nextIndex = path.length - 1; nextIndex > currentIndex + 1; nextIndex--) {
        if (this.hasLineOfSight(path[currentIndex], path[nextIndex])) {
          farthestVisible = nextIndex;
          break;
        }
      }

      smoothed.push(path[farthestVisible]);
      currentIndex = farthestVisible;
    }

    return smoothed;
  }

  /**
   * Bresenham-like ray check for line of sight across walkable grid.
   */
  private hasLineOfSight(p1: NavPoint, p2: NavPoint): boolean {
    const g1 = this.worldToGrid(p1.x, p1.z);
    const g2 = this.worldToGrid(p2.x, p2.z);

    const dx = Math.abs(g2.gx - g1.gx);
    const dz = Math.abs(g2.gz - g1.gz);
    const sx = g1.gx < g2.gx ? 1 : -1;
    const sz = g1.gz < g2.gz ? 1 : -1;
    let err = dx - dz;

    let cx = g1.gx;
    let cz = g1.gz;

    while (cx !== g2.gx || cz !== g2.gz) {
      if (!this.isWalkable(cx, cz)) return false;

      const e2 = 2 * err;
      if (e2 > -dz) {
        err -= dz;
        cx += sx;
      }
      if (e2 < dx) {
        err += dx;
        cz += sz;
      }
    }

    return this.isWalkable(g2.gx, g2.gz);
  }
}

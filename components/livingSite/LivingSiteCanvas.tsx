'use client';

import React, { useRef, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import {
  LivingSiteWorld,
  HousePlot,
  SiteCharacter,
  GraphicQuality
} from '@/lib/livingSite/types';
import {
  createHouseMesh,
  createCharacterMesh,
  animateCharacter,
  createLowPolyTree,
  createRestPavilion,
  createStorageYard,
  createRoadNetworkMesh,
  createParkNetworkMesh,
  createUnassignedGroundMesh,
  createInspectionFlagMesh,
  createDefectMarkerMesh,
  createActivityPinMesh,
  createPlotSummaryBadgeSprite,
  PALETTE
} from '@/lib/livingSite/proceduralMeshes';
import { DEFAULT_CELL_SIZE } from '@/lib/livingSite/coordinates';
import { SimulationStateMachine } from '@/lib/livingSite/stateMachine';
import { NavigationGrid } from '@/lib/livingSite/navigation';
import { SiteDisplayMode } from '@/lib/livingSite/types';

export interface LivingSiteCanvasProps {
  world: LivingSiteWorld;
  quality: GraphicQuality;
  displayMode?: SiteDisplayMode;
  selectedHouseId?: string;
  selectedCharacterId?: string;
  followedCharacterId?: string;
  roleFilter: string;
  onSelectHouse: (house: HousePlot | null) => void;
  onSelectCharacter: (char: SiteCharacter | null) => void;
  onFollowCharacter: (charId: string | null) => void;
  onSelectFacility?: (facility: any) => void;
  onWorldTick?: (updatedCharacters: SiteCharacter[]) => void;
}

export interface CanvasCameraControls {
  resetToIsometric: () => void;
  fitAll: () => void;
  rotateCW: () => void;
  rotateCCW: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  focusPlot: (plotId: string) => void;
}

export const LivingSiteCanvas = React.forwardRef<CanvasCameraControls, LivingSiteCanvasProps>(
  (
    {
      world,
      quality,
      displayMode = 'inspection',
      selectedHouseId,
      selectedCharacterId,
      followedCharacterId,
      roleFilter,
      onSelectHouse,
      onSelectCharacter,
      onFollowCharacter,
      onSelectFacility,
      onWorldTick
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    // References for Three.js state that don't trigger React renders
    const sceneRef = useRef<THREE.Scene | null>(null);
    const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);

    // Scene groups for separated lifecycle
    const envGroupRef = useRef<THREE.Group | null>(null);
    const housesGroupRef = useRef<THREE.Group | null>(null);
    const markersGroupRef = useRef<THREE.Group | null>(null);
    const charactersGroupRef = useRef<THREE.Group | null>(null);
    const lodBadgesGroupRef = useRef<THREE.Group | null>(null);
    const selectionHighlightGroupRef = useRef<THREE.Group | null>(null);

    // Meshes maps
    const houseMeshesRef = useRef<Map<string, THREE.Group>>(new Map());
    const characterMeshesRef = useRef<Map<string, THREE.Group>>(new Map());
    const animFrameRef = useRef<number>(0);
    const isTabHiddenRef = useRef<boolean>(false);

    // Dynamic props cached in refs for high-frequency animation loop
    const roleFilterRef = useRef<string>(roleFilter);
    roleFilterRef.current = roleFilter;

    const displayModeRef = useRef<SiteDisplayMode>(displayMode);
    displayModeRef.current = displayMode;

    const selectedHouseIdRef = useRef<string | undefined>(selectedHouseId);
    selectedHouseIdRef.current = selectedHouseId;

    const followedCharacterIdRef = useRef<string | undefined>(followedCharacterId);
    followedCharacterIdRef.current = followedCharacterId;

    const charactersDataRef = useRef<SiteCharacter[]>(world.characters);
    charactersDataRef.current = world.characters;

    const onFollowCharacterRef = useRef(onFollowCharacter);
    onFollowCharacterRef.current = onFollowCharacter;

    // Camera state
    const camState = useRef({
      targetX: 0,
      targetZ: 0,
      currentX: 0,
      currentZ: 0,
      zoom: 38,
      targetZoom: 38,
      rotation: Math.PI / 4, // 45 deg isometric
      targetRotation: Math.PI / 4,
      pitch: 0.615, // standard isometric angle ~35.26°
      isDragging: false,
      isRotating: false,
      lastMouseX: 0,
      lastMouseY: 0,
      dragDistance: 0
    });

    // Navigation & FSM refs
    const navGridRef = useRef<NavigationGrid | null>(null);
    const stateMachineRef = useRef<SimulationStateMachine | null>(null);

    // 1. ENGINE & RENDERER SETUP (Runs strictly on mount and quality change - NEVER on selection or filter!)
    useEffect(() => {
      if (!canvasRef.current || !containerRef.current) return;

      const container = containerRef.current;
      const canvas = canvasRef.current;
      const width = container.clientWidth || 800;
      const height = container.clientHeight || 600;

      // Create Scene
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0xf1f5f9); // Crisp neutral background (Slate 100)
      scene.fog = null; // 🌟 Crisp view across entire project without milky white haze
      sceneRef.current = scene;

      // Group hierarchy for modular rendering and updates
      const envGroup = new THREE.Group();
      envGroup.name = 'env_group';
      scene.add(envGroup);
      envGroupRef.current = envGroup;

      const housesGroup = new THREE.Group();
      housesGroup.name = 'houses_group';
      scene.add(housesGroup);
      housesGroupRef.current = housesGroup;

      const markersGroup = new THREE.Group();
      markersGroup.name = 'markers_group';
      scene.add(markersGroup);
      markersGroupRef.current = markersGroup;

      const charactersGroup = new THREE.Group();
      charactersGroup.name = 'characters_group';
      scene.add(charactersGroup);
      charactersGroupRef.current = charactersGroup;

      const lodBadgesGroup = new THREE.Group();
      lodBadgesGroup.name = 'lod_badges_group';
      scene.add(lodBadgesGroup);
      lodBadgesGroupRef.current = lodBadgesGroup;

      const selectionHighlightGroup = new THREE.Group();
      selectionHighlightGroup.name = 'selection_highlight_group';
      scene.add(selectionHighlightGroup);
      selectionHighlightGroupRef.current = selectionHighlightGroup;

      // Orthographic Camera for crisp isometric view
      const aspect = width / height;
      const frustumSize = camState.current.zoom;
      const camera = new THREE.OrthographicCamera(
        (-frustumSize * aspect) / 2,
        (frustumSize * aspect) / 2,
        frustumSize / 2,
        -frustumSize / 2,
        -200,
        500
      );
      cameraRef.current = camera;

      // WebGL Renderer with sRGB color space & ACES Filmic Tone Mapping
      let renderer: THREE.WebGLRenderer | null = null;
      try {
        renderer = new THREE.WebGLRenderer({
          canvas,
          antialias: quality !== 'low',
          powerPreference: 'high-performance'
        });
        renderer.setSize(width, height, false);

        // Clamped Pixel Ratio per graphic tier
        const targetPixelRatio =
          quality === 'high'
            ? Math.min(window.devicePixelRatio || 1, 2.0)
            : quality === 'medium'
            ? Math.min(window.devicePixelRatio || 1, 1.5)
            : 1.0;
        renderer.setPixelRatio(targetPixelRatio);

        // Correct Modern Color Space & Tone Mapping
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.0;

        if (quality !== 'low') {
          renderer.shadowMap.enabled = true;
          renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        } else {
          renderer.shadowMap.enabled = false;
        }
      } catch (err) {
        // Graceful fallback dummy renderer for headless test runners
        renderer = {
          setSize: () => {},
          setPixelRatio: () => {},
          render: () => {},
          dispose: () => {},
          shadowMap: { enabled: false, type: 0 },
          info: { render: { calls: 0, triangles: 0 }, memory: { geometries: 0, textures: 0 } }
        } as any;
      }
      rendererRef.current = renderer;

      // Lighting: Balanced warm sunlight + soft sky hemisphere
      const hemiLight = new THREE.HemisphereLight(0xf8fafc, 0x94a3b8, 0.65);
      scene.add(hemiLight);

      const dirLight = new THREE.DirectionalLight(0xfffbeb, 1.15);
      dirLight.position.set(45, 65, 35);
      if (quality !== 'low') {
        dirLight.castShadow = true;
        dirLight.shadow.mapSize.width = quality === 'high' ? 2048 : 1024;
        dirLight.shadow.mapSize.height = quality === 'high' ? 2048 : 1024;
        dirLight.shadow.camera.near = 10;
        dirLight.shadow.camera.far = 180;
        const d = 55;
        dirLight.shadow.camera.left = -d;
        dirLight.shadow.camera.right = d;
        dirLight.shadow.camera.top = d;
        dirLight.shadow.camera.bottom = -d;
        dirLight.shadow.bias = -0.0004;
      }
      scene.add(dirLight);

      // Resize handling: uses ResizeObserver for accurate container tracking, with window resize fallback
      const handleWindowResize = () => {
        if (!containerRef.current || !rendererRef.current || !cameraRef.current) return;
        const w = containerRef.current.clientWidth || 800;
        const h = containerRef.current.clientHeight || 600;
        rendererRef.current.setSize(w, h, false);
        const asp = w / h;
        const f = camState.current.zoom;
        cameraRef.current.left = (-f * asp) / 2;
        cameraRef.current.right = (f * asp) / 2;
        cameraRef.current.top = f / 2;
        cameraRef.current.bottom = -f / 2;
        cameraRef.current.updateProjectionMatrix();
      };

      let resizeObserver: ResizeObserver | null = null;
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(entries => {
          if (!entries[0] || !rendererRef.current || !cameraRef.current) return;
          const { width: w, height: h } = entries[0].contentRect;
          if (w === 0 || h === 0) return;

          rendererRef.current.setSize(w, h, false);
          const asp = w / h;
          const f = camState.current.zoom;
          cameraRef.current.left = (-f * asp) / 2;
          cameraRef.current.right = (f * asp) / 2;
          cameraRef.current.top = f / 2;
          cameraRef.current.bottom = -f / 2;
          cameraRef.current.updateProjectionMatrix();
        });
        resizeObserver.observe(container);
      } else {
        window.addEventListener('resize', handleWindowResize);
      }

      // Visibility Listener: pauses render/sim while tab is hidden, avoids time-jumping when returning
      const handleVisibilityChange = () => {
        isTabHiddenRef.current = document.hidden;
      };
      document.addEventListener('visibilitychange', handleVisibilityChange);

      // Reduced motion check
      const prefersReducedMotion =
        typeof window !== 'undefined' &&
        window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      // 60 FPS Render Loop
      let lastTime = performance.now();

      const animate = (now: number) => {
        animFrameRef.current = requestAnimationFrame(animate);

        if (isTabHiddenRef.current) {
          lastTime = now;
          return;
        }

        const dt = Math.min((now - lastTime) / 1000, 0.05); // clamped delta time
        lastTime = now;

        // Camera smoothing & Following
        const cs = camState.current;
        const followId = followedCharacterIdRef.current;
        if (followId) {
          const followChar = charactersDataRef.current.find(c => c.id === followId);
          if (followChar) {
            cs.targetX = followChar.x;
            cs.targetZ = followChar.z;
          }
        }

        if (prefersReducedMotion) {
          cs.currentX = cs.targetX;
          cs.currentZ = cs.targetZ;
          cs.zoom = cs.targetZoom;
          cs.rotation = cs.targetRotation;
        } else {
          cs.currentX += (cs.targetX - cs.currentX) * 0.12;
          cs.currentZ += (cs.targetZ - cs.currentZ) * 0.12;
          cs.zoom += (cs.targetZoom - cs.zoom) * 0.15;
          cs.rotation += (cs.targetRotation - cs.rotation) * 0.15;
        }

        if (cameraRef.current && containerRef.current) {
          const w = containerRef.current.clientWidth || 800;
          const h = containerRef.current.clientHeight || 600;
          const asp = w / h;
          cameraRef.current.left = (-cs.zoom * asp) / 2;
          cameraRef.current.right = (cs.zoom * asp) / 2;
          cameraRef.current.top = cs.zoom / 2;
          cameraRef.current.bottom = -cs.zoom / 2;
          cameraRef.current.updateProjectionMatrix();

          // Isometric camera orbit calculation
          const camDist = 120;
          const eyeX = cs.currentX + Math.sin(cs.rotation) * Math.cos(cs.pitch) * camDist;
          const eyeY = Math.sin(cs.pitch) * camDist;
          const eyeZ = cs.currentZ + Math.cos(cs.rotation) * Math.cos(cs.pitch) * camDist;

          cameraRef.current.position.set(eyeX, eyeY, eyeZ);
          cameraRef.current.lookAt(cs.currentX, 0, cs.currentZ);
        }

        // Update characters simulation & animation
        const sm = stateMachineRef.current;
        if (sm) {
          const updatedChars: SiteCharacter[] = [];
          const currentFilter = roleFilterRef.current;

          for (let i = 0; i < charactersDataRef.current.length; i++) {
            const char = charactersDataRef.current[i];
            const updated = sm.updateCharacter(char, dt);
            updatedChars.push(updated);

            // Update 3D mesh position, heading, and limb animations directly on object
            const mesh = characterMeshesRef.current.get(char.id);
            if (mesh) {
              mesh.position.set(updated.x, updated.y, updated.z);
              mesh.rotation.y = updated.rotationY;
              animateCharacter(mesh, updated, now / 1000);

              if (currentFilter !== 'all') {
                const isMatch =
                  (currentFilter === 'mason' && (updated.role === 'mason' || updated.role === 'carpenter' || updated.role === 'steel')) ||
                  (currentFilter === 'mep' && updated.role === 'mep') ||
                  (currentFilter === 'foreman' && updated.role === 'foreman') ||
                  (currentFilter === 'engineer' && updated.role === 'engineer') ||
                  (currentFilter === 'qc' && updated.role === 'qc');
                mesh.visible = isMatch;
              } else {
                mesh.visible = true;
              }
            }
          }
          charactersDataRef.current = updatedChars;
        }

        // Zoom Level of Detail (LOD) & Display Mode
        const isFarZoom = cs.zoom > 48;
        const currentDisplayMode = displayModeRef.current;
        if (lodBadgesGroupRef.current) {
          lodBadgesGroupRef.current.visible = currentDisplayMode === 'inspection' || isFarZoom;
        }
        if (charactersGroupRef.current) {
          charactersGroupRef.current.visible = !isFarZoom || currentDisplayMode === 'presentation';
        }

        if (renderer && scene && camera) {
          renderer.render(scene, camera);
        }
      };

      animFrameRef.current = requestAnimationFrame(animate);

      // Cleanup on unmount or quality change
      return () => {
        cancelAnimationFrame(animFrameRef.current);
        if (resizeObserver) {
          resizeObserver.disconnect();
        } else {
          window.removeEventListener('resize', handleWindowResize);
        }
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        if (renderer) {
          renderer.dispose();
        }
        houseMeshesRef.current.clear();
        characterMeshesRef.current.clear();
      };
    }, [quality]);

    // 2. ENVIRONMENT & STATIC TERRAIN (Only updates when environment changes)
    useEffect(() => {
      const envGroup = envGroupRef.current;
      if (!envGroup) return;

      // Clear existing environment
      while (envGroup.children.length > 0) {
        envGroup.remove(envGroup.children[0]);
      }

      // Ground plane
      const groundGeo = new THREE.PlaneGeometry(world.environment.width + 60, world.environment.depth + 60);
      const groundMat = new THREE.MeshLambertMaterial({ color: 0xe2e8f0 });
      const ground = new THREE.Mesh(groundGeo, groundMat);
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = 0;
      ground.receiveShadow = true;
      envGroup.add(ground);

      // Unassigned compacted soil
      if (world.environment.unassignedCells && world.environment.unassignedCells.length > 0) {
        const unassignedMesh = createUnassignedGroundMesh(world.environment.unassignedCells, world.environment.cellSize);
        envGroup.add(unassignedMesh);
      }

      // Roads
      if (world.environment.roadCells && world.environment.roadCells.length > 0) {
        const roadNetwork = createRoadNetworkMesh(world.environment.roadCells, world.environment.cellSize);
        envGroup.add(roadNetwork);
      } else if (world.environment.roads && world.environment.roads.length > 0) {
        for (const road of world.environment.roads) {
          const rLenX = Math.abs(road.endX - road.startX) || road.width;
          const rLenZ = Math.abs(road.endZ - road.startZ) || road.width;
          const roadGeo = new THREE.PlaneGeometry(rLenX, rLenZ);
          const roadMat = new THREE.MeshLambertMaterial({ color: PALETTE.asphaltRoad });
          const roadMesh = new THREE.Mesh(roadGeo, roadMat);
          roadMesh.rotation.x = -Math.PI / 2;
          roadMesh.position.set((road.startX + road.endX) / 2, 0.02, (road.startZ + road.endZ) / 2);
          roadMesh.receiveShadow = true;
          envGroup.add(roadMesh);
        }
      }

      // Parks / Green spaces
      if (world.environment.parkCells && world.environment.parkCells.length > 0) {
        const parkNetwork = createParkNetworkMesh(world.environment.parkCells, world.environment.cellSize);
        envGroup.add(parkNetwork);
      }

      // Demo Facilities (only if demoDecorationsEnabled)
      if (world.environment.demoDecorationsEnabled && world.environment.restArea && world.environment.restArea.width > 0) {
        const restPavilion = createRestPavilion(world.environment.restArea);
        envGroup.add(restPavilion);

        const storageYard = createStorageYard(world.environment.storageArea);
        envGroup.add(storageYard);
      }

      // Trees
      for (const t of world.environment.trees) {
        const tree = createLowPolyTree(t.x, t.z, t.scale);
        envGroup.add(tree);
      }

      // Initialize / update Navigation Grid & State Machine
      const nav = new NavigationGrid(world.environment.width, world.environment.depth, 1.0);
      nav.bakeWorld(world.environment, world.houses);
      navGridRef.current = nav;
      stateMachineRef.current = new SimulationStateMachine(nav, world.environment, world.houses);
    }, [world.environment]);

    // 3. HOUSES MESH MANAGEMENT (Differential update - in-place transform when nudging/rotating!)
    useEffect(() => {
      const housesGroup = housesGroupRef.current;
      if (!housesGroup) return;

      const currentMap = houseMeshesRef.current;
      const newIds = new Set(world.houses.map(h => h.id));

      // Remove deleted houses
      currentMap.forEach((mesh, id) => {
        if (!newIds.has(id)) {
          housesGroup.remove(mesh);
          currentMap.delete(id);
        }
      });

      // Add or incrementally update houses
      for (const house of world.houses) {
        const existing = currentMap.get(house.id);
        if (!existing) {
          const hMesh = createHouseMesh(house, quality);
          (hMesh as any).userData = {
            type: 'house',
            id: house.id,
            plotName: house.plotName,
            stage: house.currentStage,
            floorCount: house.floorCount,
            houseType: house.houseType
          };
          housesGroup.add(hMesh);
          currentMap.set(house.id, hMesh);
        } else {
          // Check if architectural structure changed
          const uData = (existing as any).userData || {};
          if (
            uData.stage !== house.currentStage ||
            uData.floorCount !== house.floorCount ||
            uData.houseType !== house.houseType
          ) {
            housesGroup.remove(existing);
            const hMesh = createHouseMesh(house, quality);
            (hMesh as any).userData = {
              type: 'house',
              id: house.id,
              plotName: house.plotName,
              stage: house.currentStage,
              floorCount: house.floorCount,
              houseType: house.houseType
            };
            housesGroup.add(hMesh);
            currentMap.set(house.id, hMesh);
          } else {
            // Fast in-place placement update (0.01ms)
            existing.position.set(house.worldX, 0, house.worldZ);
            const subgroup = existing.getObjectByName('building_subgroup');
            if (subgroup) {
              subgroup.position.set(house.placementOffset?.x || 0, 0, house.placementOffset?.z || 0);
              subgroup.rotation.y = house.placementRotation ?? (house.rotation || 0);

              const warnMesh = subgroup.getObjectByName('placement_warning_marker');
              if (warnMesh) {
                warnMesh.visible = house.isPlacementValid === false;
              }
            }
          }
        }
      }

      // Re-bake navigation grid when houses change
      if (navGridRef.current) {
        navGridRef.current.bakeWorld(world.environment, world.houses);
      }
    }, [world.houses, quality]);

    // 4. CHARACTERS MESH MANAGEMENT (Syncs character instances)
    useEffect(() => {
      const charactersGroup = charactersGroupRef.current;
      if (!charactersGroup) return;

      const currentMap = characterMeshesRef.current;
      const newIds = new Set(world.characters.map(c => c.id));

      currentMap.forEach((mesh, id) => {
        if (!newIds.has(id)) {
          charactersGroup.remove(mesh);
          currentMap.delete(id);
        }
      });

      for (const char of world.characters) {
        if (!currentMap.has(char.id)) {
          const cMesh = createCharacterMesh(char);
          (cMesh as any).userData = { type: 'character', id: char.id, name: char.name };
          charactersGroup.add(cMesh);
          currentMap.set(char.id, cMesh);
        }
      }
    }, [world.characters]);

    // 5. INSPECTION FLAGS, DEFECT MARKERS & ACTIVITY PINS
    useEffect(() => {
      const markersGroup = markersGroupRef.current;
      const lodGroup = lodBadgesGroupRef.current;
      if (!markersGroup || !lodGroup) return;

      while (markersGroup.children.length > 0) {
        markersGroup.remove(markersGroup.children[0]);
      }
      while (lodGroup.children.length > 0) {
        lodGroup.remove(lodGroup.children[0]);
      }

      for (const house of world.houses) {
        const entX = house.entrancePos.x;
        const entZ = house.entrancePos.z;
        const bWorldX = house.buildingWorldX ?? house.worldX;
        const bWorldZ = house.buildingWorldZ ?? house.worldZ;

        // A. Inspection Flag (รอตรวจ / Rework)
        const pending = house.pendingInspections || [];
        if (house.hasPendingInspection || pending.length > 0) {
          const rework = pending.find(p => p.statusFor === 'Rework');
          const urgent = pending.some(p => p.isUrgent);
          const statusFor = rework ? 'Rework' : pending[0]?.statusFor || 'Site Engineer';
          const flagMesh = createInspectionFlagMesh(statusFor, urgent);
          flagMesh.position.set(entX + 0.8, 0, entZ);
          markersGroup.add(flagMesh);
        }

        // B. Defect Alert Marker
        if (house.hasOpenDefects || house.defectCount > 0) {
          const isCritical = house.defects?.some(d => d.severity === 'critical');
          const defMesh = createDefectMarkerMesh(house.defectCount || 1, isCritical);
          defMesh.position.set(entX - 0.8, 0, entZ);
          markersGroup.add(defMesh);
        }

        // C. Activity Pins for earlier reports at this plot today
        if (house.activityMarkers && house.activityMarkers.length > 0) {
          house.activityMarkers.forEach((m, idx) => {
            const pin = createActivityPinMesh();
            pin.position.set(entX + 0.3 * (idx + 1), 0, entZ - 0.3);
            markersGroup.add(pin);
          });
        }

        // D. LOD Plot Summary Badge
        let badgeType: 'defect' | 'inspection' | 'normal' = 'normal';
        let badgeText = `${house.currentStage === 'completed' ? 'สร้างเสร็จสมบูรณ์' : `${house.overallProgress}% ${house.lastUpdateText}`}`;

        if (house.hasRework) {
          badgeType = 'defect';
          badgeText = 'งานต้องแก้ไข (Rework)';
        } else if (house.hasPendingInspection) {
          badgeType = 'inspection';
          badgeText = `รอตรวจโดย ${pending[0]?.statusFor || 'วิศวกร'}`;
        } else if (house.defectCount > 0) {
          badgeType = 'defect';
          badgeText = `${house.defectCount} รายการดีเฟกต์`;
        }

        const badgeSprite = createPlotSummaryBadgeSprite(house.plotName, badgeText, badgeType);
        badgeSprite.position.set(bWorldX, 3.8, bWorldZ);
        lodGroup.add(badgeSprite);
      }
    }, [world.houses, displayMode]);

    // 6. SELECTION HIGHLIGHT OVERLAY (Zero scene recreation, zero per-frame traversal)
    useEffect(() => {
      const group = selectionHighlightGroupRef.current;
      if (!group) return;

      // Clear existing highlight meshes
      while (group.children.length > 0) {
        const child = group.children.pop()!;
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (child.material instanceof THREE.Material) child.material.dispose();
        }
      }

      if (!selectedHouseId) {
        group.visible = false;
        return;
      }

      const house = world.houses.find(h => h.id === selectedHouseId);
      if (!house) {
        group.visible = false;
        return;
      }

      group.visible = true;
      group.position.set(house.worldX, 0, house.worldZ);

      const cellSize = DEFAULT_CELL_SIZE;
      const highlightMat = new THREE.MeshBasicMaterial({
        color: PALETTE.selectionGlow,
        transparent: true,
        opacity: 0.38,
        depthWrite: false
      });

      if (house.cells && house.cells.length > 0) {
        let sumGx = 0;
        let sumGy = 0;
        for (const c of house.cells) {
          sumGx += c.x;
          sumGy += c.y;
        }
        const avgGx = sumGx / house.cells.length;
        const avgGy = sumGy / house.cells.length;

        for (const cell of house.cells) {
          const relX = (cell.x - avgGx) * cellSize;
          const relZ = (cell.y - avgGy) * cellSize;
          const tileGeo = new THREE.PlaneGeometry(cellSize - 0.08, cellSize - 0.08);
          const tileMesh = new THREE.Mesh(tileGeo, highlightMat);
          tileMesh.rotation.x = -Math.PI / 2;
          tileMesh.position.set(relX, 0.16, relZ);
          group.add(tileMesh);
        }
      } else {
        const tileGeo = new THREE.PlaneGeometry(house.width, house.depth);
        const tileMesh = new THREE.Mesh(tileGeo, highlightMat);
        tileMesh.rotation.x = -Math.PI / 2;
        tileMesh.position.set(0, 0.16, 0);
        group.add(tileMesh);
      }
    }, [selectedHouseId, world.houses]);

    // 6. ROLE FILTER VISIBILITY (Fast in-place toggle without recreation)
    useEffect(() => {
      characterMeshesRef.current.forEach((mesh, id) => {
        const char = charactersDataRef.current.find(c => c.id === id);
        if (!char) return;

        if (roleFilter !== 'all') {
          const isMatch =
            (roleFilter === 'mason' && (char.role === 'mason' || char.role === 'carpenter' || char.role === 'steel')) ||
            (roleFilter === 'mep' && char.role === 'mep') ||
            (roleFilter === 'foreman' && char.role === 'foreman') ||
            (roleFilter === 'engineer' && char.role === 'engineer') ||
            (roleFilter === 'qc' && char.role === 'qc');
          mesh.visible = isMatch;
        } else {
          mesh.visible = true;
        }
      });
    }, [roleFilter]);

    // 7. MOUSE & POINTER CONTROLS (Pan, Rotate, Zoom, Select)
    const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
      const cs = camState.current;
      cs.isDragging = true;
      cs.isRotating = e.button === 2 || e.shiftKey;
      cs.lastMouseX = e.clientX;
      cs.lastMouseY = e.clientY;
      cs.dragDistance = 0;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
      const cs = camState.current;
      if (!cs.isDragging) return;

      const dx = e.clientX - cs.lastMouseX;
      const dy = e.clientY - cs.lastMouseY;
      cs.lastMouseX = e.clientX;
      cs.lastMouseY = e.clientY;
      cs.dragDistance += Math.hypot(dx, dy);

      if (cs.isRotating) {
        cs.targetRotation += dx * 0.008;
      } else {
        if (followedCharacterIdRef.current) {
          onFollowCharacterRef.current(null);
        }
        const panFactor = cs.zoom * 0.0014;
        const forwardX = -Math.sin(cs.rotation);
        const forwardZ = -Math.cos(cs.rotation);
        const rightX = Math.cos(cs.rotation);
        const rightZ = -Math.sin(cs.rotation);

        cs.targetX -= (rightX * dx - forwardX * dy) * panFactor;
        cs.targetZ -= (rightZ * dx - forwardZ * dy) * panFactor;
      }
    };

    const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
      const cs = camState.current;
      cs.isDragging = false;
      cs.isRotating = false;

      // Discriminate between Click and Drag (< 6px = click)
      if (cs.dragDistance < 6) {
        performRaycastClick(e.clientX, e.clientY);
      }
    };

    const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const cs = camState.current;
      const zoomFactor = e.deltaY > 0 ? 1.15 : 0.85;
      cs.targetZoom = Math.max(16, Math.min(85, cs.targetZoom * zoomFactor));
    };

    // Raycast click detection for houses, characters, and facilities
    const performRaycastClick = (clientX: number, clientY: number) => {
      if (!canvasRef.current || !cameraRef.current || !sceneRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1
      );

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, cameraRef.current);

      // Check characters first
      const charGroups = Array.from(characterMeshesRef.current.values()).filter(m => m.visible);
      const charIntersects = raycaster.intersectObjects(charGroups, true);
      if (charIntersects.length > 0) {
        let rootGroup: any = charIntersects[0].object;
        while (rootGroup && (!rootGroup.userData || rootGroup.userData.type !== 'character')) {
          rootGroup = rootGroup.parent;
        }
        if (rootGroup && rootGroup.userData) {
          const char = charactersDataRef.current.find(c => c.id === rootGroup.userData.id);
          if (char) {
            onSelectCharacter(char);
            return;
          }
        }
      }

      // Check houses
      const houseGroups = Array.from(houseMeshesRef.current.values());
      const houseIntersects = raycaster.intersectObjects(houseGroups, true);
      if (houseIntersects.length > 0) {
        let rootGroup: any = houseIntersects[0].object;
        while (rootGroup && (!rootGroup.userData || rootGroup.userData.type !== 'house')) {
          rootGroup = rootGroup.parent;
        }
        if (rootGroup && rootGroup.userData) {
          const house = world.houses.find(h => h.id === rootGroup.userData.id);
          if (house) {
            onSelectHouse(house);
            return;
          }
        }
      }

      // Check facilities (Rest Pavilion / Storage Yard)
      const allSceneObjects = sceneRef.current.children;
      const allIntersects = raycaster.intersectObjects(allSceneObjects, true);
      for (const hit of allIntersects) {
        let parent: any = hit.object;
        while (parent && (!parent.userData || parent.userData.type !== 'facility')) {
          parent = parent.parent;
        }
        if (parent && parent.userData && parent.userData.type === 'facility') {
          onSelectFacility?.(parent.userData);
          return;
        }
      }

      // Clicked on empty terrain: deselect
      onSelectHouse(null);
      onSelectCharacter(null);
      onSelectFacility?.(null);
    };

    // Double click to focus on a house
    const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!canvasRef.current || !cameraRef.current || !sceneRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, cameraRef.current);
      const houseGroups = Array.from(houseMeshesRef.current.values());
      const houseIntersects = raycaster.intersectObjects(houseGroups, true);

      if (houseIntersects.length > 0) {
        let rootGroup: any = houseIntersects[0].object;
        while (rootGroup && (!rootGroup.userData || rootGroup.userData.type !== 'house')) {
          rootGroup = rootGroup.parent;
        }
        if (rootGroup && rootGroup.userData) {
          const house = world.houses.find(h => h.id === rootGroup.userData.id);
          if (house) {
            onSelectHouse(house);
            camState.current.targetX = house.worldX;
            camState.current.targetZ = house.worldZ;
            camState.current.targetZoom = 24;
          }
        }
      }
    };

    // Expose imperative camera controls
    React.useImperativeHandle(ref, () => ({
      resetToIsometric: () => {
        camState.current.targetRotation = Math.PI / 4;
        camState.current.targetX = 0;
        camState.current.targetZ = 0;
        camState.current.targetZoom = 38;
        onFollowCharacterRef.current(null);
      },
      fitAll: () => {
        camState.current.targetX = 0;
        camState.current.targetZ = 0;
        camState.current.targetZoom = 56;
        onFollowCharacterRef.current(null);
      },
      rotateCW: () => {
        camState.current.targetRotation += Math.PI / 4;
      },
      rotateCCW: () => {
        camState.current.targetRotation -= Math.PI / 4;
      },
      zoomIn: () => {
        camState.current.targetZoom = Math.max(16, camState.current.targetZoom * 0.8);
      },
      zoomOut: () => {
        camState.current.targetZoom = Math.min(85, camState.current.targetZoom * 1.25);
      },
      focusPlot: (plotId: string) => {
        const house = world.houses.find(h => h.id === plotId || h.plotName === plotId);
        if (house) {
          onSelectHouse(house);
          camState.current.targetX = house.worldX;
          camState.current.targetZ = house.worldZ;
          camState.current.targetZoom = 26;
        }
      }
    }));

    return (
      <div
        ref={containerRef}
        className="relative w-full h-[620px] select-none overflow-hidden rounded-3xl bg-slate-950"
      >
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onWheel={handleWheel}
          onDoubleClick={handleDoubleClick}
          onContextMenu={e => e.preventDefault()}
          className="w-full h-full cursor-grab active:cursor-grabbing block outline-none select-none"
        />
      </div>
    );
  }
);

LivingSiteCanvas.displayName = 'LivingSiteCanvas';

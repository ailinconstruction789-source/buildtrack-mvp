'use client';

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import {
  LivingSiteWorld,
  HousePlot,
  SiteCharacter,
  GraphicQuality,
  SiteDisplayMode,
  SiteActivityEvent,
  AttentionPoint,
  InspectionQueueItem
} from '@/lib/livingSite/types';
import { generateDemoLivingSiteWorld } from '@/lib/livingSite/demoData';
import { adaptBuildTrackProjectToLivingSite, AdaptProjectDataParams } from '@/lib/livingSite/projectAdapter';
import { deriveSiteStateAtTime } from '@/lib/livingSite/eventModel';
import { validateBuildingPlacement } from '@/lib/livingSite/coordinates';
import { LivingSiteCanvas, CanvasCameraControls } from './LivingSiteCanvas';
import { LivingSiteUI } from './LivingSiteUI';
import { LivingSiteListView } from './LivingSiteListView';

export interface LivingSiteSimulationProps {
  selectedProject?: any;
  plots?: any[];
  plotBounds?: Record<string, { minX: number; minY: number; maxX: number; maxY: number }>;
  mapGrid?: any[];
  gridCols?: number;
  gridRows?: number;
  plotStatusCache?: Record<string, { planned: number; actual: number; status: string; label: string }>;
  getPlotOverallStatus?: (plotId: string) => any;
  plotsActiveToday?: Set<string>;
  allUpdatesRecord?: any[];
  plotTaskAssignments?: any[];
  defects?: any[];
  taskTemplates?: any[];
  houseTypes?: any[];
  selectedDate?: string;
  setSelectedPlot?: (plot: any) => void;
  setSelectedTask?: (task: any) => void;
  setView?: (v: string) => void;
}

export const LivingSiteSimulation: React.FC<LivingSiteSimulationProps> = ({
  selectedProject,
  plots = [],
  plotBounds = {},
  mapGrid = [],
  gridCols = 30,
  gridRows = 20,
  plotStatusCache = {},
  getPlotOverallStatus,
  plotsActiveToday = new Set(),
  allUpdatesRecord = [],
  plotTaskAssignments = [],
  defects = [],
  taskTemplates = [],
  houseTypes = [],
  selectedDate = new Date().toISOString().slice(0, 10),
  setSelectedPlot,
  setSelectedTask,
  setView
}) => {
  const cameraRef = useRef<CanvasCameraControls | null>(null);

  // 1. WebGL Support Detection
  const [isWebGLSupported, setIsWebGLSupported] = useState<boolean>(true);

  useEffect(() => {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      setIsWebGLSupported(!!gl);
    } catch {
      setIsWebGLSupported(false);
    }
  }, []);

  // 2. Data Modes: 'demo' vs 'live'
  // When plots are provided, start in Live Data mode; otherwise default to Demo simulation
  const [isDemoMode, setIsDemoMode] = useState<boolean>(plots.length === 0);

  // 3. UI State & Exploration Controls
  const [quality, setQuality] = useState<GraphicQuality>('medium');
  const [displayMode, setDisplayMode] = useState<SiteDisplayMode>('inspection');
  const [viewMode, setViewMode] = useState<'3d' | 'list'>('3d');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedHouse, setSelectedHouse] = useState<HousePlot | null>(null);
  const [selectedCharacter, setSelectedCharacter] = useState<SiteCharacter | null>(null);
  const [selectedFacility, setSelectedFacility] = useState<any | null>(null);
  const [followedCharacterId, setFollowedCharacterId] = useState<string | null>(null);

  // Exploration Tools State: Attention Queue & Day Replay
  const [currentAttentionIndex, setCurrentAttentionIndex] = useState<number>(0);
  const [isReplayActive, setIsReplayActive] = useState<boolean>(false);
  const [replayTime, setReplayTime] = useState<string>('12:00');
  const [isReplayPlaying, setIsReplayPlaying] = useState<boolean>(false);
  const [replaySpeed, setReplaySpeed] = useState<number>(1);

  // Day Replay Auto-Playback Timer
  useEffect(() => {
    if (!isReplayActive || !isReplayPlaying) return;

    const interval = setInterval(() => {
      setReplayTime(prev => {
        const [h, m] = prev.split(':').map(Number);
        let totalMin = h * 60 + m + 10;
        if (totalMin > 18 * 60) {
          setIsReplayPlaying(false);
          return '18:00';
        }
        const nextH = Math.floor(totalMin / 60);
        const nextM = totalMin % 60;
        return `${String(nextH).padStart(2, '0')}:${String(nextM).padStart(2, '0')}`;
      });
    }, 800 / replaySpeed);

    return () => clearInterval(interval);
  }, [isReplayActive, isReplayPlaying, replaySpeed]);

  // House Placement Local State & Saving Status
  const [customPlacements, setCustomPlacements] = useState<
    Record<string, { offsetX: number; offsetZ: number; rotation: number }>
  >({});
  const [isSavingPlacement, setIsSavingPlacement] = useState<boolean>(false);
  const [savePlacementStatus, setSavePlacementStatus] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // 4. Generate or Adapt World Data
  const world = useMemo<LivingSiteWorld>(() => {
    const rawWorld = isDemoMode
      ? generateDemoLivingSiteWorld(selectedDate, selectedProject?.name)
      : adaptBuildTrackProjectToLivingSite({
          projectName: selectedProject?.name || 'โครงการ BuildTrack',
          selectedDate,
          plots,
          plotBounds,
          mapGrid,
          gridCols,
          gridRows,
          allUpdatesRecord,
          plotTaskAssignments,
          defects,
          taskTemplates,
          houseTypes,
          plotStatusCache,
          getPlotOverallStatus,
          plotsActiveToday
        });

    if (Object.keys(customPlacements).length === 0) {
      return rawWorld;
    }

    const updatedHouses = rawWorld.houses.map(h => {
      const custom = customPlacements[h.id];
      if (!custom) return h;
      const { offsetX, offsetZ, rotation } = custom;
      const bWorldX = (h.parcelCenterX ?? h.worldX) + offsetX;
      const bWorldZ = (h.parcelCenterZ ?? h.worldZ) + offsetZ;

      // derive facing direction from rotation angle
      const normAngle = ((rotation % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      let facing: 'north' | 'east' | 'south' | 'west' = 'south';
      if (normAngle >= Math.PI * 0.25 && normAngle < Math.PI * 0.75) {
        facing = 'east';
      } else if (normAngle >= Math.PI * 0.75 && normAngle < Math.PI * 1.25) {
        facing = 'north';
      } else if (normAngle >= Math.PI * 1.25 && normAngle < Math.PI * 1.75) {
        facing = 'west';
      } else {
        facing = 'south';
      }

      const check = validateBuildingPlacement({
        plotCells: h.cells || [],
        roadCells: (rawWorld.environment.roadCells as any) || [],
        anchorWorld: { x: h.parcelCenterX ?? h.worldX, z: h.parcelCenterZ ?? h.worldZ },
        offsetX,
        offsetZ,
        rotation,
        buildingWidth: h.buildingWidth || 5.2,
        buildingDepth: h.buildingDepth || 5.0,
        cols: gridCols,
        rows: gridRows
      });

      return {
        ...h,
        placementOffset: { x: offsetX, z: offsetZ },
        placementRotation: rotation,
        facingDirection: facing,
        buildingWorldX: bWorldX,
        buildingWorldZ: bWorldZ,
        isPlacementValid: check.isValid,
        placementViolationText: check.reason
      };
    });

    return {
      ...rawWorld,
      houses: updatedHouses
    };
  }, [
    isDemoMode,
    selectedProject,
    selectedDate,
    plots,
    plotBounds,
    mapGrid,
    gridCols,
    gridRows,
    allUpdatesRecord,
    defects,
    taskTemplates,
    houseTypes,
    plotStatusCache,
    getPlotOverallStatus,
    plotsActiveToday,
    customPlacements
  ]);

  // Active World (Sliced truthfully during Day Replay or using real-time world)
  const activeWorld = useMemo<LivingSiteWorld>(() => {
    if (!isReplayActive || !world.events || world.events.length === 0) {
      return world;
    }

    const cutoffIso = `${selectedDate}T${replayTime}:00+07:00`;
    const { characters: slicedChars, updatedHouses: slicedHouses } = deriveSiteStateAtTime({
      events: world.events,
      houses: world.houses,
      cutoffTimeIso: cutoffIso
    });

    return {
      ...world,
      characters: slicedChars,
      houses: slicedHouses
    };
  }, [world, isReplayActive, replayTime, selectedDate]);

  // Keep selectedHouse actively in sync with updated world coordinates and placement validation
  const activeSelectedHouse = useMemo(() => {
    if (!selectedHouse) return null;
    return activeWorld.houses.find(h => h.id === selectedHouse.id) || selectedHouse;
  }, [activeWorld.houses, selectedHouse]);

  // Attention Queue Handlers
  const handleAttentionSelect = useCallback((item: AttentionPoint) => {
    const targetHouse = activeWorld.houses.find(h => h.id === item.plotId || h.plotName === item.plotName);
    if (targetHouse) {
      setSelectedHouse(targetHouse);
      setSelectedCharacter(null);
      setSelectedFacility(null);
      cameraRef.current?.focusPlot(targetHouse.id);
    }
  }, [activeWorld.houses]);

  const handleNextAttention = useCallback(() => {
    const list = activeWorld.attentionPoints || [];
    if (list.length === 0) return;
    const nextIdx = (currentAttentionIndex + 1) % list.length;
    setCurrentAttentionIndex(nextIdx);
    handleAttentionSelect(list[nextIdx]);
  }, [activeWorld.attentionPoints, currentAttentionIndex, handleAttentionSelect]);

  const handlePrevAttention = useCallback(() => {
    const list = activeWorld.attentionPoints || [];
    if (list.length === 0) return;
    const prevIdx = (currentAttentionIndex - 1 + list.length) % list.length;
    setCurrentAttentionIndex(prevIdx);
    handleAttentionSelect(list[prevIdx]);
  }, [activeWorld.attentionPoints, currentAttentionIndex, handleAttentionSelect]);

  const handleSelectEvent = useCallback((event: SiteActivityEvent) => {
    const targetHouse = activeWorld.houses.find(h => h.id === event.plotId || h.plotName === event.plotName);
    if (targetHouse) {
      setSelectedHouse(targetHouse);
      setSelectedCharacter(null);
      setSelectedFacility(null);
      cameraRef.current?.focusPlot(targetHouse.id);
    }
  }, [activeWorld.houses]);

  // Placement Control Handlers
  const handleRotateHouse = useCallback((plotId: string, deltaAngle: number) => {
    const house = world.houses.find(h => h.id === plotId);
    if (!house) return;
    const currentRot = house.placementRotation || 0;
    const nextRot = Math.round((currentRot + deltaAngle) / (Math.PI / 2)) * (Math.PI / 2);
    setCustomPlacements(prev => ({
      ...prev,
      [plotId]: {
        offsetX: prev[plotId]?.offsetX ?? (house.placementOffset?.x || 0),
        offsetZ: prev[plotId]?.offsetZ ?? (house.placementOffset?.z || 0),
        rotation: nextRot
      }
    }));
    setSavePlacementStatus(null);
  }, [world.houses]);

  const handleNudgeHouse = useCallback((plotId: string, dx: number, dz: number) => {
    const house = world.houses.find(h => h.id === plotId);
    if (!house) return;
    const currentOffset = house.placementOffset || { x: 0, z: 0 };
    setCustomPlacements(prev => ({
      ...prev,
      [plotId]: {
        offsetX: Number(((prev[plotId]?.offsetX ?? currentOffset.x) + dx).toFixed(2)),
        offsetZ: Number(((prev[plotId]?.offsetZ ?? currentOffset.z) + dz).toFixed(2)),
        rotation: prev[plotId]?.rotation ?? (house.placementRotation || 0)
      }
    }));
    setSavePlacementStatus(null);
  }, [world.houses]);

  const handleResetPlacement = useCallback((plotId: string) => {
    setCustomPlacements(prev => {
      const next = { ...prev };
      delete next[plotId];
      return next;
    });
    setSavePlacementStatus(null);
  }, []);

  const handleSavePlacement = useCallback(async (plotId: string) => {
    const house = world.houses.find(h => h.id === plotId);
    if (!house) return;
    if (house.isPlacementValid === false) {
      setSavePlacementStatus({
        type: 'error',
        message: 'ไม่สามารถบันทึกได้เนื่องจากตัวบ้านล้ำออกนอกแนวเขตแปลง'
      });
      return;
    }

    setIsSavingPlacement(true);
    setSavePlacementStatus(null);

    try {
      if (isDemoMode || !selectedProject?.name) {
        setSavePlacementStatus({
          type: 'success',
          message: 'บันทึกตำแหน่งในเซสชันเรียบร้อย (โหมดจำลอง)'
        });
        return;
      }

      const existingLayout = Array.isArray(selectedProject.layout_data) ? selectedProject.layout_data : [];
      const filteredLayout = existingLayout.filter(
        (item: any) => !(item.type === 'placement' && String(item.plotId) === String(plotId))
      );
      const newPlacementItem = {
        id: `PLACEMENT_${plotId}`,
        type: 'placement',
        plotId: plotId,
        offsetX: house.placementOffset?.x || 0,
        offsetZ: house.placementOffset?.z || 0,
        rotation: house.placementRotation || 0,
        facing: house.facingDirection || 'south'
      };
      const updatedLayout = [...filteredLayout, newPlacementItem];

      const { error } = await supabase
        .from('projects')
        .update({ layout_data: updatedLayout })
        .eq('name', selectedProject.name);

      if (error) throw error;

      selectedProject.layout_data = updatedLayout;
      setSavePlacementStatus({
        type: 'success',
        message: 'บันทึกตำแหน่งตัวบ้านในผังโครงการเรียบร้อย'
      });
    } catch (err: any) {
      setSavePlacementStatus({
        type: 'error',
        message: err.message || 'บันทึกไม่สำเร็จ'
      });
    } finally {
      setIsSavingPlacement(false);
    }
  }, [world.houses, isDemoMode, selectedProject]);

  // 5. Search filtering & auto camera focus
  const handleSearchChange = (q: string) => {
    setSearchQuery(q);
    if (!q.trim()) return;

    const lower = q.toLowerCase();
    // Search house plot
    const matchedHouse = world.houses.find(
      h => h.plotName.toLowerCase().includes(lower) || h.id.toLowerCase().includes(lower)
    );
    if (matchedHouse) {
      setSelectedHouse(matchedHouse);
      setSelectedCharacter(null);
      cameraRef.current?.focusPlot(matchedHouse.id);
      return;
    }

    // Search character
    const matchedChar = world.characters.find(
      c => c.name.toLowerCase().includes(lower) || c.roleLabel.toLowerCase().includes(lower)
    );
    if (matchedChar) {
      setSelectedCharacter(matchedChar);
      setSelectedHouse(null);
      setFollowedCharacterId(matchedChar.id);
    }
  };

  const handleOpenFullPlotDetail = (plotId: string) => {
    const rawPlot = plots.find(p => String(p.id) === plotId || p.plot_name === plotId);
    if (rawPlot && setSelectedPlot) {
      setSelectedPlot(rawPlot);
      if (setView) setView('detail');
    }
  };

  const totalPlotsCount = useMemo(() => {
    return activeWorld.houses.length;
  }, [activeWorld.houses]);

  const activePlotsCount = useMemo(() => {
    if (isDemoMode) {
      return activeWorld.houses.filter(h => h.activeWorkerIds.length > 0).length;
    }
    return plots.filter(p => plotsActiveToday.has(String(p.id)) || plotsActiveToday.has(p.plot_name)).length;
  }, [isDemoMode, activeWorld.houses, plots, plotsActiveToday]);

  return (
    <div className="relative w-full rounded-3xl overflow-hidden shadow-2xl border border-slate-800 bg-slate-950 font-sans">
      {/* 3D WebGL Canvas or Fallback List */}
      {viewMode === '3d' && isWebGLSupported ? (
        <div className="relative w-full h-[620px]">
          <LivingSiteCanvas
            ref={cameraRef}
            world={activeWorld}
            quality={quality}
            displayMode={displayMode}
            selectedHouseId={activeSelectedHouse?.id}
            selectedCharacterId={selectedCharacter?.id}
            followedCharacterId={followedCharacterId || undefined}
            roleFilter={roleFilter}
            onSelectHouse={h => {
              setSelectedHouse(h);
              if (h) {
                setSelectedCharacter(null);
                setSelectedFacility(null);
              }
            }}
            onSelectCharacter={c => {
              setSelectedCharacter(c);
              if (c) {
                setSelectedHouse(null);
                setSelectedFacility(null);
              }
            }}
            onSelectFacility={f => {
              setSelectedFacility(f);
              if (f) {
                setSelectedHouse(null);
                setSelectedCharacter(null);
              }
            }}
            onFollowCharacter={setFollowedCharacterId}
          />

          {/* Floating UI HUD */}
          <LivingSiteUI
            projectName={activeWorld.projectName}
            dateStr={activeWorld.dateStr}
            scaleLabel={activeWorld.environment.scaleLabel}
            isDemoMode={isDemoMode}
            quality={quality}
            displayMode={displayMode}
            viewMode={viewMode}
            roleFilter={roleFilter}
            searchQuery={searchQuery}
            totalPlotsCount={totalPlotsCount}
            activePlotsCount={activePlotsCount}
            selectedHouse={activeSelectedHouse}
            selectedCharacter={selectedCharacter}
            selectedFacility={selectedFacility}
            followedCharacterId={followedCharacterId}
            events={activeWorld.events || []}
            attentionPoints={activeWorld.attentionPoints || []}
            pendingInspections={activeWorld.pendingInspections || []}
            currentAttentionIndex={currentAttentionIndex}
            onNextAttention={handleNextAttention}
            onPrevAttention={handlePrevAttention}
            onSelectAttentionPoint={handleAttentionSelect}
            isReplayActive={isReplayActive}
            replayTime={replayTime}
            isReplayPlaying={isReplayPlaying}
            replaySpeed={replaySpeed}
            onToggleReplay={() => {
              setIsReplayActive(!isReplayActive);
              setIsReplayPlaying(false);
            }}
            onReplayTimeChange={setReplayTime}
            onToggleReplayPlay={() => setIsReplayPlaying(!isReplayPlaying)}
            onChangeReplaySpeed={setReplaySpeed}
            onSelectEvent={handleSelectEvent}
            onChangeDisplayMode={setDisplayMode}
            onToggleDemoMode={() => setIsDemoMode(!isDemoMode)}
            onChangeQuality={setQuality}
            onChangeViewMode={setViewMode}
            onChangeRoleFilter={setRoleFilter}
            onChangeSearchQuery={handleSearchChange}
            onSelectHouse={h => {
              setSelectedHouse(h);
              if (h) {
                setSelectedCharacter(null);
                setSelectedFacility(null);
              }
            }}
            onSelectCharacter={c => {
              setSelectedCharacter(c);
              if (c) {
                setSelectedHouse(null);
                setSelectedFacility(null);
              }
            }}
            onSelectFacility={setSelectedFacility}
            onRotateHouse={handleRotateHouse}
            onNudgeHouse={handleNudgeHouse}
            onSavePlacement={handleSavePlacement}
            onResetPlacement={handleResetPlacement}
            isSavingPlacement={isSavingPlacement}
            savePlacementStatus={savePlacementStatus}
            onFollowCharacter={setFollowedCharacterId}
            onResetCamera={() => cameraRef.current?.resetToIsometric()}
            onFitAll={() => cameraRef.current?.fitAll()}
            onRotateCW={() => cameraRef.current?.rotateCW()}
            onRotateCCW={() => cameraRef.current?.rotateCCW()}
            onZoomIn={() => cameraRef.current?.zoomIn()}
            onZoomOut={() => cameraRef.current?.zoomOut()}
            onOpenFullPlotDetail={handleOpenFullPlotDetail}
          />
        </div>
      ) : (
        <div className="p-4 bg-slate-900 text-white min-h-[620px] space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-slate-800/80 rounded-2xl border border-slate-700">
            <div>
              <h2 className="text-base font-black">{activeWorld.projectName}</h2>
              <p className="text-xs text-slate-400">
                {!isWebGLSupported
                  ? '⚠️ อุปกรณ์หรือเบราว์เซอร์ไม่รองรับ WebGL กำลังแสดงผลในโหมดตารางข้อความ'
                  : 'โหมดแสดงผลแบบตารางข้อความ (Accessible List)'}
              </p>
            </div>
            {isWebGLSupported && (
              <button
                onClick={() => setViewMode('3d')}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl shadow transition"
              >
                สลับกลับสู่มุมมอง 3D Simulation
              </button>
            )}
          </div>

          <LivingSiteListView
            houses={activeWorld.houses}
            characters={activeWorld.characters}
            teams={activeWorld.teams}
            onSelectHouse={setSelectedHouse}
            onSelectCharacter={setSelectedCharacter}
          />
        </div>
      )}
    </div>
  );
};

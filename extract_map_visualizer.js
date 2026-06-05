const fs = require('fs');

const mapComponent = `import React from 'react';
import { 
  Map as MapIcon, Monitor, Search, ZoomOut, ZoomIn, Loader2, Paintbrush, 
  Eraser, Pickaxe, HardHat, Activity, Trash2, Settings, PlusCircle, Grid
} from 'lucide-react';

export default function MapVisualizer(props: any) {
  const {
    view, setView, selectedProject, isAdmin, currentUserRole, isMobileLayout,
    isEditMapMode, setIsEditMapMode, gridCols, setGridCols, gridRows, setGridRows,
    mapZoom, handleZoomIn, handleZoomOut, handleZoomReset, mapTool, setMapTool,
    mapSelectedPlot, setMapSelectedPlot, plots, isSubmitting, handleSaveMap,
    mapGrid, getAdjacency, handleMouseDown, handleMouseEnter, handleMouseUp,
    setSelectedPlot, plotBounds, getPlotOverallStatus, allUpdatesRecord,
    taskTemplates, assignments, searchContractor, setSearchContractor,
    plotsActiveToday, searchPlot, setSearchPlot, filterForeman, setFilterForeman,
    foremenList, displayPlots, handleDeletePlot, handleEditPlot,
    setIsPresentationOpen, setCurrentSlideIndex
  } = props;

  return (
    <>
${fs.readFileSync('map_chunk.txt', 'utf-8')}
    </>
  );
}
`;

fs.writeFileSync('components/MapVisualizer.tsx', mapComponent);

// Now update page.tsx
let pageContent = fs.readFileSync('app/page.tsx', 'utf-8');

// Ensure import is there
if (!pageContent.includes('import MapVisualizer')) {
  pageContent = pageContent.replace(
    "import DashboardOverview from '@/components/DashboardOverview';",
    "import DashboardOverview from '@/components/DashboardOverview';\nimport MapVisualizer from '@/components/MapVisualizer';"
  );
}

const mapPropsCode = `
               {/* 🗺️ View: Project Detail & Map Builder */}
               {view === 'project-detail' && selectedProject && (
                 <MapVisualizer 
                   view={view} setView={setView} selectedProject={selectedProject} 
                   isAdmin={isAdmin} currentUserRole={currentUserRole} isMobileLayout={isMobileLayout}
                   isEditMapMode={isEditMapMode} setIsEditMapMode={setIsEditMapMode} 
                   gridCols={gridCols} setGridCols={setGridCols} gridRows={gridRows} setGridRows={setGridRows}
                   mapZoom={mapZoom} handleZoomIn={handleZoomIn} handleZoomOut={handleZoomOut} handleZoomReset={handleZoomReset}
                   mapTool={mapTool} setMapTool={setMapTool} mapSelectedPlot={mapSelectedPlot} setMapSelectedPlot={setMapSelectedPlot}
                   plots={plots} isSubmitting={isSubmitting} handleSaveMap={handleSaveMap}
                   mapGrid={mapGrid} getAdjacency={getAdjacency} handleMouseDown={handleMouseDown} 
                   handleMouseEnter={handleMouseEnter} handleMouseUp={handleMouseUp}
                   setSelectedPlot={setSelectedPlot} plotBounds={plotBounds} getPlotOverallStatus={getPlotOverallStatus}
                   allUpdatesRecord={allUpdatesRecord} taskTemplates={taskTemplates} assignments={assignments}
                   searchContractor={searchContractor} setSearchContractor={setSearchContractor}
                   plotsActiveToday={plotsActiveToday} searchPlot={searchPlot} setSearchPlot={setSearchPlot}
                   filterForeman={filterForeman} setFilterForeman={setFilterForeman} foremenList={foremenList}
                   displayPlots={displayPlots} handleDeletePlot={handleDeletePlot} handleEditPlot={handleEditPlot}
                   setIsPresentationOpen={setIsPresentationOpen} setCurrentSlideIndex={setCurrentSlideIndex}
                 />
               )}
`;

const startStr = "{/* \uD83D\uDDFA\uFE0F View: Project Detail & Map Builder */}";
const endStr = "{/* \uD83D\uDCCB LEVEL 3: House Detail */}";

const startIdx = pageContent.indexOf(startStr);
const endIdx = pageContent.indexOf(endStr);

if (startIdx !== -1 && endIdx !== -1) {
    pageContent = pageContent.substring(0, startIdx) + mapPropsCode + "\n               " + pageContent.substring(endIdx);
    fs.writeFileSync('app/page.tsx', pageContent);
    console.log("Extraction complete.");
} else {
    console.log("Could not find chunk in page.tsx");
}

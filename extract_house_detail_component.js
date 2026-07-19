const fs = require('fs');

const componentCode = `import React from 'react';
import { 
  Activity, Calendar, Camera, HardHat, Loader2, Monitor, Pickaxe, PlusCircle, UserCog, Users, ImageIcon
} from 'lucide-react';

export default function HouseDetailView(props: any) {
  const {
    view, setView, selectedPlot, selectedProject, isMobileLayout,
    plotPlanStart, plotPlanEnd, daysElapsed, totalPlannedDays, daysRemaining,
    isSummaryDelayed, isProjectPlanner, setCopyModalOpen, handleSaveAllSchedules,
    isSubmitting, houseTypes, taskTemplates, getTaskStatus, latestUpdatesMap,
    schedules, handleScheduleInput, scheduleInputs, handleFileChange, 
    handleUploadSlot, isUploadingLayer, setSelectedTask, setDefectModal,
    setTaskReturnView, handleShowActivityReport, setAssignModal,
    simulatedStatus, editingHouseType, currentUserRole
  } = props;

  return (
    <>
${fs.readFileSync('house_chunk.txt', 'utf-8')}
    </>
  );
}
`;

fs.writeFileSync('components/HouseDetailView.tsx', componentCode);

let pageContent = fs.readFileSync('app/page.tsx', 'utf-8');

if (!pageContent.includes('import HouseDetailView')) {
  pageContent = pageContent.replace(
    "import MapVisualizer from '@/components/MapVisualizer';",
    "import MapVisualizer from '@/components/MapVisualizer';\nimport HouseDetailView from '@/components/HouseDetailView';"
  );
}

const componentPropsCode = `
               {/* 📋 LEVEL 3: House Detail */}
               {view === 'house-detail' && selectedPlot && (
                 <HouseDetailView 
                   view={view} setView={setView} selectedPlot={selectedPlot} selectedProject={selectedProject}
                   isMobileLayout={isMobileLayout} plotPlanStart={plotPlanStart} plotPlanEnd={plotPlanEnd}
                   daysElapsed={daysElapsed} totalPlannedDays={totalPlannedDays} daysRemaining={daysRemaining}
                   isSummaryDelayed={isSummaryDelayed} isProjectPlanner={isProjectPlanner} 
                   setCopyModalOpen={setCopyModalOpen} handleSaveAllSchedules={handleSaveAllSchedules}
                   isSubmitting={isSubmitting} houseTypes={houseTypes} taskTemplates={taskTemplates}
                   getTaskStatus={getTaskStatus} latestUpdatesMap={latestUpdatesMap} schedules={schedules}
                   handleScheduleInput={handleScheduleInput} scheduleInputs={scheduleInputs}
                   handleFileChange={handleFileChange} handleUploadSlot={handleUploadSlot}
                   isUploadingLayer={isUploadingLayer} setSelectedTask={setSelectedTask} setDefectModal={setDefectModal}
                   setTaskReturnView={setTaskReturnView} handleShowActivityReport={handleShowActivityReport}
                   setAssignModal={setAssignModal} simulatedStatus={simulatedStatus} editingHouseType={editingHouseType}
                   currentUserRole={currentUserRole}
                 />
               )}
`;

const startStr = "{/* 📋 LEVEL 3: House Detail */}";
const endIdx = pageContent.indexOf("               {view === 'task-progress' && selectedTask && (");
const startIdx = pageContent.indexOf(startStr);

if (startIdx !== -1 && endIdx !== -1) {
    pageContent = pageContent.substring(0, startIdx) + componentPropsCode + "\n" + pageContent.substring(endIdx);
    fs.writeFileSync('app/page.tsx', pageContent);
    console.log("HouseDetailView extraction complete.");
} else {
    console.log("Could not find boundaries.");
}

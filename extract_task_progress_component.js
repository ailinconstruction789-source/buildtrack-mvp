const fs = require('fs');

const componentCode = `import React from 'react';
import { 
  AlertCircle, AlertTriangle, Camera, CheckCircle, Clock, Loader2, Printer, Send, ShieldAlert, Trash2
} from 'lucide-react';

export default function TaskProgressView(props: any) {
  const {
    view, setView, taskReturnView, isMobileLayout, selectedTask, selectedPlot,
    setProgressValue, progressValue, isSending, setFullImageUrl,
    handleDeleteUpdate, handleDeleteAllUpdates, setExportModalOpen, 
    handlePrintExport, isProjectPlanner, isAdmin, currentUserRole,
    updates, inputText, setInputText, handleFileSelect,
    selectedFiles, setSelectedFiles, handlePostUpdate
  } = props;

  return (
    <>
${fs.readFileSync('task_chunk.txt', 'utf-8')}
    </>
  );
}
`;

fs.writeFileSync('components/TaskProgressView.tsx', componentCode);

let pageContent = fs.readFileSync('app/page.tsx', 'utf-8');

if (!pageContent.includes('import TaskProgressView')) {
  pageContent = pageContent.replace(
    "import HouseDetailView from '@/components/HouseDetailView';",
    "import HouseDetailView from '@/components/HouseDetailView';\nimport TaskProgressView from '@/components/TaskProgressView';"
  );
}

const componentPropsCode = `
               {/* 🚀 LEVEL 4: Task Progress */}
               {view === 'task-progress' && selectedTask && (
                 <TaskProgressView 
                   view={view} setView={setView} taskReturnView={taskReturnView}
                   isMobileLayout={isMobileLayout} selectedTask={selectedTask} selectedPlot={selectedPlot}
                   setProgressValue={setProgressValue} progressValue={progressValue} isSending={isSending}
                   setFullImageUrl={setFullImageUrl} handleDeleteUpdate={handleDeleteUpdate}
                   handleDeleteAllUpdates={handleDeleteAllUpdates} setExportModalOpen={setExportModalOpen}
                   handlePrintExport={handlePrintExport} isProjectPlanner={isProjectPlanner}
                   isAdmin={isAdmin} currentUserRole={currentUserRole} updates={updates}
                   inputText={inputText} setInputText={setInputText} handleFileSelect={handleFileSelect}
                   selectedFiles={selectedFiles} setSelectedFiles={setSelectedFiles}
                   handlePostUpdate={handlePostUpdate}
                 />
               )}
`;

const startStr = "{/* \uD83D\uDDFA\uFE0F View: Project Detail & Map Builder */}";
// Wait, the chunk starts with `{/* 🚀 LEVEL 4: Task Progress */}` or `{view === 'task-progress' && selectedTask && (`
// Let's replace the exact text from task_chunk.txt
const chunkText = fs.readFileSync('task_chunk.txt', 'utf-8');
const chunkStart = pageContent.indexOf(chunkText);

if (chunkStart !== -1) {
    pageContent = pageContent.substring(0, chunkStart) + componentPropsCode + "\n" + pageContent.substring(chunkStart + chunkText.length);
    fs.writeFileSync('app/page.tsx', pageContent);
    console.log("TaskProgressView extraction complete.");
} else {
    console.log("Could not find boundaries.");
}

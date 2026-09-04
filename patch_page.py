import os
import re

page_path = r'd:\buildtrack\buildtrack-mvp-main\app\page.tsx'

with open(page_path, 'r', encoding='utf-8') as f:
    page_content = f.read()

# Add dynamic import for DefectProgressView
if 'const DefectProgressView' not in page_content:
    page_content = page_content.replace(
        "const TaskProgressView = dynamic(() => import('@/components/TaskProgressView'));",
        "const TaskProgressView = dynamic(() => import('@/components/TaskProgressView'));\n  const DefectProgressView = dynamic(() => import('@/components/DefectProgressView'));"
    )

# Add selectedDefect state
if 'const [selectedDefect, setSelectedDefect] = useState<any>(null);' not in page_content:
    page_content = page_content.replace(
        'const [selectedTask, setSelectedTask] = useState<any>(null);',
        'const [selectedTask, setSelectedTask] = useState<any>(null);\n  const [selectedDefect, setSelectedDefect] = useState<any>(null);'
    )
if 'const [defectUpdates, setDefectUpdates] = useState<any[]>([]);' not in page_content:
    page_content = page_content.replace(
        'const [updates, setUpdates] = useState<any[]>([]);',
        'const [updates, setUpdates] = useState<any[]>([]);\n  const [defectUpdates, setDefectUpdates] = useState<any[]>([]);'
    )
if 'const [defectReturnView, setDefectReturnView] = useState<string>(\'house-detail\');' not in page_content:
    page_content = page_content.replace(
        'const [taskReturnView, setTaskReturnView] = useState<string>(\'house-detail\');',
        'const [taskReturnView, setTaskReturnView] = useState<string>(\'house-detail\');\n  const [defectReturnView, setDefectReturnView] = useState<string>(\'house-detail\');'
    )

# Add DefectProgressView rendering
defect_view_render = """
              {/* 🚀 LEVEL 4: Defect Progress */}
              {view === 'defect-progress' && selectedDefect && (
                <DefectProgressView
                  view={view} setView={setView} defectReturnView={defectReturnView}
                  isMobileLayout={isMobileLayout} selectedDefect={selectedDefect} selectedPlot={selectedPlot}
                  setProgressValue={setProgressValue} progressValue={progressValue} isSending={isSending}
                  setFullImageUrl={setFullImageUrl} handleDeleteDefectUpdate={handleDeleteUpdate}
                  setExportModalOpen={setExportModalOpen}
                  isProjectPlanner={isProjectPlanner}
                  isAdmin={isAdmin} currentUserRole={currentUserRole} updates={defectUpdates} setUpdates={setDefectUpdates}
                  inputText={inputText} setInputText={setInputText}
                  selectedFiles={selectedFiles} setSelectedFiles={setSelectedFiles}
                  isTaskCompleted={selectedDefect.progress === 100 || selectedDefect.status === 'resolved'}
                  handleOpenExportModal={handleOpenExportModal} 
                  defects={defects} loggedInUser={loggedInUser}
                  isLockedForForeman={false} isSiteEngineer={isSiteEngineer} isPendingSE={false} handleReviewAction={() => {}}
                  isQC={isQC} isPendingQC={false} isProcurement={isProcurement} isOwner={isOwner}
                  handleSendPost={handleSendPost}
                />
              )}
"""
if "view === 'defect-progress'" not in page_content:
    page_content = page_content.replace(
        "{/* 🚀 LEVEL 4: Task Progress */}",
        defect_view_render + "\n              {/* 🚀 LEVEL 4: Task Progress */}"
    )

# Modify HouseHandoverView props in HouseDetailView and page.tsx ?
# We passed `setSelectedDefect`, `setView`, `setDefectReturnView` to HouseHandoverView ?
# HouseHandoverView is rendered inside HouseDetailView.
# So we need to pass these from page.tsx to HouseDetailView, then to HouseHandoverView.
# Let's check if setSelectedDefect is passed.
# In page.tsx:
if "setSelectedDefect={setSelectedDefect}" not in page_content:
    page_content = page_content.replace(
        'setSelectedTask={setSelectedTask}',
        'setSelectedTask={setSelectedTask} setSelectedDefect={setSelectedDefect} setDefectReturnView={setDefectReturnView}'
    )
    
with open(page_path, 'w', encoding='utf-8') as f:
    f.write(page_content)
print("Patched page.tsx")


# 2. Patch HouseDetailView.tsx to pass those props to HouseHandoverView
detail_path = r'd:\buildtrack\buildtrack-mvp-main\components\HouseDetailView.tsx'
with open(detail_path, 'r', encoding='utf-8') as f:
    detail_content = f.read()

# Add to HouseDetailView props
if 'setSelectedDefect: (d: any) => void;' not in detail_content:
    detail_content = detail_content.replace(
        'setSelectedTask: (t: any) => void;',
        'setSelectedTask: (t: any) => void;\n  setSelectedDefect: (d: any) => void;\n  setDefectReturnView: (v: string) => void;'
    )
    # destructure
    detail_content = detail_content.replace(
        'setSelectedTask, setDefectModal,',
        'setSelectedTask, setSelectedDefect, setDefectReturnView, setDefectModal,'
    )

if 'setSelectedDefect={setSelectedDefect}' not in detail_content:
    detail_content = detail_content.replace(
        '<HouseHandoverView ',
        '<HouseHandoverView \n                         setView={setView}\n                         setSelectedDefect={setSelectedDefect}\n                         setDefectReturnView={setDefectReturnView}'
    )

with open(detail_path, 'w', encoding='utf-8') as f:
    f.write(detail_content)
print("Patched HouseDetailView.tsx")

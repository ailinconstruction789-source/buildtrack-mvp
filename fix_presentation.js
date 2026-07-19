const fs = require('fs');
const path = require('path');

const filePath = path.join('c:', 'Users', 'HUAWEI', 'Desktop', 'buildtrack', 'app', 'page.tsx');
let content = fs.readFileSync(filePath, 'utf-8');

// 1. Add SalesKanban import
content = content.replace(
  "import BillingQueueView from '@/components/BillingQueueView';\n// ถอด browser-image-compression ออกเพื่อใช้ Native ป้องกัน Error",
  "import BillingQueueView from '@/components/BillingQueueView';\nimport SalesKanban from '@/components/sales/SalesKanban';\n// ถอด browser-image-compression ออกเพื่อใช้ Native ป้องกัน Error"
);

// 2. Add presentationPlots
content = content.replace(
  "    return isCurrentProject && matchSearch && matchForeman && roleAllowed;\n  }), [plots, selectedProject?.name, searchPlot, filterForeman, isForeman, loggedInUser?.username]);",
  "    return isCurrentProject && matchSearch && matchForeman && roleAllowed;\n  }), [plots, selectedProject?.name, searchPlot, filterForeman, isForeman, loggedInUser?.username]);\n\n  const presentationPlots = useMemo(() => plots.filter(p => p.project_name === selectedProject?.name), [plots, selectedProject?.name]);"
);

// 3. Update keyboard listener
content = content.replace(
  "      if (!isPresentationOpen) return;\n      if (galleryImages.length > 0 || fullImageUrl) return; // ป้องกันการเลื่อนสไลด์หลักซ้อนกับแกลเลอรี่ภาพ\n      if (e.key === 'ArrowRight') setCurrentSlideIndex(prev => Math.min(prev + 1, plots.length - 1));\n      if (e.key === 'ArrowLeft') setCurrentSlideIndex(prev => Math.max(prev - 1, 0));\n      if (e.key === 'Escape') setIsPresentationOpen(false);\n    };\n    window.addEventListener('keydown', handleKeyDown);\n    return () => window.removeEventListener('keydown', handleKeyDown);\n  }, [isPresentationOpen, plots.length, galleryImages.length, fullImageUrl]);",
  "      if (!isPresentationOpen) return;\n      if (galleryImages.length > 0 || fullImageUrl) return; // ป้องกันการเลื่อนสไลด์หลักซ้อนกับแกลเลอรี่ภาพ\n      \n      const pPlots = plots.filter(p => p.project_name === selectedProject?.name);\n      \n      if (e.key === 'ArrowRight') setCurrentSlideIndex(prev => Math.min(prev + 1, pPlots.length - 1));\n      if (e.key === 'ArrowLeft') setCurrentSlideIndex(prev => Math.max(prev - 1, 0));\n      if (e.key === 'Escape') setIsPresentationOpen(false);\n    };\n    window.addEventListener('keydown', handleKeyDown);\n    return () => window.removeEventListener('keydown', handleKeyDown);\n  }, [isPresentationOpen, plots, selectedProject?.name, galleryImages.length, fullImageUrl]);"
);

// 4. Update Presentation Modal logic (currentPlot)
content = content.replace(
  "{/* 📺 PRESENTATION MODAL (ห้องประชุม) */}\n      {isPresentationOpen && plots.length > 0 && (() => {\n        const currentPlot = plots[currentSlideIndex];\n\n        // 🌟 คำนวณความคืบหน้าและสถานะ (แก้บั๊ก getPlotStatus)\n        const allPlotUpdates = allUpdatesRecord.filter((u: any) => u.plot_id === currentPlot.id)",
  "{/* 📺 PRESENTATION MODAL (ห้องประชุม) */}\n      {isPresentationOpen && presentationPlots.length > 0 && (() => {\n        const currentPlot = presentationPlots[currentSlideIndex];\n\n        // 🌟 คำนวณความคืบหน้าและสถานะ (แก้บั๊ก getPlotStatus)\n        const allPlotUpdates = allUpdatesRecord.filter((u: any) => u.plot_id === currentPlot?.id)"
);

// 5. Update Presentation Modal logic (statusInfo)
content = content.replace(
  "// เปอร์เซ็นต์เสร็จของบ้านแต่ละหลัง\n        const statusInfo = getPlotOverallStatus(currentPlot.id);",
  "// เปอร์เซ็นต์เสร็จของบ้านแต่ละหลัง\n        const statusInfo = currentPlot ? getPlotOverallStatus(currentPlot.id) : { overall: 0, actual: 0, planned: 0, status: 'none', label: 'รอดำเนินการ', color: 'text-slate-500' };"
);

// 6. Update Input search logic
content = content.replace(
  "const foundIndex = plots.findIndex(p => p.id === targetId || p.plot_name === targetId);\n                        if (foundIndex !== -1) {\n                          setCurrentSlideIndex(foundIndex);\n                        }\n                      }}\n                      onKeyDown={(e) => {\n                        if (e.key === 'Enter') {\n                          const input = document.getElementById('presentation-plot-search') as HTMLInputElement;\n                          const targetId = input?.value.trim().toUpperCase();\n                          const foundIndex = plots.findIndex(p => p.id === targetId || p.plot_name === targetId);",
  "const foundIndex = presentationPlots.findIndex(p => p.id === targetId || p.plot_name === targetId);\n                        if (foundIndex !== -1) {\n                          setCurrentSlideIndex(foundIndex);\n                        }\n                      }}\n                      onKeyDown={(e) => {\n                        if (e.key === 'Enter') {\n                          const input = document.getElementById('presentation-plot-search') as HTMLInputElement;\n                          const targetId = input?.value.trim().toUpperCase();\n                          const foundIndex = presentationPlots.findIndex(p => p.id === targetId || p.plot_name === targetId);"
);

// 7. Update button max arrows
content = content.replace(
  "onClick={() => setCurrentSlideIndex(prev => Math.min(prev + 1, plots.length - 1))}\n                  disabled={currentSlideIndex === plots.length - 1}",
  "onClick={() => setCurrentSlideIndex(prev => Math.min(prev + 1, presentationPlots.length - 1))}\n                  disabled={currentSlideIndex === presentationPlots.length - 1}"
);

// 8. Add Sales Dashboard view at the end
content = content.replace(
  "              {/* 🗺️ View: Project Detail & Map Builder */}\n              {view === 'project-detail' && selectedProject && (",
  "              {/* 📊 View: Sales Dashboard */}\n              {view === 'sales-dashboard' && selectedProject && (\n                <SalesKanban\n                  project={selectedProject}\n                  user={loggedInUser}\n                  onBack={() => setView('dashboard')}\n                />\n              )}\n\n              {/* 🗺️ View: Project Detail & Map Builder */}\n              {view === 'project-detail' && selectedProject && ("
);

fs.writeFileSync(filePath, content, 'utf-8');
console.log('done');

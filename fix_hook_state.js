const fs = require('fs');
let content = fs.readFileSync('hooks/useBuildTrackData.ts', 'utf8');

if (!content.includes('const [plotStatuses, setPlotStatuses] = useState<any[]>([]);')) {
    content = content.replace("const [inspectionQueue, setInspectionQueue] = useState<any[]>([]);", "const [inspectionQueue, setInspectionQueue] = useState<any[]>([]);\n  const [plotStatuses, setPlotStatuses] = useState<any[]>([]);");
}

if (!content.includes('setPlotStatuses(plotStatusesData || []);')) {
    content = content.replace("setInspectionQueueView(inspectionQueueData || []);", "setInspectionQueueView(inspectionQueueData || []);\n      setPlotStatuses(plotStatusesData || []);");
}

fs.writeFileSync('hooks/useBuildTrackData.ts', content, 'utf8');
console.log("Fixed plotStatuses in useBuildTrackData.ts");

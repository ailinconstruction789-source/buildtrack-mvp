const fs = require('fs');
let content = fs.readFileSync('hooks/useBuildTrackData.ts', 'utf8');

content = content.replace("const [inspectionQueueView, setInspectionQueueView] = useState<any[]>([]);", "const [inspectionQueueView, setInspectionQueueView] = useState<any[]>([]);\n  const [plotStatuses, setPlotStatuses] = useState<any[]>([]);");

fs.writeFileSync('hooks/useBuildTrackData.ts', content, 'utf8');
console.log("Fixed plotStatuses declaration.");

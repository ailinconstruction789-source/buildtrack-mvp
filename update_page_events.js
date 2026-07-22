const fs = require('fs');

let code = fs.readFileSync('app/page.tsx', 'utf8');

const newEvents = `
  const handleMouseDown = useCallback((x: any, y: any) => { 
    if (!isEditMapMode) return; 
    setIsDrawing(true); 
    setLastDrawCell({ x, y }); 
    
    if (mapTool === 'eraser') {
       eraseCell(x, y); 
       setMapGrid((prev: any) => prev.map((c: any) => {
           if (c.type === 'polyline') {
               return { ...c, points: c.points.filter((p: any) => p.x !== x || p.y !== y) };
           }
           return c;
       }).filter((c: any) => c.type !== 'polyline' || c.points.length > 0)); 
    } 
    else if (mapTool === 'plot' || mapTool === 'road' || mapTool === 'park') { 
       if (mapTool === 'plot' && !mapSelectedPlot) { 
           setIsDrawing(false); 
           return showAlert('แจ้งเตือน', 'เลือกรหัสแปลงก่อน'); 
       } 

       const plotInfo = plots.find((p: any) => p.id === mapSelectedPlot);
       const isInfra = houseTypes.find((h: any) => h.id === plotInfo?.house_type_id)?.is_infrastructure;

       if (isInfra && mapTool === 'plot') {
           setMapGrid((prev: any) => {
               const existingPoly = prev.find((c: any) => c.type === 'polyline' && c.plotId === mapSelectedPlot);
               if (existingPoly) {
                   const lastPt = existingPoly.points[existingPoly.points.length - 1];
                   if (lastPt && lastPt.x === x && lastPt.y === y) return prev;
                   return prev.map((c: any) => c.id === existingPoly.id ? { ...c, points: [...c.points, {x, y}] } : c);
               } else {
                   return [...prev, { id: \`poly-\${mapSelectedPlot}\`, type: 'polyline', plotId: mapSelectedPlot, points: [{x, y}] }];
               }
           });
       } else {
           paintCell(x, y); 
       }
    } 
  }, [isEditMapMode, mapTool, mapSelectedPlot, eraseCell, paintCell, showAlert, plots, houseTypes]);

  const handleMouseEnter = useCallback((x: any, y: any) => { 
    if (!isDrawing || !isEditMapMode) return; 

    const plotInfo = plots.find((p: any) => p.id === mapSelectedPlot);
    const isInfra = houseTypes.find((h: any) => h.id === plotInfo?.house_type_id)?.is_infrastructure;
    if (isInfra && mapTool === 'plot') return; // Do not draw polyline on drag

    if (mapTool === 'fence' || mapTool === 'eraser') { 
        if (lastDrawCell) { 
            const dx = x - lastDrawCell.x, dy = y - lastDrawCell.y; 
            if (Math.abs(dx) >= 1 && dy === 0) toggleFence('v', Math.max(x, lastDrawCell.x), y, mapTool === 'eraser' ? 'erase' : 'add'); 
            else if (Math.abs(dy) >= 1 && dx === 0) toggleFence('h', x, Math.max(y, lastDrawCell.y), mapTool === 'eraser' ? 'erase' : 'add'); 
        } 
        if (mapTool === 'eraser') eraseCell(x, y); 
        setLastDrawCell({ x, y }); 
    } else { 
        paintCell(x, y); 
        setLastDrawCell({ x, y }); 
    } 
  }, [isDrawing, isEditMapMode, mapTool, lastDrawCell, toggleFence, eraseCell, paintCell, plots, houseTypes, mapSelectedPlot]);

  const handleMouseUp = useCallback(() => { setIsDrawing(false); setLastDrawCell(null); }, []);
`;

code = code.replace(/const handleMouseDown = useCallback\(\(x: any, y: any\) => \{[\s\S]*?const handleMouseUp = useCallback\(\(\) => \{ setIsDrawing\(false\); setLastDrawCell\(null\); \}, \[\]\);/m, newEvents.trim());

fs.writeFileSync('app/page.tsx', code);
console.log('page events updated');

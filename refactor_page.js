const fs = require('fs');

let pageCode = fs.readFileSync('app/page.tsx', 'utf8');

// 1. Replace toggleFence with toggleEdgeCell
pageCode = pageCode.replace(
  /const toggleFence = useCallback\(\(dir: any, x: any, y: any, mode: any\) => \{ setMapGrid\(\(prev: any\) => \{ const id = \`fence-\$\{dir\}-\$\{x\}-\$\{y\}\`; if \(mode === 'add'\) \{ return prev\.some\(\(c: any\) => c\.id === id\) \? prev : \[\.\.\.prev, \{ id, type: \`fence-\$\{dir\}\`, x, y \}\]; \} else \{ return prev\.filter\(\(c: any\) => c\.id !== id\); \} \}\); \}, \[\]\);/,
  \`const toggleEdgeCell = useCallback((type: any, dir: any, x: any, y: any, mode: any, plotId: any = null) => { setMapGrid((prev: any) => { const id = \\\`\${type}-\${dir}-\${x}-\${y}\\\`; if (mode === 'add') { return prev.some((c: any) => c.id === id) ? prev : [...prev.filter((c: any) => !((c.type.startsWith('fence-') || c.type.startsWith('infra-')) && c.x === x && c.y === y && c.type.endsWith(dir))), { id, type: \\\`\${type}-\${dir}\\\`, x, y, plotId }]; } else { return prev.filter((c: any) => c.id !== id); } }); }, []);\`
);

// 2. Replace handleMouseEnter logic
pageCode = pageCode.replace(
  /const isInfra = houseTypes\.find\(\(h: any\) => h\.id === plotInfo\?\.house_type_id\)\?\.is_infrastructure;\s*if \(isInfra && mapTool === 'plot'\) return; \/\/ Do not draw polyline on drag\s*if \(mapTool === 'fence' \|\| mapTool === 'eraser'\) \{ \s*if \(lastDrawCell\) \{ \s*const dx = x - lastDrawCell\.x, dy = y - lastDrawCell\.y; \s*if \(Math\.abs\(dx\) >= 1 && dy === 0\) toggleFence\('v', Math\.max\(x, lastDrawCell\.x\), y, mapTool === 'eraser' \? 'erase' : 'add'\); \s*else if \(Math\.abs\(dy\) >= 1 && dx === 0\) toggleFence\('h', x, Math\.max\(y, lastDrawCell\.y\), mapTool === 'eraser' \? 'erase' : 'add'\); \s*\} \s*if \(mapTool === 'eraser'\) eraseCell\(x, y\); \s*setLastDrawCell\(\{ x, y \}\); \s*\} else \{/,
  \`const isInfra = houseTypes.find((h: any) => h.id === plotInfo?.house_type_id)?.is_infrastructure;

    if (mapTool === 'fence' || mapTool === 'eraser' || (isInfra && mapTool === 'plot')) { 
        if (lastDrawCell) { 
            const dx = x - lastDrawCell.x, dy = y - lastDrawCell.y; 
            const edgeType = mapTool === 'fence' ? 'fence' : 'infra';
            const mode = mapTool === 'eraser' ? 'erase' : 'add';
            if (Math.abs(dx) >= 1 && dy === 0) toggleEdgeCell(edgeType, 'v', Math.max(x, lastDrawCell.x), y, mode, mapSelectedPlot); 
            else if (Math.abs(dy) >= 1 && dx === 0) toggleEdgeCell(edgeType, 'h', x, Math.max(y, lastDrawCell.y), mode, mapSelectedPlot); 
        } 
        if (mapTool === 'eraser') eraseCell(x, y); 
        setLastDrawCell({ x, y }); 
    } else {\`
);

// Fix dependencies of handleMouseEnter
pageCode = pageCode.replace(
  /\[isDrawing, isEditMapMode, mapTool, lastDrawCell, toggleFence, eraseCell, paintCell, plots, houseTypes, mapSelectedPlot\]\);/g,
  \`[isDrawing, isEditMapMode, mapTool, lastDrawCell, toggleEdgeCell, eraseCell, paintCell, plots, houseTypes, mapSelectedPlot]);\`
);


// 3. Remove polyline logic from handleMouseDown
pageCode = pageCode.replace(
  /const isInfra = houseTypes\.find\(\(h: any\) => h\.id === plotInfo\?\.house_type_id\)\?\.is_infrastructure;\s*if \(isInfra && mapTool === 'plot'\) \{\s*setMapGrid\(\(prev: any\) => \{\s*const existingPoly = prev\.find\(\(c: any\) => c\.type === 'polyline' && c\.plotId === mapSelectedPlot\);\s*if \(existingPoly\) \{\s*const lastPt = existingPoly\.points\[existingPoly\.points\.length - 1\];\s*if \(lastPt && lastPt\.x === x && lastPt\.y === y\) return prev;\s*return prev\.map\(\(c: any\) => c\.id === existingPoly\.id \? \{ \.\.\.c, points: \[\.\.\.c\.points, \{x, y\}\] \} : c\);\s*\} else \{\s*return \[\.\.\.prev, \{ id: \`poly-\$\{mapSelectedPlot\}\`, type: 'polyline', plotId: mapSelectedPlot, points: \[\{x, y\}\] \}\];\s*\}\s*\}\);\s*\} else \{/g,
  \`const isInfra = houseTypes.find((h: any) => h.id === plotInfo?.house_type_id)?.is_infrastructure;
       if (isInfra && mapTool === 'plot') {
           // Drawing infra edges is handled by dragging in handleMouseEnter now.
           // You can also start an edge by clicking and moving.
       } else {\`
);

fs.writeFileSync('app/page.tsx', pageCode);
console.log('page.tsx updated successfully');

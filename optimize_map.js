const fs = require('fs');

// 1. UPDATE app/page.tsx
let pageCode = fs.readFileSync('app/page.tsx', 'utf8');

// Insert gridMap
const gridMapCode = `
  const gridMap = useMemo(() => {
    const map = new Map();
    mapGrid.forEach(c => {
      if (c.type === 'plot' || c.type === 'road' || c.type === 'park') {
        map.set(\`\${c.x}-\${c.y}\`, c);
      }
    });
    return map;
  }, [mapGrid]);
`;

// Replace old getAdjacency
const oldAdjacencyRegex = /const getAdjacency = useCallback\(\(x: number, y: number, type: string, plotId: string \| null\) => \(\{ hasTop: mapGrid\.some[\s\S]*?\}\), \[mapGrid\]\);/;
const newAdjacencyCode = `
  ${gridMapCode}

  const getAdjacency = useCallback((x: number, y: number, type: string, plotId: string | null) => {
    const check = (cx: number, cy: number) => {
      const c = gridMap.get(\`\${cx}-\${cy}\`);
      return c && c.type === type && (type !== 'plot' || c.plotId === plotId);
    };
    return { hasTop: !!check(x, y - 1), hasBottom: !!check(x, y + 1), hasLeft: !!check(x - 1, y), hasRight: !!check(x + 1, y) };
  }, [gridMap]);
`;

pageCode = pageCode.replace(oldAdjacencyRegex, newAdjacencyCode);

// Add gridMap to MapVisualizer props
pageCode = pageCode.replace(/mapGrid=\{mapGrid\}/, 'mapGrid={mapGrid} gridMap={gridMap}');

fs.writeFileSync('app/page.tsx', pageCode);

// 2. UPDATE components/MapVisualizer.tsx
let mapCode = fs.readFileSync('components/MapVisualizer.tsx', 'utf8');

// Add gridMap to MapVisualizerProps
mapCode = mapCode.replace(/mapGrid:\s*any\[\];/, 'mapGrid: any[];\n  gridMap?: Map<string, any>;');

// Destructure gridMap
mapCode = mapCode.replace(/loading, houseTypes\n\s*\} = props;/, 'loading, houseTypes, gridMap\n  } = props;');

// Replace cellData lookup
mapCode = mapCode.replace(/const cellData = mapGrid\.find\(c => c\.x === x && c\.y === y && \(c\.type === 'plot' \|\| c\.type === 'road' \|\| c\.type === 'park'\)\);/, `const cellData = gridMap ? gridMap.get(\`\${x}-\${y}\`) : mapGrid.find((c: any) => c.x === x && c.y === y && (c.type === 'plot' || c.type === 'road' || c.type === 'park'));`);

// Simplify Plot Cards in Edit Mode (Lite Mode)
// Around line where plotBounds are rendered:
// {isEditMapMode ? <SimpleCard/> : <HeavyCard/>}
// Let's find the card rendering part.

// The main card container is:
// <div className={\`w-full h-full border-[2px] sm:border-[3px] rounded-md sm:rounded-lg shadow-sm backdrop-blur-sm flex flex-col items-center justify-center relative transition-all group-hover:shadow-md group-hover:scale-[1.02] \${cardBorderClass} \${highlightRingClass} overflow-hidden\`}>
// I'll replace everything INSIDE this div based on isEditMapMode!
// Wait, we also should skip getPlotOverallStatus if in edit mode!

// Find getPlotOverallStatus call
const oldStatusCall = /const statusInfo = getPlotOverallStatus\(plotInfo\.id\);/;
const newStatusCall = `const statusInfo = isEditMapMode ? { planned: 0, actual: 0, status: 'on-track', label: '' } : getPlotOverallStatus(plotInfo.id);`;
mapCode = mapCode.replace(oldStatusCall, newStatusCall);

// Inside the return for the plotBounds card:
const cardStartRegex = /<div className=\{\`w-full h-full border-\[2px\] sm:border-\[3px\] rounded-md sm:rounded-lg shadow-sm backdrop-blur-sm flex flex-col items-center justify-center relative transition-all group-hover:shadow-md group-hover:scale-\[1\.02\] \$\{cardBorderClass\} \$\{highlightRingClass\} overflow-hidden\`\}>/;

const simpleContent = `
                                     {/* 🌟 LITE MODE สำหรับ Edit Map 🌟 */}
                                     {isEditMapMode && (
                                       <div className="flex flex-col items-center justify-center w-full h-full relative z-10 opacity-70">
                                         <span className="font-bold text-xs sm:text-lg text-slate-800">{plotInfo.plot_name || plotInfo.id}</span>
                                       </div>
                                     )}
                                     
                                     {/* 🌟 FULL MODE สำหรับ View ปกติ 🌟 */}
                                     {!isEditMapMode && (
                                       <>
`;

mapCode = mapCode.replace(cardStartRegex, cardStartRegex.source + '\\n' + simpleContent);

// And we must close the `<>` fragment.
// The end of the card content is before: `</button>` Wait no, the card is wrapped in a `<div onClick...>` and the inner div is what we want.
// Let's find the end of the inner div.
const cardEndRegex = /\{\/\* ไอคอนจอบสีเหลืองในการ์ด \(ผมปรับให้อยู่ตรงกลางบนเหมือนกันเพื่อความสวยงามครับ\) \*\/\}/;

mapCode = mapCode.replace(cardEndRegex, `
                                       </>
                                     )}
                                     {/* ไอคอนจอบสีเหลืองในการ์ด (ผมปรับให้อยู่ตรงกลางบนเหมือนกันเพื่อความสวยงามครับ) */}
`);

fs.writeFileSync('components/MapVisualizer.tsx', mapCode);

console.log('Optimization applied successfully!');

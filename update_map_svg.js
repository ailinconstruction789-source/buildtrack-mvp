const fs = require('fs');

let code = fs.readFileSync('components/MapVisualizer.tsx', 'utf8');

const svgOverlay = `
                     {/* 🌟 SVG Polyline Overlay for Infrastructure 🌟 */}
                     <svg className="absolute inset-0 pointer-events-none z-[55]" style={{ width: '100%', height: '100%' }}>
                         {mapGrid.filter((c: any) => c.type === 'polyline').map((poly: any) => {
                             if (!poly.points || poly.points.length === 0) return null;
                             
                             const plotInfo = plots.find((p: any) => p.id === poly.plotId);
                             if (!plotInfo) return null;
                             
                             const statusInfo = getPlotOverallStatus(plotInfo.id);
                             
                             let strokeColor = "#3b82f6";
                             if (isUtilityMode) {
                                 strokeColor = "#06b6d4";
                             } else {
                                 strokeColor = "rgba(148, 163, 184, 0.7)";
                             }
                     
                             if (statusInfo.status === 'delayed' && !plotInfo.is_completed) strokeColor = "#f43f5e";
                             else if (plotInfo.is_completed) strokeColor = "#10b981";
                     
                             if (poly.points.length === 1) {
                                 return (
                                     <circle 
                                         key={poly.id} 
                                         cx={(poly.points[0].x * 40) + 20} 
                                         cy={(poly.points[0].y * 40) + 20} 
                                         r={isUtilityMode ? "6" : "4"} 
                                         fill={strokeColor} 
                                         className={\`pointer-events-auto cursor-pointer transition-all \${isUtilityMode ? 'drop-shadow-[0_0_8px_rgba(6,182,212,0.8)]' : ''}\`}
                                         onClick={(e) => {
                                             if (!isEditMapMode) {
                                                 e.stopPropagation();
                                                 setSelectedPlot(plotInfo);
                                                 setView('house-detail');
                                             }
                                         }}
                                     />
                                 );
                             }

                             const pointsStr = poly.points.map((p: any) => \`\${(p.x * 40) + 20},\${(p.y * 40) + 20}\`).join(' ');
                     
                             return (
                                 <polyline
                                     key={poly.id}
                                     points={pointsStr}
                                     fill="none"
                                     stroke={strokeColor}
                                     strokeWidth={isUtilityMode ? "8" : "5"}
                                     strokeLinecap="round"
                                     strokeLinejoin="round"
                                     className={\`pointer-events-auto cursor-pointer transition-all \${isUtilityMode ? 'drop-shadow-[0_0_10px_rgba(6,182,212,0.8)]' : ''} hover:stroke-cyan-400\`}
                                     onClick={(e) => {
                                         if (!isEditMapMode) {
                                             e.stopPropagation();
                                             setSelectedPlot(plotInfo);
                                             setView('house-detail');
                                         }
                                     }}
                                 />
                             );
                         })}
                         {/* Show drawing nodes in edit mode */}
                         {isEditMapMode && mapGrid.filter((c: any) => c.type === 'polyline').map((poly: any) => 
                             poly.points.map((p: any, i: number) => (
                                 <circle 
                                     key={\`\${poly.id}-pt-\${i}\`}
                                     cx={(p.x * 40) + 20}
                                     cy={(p.y * 40) + 20}
                                     r="4"
                                     fill={poly.plotId === mapSelectedPlot ? "#ef4444" : "#94a3b8"}
                                     className="pointer-events-none"
                                 />
                             ))
                         )}
                     </svg>
`;

// Insert before plotBounds.map
code = code.replace(/\{plotBounds\.map\(\(bounds: any, idx: number\) => \{/, svgOverlay + '\n                   {plotBounds.map((bounds: any, idx: number) => {');

// Remove the chunky box render for polylines in plotBounds!
// Wait, plotBounds groups standard cells by plotId.
// If a cell is 'polyline', we must EXCLUDE it from plotBounds grouping, otherwise it will try to draw a chunky box around it!
// plotBounds logic is derived from mapGrid. We must find where plotBounds is generated.
code = code.replace(/const getPlotBounds = \(\) => \{/, `const getPlotBounds = () => {\n    const filteredGrid = mapGrid.filter((c: any) => c.type !== 'polyline');\n    const boundsMap = new Map();\n    filteredGrid.forEach((cell: any) => {\n      if (cell.type === 'plot' && cell.plotId) {\n        if (!boundsMap.has(cell.plotId)) boundsMap.set(cell.plotId, { minX: cell.x, maxX: cell.x, minY: cell.y, maxY: cell.y });\n        else {\n          const b = boundsMap.get(cell.plotId);\n          b.minX = Math.min(b.minX, cell.x); b.maxX = Math.max(b.maxX, cell.x);\n          b.minY = Math.min(b.minY, cell.y); b.maxY = Math.max(b.maxY, cell.y);\n        }\n      }\n    });\n    return Array.from(boundsMap.entries()).map(([id, bounds]) => ({ id, ...bounds }));\n  };\n\n  // old getPlotBounds: `);

fs.writeFileSync('components/MapVisualizer.tsx', code);
console.log('MapVisualizer updated with SVG overlay');

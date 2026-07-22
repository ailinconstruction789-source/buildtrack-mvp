const fs = require('fs');
let code = fs.readFileSync('components/MapVisualizer.tsx', 'utf8');

// Change `(gridMap ? Array.from(gridMap.values()) : mapGrid)` to just `mapGrid`
code = code.replace(/\(gridMap \? Array\.from\(gridMap\.values\(\)\) : mapGrid\)\.filter/g, 'mapGrid.filter');

fs.writeFileSync('components/MapVisualizer.tsx', code);
console.log('Fixed polyline source array');

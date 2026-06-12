const fs = require('fs');
const files = [
  'app/page.tsx',
  'components/DashboardOverview.tsx',
  'components/HouseDetailView.tsx',
  'components/MapVisualizer.tsx',
  'components/TaskProgressView.tsx',
  'package.json',
  'code_review_report.md'
];

files.forEach(file => {
  try {
    const stats = fs.statSync(file);
    console.log(`${file}: mtime=${stats.mtime.toISOString()} size=${stats.size}`);
  } catch (err) {
    console.log(`${file}: ERROR ${err.message}`);
  }
});

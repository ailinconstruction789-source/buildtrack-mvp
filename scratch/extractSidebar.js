const fs = require('fs');
const code = fs.readFileSync('d:/buildtrack/buildtrack-mvp-main/app/page.tsx', 'utf8');
const lines = code.split('\n');
const sidebarLines = lines.slice(2551, 2679); // 2552 is index 2551

const icons = ['LayoutDashboard', 'ClipboardList', 'Home', 'PieChart', 'BarChartHorizontal', 'TrendingUp', 'Building2', 'Users', 'Lightbulb', 'Grid', 'Calendar', 'Activity', 'ShieldAlert', 'PlusCircle', 'MapIcon', 'Building', 'DollarSign', 'Monitor', 'FileSpreadsheet', 'Wrench', 'FolderOpen', 'Smartphone', 'ChevronRight'];

const sidebarFileContent = `'use client';
import React, { useState } from 'react';
import { ${icons.join(', ')} } from 'lucide-react';

const Sidebar = React.memo(({
  activeView,
  setView,
  setSelectedProject,
  isAdmin,
  isOwner,
  isSiteEngineer,
  isProjectPlanner,
  isQC,
  isForeman,
  isSales,
  isProcurement,
  isStore,
  isMobilePreview,
  setIsMobilePreview,
  isMobileLayout
}: any) => {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);

  return (
${sidebarLines.join('\n')}
  );
});

export default Sidebar;
`;

fs.writeFileSync('d:/buildtrack/buildtrack-mvp-main/components/Sidebar.tsx', sidebarFileContent);
console.log('Sidebar created');

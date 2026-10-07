/** Restore the Dashboard presentation only; all readers, guards and flags come from production. */
export const DASHBOARD_BASELINE = 'e91e22f373ce635778ebab33ef9f4cc03c40ed90';
export const DASHBOARD_RUNTIME_FILES = Object.freeze([
  'components/sales/CentralExcelReportView.tsx',
  'components/sales/CentralLegacyDashboard.tsx',
  'components/sales/CentralLegacyWaitingDetails.tsx',
].sort());
export const DASHBOARD_OVERLAY_TEST_FILES = Object.freeze([
  'components/sales/__tests__/CentralExcelReportView.test.tsx',
  'components/sales/__tests__/CentralLegacyWaitingDetails.test.tsx',
].sort());
export const DASHBOARD_OVERLAY = Object.freeze([...DASHBOARD_RUNTIME_FILES, ...DASHBOARD_OVERLAY_TEST_FILES].sort());
export const DASHBOARD_TEST_FILES = Object.freeze([
  ...DASHBOARD_OVERLAY_TEST_FILES,
  'components/sales/__tests__/CentralExcelReportWorkspace.test.tsx',
  'components/sales/__tests__/ExcelReportingBoundary.test.tsx',
  'lib/sales/__tests__/excelReportClient.test.ts',
  'lib/sales/__tests__/excelReportMetrics.test.ts',
  'lib/sales/__tests__/excelReportServer.test.ts',
].sort());

function safeSource(file) {
  if (typeof file !== 'string' || !file || file.includes('\\') || file.includes(':')) return false;
  if (file.split('/').some(part => !part || part.startsWith('.') || part === 'node_modules')) return false;
  return /\.(?:tsx?|mts|[cm]?js|jsx|css)$/.test(file)
    || ['package.json', 'package-lock.json', 'tsconfig.json'].includes(file)
    || /^(?:public|app)\/.*\.(?:svg|png|jpe?g|webp|ico|woff2?)$/.test(file);
}

export function selectedDashboardFiles(baselineFiles, includeSource) {
  if (new Set(DASHBOARD_OVERLAY).size !== DASHBOARD_OVERLAY.length) throw new Error('Duplicate Dashboard overlay');
  if (DASHBOARD_OVERLAY.some(file => !safeSource(file) || !includeSource(file))) throw new Error('Unsafe Dashboard overlay');
  return [...new Set([...baselineFiles.filter(file => safeSource(file) && includeSource(file)), ...DASHBOARD_OVERLAY])].sort();
}

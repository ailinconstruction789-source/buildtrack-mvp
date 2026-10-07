/** Bounded data connections on top of the already-restored production Dashboard. */
export const DETAILS_BASELINE = 'ebde3bdf459ec2a1015925fd56ecc67577e2b819';
export const DETAILS_OVERLAY = Object.freeze([
  'components/sales/CentralLegacyDashboard.tsx',
  'components/sales/CentralLegacyWaitingDetails.tsx',
  'components/sales/__tests__/CentralExcelReportView.test.tsx',
  'components/sales/__tests__/CentralLegacyWaitingDetails.test.tsx',
  'lib/sales/excelReportContracts.ts',
  'lib/sales/excelReportMetrics.ts',
  'lib/sales/excelHouseDetails.ts',
  'lib/sales/excelHouseDetailsServer.ts',
  'lib/sales/projectSalesServer.ts',
  'lib/sales/__tests__/excelReportMetrics.test.ts',
  'lib/sales/__tests__/excelReportServer.test.ts',
  'lib/sales/__tests__/excelBookingAmounts.test.ts',
  'lib/sales/__tests__/excelHouseDetails.test.ts',
  'lib/sales/__tests__/excelHouseDetailsServer.test.ts',
].sort());
export const DETAILS_TEST_FILES = Object.freeze([...DETAILS_OVERLAY.filter(file => /\.test\./.test(file)),
  'components/sales/__tests__/CentralExcelReportWorkspace.test.tsx',
  'components/sales/__tests__/ExcelReportingBoundary.test.tsx',
  'lib/sales/__tests__/excelReportClient.test.ts',
].sort());
export function selectedDetailsFiles(baselineFiles, includeSource) {
  const safe = file => typeof file === 'string' && !file.includes('\\') && !file.includes(':')
    && file.split('/').every(part => part && !part.startsWith('.') && part !== 'node_modules') && includeSource(file);
  if (DETAILS_OVERLAY.some(file => !safe(file))) throw new Error('Unsafe Dashboard details overlay');
  return [...new Set([...baselineFiles.filter(safe), ...DETAILS_OVERLAY])].sort();
}

/** Local-only Excel candidate: immutable deployed baseline plus this explicit overlay. */
import { createHash } from 'node:crypto';

export const EXCEL_BASELINE = '89b63b48087fe2bcdd1afd8280d10c6d4c333902';
export const EXCEL_ENTRY_PATH = 'components/sales/SalesReportingEntry.tsx';
export const EXCEL_ENTRY_BASELINE_SHA256 = 'bf5a4cb980ab0a73fbf2535c71e9a37c1d7c6fc3191348d1cf617097223f28a5';
export const EXCEL_RUNTIME_FILES = Object.freeze([
  'app/api/sales-crm/excel-report/route.ts',
  'components/sales/CentralExcelReportWorkspace.tsx',
  'components/sales/CentralExcelReportView.tsx',
  EXCEL_ENTRY_PATH,
  'lib/sales/excelReportClient.ts',
  'lib/sales/excelReportContracts.ts',
  'lib/sales/excelReportMetrics.ts',
  'lib/sales/projectSalesServer.ts',
].sort());
export const EXCEL_TEST_FILES = Object.freeze([
  'components/sales/__tests__/CentralExcelReportView.test.tsx',
  'components/sales/__tests__/CentralExcelReportWorkspace.test.tsx',
  'components/sales/__tests__/ExcelReportingBoundary.test.tsx',
  'lib/sales/__tests__/excelReportClient.test.ts',
  'lib/sales/__tests__/excelReportMetrics.test.ts',
  'lib/sales/__tests__/excelReportServer.test.ts',
].sort());
export const EXCEL_OVERLAY = Object.freeze([...EXCEL_RUNTIME_FILES, ...EXCEL_TEST_FILES].sort());
// Only these files may be read from the dirty main checkout. Entry is derived from Git below.
export const EXCEL_SOURCE_FILES = Object.freeze(EXCEL_OVERLAY.filter(file => file !== EXCEL_ENTRY_PATH));

function safeSource(file) {
  if (typeof file !== 'string' || !file || file.includes('\\') || file.includes(':')) return false;
  if (file.split('/').some(part => !part || part.startsWith('.') || part === 'node_modules')) return false;
  return /\.(?:tsx?|mts|[cm]?js|jsx|css)$/.test(file)
    || ['package.json', 'package-lock.json', 'tsconfig.json'].includes(file)
    || /^(?:public|app)\/.*\.(?:svg|png|jpe?g|webp|ico|woff2?)$/.test(file);
}

export function selectedExcelFiles(baselineFiles, includeSource) {
  if (new Set(EXCEL_OVERLAY).size !== EXCEL_OVERLAY.length) throw new Error('Duplicate Excel overlay');
  if (EXCEL_OVERLAY.some(file => !safeSource(file) || !includeSource(file))) throw new Error('Unsafe Excel overlay');
  return [...new Set([...baselineFiles.filter(file => safeSource(file) && includeSource(file)), ...EXCEL_OVERLAY])].sort();
}

const entryImport = "import CentralExcelReportWorkspace from './CentralExcelReportWorkspace';\n";
const entryBranch = "  if (props.surface === 'dashboard' || props.surface === 'summary') return <CentralExcelReportWorkspace surface={props.surface} initialProjectName={projectName} />;\n";

/** Return null for normal source selection. For Entry pass the exact Git baseline body,
 * never the dirty main Entry. The baseline digest fails closed if its guards drift.
 * Caller records the returned body's digest as the overlay/snapshot hash and must not
 * list the dirty Entry among report.sources. No filesystem or Git writes occur here. */
export function excelSourceOverride(file, baselineSource) {
  if (file !== EXCEL_ENTRY_PATH) return null;
  if (typeof baselineSource !== 'string') throw new Error('Excel entry requires its immutable baseline source');
  const source = baselineSource.replaceAll('\r\n', '\n');
  if (createHash('sha256').update(source).digest('hex') !== EXCEL_ENTRY_BASELINE_SHA256) throw new Error('Excel entry baseline mismatch');
  const importAnchor = "import { useSalesWorkspaceMode } from './SalesWorkspaceModeProvider';\n";
  const branchAnchor = "  const projectName = 'project' in props && typeof props.project?.name === 'string' && props.project.name.trim() ? props.project.name : null;\n";
  if (source.split(importAnchor).length !== 2 || source.split(branchAnchor).length !== 2) throw new Error('Excel entry anchor mismatch');
  return source.replace(importAnchor, importAnchor + entryImport).replace(branchAnchor, branchAnchor + entryBranch);
}

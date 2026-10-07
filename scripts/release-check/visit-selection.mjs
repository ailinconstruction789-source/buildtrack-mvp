/** Explicit local candidate overlay. Never copies the dirty application wholesale. */
export const VISIT_BASELINE = '7499cdd638bc2ff0c33b3ece4d8b0f1e8e7ed857';
export const VISIT_RUNTIME_FILES = Object.freeze([
  ...['notifications', 'work-schedule', 'sla-preview', 'sla-processing'].map(name => `app/sales-crm/${name}/page.tsx`),
  ...['notification', 'workSchedule', 'slaPreview', 'slaCycle', 'slaReceipt', 'slaProcessing'].map(name => `lib/sales/${name}Server.ts`),
  'app/sales-crm/page.tsx',
  'app/sales-crm/visits/page.tsx', 'app/sales-crm/sop/page.tsx',
  'app/sales-crm/customer-voices/page.tsx', 'app/customer-voices/page.tsx',
  'app/sales-crm/visit-follow-up/page.tsx',
  'app/api/sales-crm/visits/route.ts', 'app/api/sales-crm/sop/route.ts',
  'app/api/sales-crm/customer-voices/route.ts', 'app/api/customer-voices/route.ts',
  'app/api/sales-crm/visit-follow-up/route.ts',
  'components/sales/CentralLeadsView.tsx', 'components/sales/CentralLeadTracker.tsx',
  'components/sales/VisitsWorkspace.tsx', 'components/sales/VisitActionForm.tsx',
  'components/sales/VisitSopWorkspace.tsx', 'components/sales/VisitSopForm.tsx',
  'components/sales/CustomerVoicesWorkspace.tsx', 'components/sales/CustomerVoiceForm.tsx',
  'components/sales/CustomerVoicePublic.tsx', 'components/sales/VisitFollowUpWorkspace.tsx',
  'components/sales/LeadWorkForm.tsx',
  'lib/sales/releaseScope.ts', 'lib/sales/leadWorkServer.ts',
  'lib/sales/leadWorkClient.ts', 'lib/sales/leadWorkReadContracts.ts',
  'lib/sales/visitFollowUpClient.ts',
  ...['visits', 'visitSop'].flatMap(name => ['Client', 'Contracts', 'Pending', 'Server'].map(kind => `lib/sales/${name}${kind}.ts`)),
  'lib/sales/visitSopTemplate.ts',
  ...['Client', 'Contracts', 'Server', 'Template'].map(kind => `lib/sales/customerVoices${kind}.ts`),
  'next.config.ts', 'package.json', 'package-lock.json',
].sort());
export const VISIT_TEST_FILES = Object.freeze([
  ...['VisitsWorkspace', 'VisitActionForm', 'VisitsPage', 'VisitSopWorkspace', 'VisitSopForm', 'VisitSopPage',
    'CustomerVoicesWorkspace', 'CustomerVoiceForm', 'CustomerVoicePublic', 'CustomerVoicesPage',
    'VisitFollowUpWorkspace', 'VisitFollowUpPage'].map(name => `components/sales/__tests__/${name}.test.tsx`),
  'components/sales/__tests__/visitsFixtures.ts',
  ...['visits', 'visitSop'].flatMap(name => ['Client', 'Contracts', 'Pending', 'Server'].map(kind => `lib/sales/__tests__/${name}${kind}.test.ts`)),
  ...['Client', 'Contracts', 'Qr', 'Server'].map(kind => `lib/sales/__tests__/customerVoices${kind}.test.ts`),
  'lib/sales/__tests__/visitFollowUpClient.test.ts', 'lib/sales/__tests__/visitFollowUpServer.test.ts',
  ...['visits', 'visitSop', 'customerVoices'].map(name => `lib/sales/__tests__/${name}Fixtures.ts`),
].sort());
export const VISIT_OVERLAY = Object.freeze([...VISIT_RUNTIME_FILES, ...VISIT_TEST_FILES].sort());

export function selectedVisitFiles(baselineFiles, includeSource) {
  if (new Set(VISIT_OVERLAY).size !== VISIT_OVERLAY.length) throw new Error('Duplicate Visit overlay');
  if (VISIT_OVERLAY.some(file => !includeSource(file))) throw new Error('Unsafe Visit overlay');
  return [...new Set([...baselineFiles.filter(includeSource), ...VISIT_OVERLAY])].sort();
}

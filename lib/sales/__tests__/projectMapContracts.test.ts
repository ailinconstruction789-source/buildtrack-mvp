import { describe, expect, it } from 'vitest';
import { buildProjectMap, parseProjectMapSnapshot, parseStoredProjectMapLayout } from '../projectMapContracts';
import { projectMapSnapshot } from './projectMapFixtures';
import type { RentalProjectPage, RentalProjectRow } from '../rentalProjectReadContracts';
import { pid, projectSale } from './projectSalesFixtures';


const leaseRow=(overrides:Partial<RentalProjectRow>={}):RentalProjectRow=>({contractId:pid(70),customerId:pid(71),interestId:pid(72),ownerUserId:pid(8),projectName:'โครงการ A',plotId:'P-2',customerName:'ลูกค้าเช่า',customerPhone:null,programType:'program_b',status:'active',revision:pid(73),startDate:'2026-01-01',endDate:'2026-12-31',endedDate:null,convertedSaleId:null,...overrides});
const leasePage=(overrides:Partial<RentalProjectPage>={}):RentalProjectPage=>({projectName:'โครงการ A',actor:{userId:pid(8),role:'sales'},snapshotRevision:'a'.repeat(32),page:0,hasMore:false,rows:[leaseRow()],...overrides});

describe('project map original geometry and current booking identity', () => {
  it('keeps original coordinates and separates construction completion from transfer', () => {
    const snapshot = parseProjectMapSnapshot(projectMapSnapshot(), 'โครงการ A');
    const { regions } = buildProjectMap(snapshot);
    expect(regions[0]).toMatchObject({ x: 1, y: 1, width: 1, height: 2, status: 'booked', isCompleted: true });
    expect(regions[1]).toMatchObject({ status: 'available', isCompleted: true });
  });
  it('cancelled history does not occupy an otherwise vacant plot; later booking wins', () => {
    const snapshot = projectMapSnapshot();
    snapshot.salePages[0].rows = [projectSale({ stage: 'cancelled', plotId: 'P-2' })];
    expect(buildProjectMap(snapshot).regions[1]).toMatchObject({ status: 'available', currentSale: null, history: [expect.anything()] });
    snapshot.plots[1].hasCustomer = true;
    snapshot.salePages[0].rows.push(projectSale({ saleId: pid(9), plotId: 'P-2' }));
    expect(buildProjectMap(snapshot).regions[1]).toMatchObject({ status: 'booked', currentSale: { saleId: pid(9) } });
  });
  it('transfer is based on the current sale, not completion', () => {
    const snapshot = projectMapSnapshot(); snapshot.salePages[0].rows[0].stage = 'transferred';
    snapshot.plots[0].saleStatus = 'transferred';
    expect(buildProjectMap(snapshot).regions[0].status).toBe('transferred');
  });
  it('marks conflicting plot flags and sales stages unknown in both directions', () => {
    const snapshot = projectMapSnapshot(); snapshot.plots[0].saleStatus = 'transferred';
    expect(buildProjectMap(snapshot).regions[0].status).toBe('unknown');
    snapshot.plots[0].saleStatus = 'active'; snapshot.salePages[0].rows[0].stage = 'transferred';
    expect(buildProjectMap(snapshot).regions[0].status).toBe('unknown');
  });
  it('shows duplicates, unknown occupancy and unmatched canonical IDs as unknown, never guesses names', () => {
    const snapshot = projectMapSnapshot();
    snapshot.salePages[0].rows.push(projectSale({ saleId: pid(7) }));
    expect(buildProjectMap(snapshot).regions[0].status).toBe('unknown');
    snapshot.plots[1].hasCustomer = null;
    snapshot.layout.cells.push({ x: 5, y: 1, type: 'plot', plotId: 'A1' });
    expect(buildProjectMap(snapshot).regions.map(r => r.status)).toEqual(['unknown', 'unknown', 'unknown']);
  });
  it('does not call an occupied plot or stale transferred flag vacant when sales are absent', () => {
    const snapshot = projectMapSnapshot(); snapshot.salePages[0].rows = [];
    snapshot.plots[1].saleStatus = 'transferred';
    expect(buildProjectMap(snapshot).regions.every(r => r.status === 'unknown')).toBe(true);
  });
  it('returns off-map plots separately without fabricating their positions on the map', () => {
    const snapshot = projectMapSnapshot(); snapshot.layout.cells = [];
    expect(buildProjectMap(snapshot)).toMatchObject({ regions: [], unmappedPlots: [expect.objectContaining({ plotId: 'P-1' }), expect.objectContaining({ plotId: 'P-2' })] });
    expect(buildProjectMap(snapshot).unmappedPlots[1].status).toBe('unknown');
  });
  it('preserves roads, parks, fences and infrastructure', () => {
    expect(parseStoredProjectMapLayout([{ type: 'config', cols: 3, rows: 2 },
      { type: 'park', x: 0, y: 0 }, { type: 'fence-h', x: 1, y: 0 }, { type: 'infra-h', x: 2, y: 0 },
    ]).cells.map(c => c.type)).toEqual(['park', 'fence-h', 'infra-h']);
    expect(parseStoredProjectMapLayout(null).cells).toEqual([]);
  });
  it('accepts original layered fences and infrastructure over plot and road cells', () => {
    const layout = parseStoredProjectMapLayout([{ type: 'config', cols: 1, rows: 1 },
      { type: 'plot', plotId: 'P-1', x: 0, y: 0 }, { type: 'fence-h', x: 0, y: 0 },
      { type: 'fence-v', x: 0, y: 0 }, { type: 'infra-h', x: 0, y: 0 },
    ]);
    expect(layout.cells).toHaveLength(4);
    expect(() => parseStoredProjectMapLayout([...layout.cells, { type: 'fence-h', x: 0, y: 0 }])).toThrow();
  });
  it.each([
    [{ type: 'config', cols: 999, rows: 1 }],
    [{ type: 'road', x: -1, y: 0 }],
    [{ type: 'road', x: 0, y: 0 }, { type: 'plot', x: 0, y: 0, plotId: 'P-1' }],
    [{ type: 'script', x: 0, y: 0 }],
  ])('rejects broken/unsafe geometry %j', (...cells) => expect(() => parseStoredProjectMapLayout(cells)).toThrow());
  it('rejects wrong project, partial pages, repeated sales and cross-actor pages', () => {
    const snapshot = projectMapSnapshot();
    expect(() => parseProjectMapSnapshot(snapshot, 'โครงการ B')).toThrow();
    snapshot.salePages[0].hasMore = true;
    expect(() => parseProjectMapSnapshot(snapshot, 'โครงการ A')).toThrow();
    snapshot.salePages[0].hasMore = false;
    snapshot.salePages[0].rows.push(projectSale());
    expect(() => parseProjectMapSnapshot(snapshot, 'โครงการ A')).toThrow();
    snapshot.salePages[0].rows.pop(); snapshot.actor = { ...snapshot.actor, userId: pid(99) };
    expect(() => parseProjectMapSnapshot(snapshot, 'โครงการ A')).toThrow();
  });
});


describe('canonical rentals on project map',()=>{
 it('keeps absent rental pages absent and old sale/vacancy projection intact',()=>{const s=parseProjectMapSnapshot(projectMapSnapshot(),'โครงการ A');expect(s).not.toHaveProperty('rentalPages');expect(buildProjectMap(s).regions.map(r=>r.status)).toEqual(['booked','available']);});
 it('shows one exact active rental as occupied, preserving history and geometry',()=>{const s=projectMapSnapshot();s.rentalPages=[leasePage()];s.plots[1].hasCustomer=true;const regions=buildProjectMap(parseProjectMapSnapshot(s,'โครงการ A')).regions;expect(regions[1]).toMatchObject({status:'rented',currentSale:null,currentRental:{contractId:pid(70),customerId:pid(71)},x:3,y:1,width:1,height:1,rentalHistory:[expect.anything()]});});
 it.each(['active','renewed'] as const)('recognizes current rental %s',status=>{const s=projectMapSnapshot();s.rentalPages=[leasePage({rows:[leaseRow({status})]})];s.plots[1].hasCustomer=true;expect(buildProjectMap(s).regions[1].status).toBe('rented');});
 it('never considers active lease with vacant flag or conflicting purchase or multiple leases available',()=>{const s=projectMapSnapshot();s.rentalPages=[leasePage()];expect(buildProjectMap(s).regions[1].status).toBe('unknown');s.plots[1].hasCustomer=true;s.salePages[0].rows.push(projectSale({saleId:pid(19),plotId:'P-2'}));expect(buildProjectMap(s).regions[1].status).toBe('unknown');s.salePages[0].rows.pop();s.rentalPages[0].rows.push(leaseRow({contractId:pid(75)}));expect(buildProjectMap(s).regions[1]).toMatchObject({status:'unknown',currentRental:null});});
 it('ended and converted rentals remain history without preventing a verified vacancy or active purchase',()=>{const s=projectMapSnapshot();s.rentalPages=[leasePage({rows:[leaseRow({status:'ended',endedDate:'2026-10-09'})]})];expect(buildProjectMap(s).regions[1]).toMatchObject({status:'available',currentRental:null,rentalHistory:[expect.anything()]});s.rentalPages[0].rows[0].status='converted';s.rentalPages[0].rows[0].convertedSaleId=pid(19);s.salePages[0].rows.push(projectSale({saleId:pid(19),plotId:'P-2'}));s.plots[1].hasCustomer=true;expect(buildProjectMap(s).regions[1]).toMatchObject({status:'booked',currentRental:null});});
 it('does not match nickname, alternate project, or leading zero IDs',()=>{const s=projectMapSnapshot();s.rentalPages=[leasePage({rows:[leaseRow({plotId:'A2'})]})];expect(buildProjectMap(s).regions[1]).toMatchObject({status:'available',rentalHistory:[]});s.rentalPages[0].rows[0].plotId='P-02';expect(buildProjectMap(s).regions[1].rentalHistory).toEqual([]);s.rentalPages[0].rows[0].plotId='P-2';s.rentalPages[0].rows[0].projectName='โครงการ B';expect(buildProjectMap(s).regions[1].rentalHistory).toEqual([]);});
 it('rejects absent-first pages, duplicate contracts, partial terminal pages and changed fingerprint/actor',()=>{const s=projectMapSnapshot();s.rentalPages=[];expect(()=>parseProjectMapSnapshot(s,'โครงการ A')).toThrow();const first=leasePage({hasMore:true,rows:Array.from({length:50},(_,i)=>leaseRow({contractId:pid(i+100)}))});const second=leasePage({page:1});s.rentalPages=[first,second];expect(parseProjectMapSnapshot(s,'โครงการ A').rentalPages).toHaveLength(2);second.snapshotRevision='b'.repeat(32);expect(()=>parseProjectMapSnapshot(s,'โครงการ A')).toThrow();second.snapshotRevision=first.snapshotRevision;second.actor={...second.actor,userId:pid(99)};expect(()=>parseProjectMapSnapshot(s,'โครงการ A')).toThrow();second.actor=first.actor;second.rows=[first.rows[0]];expect(()=>parseProjectMapSnapshot(s,'โครงการ A')).toThrow();second.rows=[leaseRow()];second.hasMore=true;expect(()=>parseProjectMapSnapshot(s,'โครงการ A')).toThrow();});
});

it.each(['','active','normal','ready_for_sale','available','vacant',' Available '])('supports verified lease on accepted source saleStatus %s',saleStatus=>{const s=projectMapSnapshot();s.rentalPages=[leasePage()];s.plots[1].hasCustomer=true;s.plots[1].saleStatus=saleStatus;expect(buildProjectMap(s).regions[1].status).toBe('rented');});
it('does not treat transferred flags or unmapped registry entries as verified rental map status',()=>{const s=projectMapSnapshot();s.rentalPages=[leasePage()];s.plots[1].hasCustomer=true;s.plots[1].saleStatus='transferred';expect(buildProjectMap(s).regions[1].status).toBe('unknown');s.plots[1].saleStatus='active';s.layout.cells=s.layout.cells.filter(c=>c.plotId!=='P-2');expect(buildProjectMap(s).unmappedPlots[0].status).toBe('unknown');});

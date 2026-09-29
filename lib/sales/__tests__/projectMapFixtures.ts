import type { ProjectMapSnapshot } from '../projectMapContracts';
import { projectSale, projectScope, projectSnapshot } from './projectSalesFixtures';
export function projectMapSnapshot(): ProjectMapSnapshot {
  return { projectName: 'โครงการ A', actor: projectSnapshot().actor,
    layout: { cols: 6, rows: 4, cells: [
      { x: 1, y: 1, type: 'plot', plotId: 'P-1' }, { x: 1, y: 2, type: 'plot', plotId: 'P-1' },
      { x: 2, y: 1, type: 'road' }, { x: 3, y: 1, type: 'plot', plotId: 'P-2' },
    ] },
    plots: [
      { id: 'P-1', name: 'A1', hasCustomer: true, isCompleted: true, saleStatus: 'ready_for_sale' },
      { id: 'P-2', name: 'A2', hasCustomer: false, isCompleted: true, saleStatus: 'ready_for_sale' },
    ], salePages: [{ ...projectSnapshot(projectScope({ tab: 'all' })), rows: [projectSale()] }],
  };
}

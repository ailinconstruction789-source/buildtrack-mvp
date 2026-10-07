import React from 'react';
import { createRoot } from 'react-dom/client';
import ProjectSalesMap from '../../components/sales/ProjectSalesMap';
import { projectMapSnapshot } from '../../lib/sales/__tests__/projectMapFixtures';
import '../../app/globals.css';

const data = projectMapSnapshot();
data.layout = { cols: 20, rows: 14, cells: [] };
data.plots = [];
data.salePages[0].rows = [];
for (let n = 0; n < 18; n++) {
  const x = 2 + (n % 6) * 3, y = 2 + Math.floor(n / 6) * 4;
  const id = `DEMO-${n + 1}`;
  for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 3; dy++) data.layout.cells.push({ x: x + dx, y: y + dy, type: 'plot', plotId: id });
  data.layout.cells.push({ x, y: y + 3, type: 'road' }, { x: x + 1, y: y + 3, type: 'road' }, { x: x + 2, y: y + 3, type: 'road' });
  const transferred = n % 3 === 0, booked = n % 3 === 1;
  data.plots.push({ id, name: String(n + 1), hasCustomer: transferred || booked, isCompleted: n % 2 === 0, saleStatus: transferred ? 'transferred' : 'active' });
  if (booked || transferred) data.salePages[0].rows.push({ ...projectMapSnapshot().salePages[0].rows[0],
    saleId: `19000000-0000-4000-8000-${String(n + 100).padStart(12, '0')}`, plotId: id, plotName: String(n + 1), stage: transferred ? 'transferred' : 'booked', customerName: `ลูกค้าจำลอง ${n + 1}` });
}
const api = { read: async () => data };
createRoot(document.getElementById('root')!).render(<main className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6"><p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">ทดสอบหน้าจอด้วยข้อมูลจำลองเท่านั้น — ไม่เชื่อมฐานจริง</p><ProjectSalesMap projectName="โครงการ A" api={api} /></main>);

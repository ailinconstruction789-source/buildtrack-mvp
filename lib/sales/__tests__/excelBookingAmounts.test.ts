import { describe, expect, it } from 'vitest';
import { parseExcelBookingAmounts } from '../excelReportContracts';
import { projectMapSnapshot } from './projectMapFixtures';

const map = projectMapSnapshot();
const fixture = () => ({ contractVersion: 'excel_booking_amounts_v1', projectName: map.projectName, actor: map.actor,
  rows: map.salePages.flatMap(page => page.rows).map(sale => ({ saleId: sale.saleId, tdPrice: null as number | null })) });

describe('project-bound TD evidence', () => {
  it('covers every booking round, keeps missing values null and explicit zero', () => {
    const data = fixture(); data.rows[0].tdPrice = 0;
    expect(parseExcelBookingAmounts(data, map)).toEqual(data.rows);
  });
  it.each(['project', 'actor', 'role', 'version', 'missing', 'duplicate', 'unrelated', 'negative', 'infinite', 'string'])('rejects %s evidence', issue => {
    const data = fixture();
    const raw = data as unknown as Record<string, unknown>;
    if (issue === 'project') data.projectName = 'other';
    if (issue === 'actor') data.actor = { ...data.actor, userId: 'other' };
    if (issue === 'role') data.actor = { ...data.actor, role: 'owner' };
    if (issue === 'version') data.contractVersion = 'other';
    if (issue === 'missing') data.rows.pop();
    if (issue === 'duplicate') data.rows[1] = data.rows[0];
    if (issue === 'unrelated') data.rows[0].saleId = '11111111-1111-4111-8111-111111111111';
    if (issue === 'negative') data.rows[0].tdPrice = -1;
    if (issue === 'infinite') data.rows[0].tdPrice = Infinity;
    if (issue === 'string') raw.rows = data.rows.map(row => ({ ...row, tdPrice: '100' }));
    expect(() => parseExcelBookingAmounts(raw, map)).toThrow();
  });
});

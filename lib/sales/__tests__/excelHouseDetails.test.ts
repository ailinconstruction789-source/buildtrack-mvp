import { describe, expect, it } from 'vitest';
import { EXCEL_FOREMAN_TASKS, parseExcelHouseDetails, safeHouseImage } from '../excelHouseDetails';
export const houseFixture = () => ({ imageUrl: 'https://example.com/house.jpg', houseType: 'แบบ A', overallProgress: 50,
  tasks: EXCEL_FOREMAN_TASKS.map(name => ({ name, progress: 0, excluded: false })),
  inspections: [{ date: '2026-09-30', status: 'scheduled' }, { date: null, status: 'pending' }] });
describe('house report evidence contract', () => {
  it('preserves known zero and unknown separately', () => {
    const value = houseFixture(); value.tasks[0].progress = 100;
    const result = parseExcelHouseDetails(value);
    expect(result.tasks[1].progress).toBe(0);
    expect(result.inspections[1].date).toBeNull();
    expect(result.overallProgress).toBe(50);
  });
  it.each(['javascript:alert(1)', 'data:image/png;base64,abc', '//evil.test/a', 'file:///C:/x', 'https://user:pass@example.com/x', 'http://example.com/x'])('rejects unsafe image %s', url => expect(safeHouseImage(url)).toBeNull());
  it('rejects duplicate/missing task labels, impossible dates, statuses and invalid progress', () => {
    const wrongTask = houseFixture(); wrongTask.tasks[0].name = wrongTask.tasks[1].name;
    const wrongDate = houseFixture(); wrongDate.inspections[0].date = '2026-02-30';
    const wrongStatus = houseFixture(); wrongStatus.inspections[0].status = 'complete';
    for (const value of [wrongTask, wrongDate, wrongStatus, { ...houseFixture(), overallProgress: 101 }]) expect(() => parseExcelHouseDetails(value)).toThrow();
  });
});

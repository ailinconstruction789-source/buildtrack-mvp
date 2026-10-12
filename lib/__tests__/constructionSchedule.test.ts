import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  constructionScheduleAssignmentIndex, constructionScheduleDateMs, constructionScheduleDayGroups,
  constructionScheduleFirstIndex, constructionScheduleGanttLanes, constructionScheduleGanttRange,
  constructionScheduleHouseTypeIndex,
} from '../constructionSchedule';

describe('construction schedule calendar dates', () => {
  it.each(['Asia/Bangkok', 'UTC', 'America/New_York'])('keeps inclusive calendar-day boundaries in %s', timezone => {
    const source = readFileSync(path.resolve(process.cwd(), 'lib/constructionSchedule.ts'), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const script = `const exports = {};\n${compiled}\n
      const dateMs = exports.constructionScheduleDateMs('2026-10-08');
      const today = new Date(2026,9,8); const end = new Date(2026,9,90);
      const start = new Date(2026,9,1).getTime();
      const lastString = end.getFullYear()+'-'+String(end.getMonth()+1).padStart(2,'0')+'-'+String(end.getDate()).padStart(2,'0');
      console.log(JSON.stringify({ hours: new Date(dateMs).getHours(), day: new Date(dateMs).getDate(),
        todayActive: dateMs <= today.getTime() && today.getTime() <= dateMs,
        oldTodayActive: new Date('2026-10-08').getTime() <= today.getTime() && today.getTime() <= new Date('2026-10-08').getTime(),
        first: exports.constructionScheduleGanttRange('2026-10-01','2026-10-01',start,end.getTime()),
        last: exports.constructionScheduleGanttRange(lastString,lastString,start,end.getTime()),
        acrossDst: exports.constructionScheduleGanttRange('2026-03-09','2026-03-09',new Date(2026,2,1).getTime(),new Date(2026,4,29).getTime()) }));`;
    const result = JSON.parse(execFileSync(process.execPath, ['-e', script], {
      encoding: 'utf8', env: { NODE_ENV: 'test', TZ: timezone, SystemRoot: process.env.SystemRoot },
    }));
    expect(result.hours).toBe(0);
    expect(result.day).toBe(8);
    expect(result.todayActive).toBe(true);
    if (timezone === 'Asia/Bangkok') expect(result.oldTodayActive).toBe(false);
    expect(result.first).toEqual({ startIdx: 0, endIdx: 0, width: 40, left: 0 });
    expect(result.last).toEqual({ startIdx: 89, endIdx: 89, width: 40, left: 3560 });
    expect(result.acrossDst).toEqual({ startIdx: 8, endIdx: 8, width: 40, left: 320 });
  });

  it('clips crossing ranges without changing inclusive duration and skips invalid or reversed dates', () => {
    const first = new Date(2026, 9, 1).getTime();
    const last = new Date(2026, 9, 90).getTime();
    expect(constructionScheduleGanttRange('2026-09-29', '2026-10-03', first, last)).toEqual({ startIdx: 0, endIdx: 2, width: 120, left: 0 });
    expect(constructionScheduleGanttRange('2026-12-28', '2027-01-05', first, last)).toEqual({ startIdx: 88, endIdx: 89, width: 80, left: 3520 });
    expect(constructionScheduleGanttRange('2026-09-01', '2026-09-30', first, last)).toBeNull();
    expect(constructionScheduleGanttRange('2026-12-30', '2027-01-01', first, last)).toBeNull();
    expect(constructionScheduleGanttRange('2026-10-05', '2026-10-04', first, last)).toBeNull();
    expect(constructionScheduleGanttRange('2026-02-30', '2026-10-08', first, last)).toBeNull();
    expect(Number.isNaN(constructionScheduleDateMs(null))).toBe(true);
    expect(Number.isNaN(constructionScheduleDateMs('not-a-date'))).toBe(true);
    expect(new Date(constructionScheduleDateMs('2028-02-29')).getDate()).toBe(29);
  });

  it('preserves explicit timestamp instants for compatible non-date inputs', () => {
    const value = '2026-10-08T15:00:00+07:00';
    expect(constructionScheduleDateMs(value)).toBe(new Date(value).getTime());
  });
});

describe('construction schedule indexing and day grouping parity', () => {
  it('retains first duplicate rows, original order, and strict numeric/string identifiers', () => {
    const rows = [{ id: '1', name: 'first' }, { id: '1', name: 'duplicate' }, { id: 1, name: 'numeric' }];
    const indexed = constructionScheduleFirstIndex(rows, row => row.id);
    expect(indexed.get('1')).toBe(rows[0]);
    expect(indexed.get(1)).toBe(rows[2]);
    const assignments = [
      { plot_id: 'a-b', task_template_id: 'c', value: 'first' },
      { plot_id: 'a-b', task_template_id: 'c', value: 'duplicate' },
      { plot_id: 'a', task_template_id: 'b-c', value: 'different' },
      { plot_id: 1, task_template_id: 'c', value: 'numeric' },
    ];
    const assignmentIndex = constructionScheduleAssignmentIndex(assignments);
    expect(assignmentIndex.get('a-b')?.get('c')).toBe(assignments[0]);
    expect(assignmentIndex.get('a')?.get('b-c')).toBe(assignments[2]);
    expect(assignmentIndex.get('1')).toBeUndefined();
    expect(assignmentIndex.get(1)?.get('c')).toBe(assignments[3]);
    const templates = [{ id: 1, house_type_id: 'H' }, { id: 2, house_type_id: 1 }, { id: 3, house_type_id: 'H' }];
    const groups = constructionScheduleHouseTypeIndex(templates);
    expect(groups.get('H')).toEqual([templates[0], templates[2]]);
    expect(groups.get('1')).toBeUndefined();
  });

  it('keeps legacy day membership, group ordering, clashes and short contractor names on synthetic rows', () => {
    const list = Array.from({ length: 250 }, (_, index) => ({
      plot_id: String(index % 17), contractorName: `Team ${index % 5}`,
      pStart: index % 13, pEnd: index % 13 + index % 7, id: index,
    }));
    for (let time = 0; time < 20; time++) {
      const tasksForDay = list.filter(task => task.pStart <= time && time <= task.pEnd);
      const legacyGroups: Record<string, typeof list> = {};
      tasksForDay.forEach(task => { (legacyGroups[task.plot_id] ||= []).push(task); });
      const groupedTasksWithDetails = Object.entries(legacyGroups).map(([plotId, tasks]) => ({
        plotId, tasks, isClashing: new Set(tasks.map(task => task.contractorName)).size > 1,
        uniqueContractorNames: Array.from(new Set(tasks.map(task => task.contractorName.split(' ')[0]))).join(' / '),
      }));
      const clashes = groupedTasksWithDetails.filter(group => group.isClashing).map(({ plotId, tasks }) => ({ plotId, tasks }));
      expect(constructionScheduleDayGroups(list, time)).toEqual({ tasksForDay, groupedTasksWithDetails, clashes });
    }
    expect(constructionScheduleDayGroups([{ plot_id: 'P', contractorName: 'T', pStart: NaN, pEnd: 10 }], 5).tasksForDay).toEqual([]);
  });

  it('builds each large input once and avoids per-schedule rescans', () => {
    let reads = 0;
    const rows = Array.from({ length: 2000 }, (_, index) => ({ get id() { reads++; return index; } }));
    const indexed = constructionScheduleFirstIndex(rows, row => row.id);
    expect(reads).toBe(2000);
    for (let request = 0; request < 5000; request++) expect(indexed.get(request % 2000)).toBe(rows[request % 2000]);
    expect(reads).toBe(2000);
  });
});

describe('construction Gantt interval lanes', () => {
  it('separates an overlap chain and reuses freed lanes', () => {
    const tasks = [{ startIdx: 0, endIdx: 1 }, { startIdx: 1, endIdx: 2 }, { startIdx: 2, endIdx: 3 }];
    const legacyLanes = tasks.map(task => tasks.filter(other => other.startIdx <= task.endIdx && other.endIdx >= task.startIdx).indexOf(task));
    expect(legacyLanes).toEqual([0, 1, 1]);
    expect(constructionScheduleGanttLanes(tasks)).toEqual({ lanes: [0, 1, 0], laneCount: 2 });
  });

  it('retains normal isolated/full-overlap positions and original row order', () => {
    expect(constructionScheduleGanttLanes([{ startIdx: 8, endIdx: 9 }, { startIdx: 1, endIdx: 3 }])).toEqual({ lanes: [0, 0], laneCount: 1 });
    expect(constructionScheduleGanttLanes(Array.from({ length: 8 }, () => ({ startIdx: 1, endIdx: 3 })))).toEqual({ lanes: [0, 1, 2, 3, 4, 5, 6, 7], laneCount: 8 });
    expect(constructionScheduleGanttLanes([])).toEqual({ lanes: [], laneCount: 0 });
  });

  it('never places intersecting bars in the same lane and uses maximum concurrent capacity', () => {
    let seed = 13;
    const random = () => { seed = (seed * 48271) % 2147483647; return seed; };
    const tasks = Array.from({ length: 400 }, () => {
      const startIdx = random() % 90;
      return { startIdx, endIdx: Math.min(89, startIdx + random() % 10) };
    });
    const original = tasks.map(task => ({ ...task }));
    const { lanes, laneCount } = constructionScheduleGanttLanes(tasks);
    for (let i = 0; i < tasks.length; i++) {
      for (let j = i + 1; j < tasks.length; j++) {
        if (tasks[i].startIdx <= tasks[j].endIdx && tasks[j].startIdx <= tasks[i].endIdx) expect(lanes[i]).not.toBe(lanes[j]);
      }
    }
    const maximumConcurrent = Math.max(...Array.from({ length: 90 }, (_, day) => tasks.filter(task => task.startIdx <= day && day <= task.endIdx).length));
    expect(laneCount).toBe(maximumConcurrent);
    expect(tasks).toEqual(original);
  });
});

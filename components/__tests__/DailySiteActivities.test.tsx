import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  parseThaiOrIsoDate,
  isPlotTagMatch,
  calculatePhotoAudit,
  triggerBackgroundPhotoAudit,
  fetchBatchPhotoAuditsFromDb,
  PhotoAuditResult
} from '../../lib/photoAudit';
import DailySiteActivitiesView from '../DailySiteActivitiesView';

describe('Photo Watermark Time Audit Logic (lib/photoAudit)', () => {
  it('correctly parses Thai Buddhist Era datetime strings into Gregorian dates', () => {
    // 16 ต.ค. 2569 13:50:41 -> 2026-10-16 13:50:41 (Bangkok UTC+7 = 06:50:41 UTC)
    const parsed = parseThaiOrIsoDate('16 ต.ค. 2569 13:50:41');
    expect(parsed).not.toBeNull();
    expect(parsed?.getUTCFullYear()).toBe(2026);
    expect(parsed?.getUTCMonth()).toBe(9); // October = 9 (0-indexed)
    expect(parsed?.getUTCDate()).toBe(16);
    expect(parsed?.getUTCHours()).toBe(6); // 13 - 7 = 6 UTC
    expect(parsed?.getUTCMinutes()).toBe(50);
    expect(parsed?.getUTCSeconds()).toBe(41);
  });

  it('correctly parses full Thai month name', () => {
    const parsed = parseThaiOrIsoDate('25 พฤศจิกายน 2569 09:30:00');
    expect(parsed).not.toBeNull();
    expect(parsed?.getUTCFullYear()).toBe(2026);
    expect(parsed?.getUTCMonth()).toBe(10); // November = 10
    expect(parsed?.getUTCDate()).toBe(25);
  });

  it('correctly parses standard ISO 8601 strings', () => {
    const iso = '2026-10-16T13:50:41+07:00';
    const parsed = parseThaiOrIsoDate(iso);
    expect(parsed).not.toBeNull();
    expect(parsed?.getUTCFullYear()).toBe(2026);
    expect(parsed?.getUTCDate()).toBe(16);
  });

  it('matches plot tags correctly with fuzzy and prefix matching', () => {
    // Exact match
    expect(isPlotTagMatch('AL6-45', 'AL6-45')).toBe(true);
    // Trailing digits match (e.g. plot 45 in project AL6)
    expect(isPlotTagMatch('AL6-45', '45')).toBe(true);
    expect(isPlotTagMatch('45', 'AL6-45')).toBe(true);
    // Explicit mismatch
    expect(isPlotTagMatch('AL6-45', 'AL6-42')).toBe(false);
    expect(isPlotTagMatch('AL6-45', '12')).toBe(false);
  });

  it('classifies photos as "on_time" when submitted within 30 minutes', () => {
    const taken = '2026-10-16T13:30:00+07:00';
    const reported = '2026-10-16T13:50:00+07:00'; // 20 mins later
    const audit = calculatePhotoAudit(taken, reported, 'AL6-45', 'AL6-45');

    expect(audit.status).toBe('on_time');
    expect(audit.timeDiffMinutes).toBe(20);
    expect(audit.statusLabel).toContain('ส่งทันที');
    expect(audit.isPlotMatch).toBe(true);
  });

  it('classifies photos as "delayed_same_day" when foremen took photo 2 hours earlier', () => {
    const taken = '2026-10-16T10:00:00+07:00';
    const reported = '2026-10-16T12:30:00+07:00'; // 2 hours 30 mins later
    const audit = calculatePhotoAudit(taken, reported, 'AL6-45', 'AL6-45');

    expect(audit.status).toBe('delayed_same_day');
    expect(audit.timeDiffMinutes).toBe(150);
    expect(audit.timeDiffText).toContain('2 ชม. 30 นาที');
  });

  it('classifies photos as "cross_day" when photos were taken on a previous day', () => {
    const taken = '2026-10-15T16:00:00+07:00'; // Yesterday
    const reported = '2026-10-16T09:00:00+07:00'; // Today
    const audit = calculatePhotoAudit(taken, reported, 'AL6-45', 'AL6-45');

    expect(audit.status).toBe('cross_day');
    expect(audit.statusLabel).toContain('ถ่ายข้ามวัน');
    expect(audit.isSameDay).toBe(false);
  });

  it('warns when plot tag in watermark does not match reported plot', () => {
    const taken = '2026-10-16T13:50:00+07:00';
    const reported = '2026-10-16T14:00:00+07:00';
    const audit = calculatePhotoAudit(taken, reported, 'AL6-45', 'AL6-99');

    expect(audit.isPlotMatch).toBe(false);
    expect(audit.plotMatchLabel).toContain('ไม่ตรงกับแปลงที่รายงาน');
  });

  it('triggers background photo audit without blocking or throwing errors', () => {
    // Must never throw even with invalid or empty URLs
    expect(() => {
      triggerBackgroundPhotoAudit(['https://images.example.com/test.jpg'], 'AL6-45');
      triggerBackgroundPhotoAudit([], undefined);
    }).not.toThrow();
  });

  it('safely handles batch fetch from DB with empty or non-existent rows', async () => {
    const result = await fetchBatchPhotoAuditsFromDb([]);
    expect(result).toEqual({});
  });
});

describe('DailySiteActivitiesView Component', () => {
  const mockUpdates = [
    {
      id: 'upd-1',
      plot_id: 'AL6-45',
      task_template_id: 'task-1',
      task_name: 'งานผูกเหล็กคานคอดิน',
      user_name: 'สมศักดิ์ โฟร์แมน',
      role: 'Foreman',
      action: 'ส่งงานประจำวัน',
      text_content: 'ผูกเหล็กเสร็จสิ้น 100% รอ QC ตรวจ',
      image_url: 'https://images.example.com/photo1.jpg, https://images.example.com/photo2.jpg',
      weather_info: 'แดดจัด 32°C',
      created_at: new Date().toISOString() // Today
    }
  ];

  const mockPlots = [
    { id: 'AL6-45', plot_name: 'AL6-45', project_name: 'The Grand Valley' }
  ];

  it('renders the Daily Site Activities header and title', () => {
    render(
      <DailySiteActivitiesView
        allUpdatesRecord={mockUpdates}
        plots={mockPlots}
      />
    );

    expect(screen.getByText('ดูกิจกรรมประจำวัน')).toBeDefined();
    expect(screen.getByText('งานผูกเหล็กคานคอดิน')).toBeDefined();
    expect(screen.getAllByText('สมศักดิ์ โฟร์แมน').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/AL6-45/).length).toBeGreaterThan(0);
  });

  it('displays photo audit scan buttons for attached photos', () => {
    render(
      <DailySiteActivitiesView
        allUpdatesRecord={mockUpdates}
        plots={mockPlots}
      />
    );

    const scanButtons = screen.getAllByText('สแกนลายน้ำ & ตรวจสอบเวลา');
    expect(scanButtons.length).toBe(2);
  });

  it('supports searching by task name or foreman name', () => {
    render(
      <DailySiteActivitiesView
        allUpdatesRecord={mockUpdates}
        plots={mockPlots}
      />
    );

    const searchInput = screen.getByPlaceholderText(/ค้นหาชื่องาน/);
    fireEvent.change(searchInput, { target: { value: 'เหล็กคาน' } });
    expect(screen.getByText('งานผูกเหล็กคานคอดิน')).toBeDefined();

    fireEvent.change(searchInput, { target: { value: 'ไม่มีคำนี้ในระบบ' } });
    expect(screen.getByText(/ไม่มีกิจกรรมการรายงานสำหรับเงื่อนไขที่เลือก/)).toBeDefined();
  });
});

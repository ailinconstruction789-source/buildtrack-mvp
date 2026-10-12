import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DailyHouseInspectionModal from '../DailyHouseInspectionModal';

const db = vi.hoisted(() => ({ from: vi.fn(), insert: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: db.from } }));
beforeEach(() => {
  vi.clearAllMocks();
  db.from.mockReturnValue({ insert: db.insert });
  db.insert.mockResolvedValue({ error: null });
});
const props = { projectName: 'ไอลิน6', user: { username: 'Bell' }, sampleHouses: ['A01'], onClose: vi.fn() };

describe('DailyHouseInspectionModal through SalesOverlay', () => {
  it('keeps a closed inspection absent without database reads or writes', () => {
    const { container } = render(<DailyHouseInspectionModal {...props} isOpen={false} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/SOP ตรวจบ้านประจำวัน/)).not.toBeInTheDocument();
    expect(db.from).not.toHaveBeenCalled();
  });

  it('exposes the actual checklist outside the clipped shell and preserves select/clear/mode buttons', () => {
    const { container } = render(<section style={{ transform: 'translateZ(0)', overflow: 'hidden' }}>
      <DailyHouseInspectionModal {...props} isOpen />
    </section>);
    const heading = screen.getByRole('heading', { name: /SOP ตรวจบ้านประจำวัน/ });
    const overlay = heading.closest('.fixed.inset-0')!;
    expect(overlay.parentElement).toBe(document.body);
    expect(overlay).toHaveClass('z-[200]');
    expect(container).not.toContainElement(heading);
    expect(heading).toBeVisible();
    expect(screen.getByText(/รายการตรวจสอบ \(0\/7\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/ถวายน้ำพระ/));
    expect(screen.getByText(/รายการตรวจสอบ \(1\/7\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/ถวายน้ำพระ/));
    expect(screen.getByText(/รายการตรวจสอบ \(0\/7\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /ติ๊กทั้งหมด/ }));
    expect(screen.getByText(/รายการตรวจสอบ \(7\/7\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ล้างตัวเลือก' }));
    expect(screen.getByText(/รายการตรวจสอบ \(0\/7\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /รอบเย็น \(ปิดบ้าน\)/ }));
    expect(screen.getByText(/ประตูดิจิทัล/)).toBeInTheDocument();
    expect(screen.queryByText(/ถวายน้ำพระ/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /ติ๊กทั้งหมด/ }));
    expect(screen.getByText(/รายการตรวจสอบ \(7\/7\)/)).toBeInTheDocument();
    expect(db.from).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('preserves the actual close control and removes the inspection portal', () => {
    const closed = vi.fn();
    function Inspection() {
      const [open, setOpen] = useState(true);
      return <DailyHouseInspectionModal {...props} isOpen={open} onClose={() => { closed(); setOpen(false); }} />;
    }
    render(<Inspection />);
    const overlay = screen.getByRole('heading', { name: /SOP ตรวจบ้านประจำวัน/ }).closest('.fixed.inset-0');
    if (!(overlay instanceof HTMLElement)) throw new Error('Inspection overlay must be an HTML element');
    const closeButton = overlay.querySelector<HTMLButtonElement>('button');
    if (!closeButton) throw new Error('Inspection close button was not rendered');
    fireEvent.click(closeButton);
    expect(closed).toHaveBeenCalledOnce();
    expect(screen.queryByText(/SOP ตรวจบ้านประจำวัน/)).not.toBeInTheDocument();
    expect(document.body).not.toContainElement(overlay);
    expect(db.from).not.toHaveBeenCalled();
  });
});

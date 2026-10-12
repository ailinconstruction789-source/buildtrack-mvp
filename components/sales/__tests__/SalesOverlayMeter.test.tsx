import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MeterPhotoConfirmationModal from '../../MeterPhotoConfirmationModal';

const db = vi.hoisted(() => ({ from: vi.fn(), storageFrom: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: db.from, storage: { from: db.storageFrom } } }));
const props = {
  isOpen: true, onClose: vi.fn(), meterType: 'water_meter' as const,
  plot: {
    id: 'A', plot_name: 'A01', project_name: 'Project A', water_meter_meter_no: 'W-001',
    water_meter_status: 'Installed', water_meter_installed_date: '2026-10-08T00:00:00Z',
    water_meter_image_url: 'https://example.invalid/meter.png',
  },
  currentUserRole: 'Sales', currentUserName: 'Bell',
};
beforeEach(() => vi.clearAllMocks());

describe('shared meter confirmation overlay compatibility', () => {
  it('retains the original inline construction placement when portalToBody is omitted', () => {
    const { container } = render(<section data-testid="construction-shell">
      <MeterPhotoConfirmationModal {...props} />
    </section>);
    const heading = screen.getByRole('heading', { name: 'ยืนยันการติดตั้ง มิเตอร์น้ำ' });
    const overlay = heading.closest('.fixed.inset-0');
    if (!(overlay instanceof HTMLElement)) throw new Error('Meter overlay was not rendered');
    expect(container).toContainElement(overlay);
    expect(screen.getByTestId('construction-shell')).toContainElement(overlay);
    expect(overlay.parentElement).not.toBe(document.body);
    expect(overlay).toHaveClass('z-[110]');
    expect(overlay).not.toHaveClass('z-[200]');
    expect(screen.getByDisplayValue('W-001')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'ภาพถ่าย มิเตอร์น้ำ' })).toHaveAttribute('src', props.plot.water_meter_image_url);
    expect(db.from).not.toHaveBeenCalled();
    expect(db.storageFrom).not.toHaveBeenCalled();
  });

  it('portals to body only when the sales caller opts in, retaining form content', () => {
    const { container } = render(<section style={{ transform: 'translateZ(0)', overflow: 'hidden' }}>
      <MeterPhotoConfirmationModal {...props} portalToBody />
    </section>);
    const heading = screen.getByRole('heading', { name: 'ยืนยันการติดตั้ง มิเตอร์น้ำ' });
    const overlay = heading.closest('.fixed.inset-0');
    if (!(overlay instanceof HTMLElement)) throw new Error('Meter overlay was not rendered');
    expect(overlay.parentElement).toBe(document.body);
    expect(container).not.toContainElement(overlay);
    expect(overlay).toHaveClass('z-[200]', 'print:hidden');
    expect(heading).toBeVisible();
    expect(screen.getByDisplayValue('W-001')).toBeInTheDocument();
    expect(db.from).not.toHaveBeenCalled();
    expect(db.storageFrom).not.toHaveBeenCalled();
  });

  it.each([false, true])('keeps the close control functional for portalToBody=%s without writes', portalToBody => {
    const closed = vi.fn();
    function Confirmation() {
      const [open, setOpen] = useState(true);
      return open ? <MeterPhotoConfirmationModal {...props} portalToBody={portalToBody}
        onClose={() => { closed(); setOpen(false); }} /> : null;
    }
    render(<Confirmation />);
    const overlay = screen.getByRole('heading', { name: 'ยืนยันการติดตั้ง มิเตอร์น้ำ' }).closest('.fixed.inset-0');
    if (!(overlay instanceof HTMLElement)) throw new Error('Meter overlay was not rendered');
    const closeButton = overlay.querySelector<HTMLButtonElement>('button');
    if (!closeButton) throw new Error('Meter close button was not rendered');
    fireEvent.click(closeButton);
    expect(closed).toHaveBeenCalledOnce();
    expect(document.body).not.toContainElement(overlay);
    expect(db.from).not.toHaveBeenCalled();
    expect(db.storageFrom).not.toHaveBeenCalled();
  });

  it('renders nothing when closed without calling any service', () => {
    const { container } = render(<MeterPhotoConfirmationModal {...props} isOpen={false} portalToBody />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('heading', { name: 'ยืนยันการติดตั้ง มิเตอร์น้ำ' })).not.toBeInTheDocument();
    expect(db.from).not.toHaveBeenCalled();
    expect(db.storageFrom).not.toHaveBeenCalled();
  });
});

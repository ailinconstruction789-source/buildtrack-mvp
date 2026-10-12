import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AppCustomModal, { type AppModalConfig } from '../../AppCustomModal';

const config: AppModalConfig = { isOpen: true, type: 'confirm', title: 'ยืนยันรายการของแถม', message: 'ตรวจรายการก่อนดำเนินการ' };

describe('Sales shared alert portal integration', () => {
  it('keeps existing non-sales callers inline by default', () => {
    const { container } = render(<AppCustomModal config={config} onClose={vi.fn()} />);
    expect(container).toContainElement(screen.getByText(config.title));
  });

  it('places the sales alert above its promotion form and preserves confirmation callbacks', () => {
    const confirm = vi.fn();
    const close = vi.fn();
    const { container } = render(<section style={{ transform: 'translateZ(0)', overflow: 'hidden' }}>
      <AppCustomModal portalToBody config={{ ...config, onConfirm: confirm }} onClose={close} />
    </section>);
    const title = screen.getByText(config.title);
    const overlay = title.closest('.fixed');
    expect(overlay?.parentElement).toBe(document.body);
    expect(overlay).toHaveClass('z-[999999]');
    expect(container).not.toContainElement(title);
    fireEvent.click(screen.getByRole('button', { name: 'ยืนยัน' }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('preserves cancellation without running confirmation', () => {
    const confirm = vi.fn();
    const cancel = vi.fn();
    const close = vi.fn();
    render(<AppCustomModal portalToBody config={{ ...config, onConfirm: confirm, onCancel: cancel }} onClose={close} />);
    fireEvent.click(screen.getByRole('button', { name: 'ยกเลิก' }));
    expect(confirm).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('preserves closing from the icon button', () => {
    const cancel = vi.fn();
    const close = vi.fn();
    render(<AppCustomModal portalToBody config={{ ...config, onCancel: cancel }} onClose={close} />);
    fireEvent.click(screen.getByRole('button', { name: '' }));
    expect(cancel).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('removes its portal when closed and renders nothing without a configuration', () => {
    const { rerender } = render(<AppCustomModal portalToBody config={config} onClose={vi.fn()} />);
    expect(screen.getByText(config.title)).toBeInTheDocument();
    rerender(<AppCustomModal portalToBody config={{ ...config, isOpen: false }} onClose={vi.fn()} />);
    expect(screen.queryByText(config.title)).not.toBeInTheDocument();
    rerender(<AppCustomModal portalToBody config={null} onClose={vi.fn()} />);
    expect(document.body.querySelector('.fixed')).toBeNull();
  });
});

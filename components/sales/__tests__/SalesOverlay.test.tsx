import React, { createContext, useContext, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import SalesOverlay from '../SalesOverlay';

describe('SalesOverlay DOM placement and interaction', () => {
  it('portals directly to body outside transformed and clipped application ancestors', () => {
    const { container } = render(
      <section data-testid="app-frame" style={{ transform: 'translateZ(0)', overflow: 'hidden' }}>
        <SalesOverlay role="dialog" aria-label="Sales popup" className="fixed inset-0 z-50 flex p-4">
          <p>Popup content</p>
        </SalesOverlay>
      </section>,
    );
    const overlay = screen.getByRole('dialog', { name: 'Sales popup' });
    expect(overlay.parentElement).toBe(document.body);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(screen.getByTestId('app-frame')).not.toContainElement(overlay);
    expect(overlay).toHaveClass('fixed', 'inset-0', 'flex', 'p-4');
    expect(overlay.children).toHaveLength(1);
    expect(overlay.firstElementChild).toHaveTextContent('Popup content');
  });

  it.each(['z-50', 'z-[100]', 'z-[110]', 'z-[120]'])('raises the original base %s class above shell layers without modifying other classes', originalZ => {
    render(<>
      <header data-testid="header" className="relative z-[100]">Header</header>
      <nav data-testid="navigation" className="fixed z-[100]">Navigation</nav>
      <aside data-testid="sidebar" className="fixed z-[120]">Sidebar</aside>
      <SalesOverlay data-testid="overlay" className={`fixed inset-0 ${originalZ} bg-black/50 overflow-y-auto`} />
    </>);
    const overlay = screen.getByTestId('overlay');
    expect(overlay).toHaveClass('z-[200]', 'bg-black/50', 'overflow-y-auto');
    expect(overlay).not.toHaveClass(originalZ);
    expect(screen.getByTestId('header')).toHaveClass('z-[100]');
    expect(screen.getByTestId('navigation')).toHaveClass('z-[100]');
    expect(screen.getByTestId('sidebar')).toHaveClass('z-[120]');
    // Class/DOM regression only; jsdom does not measure painted stacking or hit testing.
    expect(overlay.parentElement).toBe(document.body);
  });

  it('retains existing higher overlay layers and nested child z-index classes', () => {
    render(<SalesOverlay data-testid="gallery" className="fixed inset-0 z-[99999]">
      <div data-testid="inner-base" className="relative z-50" />
      <div data-testid="nested-dropdown" className="absolute z-[700]" />
    </SalesOverlay>);
    expect(screen.getByTestId('gallery')).toHaveClass('z-[99999]');
    expect(screen.getByTestId('gallery')).not.toHaveClass('z-[200]');
    expect(screen.getByTestId('inner-base')).toHaveClass('z-50');
    expect(screen.getByTestId('nested-dropdown')).toHaveClass('z-[700]');
    expect(screen.getByTestId('gallery').children).toHaveLength(2);
  });

  it.each(['z-[600]', 'z-[999999]'])('preserves the existing shared alert/gallery %s layer', originalZ => {
    render(<SalesOverlay data-testid="shared-layer" className={`fixed inset-0 ${originalZ}`} />);
    expect(screen.getByTestId('shared-layer')).toHaveClass(originalZ);
    expect(screen.getByTestId('shared-layer')).not.toHaveClass('z-[200]');
    expect(screen.getByTestId('shared-layer').parentElement).toBe(document.body);
  });

  it('preserves shell typography and excludes ordinary overlays from printing by default', () => {
    render(<SalesOverlay data-testid="ordinary" className="fixed inset-0 z-50 bg-white" />);
    expect(screen.getByTestId('ordinary')).toHaveClass('font-sans', 'text-[#1d1d1f]', 'print:hidden', 'bg-white');
  });

  it('supports printable receipt overlays without leaking the printable prop to the DOM', () => {
    render(<SalesOverlay data-testid="receipt" printable className="fixed inset-0 z-[300] print:block" />);
    expect(screen.getByTestId('receipt')).not.toHaveClass('print:hidden');
    expect(screen.getByTestId('receipt')).toHaveClass('print:block', 'font-sans', 'text-[#1d1d1f]', 'z-[300]');
    expect(screen.getByTestId('receipt')).not.toHaveAttribute('printable');
  });

  it('preserves DOM attributes, styling, events, React context and logical event bubbling', () => {
    const Account = createContext('default');
    const click = vi.fn();
    const key = vi.fn();
    const ancestorClick = vi.fn();
    function AccountName() { return <button type="button">{useContext(Account)}</button>; }
    render(<Account.Provider value="Sales account">
      <section onClick={ancestorClick}>
        <SalesOverlay id="sale-dialog" role="dialog" aria-modal="true" aria-label="Account popup"
          data-project="Project A" tabIndex={-1} style={{ opacity: 0.9 }} className="fixed inset-0 z-50"
          onClick={click} onKeyDown={key}>
          <AccountName />
        </SalesOverlay>
      </section>
    </Account.Provider>);
    const overlay = screen.getByRole('dialog', { name: 'Account popup' });
    expect(overlay).toHaveAttribute('id', 'sale-dialog');
    expect(overlay).toHaveAttribute('aria-modal', 'true');
    expect(overlay).toHaveAttribute('data-project', 'Project A');
    expect(overlay).toHaveAttribute('tabindex', '-1');
    expect(overlay).toHaveStyle({ opacity: '0.9' });
    fireEvent.click(screen.getByRole('button', { name: 'Sales account' }));
    expect(click).toHaveBeenCalledOnce();
    expect(ancestorClick).toHaveBeenCalledOnce();
    fireEvent.keyDown(overlay, { key: 'Escape' });
    expect(key).toHaveBeenCalledOnce();
    expect(key.mock.calls[0][0].key).toBe('Escape');
  });

  it('removes the portal on close and reopens exactly one overlay', () => {
    function Toggle() {
      const [open, setOpen] = useState(true);
      return <>
        <button onClick={() => setOpen(true)}>Open popup</button>
        {open && <SalesOverlay role="dialog" className="fixed inset-0 z-50">
          <button onClick={() => setOpen(false)}>Close popup</button>
        </SalesOverlay>}
      </>;
    }
    const { unmount } = render(<Toggle />);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Close popup' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open popup' }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    unmount();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it('renders no portal markup before client effects during server rendering', () => {
    expect(renderToString(<SalesOverlay className="fixed inset-0 z-50">Server popup</SalesOverlay>)).toBe('');
    expect(screen.queryByText('Server popup')).not.toBeInTheDocument();
  });
});

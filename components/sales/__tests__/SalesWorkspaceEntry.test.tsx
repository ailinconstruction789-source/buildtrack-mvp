import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SalesWorkspaceEntry from '../SalesWorkspaceEntry';
import SalesWorkspaceModeProvider from '../SalesWorkspaceModeProvider';
import SalesPage from '@/app/sales/page';
const mock = vi.hoisted(() => ({ workspace: vi.fn() }));
vi.mock('next/dynamic', () => ({ default: () => (props: unknown) => { mock.workspace(props); return <p>Original project workspace</p>; } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe('restored native project workspace entry', () => {
  it.each(['legacy', 'central', 'blocked'] as const)('preserves the original UI and all route props in %s configuration', mode => {
    const props = { project: { name: 'Project A' }, initialTab: 'map', user: { role: 'Sales' }, onBack: vi.fn() };
    render(<SalesWorkspaceModeProvider mode={mode}><SalesWorkspaceEntry {...props} /></SalesWorkspaceModeProvider>);
    expect(screen.getByText('Original project workspace')).toBeInTheDocument();
    expect(mock.workspace.mock.lastCall?.[0]).toEqual(props);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
  it('opens the same inline workspace without a cutover provider', () => {
    render(<SalesWorkspaceEntry initialTab="transferred" />);
    expect(mock.workspace.mock.lastCall?.[0]).toEqual({ initialTab: 'transferred' });
  });
  it('uses the same restored workspace from the direct sales route', () => {
    render(<SalesPage />);
    expect(screen.getByText('Original project workspace')).toBeInTheDocument();
    expect(mock.workspace).toHaveBeenCalledOnce();
  });
});

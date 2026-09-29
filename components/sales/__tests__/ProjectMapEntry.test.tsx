import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ legacy: vi.fn(() => null), central: vi.fn<(props: Record<string, unknown>) => null>(() => null) }));
vi.mock('next/dynamic', () => ({ default: () => mock.legacy }));
vi.mock('../ProjectSalesWorkspace', () => ({ default: mock.central }));
import SalesWorkspaceEntry from '../SalesWorkspaceEntry';
import SalesWorkspaceModeProvider from '../SalesWorkspaceModeProvider';
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe('restored project map entry', () => {
  it('opens the map from the former Lead tracker without reviving legacy writers', () => {
    render(<SalesWorkspaceModeProvider mode="central"><SalesWorkspaceEntry project={{ name: 'โครงการ A' }} initialTab="lead_tracker" /></SalesWorkspaceModeProvider>);
    expect(mock.central.mock.calls[0][0]).toMatchObject({ initialProjectName: 'โครงการ A', initialView: 'map' });
    expect(mock.legacy).not.toHaveBeenCalled();
  });
  it('preserves the transferred list deep entry', () => {
    render(<SalesWorkspaceModeProvider mode="central"><SalesWorkspaceEntry initialTab="transferred" /></SalesWorkspaceModeProvider>);
    expect(mock.central.mock.calls[0][0]).toMatchObject({ initialProjectName: null, initialTab: 'transferred', initialView: 'list' });
  });
  it('does not open map or legacy workspace when the release is blocked', () => {
    render(<SalesWorkspaceModeProvider mode="blocked"><SalesWorkspaceEntry /></SalesWorkspaceModeProvider>);
    expect(mock.central).not.toHaveBeenCalled(); expect(mock.legacy).not.toHaveBeenCalled();
  });
});

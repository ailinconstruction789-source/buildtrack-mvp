import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SalesWorkspaceEntry from '../SalesWorkspaceEntry';
import SalesWorkspaceModeProvider from '../SalesWorkspaceModeProvider';
const mock = vi.hoisted(() => ({ rich: vi.fn() }));
vi.mock('next/dynamic', () => ({ default: () => (props: unknown) => { mock.rich(props); return <p>Rich inline workspace</p>; } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe('retired imported-cohort entry configuration', () => {
  it.each(['central', 'blocked'] as const)('does not restore imported readers or disable the original Map for stale %s configuration', mode => {
    render(<SalesWorkspaceModeProvider mode={mode}><SalesWorkspaceEntry initialTab="map" project={{ name: 'Project' }} /></SalesWorkspaceModeProvider>);
    expect(screen.getByText('Rich inline workspace')).toBeInTheDocument();
    expect(mock.rich.mock.lastCall?.[0]).toEqual({ initialTab: 'map', project: { name: 'Project' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

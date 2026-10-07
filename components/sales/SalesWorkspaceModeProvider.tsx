'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { ProjectWorkspaceMode } from '@/lib/sales/projectSalesFlags';

// Missing server configuration defaults to legacy to ensure full BuildTrack sales workspace is active.
const ModeContext = createContext<ProjectWorkspaceMode>('legacy');
const PostBookingContext = createContext(false);
const ReportsContext = createContext(true);
export function useSalesWorkspaceMode() { return useContext(ModeContext); }
export function usePostBookingEnabled() { return useContext(PostBookingContext); }
export function useSalesReportsEnabled() { return useContext(ReportsContext); }
export default function SalesWorkspaceModeProvider({ mode = 'legacy', postBookingEnabled = false, reportsEnabled = true, children }: { mode?: ProjectWorkspaceMode; postBookingEnabled?: boolean; reportsEnabled?: boolean; children: ReactNode }) {
  return <ModeContext.Provider value={mode}><ReportsContext.Provider value={reportsEnabled}><PostBookingContext.Provider value={postBookingEnabled}>{children}</PostBookingContext.Provider></ReportsContext.Provider></ModeContext.Provider>;
}

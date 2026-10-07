'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import type { ComponentProps } from 'react';
import type SalesKanban from './SalesKanban';
import ProjectSalesWorkspace from './ProjectSalesWorkspace';
import { useSalesWorkspaceMode } from './SalesWorkspaceModeProvider';

const LegacySalesKanban = dynamic(() => import('./SalesKanban'));
type Props = ComponentProps<typeof SalesKanban>;

export default function SalesWorkspaceEntry(props: Props) {
  return <LegacySalesKanban {...props} />;
}

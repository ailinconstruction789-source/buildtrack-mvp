'use client';

import dynamic from 'next/dynamic';
import type { ComponentProps } from 'react';
import type SalesKanban from './SalesKanban';

const LegacySalesKanban = dynamic(() => import('./SalesKanban'));
type Props = ComponentProps<typeof SalesKanban>;

export default function SalesWorkspaceEntry(props: Props) {
  return <LegacySalesKanban {...props} />;
}

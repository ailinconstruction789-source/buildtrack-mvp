'use client';

import React from 'react';
import { LivingSiteSimulation, LivingSiteSimulationProps } from './livingSite/LivingSiteSimulation';

export type ProjectMap3DColonySimProps = LivingSiteSimulationProps & {
  onClose3D?: () => void;
};

export interface SiteEntity {
  id: string;
  plotId: string;
  role: 'engineer' | 'qc' | 'foreman' | 'worker';
  trade?: 'mason' | 'steel' | 'painter' | 'plumber' | 'general';
  userName: string;
  taskName: string;
  action: string;
  timeStr: string;
  speechText: string;
  photoUrl?: string;
  worldX: number;
  worldY: number;
  offsetAngle: number;
}

export const ProjectMap3DColonySim: React.FC<ProjectMap3DColonySimProps> = (props) => {
  return <LivingSiteSimulation {...props} />;
};

export default ProjectMap3DColonySim;

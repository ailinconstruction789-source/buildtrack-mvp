// Mock API for Owner Analytics Dashboard until real DB is hooked up
export async function getDashboardKPIs(projectId?: string) {
  // Simulate network delay
  await new Promise((resolve) => setTimeout(resolve, 500));
  
  return {
    walkIns: 124,
    bookings: 32,
    transfers: 15,
    cancellations: 5,
    revenue: 45000000,
    targetRevenue: 50000000,
  };
}

export async function getFunnelData(projectId?: string) {
  await new Promise((resolve) => setTimeout(resolve, 500));
  return [
    { name: 'Walk-ins', value: 124 },
    { name: 'Visiting', value: 80 },
    { name: 'Negotiation', value: 45 },
    { name: 'Bookings', value: 32 },
    { name: 'Transfers', value: 15 },
  ];
}

export async function getCycleTimeData(projectId?: string) {
  await new Promise((resolve) => setTimeout(resolve, 500));
  return [
    { stage: 'Lead to Contact (Hrs)', time: 2.5, target: 1.0 },
    { stage: 'Contact to Visit (Days)', time: 3.2, target: 5.0 },
    { stage: 'Visit to Booking (Days)', time: 7.5, target: 7.0 },
    { stage: 'Booking to Transfer (Days)', time: 45.0, target: 30.0 },
  ];
}

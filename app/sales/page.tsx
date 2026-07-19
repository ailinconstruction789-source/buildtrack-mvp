import SalesKanban from '@/components/sales/SalesKanban';

export const metadata = {
  title: 'Sales Pipeline | BuildTrack',
  description: 'Manage sales leads and bookings',
};

export default function SalesPage() {
  return <SalesKanban />;
}

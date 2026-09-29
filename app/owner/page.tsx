import SalesReportingEntry from '@/components/sales/SalesReportingEntry';

export const metadata = {
  title: 'Owner Analytics | BuildTrack',
  description: 'Executive Sales Analytics Dashboard',
};

export default function OwnerPage() {
  return <SalesReportingEntry surface="owner" />;
}

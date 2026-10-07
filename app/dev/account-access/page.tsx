import { notFound } from 'next/navigation';
import AccountAccessDemo from '@/components/dev/AccountAccessDemo';

export const metadata = {
  title: 'ทดลองคืนสิทธิ์ฝ่ายขาย | BuildTrack',
  robots: { index: false, follow: false },
};

export default function AccountAccessDemoPage() {
  // This is an isolated UI demonstration, never a production auth bypass.
  if (process.env.NODE_ENV !== 'development') notFound();
  return <AccountAccessDemo />;
}

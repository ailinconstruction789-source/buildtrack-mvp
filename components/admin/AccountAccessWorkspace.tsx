'use client';

import AccountAccessView from './AccountAccessView';
import { accountAccessApi } from '@/lib/auth/accountAccessClient';
import { restoreAccountAccess } from '@/lib/auth/accountRestoreClient';

export default function AccountAccessWorkspace({restoreEnabled=false}:{restoreEnabled?:boolean}) {
  return <AccountAccessView api={accountAccessApi} restore={restoreEnabled?restoreAccountAccess:undefined} />;
}

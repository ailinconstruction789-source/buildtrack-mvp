/** In-memory UI examples only. Never import this module to authorize a real request. */
export type DemoReviewer = 'admin' | 'owner' | 'sales';
export interface DemoEvent {
  sequence: number;
  label: string;
  reason?: string;
  reference?: string;
}
export interface DemoAccount {
  id: string;
  name: string;
  banned: boolean;
  crmActive: boolean;
  signedIn: boolean;
  reviewRevision: number;
  events: DemoEvent[];
}
export type DemoAction = { type: 'ban' | 'unban' | 'login' | 'logout' } | {
  type: 'review'; reviewer: DemoReviewer; expectedRevision: number;
  reason: string; reference: string; confirmed: boolean;
};
export interface DemoResult { account: DemoAccount; message: string; error: boolean }

export function initialDemoAccounts(): DemoAccount[] {
  return [
    { id: 'example-a', name: 'Sales ตัวอย่าง A', banned: false, crmActive: true, signedIn: true, reviewRevision: 1, events: [] },
    { id: 'example-b', name: 'Sales ตัวอย่าง B', banned: true, crmActive: false, signedIn: true, reviewRevision: 1,
      events: [{ sequence: 1, label: 'ตัวอย่างบัญชีที่ถูกแบนและพักสิทธิ์ฝ่ายขาย' }] },
    { id: 'example-c', name: 'Sales ตัวอย่าง C', banned: false, crmActive: false, signedIn: true, reviewRevision: 1,
      events: [{ sequence: 1, label: 'ตัวอย่างบัญชีที่ปลดแบนแล้ว แต่ยังรอ Admin รับรองใหม่' }] },
  ];
}

export function demoAccess(account: DemoAccount) {
  const ownerEligible = !account.banned && account.crmActive;
  return { ownerEligible, canUseCrm: ownerEligible && account.signedIn };
}

export function applyDemoAction(account: DemoAccount, action: DemoAction): DemoResult {
  const denied = (message: string): DemoResult => ({ account, message, error: true });
  let change: Partial<DemoAccount>;
  let event: Omit<DemoEvent, 'sequence'>;
  switch (action.type) {
    case 'ban':
      if (account.banned) return denied('บัญชีตัวอย่างถูกแบนอยู่แล้ว');
      change = { banned: true, crmActive: false };
      event = { label: 'จำลองแบนบัญชี → พักสิทธิ์ฝ่ายขาย' };
      break;
    case 'unban':
      if (!account.banned) return denied('บัญชีตัวอย่างไม่ได้ถูกแบน');
      change = { banned: false }; // Never restore CRM access on unban.
      event = { label: 'จำลองปลดแบน → ยังรอ Admin รับรองสิทธิ์ฝ่ายขาย' };
      break;
    case 'logout':
      if (!account.signedIn) return denied('ออกจากระบบตัวอย่างแล้ว');
      change = { signedIn: false }; // Work ownership is independent of a session.
      event = { label: 'จำลองออกจากระบบ → ความรับผิดชอบงานยังอยู่' };
      break;
    case 'login':
      if (account.banned) return denied('บัญชีที่ถูกแบนยังเข้าสู่ระบบไม่ได้');
      if (account.signedIn) return denied('มีเซสชันตัวอย่างอยู่แล้ว');
      change = { signedIn: true };
      event = { label: 'จำลองเข้าสู่ระบบ → ไม่เปลี่ยนสิทธิ์ฝ่ายขาย' };
      break;
    case 'review': {
      if (action.reviewer !== 'admin') return denied('เฉพาะ Admin ที่มีสิทธิ์จัดการบัญชีเท่านั้น');
      if (account.banned) return denied('ต้องปลดแบนก่อน จึงจะรับรองสิทธิ์ใหม่ได้');
      if (action.expectedRevision !== account.reviewRevision) return denied('รายการเปลี่ยนแล้ว กรุณาตรวจข้อมูลใหม่');
      if (account.crmActive) return denied('บัญชีมีสิทธิ์ฝ่ายขายอยู่แล้ว');
      const reason = action.reason.trim();
      const reference = action.reference.trim();
      if (!reason || reason.length > 500 || !reference || reference.length > 120 || !action.confirmed) {
        return denied('กรอกเหตุผล หลักฐานอ้างอิง และยืนยันการตรวจให้ครบ');
      }
      change = { crmActive: true, reviewRevision: account.reviewRevision + 1 };
      event = { label: 'Admin ตัวอย่างรับรองและเปิดสิทธิ์ฝ่ายขายใหม่', reason, reference };
      break;
    }
  }
  return {
    account: { ...account, ...change, events: [...account.events, { ...event, sequence: account.events.length + 1 }] },
    message: event.label, error: false,
  };
}

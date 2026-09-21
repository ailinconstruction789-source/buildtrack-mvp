import { describe, it, expect } from 'vitest';

describe('Daily Activity Hub & Accountability Logic', () => {
  // Pure logic replica of role categorization
  function getRoleCategory(roleStr?: string, userName?: string, allUsers: any[] = []): 'Foreman' | 'Site Engineer' | 'QC' | 'Other' {
    const r = (roleStr || '').toLowerCase();
    if (r.includes('foreman') || r.includes('โฟร์แมน')) return 'Foreman';
    if (r.includes('engineer') || r.includes('วิศวกร')) return 'Site Engineer';
    if (r.includes('qc') || r.includes('ควบคุมคุณภาพ')) return 'QC';
    
    if (userName) {
      const u = allUsers.find(user => (user.username || '').toLowerCase() === userName.toLowerCase() || (user.name || '').toLowerCase() === userName.toLowerCase());
      if (u) {
        const ur = (u.role || '').toLowerCase();
        if (ur.includes('foreman')) return 'Foreman';
        if (ur.includes('engineer')) return 'Site Engineer';
        if (ur.includes('qc')) return 'QC';
      }
    }
    return 'Other';
  }

  // Pure logic replica of Image URL extraction
  function extractFirstValidImageUrl(raw: any): string | null {
    if (!raw) return null;
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (typeof item === 'string') {
          const trimmed = item.trim();
          if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
            return trimmed;
          }
        }
      }
      return null;
    }
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (!trimmed || trimmed === 'null' || trimmed === 'undefined') return null;
      const parts = trimmed.split(',').map(s => s.trim()).filter(s => s.startsWith('http://') || s.startsWith('https://'));
      return parts.length > 0 ? parts[0] : null;
    }
    return null;
  }

  // Pure logic replica of Role Metrics calculation
  function calculateRoleMetrics(activities: any[], inspectionQueue: any[] = []) {
    const foremanActs = activities.filter(a => a.role === 'Foreman');
    const engineerActs = activities.filter(a => a.role === 'Site Engineer');
    const qcActs = activities.filter(a => a.role === 'QC');

    const foremanPlots = new Set(foremanActs.map(a => a.plot));
    const foremanSubmits = foremanActs.filter(a => (a.action || '').includes('ส่ง') || a.progress === 100).length;
    const foremanUpdates = foremanActs.filter(a => !(a.action || '').includes('ส่ง') && a.progress !== 100).length;

    // Breakdown per foreman
    const foremanByStaff = new Map<string, any>();
    foremanActs.forEach(a => {
      const user = a.user || 'ไม่ระบุชื่อ';
      if (!foremanByStaff.has(user)) {
        foremanByStaff.set(user, { user, totalActivities: 0, totalPlots: new Set(), updates: 0, submits: 0 });
      }
      const record = foremanByStaff.get(user)!;
      record.totalActivities += 1;
      if (a.plot) record.totalPlots.add(String(a.plot));
      if ((a.action || '').includes('ส่ง') || a.progress === 100) record.submits += 1;
      else record.updates += 1;
    });
    const foremanStaffList = Array.from(foremanByStaff.values()).sort((a, b) => b.totalActivities - a.totalActivities);

    const engineerInspections = engineerActs.length;
    const engineerApproved = engineerActs.filter(a => (a.action || '').includes('อนุมัติ') || (a.action || '').includes('ผ่าน')).length;
    const engineerPending = inspectionQueue.filter(q => q.statusFor === 'Site Engineer').length;

    const qcTotal = qcActs.length;
    const qcApproved = qcActs.filter(a => (a.action || '').includes('อนุมัติ') || (a.action || '').includes('ผ่าน')).length;
    const qcReworks = qcActs.filter(a => a.type === 'defect' || (a.action || '').includes('ตีกลับ') || (a.action || '').includes('แก้')).length;
    const qcPassRate = qcTotal > 0 ? Math.round((qcApproved / qcTotal) * 100) : 100;
    const qcPending = inspectionQueue.filter(q => q.statusFor === 'QC').length;

    return {
      foreman: { totalPlots: foremanPlots.size, submits: foremanSubmits, updates: foremanUpdates, staffList: foremanStaffList },
      engineer: { inspections: engineerInspections, approved: engineerApproved, pendingQueue: engineerPending },
      qc: { inspections: qcTotal, approved: qcApproved, reworks: qcReworks, passRate: qcPassRate, pendingQueue: qcPending }
    };
  }

  // Pure logic replica of Walkthrough & Blind Spot detection
  function calculateWalkthroughStatus(plots: any[], activities: any[]) {
    const activitiesByPlot = new Map<string, any[]>();
    activities.forEach(a => {
      if (!a.plot) return;
      if (!activitiesByPlot.has(a.plot)) activitiesByPlot.set(a.plot, []);
      activitiesByPlot.get(a.plot)!.push(a);
    });

    const result = plots.map(p => {
      const acts = activitiesByPlot.get(String(p.id)) || [];
      const hasForeman = acts.some(a => a.role === 'Foreman');
      const hasEngineer = acts.some(a => a.role === 'Site Engineer');
      const hasQC = acts.some(a => a.role === 'QC');
      const isBlindSpot = acts.length === 0;
      return { id: p.id, actsCount: acts.length, hasForeman, hasEngineer, hasQC, isBlindSpot };
    });

    const total = result.length;
    const inspected = result.filter(r => !r.isBlindSpot).length;
    const blindSpots = result.filter(r => r.isBlindSpot).length;
    const coverage = total > 0 ? Math.round((inspected / total) * 100) : 0;

    return { result, total, inspected, blindSpots, coverage };
  }

  describe('Role Normalization', () => {
    it('correctly maps Foreman roles with variations', () => {
      expect(getRoleCategory('Foreman')).toBe('Foreman');
      expect(getRoleCategory('foreman')).toBe('Foreman');
      expect(getRoleCategory('โฟร์แมน')).toBe('Foreman');
    });

    it('correctly maps Site Engineer roles with variations', () => {
      expect(getRoleCategory('Site Engineer')).toBe('Site Engineer');
      expect(getRoleCategory('site engineer')).toBe('Site Engineer');
      expect(getRoleCategory('วิศวกร')).toBe('Site Engineer');
    });

    it('correctly maps QC roles with variations', () => {
      expect(getRoleCategory('QC')).toBe('QC');
      expect(getRoleCategory('qc')).toBe('QC');
      expect(getRoleCategory('ควบคุมคุณภาพ')).toBe('QC');
    });

    it('looks up username in allUsers when roleStr is missing', () => {
      const allUsers = [{ username: 'somchai_qc', role: 'QC' }];
      expect(getRoleCategory(undefined, 'somchai_qc', allUsers)).toBe('QC');
    });
  });

  describe('Role Metrics Calculation', () => {
    it('correctly tallies Foreman plots, submits, and updates', () => {
      const activities = [
        { role: 'Foreman', plot: 'A01', action: 'อัปเดตงานก่ออิฐ', progress: 50 },
        { role: 'Foreman', plot: 'A01', action: 'ส่งงาน 100%', progress: 100 },
        { role: 'Foreman', plot: 'A02', action: 'อัปเดตงานฉาบปูน', progress: 30 }
      ];

      const metrics = calculateRoleMetrics(activities, []);
      expect(metrics.foreman.totalPlots).toBe(2); // A01, A02
      expect(metrics.foreman.submits).toBe(1);
      expect(metrics.foreman.updates).toBe(2);
    });

    it('correctly tallies Site Engineer inspections and approvals', () => {
      const activities = [
        { role: 'Site Engineer', plot: 'A01', action: 'Site Engineer อนุมัติผ่าน' },
        { role: 'Site Engineer', plot: 'B02', action: 'เข้าตรวจสอบฐานราก' }
      ];
      const queue = [{ statusFor: 'Site Engineer' }, { statusFor: 'Site Engineer' }];

      const metrics = calculateRoleMetrics(activities, queue);
      expect(metrics.engineer.inspections).toBe(2);
      expect(metrics.engineer.approved).toBe(1);
      expect(metrics.engineer.pendingQueue).toBe(2);
    });

    it('correctly tallies QC inspections, pass rate and reworks', () => {
      const activities = [
        { role: 'QC', plot: 'A01', action: 'QC ตรวจผ่าน' },
        { role: 'QC', plot: 'A02', action: 'QC ตรวจผ่าน' },
        { role: 'QC', plot: 'A03', action: 'QC สั่งแก้ไข/ตีกลับ', type: 'defect' },
        { role: 'QC', plot: 'A04', action: 'ตรวจงานซ่อม', type: 'defect' }
      ];

      const metrics = calculateRoleMetrics(activities, []);
      expect(metrics.qc.inspections).toBe(4);
      expect(metrics.qc.approved).toBe(2);
      expect(metrics.qc.reworks).toBe(2);
      expect(metrics.qc.passRate).toBe(50); // 2/4 = 50%
    });
  });

  describe('Walkthrough & Blind Spot Detection', () => {
    it('correctly identifies inspected plots vs blind spots (จุดอับ)', () => {
      const plots = [
        { id: 'A01', project_name: 'Project A' },
        { id: 'A02', project_name: 'Project A' },
        { id: 'A03', project_name: 'Project A' },
        { id: 'A04', project_name: 'Project A' }
      ];

      const activities = [
        { role: 'Foreman', plot: 'A01', action: 'อัปเดตงาน' },
        { role: 'Site Engineer', plot: 'A02', action: 'ตรวจงาน' },
        { role: 'QC', plot: 'A02', action: 'QC ผ่าน' }
      ];

      const walkthrough = calculateWalkthroughStatus(plots, activities);
      expect(walkthrough.total).toBe(4);
      expect(walkthrough.inspected).toBe(2); // A01, A02
      expect(walkthrough.blindSpots).toBe(2); // A03, A04
      expect(walkthrough.coverage).toBe(50); // 2/4 = 50%

      const p1 = walkthrough.result.find(r => r.id === 'A01');
      expect(p1?.hasForeman).toBe(true);
      expect(p1?.hasEngineer).toBe(false);
      expect(p1?.isBlindSpot).toBe(false);

      const p3 = walkthrough.result.find(r => r.id === 'A03');
      expect(p3?.isBlindSpot).toBe(true);
      expect(p3?.actsCount).toBe(0);
    });
  });

  describe('Foreman Individual Breakdown & QC Pending Queue', () => {
    it('breaks down Foreman activities by individual staff member', () => {
      const activities = [
        { role: 'Foreman', user: 'สมชาย', plot: 'A01', action: 'อัปเดตงานฉาบ' },
        { role: 'Foreman', user: 'สมชาย', plot: 'A02', action: 'ส่งงาน 100%', progress: 100 },
        { role: 'Foreman', user: 'สมชาย', plot: 'A01', action: 'อัปเดตงานปูกระเบื้อง' },
        { role: 'Foreman', user: 'วิชัย', plot: 'B01', action: 'อัปเดตงานทาสี' }
      ];

      const metrics = calculateRoleMetrics(activities, []);
      expect(metrics.foreman.staffList.length).toBe(2);

      const somchai = metrics.foreman.staffList.find((s: any) => s.user === 'สมชาย');
      expect(somchai).toBeDefined();
      expect(somchai?.totalActivities).toBe(3);
      expect(somchai?.totalPlots.size).toBe(2); // A01, A02
      expect(somchai?.submits).toBe(1);
      expect(somchai?.updates).toBe(2);

      const wichai = metrics.foreman.staffList.find((s: any) => s.user === 'วิชัย');
      expect(wichai).toBeDefined();
      expect(wichai?.totalActivities).toBe(1);
      expect(wichai?.totalPlots.size).toBe(1); // B01
    });

    it('correctly tracks QC pending queue from inspectionQueue', () => {
      const activities = [
        { role: 'QC', user: 'มานพ', plot: 'A01', action: 'QC ตรวจผ่าน' }
      ];
      const queue = [
        { statusFor: 'QC' },
        { statusFor: 'QC' },
        { statusFor: 'Site Engineer' }
      ];

      const metrics = calculateRoleMetrics(activities, queue);
      expect(metrics.qc.pendingQueue).toBe(2);
      expect(metrics.engineer.pendingQueue).toBe(1);
    });
  });

  describe('Image Extraction & Broken Image Prevention', () => {
    it('extracts first valid URL from comma-separated string', () => {
      const raw = 'https://buildtrack.com/img1.jpg,https://buildtrack.com/img2.jpg';
      expect(extractFirstValidImageUrl(raw)).toBe('https://buildtrack.com/img1.jpg');
    });

    it('extracts first valid URL from array', () => {
      const raw = ['https://buildtrack.com/img1.jpg', 'https://buildtrack.com/img2.jpg'];
      expect(extractFirstValidImageUrl(raw)).toBe('https://buildtrack.com/img1.jpg');
    });

    it('returns null for invalid or broken image values', () => {
      expect(extractFirstValidImageUrl(null)).toBeNull();
      expect(extractFirstValidImageUrl(undefined)).toBeNull();
      expect(extractFirstValidImageUrl('')).toBeNull();
      expect(extractFirstValidImageUrl('null')).toBeNull();
      expect(extractFirstValidImageUrl('undefined')).toBeNull();
      expect(extractFirstValidImageUrl('broken_image_path.jpg')).toBeNull();
    });

    it('handles single valid http/https URL', () => {
      expect(extractFirstValidImageUrl('http://example.com/photo.png')).toBe('http://example.com/photo.png');
      expect(extractFirstValidImageUrl('https://example.com/photo.png')).toBe('https://example.com/photo.png');
    });
  });
});


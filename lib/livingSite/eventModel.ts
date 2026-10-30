import {
  SiteActivityEvent,
  ActivityMarker,
  InspectionQueueItem,
  AttentionPoint,
  SiteFreshness,
  ActivityEventType,
  WorkerRole,
  SiteCharacter,
  HousePlot,
  BusinessState,
  SimulationActivity
} from './types';

// Bangkok Timezone offset in minutes (+07:00 => +420 min)
const BANGKOK_OFFSET_MINUTES = 7 * 60;

/**
 * Converts a Date or ISO string into a Date object adjusted to Bangkok timezone components.
 */
export function parseToBangkokDate(input: string | Date | number): {
  year: number;
  month: number;
  day: number;
  hours: number;
  minutes: number;
  seconds: number;
  dateStr: string; // YYYY-MM-DD
  timeStr: string; // HH:mm น.
  rawDate: Date;
} {
  const d = new Date(input);
  const pad = (n: number) => String(n).padStart(2, '0');

  if (isNaN(d.getTime())) {
    const now = new Date();
    const bkkMs = now.getTime() + BANGKOK_OFFSET_MINUTES * 60000;
    const bkkDate = new Date(bkkMs);
    return {
      year: bkkDate.getUTCFullYear(),
      month: bkkDate.getUTCMonth() + 1,
      day: bkkDate.getUTCDate(),
      hours: bkkDate.getUTCHours(),
      minutes: bkkDate.getUTCMinutes(),
      seconds: bkkDate.getUTCSeconds(),
      dateStr: `${bkkDate.getUTCFullYear()}-${pad(bkkDate.getUTCMonth() + 1)}-${pad(bkkDate.getUTCDate())}`,
      timeStr: `${pad(bkkDate.getUTCHours())}:${pad(bkkDate.getUTCMinutes())} น.`,
      rawDate: now
    };
  }

  // d.getTime() is UTC milliseconds epoch. Bangkok is UTC+7 (+420 minutes).
  const bkkMs = d.getTime() + BANGKOK_OFFSET_MINUTES * 60000;
  const bkkDate = new Date(bkkMs);

  const year = bkkDate.getUTCFullYear();
  const month = bkkDate.getUTCMonth() + 1;
  const day = bkkDate.getUTCDate();
  const hours = bkkDate.getUTCHours();
  const minutes = bkkDate.getUTCMinutes();
  const seconds = bkkDate.getUTCSeconds();

  const dateStr = `${year}-${pad(month)}-${pad(day)}`;
  const timeStr = `${pad(hours)}:${pad(minutes)} น.`;

  return {
    year,
    month,
    day,
    hours,
    minutes,
    seconds,
    dateStr,
    timeStr,
    rawDate: d
  };
}

/**
 * Calculates human-readable elapsed duration text (e.g. "รอตรวจ 3 ชม.", "รอ 2 วัน")
 */
export function formatWaitDuration(fromIso: string, toDate: Date = new Date()): string {
  const fromTime = new Date(fromIso).getTime();
  if (isNaN(fromTime)) return 'เพิ่งรายงาน';
  const diffMs = Math.max(0, toDate.getTime() - fromTime);
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) return `${diffDays} วัน`;
  if (diffHours > 0) return `${diffHours} ชม.`;
  if (diffMinutes > 0) return `${diffMinutes} นาที`;
  return 'เพิ่งรายงาน';
}

/**
 * Calculates data freshness category based on elapsed time:
 * - < 2h: 'fresh' (สดใหม่)
 * - 2h - 6h: 'recent' (วันนี้)
 * - > 6h (same day): 'stale' (ค้างนาน)
 * - earlier day: 'historical' (ประวัติย้อนหลัง)
 */
export function calculateFreshness(
  eventIso: string,
  selectedDate: string,
  now: Date = new Date()
): SiteFreshness {
  const parsed = parseToBangkokDate(eventIso);
  if (parsed.dateStr !== selectedDate) {
    return 'historical';
  }

  const diffMs = Math.max(0, now.getTime() - parsed.rawDate.getTime());
  const diffHours = diffMs / (1000 * 60 * 60);

  if (diffHours < 2) return 'fresh';
  if (diffHours < 6) return 'recent';
  return 'stale';
}

/**
 * Resolves appropriate WorkerRole and Role Label from role string and action text.
 */
export function resolveWorkerRole(roleStr: string = '', actionStr: string = ''): {
  role: WorkerRole;
  roleLabel: string;
  color: string;
} {
  const r = roleStr.toLowerCase();
  const a = actionStr.toLowerCase();

  if (r.includes('foreman') || r.includes('โฟร์แมน')) {
    return { role: 'foreman', roleLabel: 'โฟร์แมน', color: '#ffffff' };
  }
  if (r.includes('engineer') || r.includes('วิศวกร')) {
    return { role: 'engineer', roleLabel: 'วิศวกรโครงการ', color: '#ffffff' };
  }
  if (r.includes('qc') || r.includes('ตรวจสอบ') || r.includes('ตรวจงาน')) {
    return { role: 'qc', roleLabel: 'QC ผู้ตรวจงาน', color: '#10b981' };
  }
  if (r.includes('ระบบ') || r.includes('ไฟ') || r.includes('ประปา') || a.includes('ไฟฟ้า') || a.includes('ประปา')) {
    return { role: 'mep', roleLabel: 'ช่างระบบ MEP', color: '#38bdf8' };
  }
  if (r.includes('โครงสร้าง') || r.includes('เหล็ก') || a.includes('เหล็ก') || a.includes('เทคอนกรีต') || a.includes('เสา')) {
    return { role: 'steel', roleLabel: 'ช่างโครงสร้างเหล็ก', color: '#f59e0b' };
  }
  if (r.includes('ไม้') || r.includes('แบบ') || a.includes('ไม้') || a.includes('แบบหล่อ')) {
    return { role: 'carpenter', roleLabel: 'ช่างไม้แบบ', color: '#eab308' };
  }
  return { role: 'mason', roleLabel: 'ช่างก่อสร้าง', color: '#f97316' };
}

export interface NormalizeEventsParams {
  taskUpdates?: any[];
  plotTaskAssignments?: any[];
  defects?: any[];
  plots?: any[];
  taskTemplates?: any[];
  selectedDate: string; // YYYY-MM-DD
  now?: Date;
}

/**
 * Normalizes all raw construction records into a unified, truthful SiteActivityEvent model.
 * 
 * Strict Truthfulness Rules:
 * 1. Reporter (`user_name`) is distinct from the Performer / Contractor Team (`contractor_name`).
 * 2. If a foreman reports progress on a masonry task assigned to "ช่างชาญ",
 *    the actor is "ทีมช่างชาญ", reported by "สมศักดิ์ (โฟร์แมน)".
 * 3. An inspector (QC, Site Engineer) appears as the actor ONLY when they submitted an inspection report.
 * 4. Stable tie-breaking sort by Bangkok event timestamp ASC, then ID ASC.
 */
export function normalizeConstructionEvents({
  taskUpdates = [],
  plotTaskAssignments = [],
  defects = [],
  plots = [],
  taskTemplates = [],
  selectedDate,
  now = new Date()
}: NormalizeEventsParams): SiteActivityEvent[] {
  const events: SiteActivityEvent[] = [];

  // 1. Build lookup dictionaries
  const plotMap = new Map<string, any>();
  plots.forEach(p => {
    plotMap.set(String(p.id), p);
    if (p.plot_name) plotMap.set(p.plot_name, p);
  });

  const taskTemplateMap = new Map<string, any>();
  taskTemplates.forEach(t => {
    taskTemplateMap.set(String(t.id), t);
  });

  // Index assignments by `plot_id:task_template_id`
  const assignmentMap = new Map<string, any>();
  plotTaskAssignments.forEach(a => {
    const key = `${a.plot_id}:${a.task_template_id}`;
    assignmentMap.set(key, a);
  });

  // 2. Process Task Updates
  for (const u of taskUpdates) {
    if (!u || !u.created_at) continue;

    const bkk = parseToBangkokDate(u.created_at);
    const plot = plotMap.get(String(u.plot_id));
    const plotName = plot?.plot_name || `แปลง ${u.plot_id}`;
    const taskTmpl = taskTemplateMap.get(String(u.task_template_id));
    const taskName = taskTmpl?.task_name || u.action || 'งานก่อสร้างประจำวัน';

    const assignKey = `${u.plot_id}:${u.task_template_id}`;
    const assignment = assignmentMap.get(assignKey);

    const reporterName = u.user_name || 'ผู้รายงานหน้างาน';
    const reporterRoleStr = u.role || 'โฟร์แมน';
    const actionText = u.action || '';
    const progress = Number(u.progress ?? 0);

    // Determine activity type
    let activityType: ActivityEventType = 'work';
    if (actionText.includes('ไม่อนุมัติ') || actionText.includes('ไม่ผ่าน') || actionText.includes('แจ้งแก้ไข')) {
      activityType = 'inspection_reject';
    } else if (actionText.includes('อนุมัติ') || actionText.includes('ผ่าน') || actionText.includes('ตรวจรับ')) {
      activityType = 'inspection_pass';
    } else if (actionText.includes('ส่งงาน 100%') || progress === 100) {
      activityType = 'inspection_req';
    }

    // Determine Actor vs Reporter identity separation
    const isInspectorAction =
      reporterRoleStr.toLowerCase().includes('qc') ||
      reporterRoleStr.toLowerCase().includes('engineer') ||
      activityType === 'inspection_pass' ||
      activityType === 'inspection_reject';

    let actorType: 'person' | 'team' = 'person';
    let actorId = `user_${reporterName}`;
    let actorName = reporterName;
    let isTeam = false;
    let teamName: string | undefined = undefined;
    let isUnknownTeam = false;

    let roleInfo = resolveWorkerRole(reporterRoleStr, taskName);

    if (isInspectorAction) {
      // Inspector acting directly
      actorType = 'person';
      actorId = `inspector_${reporterName}`;
      actorName = reporterName;
      roleInfo = resolveWorkerRole(reporterRoleStr, 'ตรวจสอบคุณภาพ');
    } else {
      // Construction work report: distinguish contractor team vs foreman reporter
      const contractorName = assignment?.contractor_name || u.contractor_name;
      if (contractorName) {
        actorType = 'team';
        isTeam = true;
        teamName = contractorName.startsWith('ทีม') ? contractorName : `ทีม${contractorName}`;
        actorName = teamName;
        actorId = `team_${actorName}`;
        roleInfo = resolveWorkerRole('mason', taskName);
      } else if (reporterRoleStr.toLowerCase().includes('foreman') || reporterRoleStr.toLowerCase().includes('โฟร์แมน')) {
        // Foreman reported on site without specified contractor team
        actorType = 'person';
        actorId = `foreman_${reporterName}`;
        actorName = reporterName;
        isUnknownTeam = true;
        roleInfo = resolveWorkerRole('foreman', taskName);
      } else {
        // Direct worker or sub-team
        actorType = 'person';
        actorId = `worker_${reporterName}`;
        actorName = reporterName;
        roleInfo = resolveWorkerRole(reporterRoleStr, taskName);
      }
    }

    // Extract photo URLs
    const photoUrls: string[] = [];
    if (Array.isArray(u.images)) {
      u.images.forEach((img: any) => {
        if (typeof img === 'string' && img.trim()) photoUrls.push(img.trim());
      });
    }
    if (u.image_url && typeof u.image_url === 'string' && !photoUrls.includes(u.image_url)) {
      photoUrls.push(u.image_url);
    }

    const freshness = calculateFreshness(u.created_at, selectedDate, now);

    events.push({
      id: `evt_tu_${u.id}`,
      sourceRecordId: String(u.id),
      sourceType: 'task_update',
      plotId: String(u.plot_id),
      plotName,
      taskTemplateId: u.task_template_id ? String(u.task_template_id) : undefined,
      taskName,
      actorType,
      actorId,
      actorName,
      actorRole: roleInfo.role,
      actorRoleLabel: roleInfo.roleLabel,
      actorColor: roleInfo.color,
      isTeam,
      teamName,
      reporterName,
      reporterRole: reporterRoleStr,
      isUnknownTeam,
      eventTime: u.created_at,
      reportTime: u.created_at,
      timeLabel: bkk.timeStr,
      dateLabel: bkk.dateStr,
      activityType,
      actionTitle: actionText || taskName,
      description: u.text_content || `${actorName}: ${actionText || taskName}`,
      progress,
      isWorkerPresent: u.is_worker_present ?? true,
      photoUrls,
      freshness
    });
  }

  // 3. Process Defects as Events
  for (const d of defects) {
    if (!d || !d.created_at) continue;

    const bkk = parseToBangkokDate(d.created_at);
    const plot = plotMap.get(String(d.plot_id));
    const plotName = plot?.plot_name || `แปลง ${d.plot_id}`;

    let activityType: ActivityEventType = 'defect_new';
    let actorName = d.reported_by || 'ผู้ตรวจสอบ';
    if (d.status === 'resolved') {
      activityType = 'defect_done';
      actorName = d.resolved_by || d.reported_by || 'ผู้แก้ไขดีเฟกต์';
    } else if (d.status === 'in_progress') {
      activityType = 'defect_fix';
    }

    const photoUrls: string[] = [];
    if (Array.isArray(d.images)) {
      d.images.forEach((img: any) => {
        if (typeof img === 'string' && img.trim()) photoUrls.push(img.trim());
      });
    }
    if (d.image_url && typeof d.image_url === 'string' && !photoUrls.includes(d.image_url)) {
      photoUrls.push(d.image_url);
    }

    const freshness = calculateFreshness(d.created_at, selectedDate, now);

    events.push({
      id: `evt_def_${d.id}`,
      sourceRecordId: String(d.id),
      sourceType: 'defect',
      plotId: String(d.plot_id),
      plotName,
      taskTemplateId: d.task_id ? String(d.task_id) : undefined,
      taskName: 'รายการตรวจพบข้อบกพร่อง (Defect)',
      actorType: 'person',
      actorId: `defect_actor_${actorName}`,
      actorName,
      actorRole: 'qc',
      actorRoleLabel: 'ฝ่ายตรวจสอบคุณภาพ',
      actorColor: '#ef4444',
      isTeam: false,
      reporterName: d.reported_by || actorName,
      reporterRole: 'QC',
      eventTime: d.updated_at || d.created_at,
      reportTime: d.created_at,
      timeLabel: bkk.timeStr,
      dateLabel: bkk.dateStr,
      activityType,
      actionTitle: d.description || d.title || 'รายการแก้ไขหน้างาน',
      description: `ดีเฟกต์สถานะ: ${d.status || 'open'} — ${d.description || ''}`,
      photoUrls,
      freshness
    });
  }

  // 4. Stable tie-breaking sort: by eventTime ASC, then id ASC
  events.sort((a, b) => {
    const timeA = new Date(a.eventTime).getTime();
    const timeB = new Date(b.eventTime).getTime();
    if (timeA !== timeB) return timeA - timeB;
    return a.id.localeCompare(b.id);
  });

  return events;
}

/**
 * Derives pending inspection queue items from assignments and updates.
 */
export function deriveInspectionQueueItems(
  plotTaskAssignments: any[] = [],
  plots: any[] = [],
  taskTemplates: any[] = [],
  now: Date = new Date()
): InspectionQueueItem[] {
  const queue: InspectionQueueItem[] = [];

  const plotMap = new Map<string, any>();
  plots.forEach(p => {
    plotMap.set(String(p.id), p);
    if (p.plot_name) plotMap.set(p.plot_name, p);
  });

  const templateMap = new Map<string, any>();
  taskTemplates.forEach(t => templateMap.set(String(t.id), t));

  for (const pta of plotTaskAssignments) {
    const progress = Number(pta.current_progress ?? 0);
    const action = pta.latest_action || '';
    const role = (pta.latest_role || '').toLowerCase();
    const reportTime = pta.latest_update_created_at || pta.created_at;

    const isRejected = action.includes('ไม่อนุมัติ') || action.includes('ไม่ผ่าน') || action.includes('แจ้งแก้ไข');
    let statusFor: 'Site Engineer' | 'QC' | 'Rework' | null = null;

    if (progress === 95 && isRejected) {
      statusFor = 'Rework';
    } else if (progress === 100 && (action === 'ส่งงาน 100%' || role.includes('foreman'))) {
      statusFor = 'Site Engineer';
    } else if (progress === 100 && action === 'Site Engineer อนุมัติ') {
      statusFor = 'QC';
    }

    if (statusFor) {
      const plot = plotMap.get(String(pta.plot_id));
      const tmpl = templateMap.get(String(pta.task_template_id));
      const waitText = formatWaitDuration(reportTime, now);

      // Urgent if pending >= 2 days
      const diffDays = (now.getTime() - new Date(reportTime).getTime()) / (1000 * 60 * 60 * 24);
      const isUrgent = diffDays >= 2;

      queue.push({
        id: `insp_${pta.plot_id}_${pta.task_template_id}`,
        plotId: String(pta.plot_id),
        plotName: plot?.plot_name || `แปลง ${pta.plot_id}`,
        taskTemplateId: String(pta.task_template_id),
        taskName: tmpl?.task_name || pta.task_name || 'งานรอตรวจ',
        progress,
        latestAction: action,
        statusFor,
        isRejected,
        isUrgent,
        waitDurationText: waitText,
        reportedAt: reportTime,
        contractorName: pta.contractor_name
      });
    }
  }

  // Sort queue: urgent first, then Rework, then longest wait time
  queue.sort((a, b) => {
    if (a.isUrgent !== b.isUrgent) return a.isUrgent ? -1 : 1;
    if (a.statusFor === 'Rework' && b.statusFor !== 'Rework') return -1;
    if (b.statusFor === 'Rework' && a.statusFor !== 'Rework') return 1;
    const timeA = new Date(a.reportedAt).getTime();
    const timeB = new Date(b.reportedAt).getTime();
    return timeA - timeB;
  });

  return queue;
}

/**
 * Derives Attention Points ("พาไปจุดที่ต้องดู") prioritized by urgency.
 */
export function deriveAttentionPoints(
  defects: any[] = [],
  inspectionQueue: InspectionQueueItem[] = [],
  plots: any[] = [],
  now: Date = new Date()
): AttentionPoint[] {
  const points: AttentionPoint[] = [];

  const plotMap = new Map<string, any>();
  plots.forEach(p => {
    plotMap.set(String(p.id), p);
    if (p.plot_name) plotMap.set(p.plot_name, p);
  });

  // 1. Open Defects
  defects
    .filter(d => d.status !== 'resolved')
    .forEach(d => {
      const plot = plotMap.get(String(d.plot_id));
      const isCritical = d.severity === 'critical' || d.severity === 'major';
      points.push({
        id: `att_def_${d.id}`,
        plotId: String(d.plot_id),
        plotName: plot?.plot_name || `แปลง ${d.plot_id}`,
        type: 'defect',
        title: d.description || d.title || 'รายการดีเฟกต์หน้างาน',
        subtitle: `แจ้งโดย ${d.reported_by || 'QC'} (สถานะ: ${d.status || 'open'})`,
        severity: isCritical ? 'critical' : 'warning',
        waitDurationText: formatWaitDuration(d.created_at, now),
        targetTaskId: d.task_id ? String(d.task_id) : undefined,
        timestamp: d.created_at
      });
    });

  // 2. Pending Inspections & Rework
  inspectionQueue.forEach(q => {
    let severity: 'critical' | 'warning' | 'info' = 'info';
    let titlePrefix = 'รอตรวจงาน';
    if (q.statusFor === 'Rework') {
      severity = 'critical';
      titlePrefix = 'งานต้องแก้ไข (Rework)';
    } else if (q.isUrgent) {
      severity = 'warning';
      titlePrefix = `รอตรวจเร่งด่วนโดย ${q.statusFor}`;
    } else {
      titlePrefix = `รอตรวจโดย ${q.statusFor}`;
    }

    points.push({
      id: `att_${q.id}`,
      plotId: q.plotId,
      plotName: q.plotName,
      type: q.statusFor === 'Rework' ? 'rework' : 'pending_inspection',
      title: `${titlePrefix}: ${q.taskName}`,
      subtitle: q.contractorName ? `ผู้รับเหมา: ${q.contractorName}` : q.latestAction,
      severity,
      waitDurationText: q.waitDurationText,
      targetTaskId: q.taskTemplateId,
      timestamp: q.reportedAt
    });
  });

  // Sort: critical first, then warning, then info, then oldest timestamp
  const rank = { critical: 0, warning: 1, info: 2 };
  points.sort((a, b) => {
    if (rank[a.severity] !== rank[b.severity]) {
      return rank[a.severity] - rank[b.severity];
    }
    return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
  });

  return points;
}

/**
 * Derives the active 3D site state at a given slice of time (Replay / Real-time).
 * 
 * Rules:
 * 1. Single Avatar per Actor: each unique actor appears at their LATEST reported plot up to `cutoffTimeIso`.
 * 2. Earlier events by the same actor at other plots become `ActivityMarkers` on those plots.
 * 3. Links characters to their entrance/workspots on the house plot.
 */
export function deriveSiteStateAtTime({
  events,
  houses,
  cutoffTimeIso
}: {
  events: SiteActivityEvent[];
  houses: HousePlot[];
  cutoffTimeIso?: string;
}): {
  characters: SiteCharacter[];
  updatedHouses: HousePlot[];
} {
  const filteredEvents = cutoffTimeIso
    ? events.filter(e => new Date(e.eventTime).getTime() <= new Date(cutoffTimeIso).getTime())
    : events;

  // Group events by actorId
  const actorEventsMap = new Map<string, SiteActivityEvent[]>();
  for (const ev of filteredEvents) {
    const list = actorEventsMap.get(ev.actorId) || [];
    list.push(ev);
    actorEventsMap.set(ev.actorId, list);
  }

  const characters: SiteCharacter[] = [];
  const plotMarkersMap = new Map<string, ActivityMarker[]>();
  const plotActiveWorkersMap = new Map<string, string[]>();

  let charIndex = 0;
  for (const [actorId, evList] of actorEventsMap.entries()) {
    charIndex++;
    // The events are sorted chronologically; latest is the last item
    const latestEvent = evList[evList.length - 1];
    const charId = `char_real_${charIndex}`;

    // Previous events on DIFFERENT plots become activity markers
    for (let i = 0; i < evList.length - 1; i++) {
      const prev = evList[i];
      if (prev.plotId !== latestEvent.plotId) {
        const markers = plotMarkersMap.get(prev.plotId) || [];
        markers.push({
          id: `marker_${prev.id}`,
          plotId: prev.plotId,
          actorId: prev.actorId,
          actorName: prev.actorName,
          role: prev.actorRole,
          timeStr: prev.timeLabel,
          timeIso: prev.eventTime,
          actionText: prev.actionTitle,
          reporterName: prev.reporterName,
          isTeam: prev.isTeam
        });
        plotMarkersMap.set(prev.plotId, markers);
      }
    }

    // Place avatar at latest reported plot
    const targetHouse = houses.find(h => h.id === latestEvent.plotId || h.plotName === latestEvent.plotName);
    const spawnX = targetHouse ? targetHouse.entrancePos.x : (charIndex % 5) * 3;
    const spawnZ = targetHouse ? targetHouse.entrancePos.z : 10;

    let simActivity: SimulationActivity = 'working_trowel';
    if (latestEvent.actorRole === 'foreman' || latestEvent.actorRole === 'qc' || latestEvent.actorRole === 'engineer') {
      simActivity = 'working_inspect';
    }

    let speechText = latestEvent.actionTitle;
    if (latestEvent.isTeam && latestEvent.reporterName) {
      speechText = `${latestEvent.actionTitle} (รายงานโดย ${latestEvent.reporterName})`;
    }

    characters.push({
      id: charId,
      name: latestEvent.actorName,
      role: latestEvent.actorRole,
      roleLabel: latestEvent.actorRoleLabel,
      teamId: latestEvent.teamName ? `team_${latestEvent.teamName}` : `team_${latestEvent.actorRole}`,
      teamName: latestEvent.teamName || `ฝ่าย${latestEvent.actorRoleLabel}`,
      color: latestEvent.actorColor,
      currentPlotId: targetHouse?.id,
      targetPlotId: targetHouse?.id,
      x: spawnX,
      y: 0,
      z: spawnZ,
      rotationY: targetHouse?.placementRotation || 0,
      businessState: 'in_progress',
      simActivity,
      path: [],
      pathIndex: 0,
      speed: 1.6,
      targetPos: targetHouse?.workSpots[0] || targetHouse?.entrancePos,
      taskName: latestEvent.taskName,
      actionDetail: latestEvent.description,
      speechText,
      lastReportTime: latestEvent.timeLabel,
      photoUrl: latestEvent.photoUrls[0],
      isSimulated: true,
      reporterName: latestEvent.reporterName,
      isTeam: latestEvent.isTeam,
      actorType: latestEvent.actorType,
      isUnknownTeam: latestEvent.isUnknownTeam,
      freshness: latestEvent.freshness,
      sourceEventId: latestEvent.id
    });

    if (targetHouse) {
      const currentWorkers = plotActiveWorkersMap.get(targetHouse.id) || [];
      currentWorkers.push(charId);
      plotActiveWorkersMap.set(targetHouse.id, currentWorkers);
    }
  }

  // Update houses with their activity markers, active workers, and attention cues
  const updatedHouses = houses.map(h => {
    const activeWorkerIds = plotActiveWorkersMap.get(h.id) || [];
    const activityMarkers = plotMarkersMap.get(h.id) || [];
    return {
      ...h,
      activeWorkerIds,
      activityMarkers
    };
  });

  return {
    characters,
    updatedHouses
  };
}

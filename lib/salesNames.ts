/**
 * Normalize Project Name from Excel code to DB project name
 */
export function normalizeProjectName(raw?: string, defaultProject: string = 'ไอลิน6'): string {
  if (!raw) return defaultProject;
  const str = raw.toString().trim();
  const lower = str.toLowerCase().replace(/\s+/g, '');

  if (lower === 'k4' || lower.includes('กานต์รวี4') || lower.includes('กานต์รวี 4')) return 'กานต์รวี4';
  if (lower === 'k2' || lower === 'k2พิเศษ' || lower.includes('กานต์รวี2') || lower.includes('กานต์รวี 2')) return 'กานต์รวี2';
  if (lower === 'al4' || lower.includes('ไอลิน4') || lower.includes('ไอลิน 4')) return 'ไอลิน 4';
  if (lower === 'al6' || lower.includes('ไอลิน6') || lower.includes('ไอลิน 6')) return 'ไอลิน6';
  if (lower === 'al3' || lower.includes('ไอลิน3') || lower.includes('ไอลิน 3')) return 'ไอลิน 3';
  if (lower === 'al2' || lower.includes('ไอลิน2') || lower.includes('ไอลิน 2')) return 'ไอลิน 2';
  if (lower === 'yr' || lower.includes('โยริว')) return 'โยริว';
  if (lower.includes('สันทราย2') || lower.includes('st2') || lower.includes('alst2')) return 'ไอลิน สันทราย 2';

  if (str.includes(',')) {
    const primary = str.split(',')[0].trim();
    return normalizeProjectName(primary, defaultProject);
  }
  return str;
}

/**
 * Normalize Sales Agent name from Excel to system username/displayName
 */
export function normalizeSalesOwner(name?: string): string {
  if (!name) return 'ทีมขาย';
  const str = name.trim();
  const lower = str.toLowerCase().replace(/\s+/g, '');

  if (lower === 'piew' || str.includes('ปวีณา') || str.includes('เปิ้ล')) return 'PIEW';
  if (lower === 'bell' || str.includes('พนิดดา') || str.includes('เบล')) return 'BELL';
  if (lower === 'ying' || str.includes('จริยา') || str.includes('หญิง')) return 'YING';
  if (lower === 'nook' || str.includes('สุมลยา') || str.includes('นุ๊ก')) return 'NOOK';
  if (lower === 'field' || str.includes('กรุณพล') || str.includes('ฟิลด์')) return 'FIELD';
  if (lower === 'teaw' || str.includes('วีรกาณต์') || str.includes('แต้ว')) return 'TEAW';
  if (lower === 'jeejee' || str.includes('อัจฉรา') || str.includes('จีจี้')) return 'JEEJEE';

  return str;
}


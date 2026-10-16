/** Customer-specific deal values; never replace the plot catalogue price. */
export interface CustomerDealDetails { salePrice: number | null; bank: string }
export function customerDealDetails(notes: unknown): CustomerDealDetails {
  const text = typeof notes === 'string' ? notes : '';
  const price = text.match(/^\s*•?\s*ราคาขายสุทธิ:\s*฿?([\d,.]+)\s*บาท/m);
  const bank = text.match(/^\s*•?\s*ธนาคาร:[ \t]*([^\r\n]*)/m);
  const value = price ? Number(price[1].replace(/,/g, '')) : null;
  return { salePrice: value !== null && Number.isFinite(value) && value >= 0 ? value : null, bank: bank?.[1]?.trim() || '' };
}
export function customerDealSummary(price: number | null, bank: string): string {
  return `${price === null ? '' : `• ราคาขายสุทธิ: ฿${price.toLocaleString('en-US', { maximumFractionDigits: 2 })} บาท\n`}• ธนาคาร: ${bank.trim()}`;
}

export interface ExtractedPrices {
  salePrice: number | null;
  landAppraisalPrice: number | null;
}

/** Extracts agreed sale price and land office appraisal price from lead notes/history */
export function extractAgreedPrices(notes: unknown): ExtractedPrices {
  if (typeof notes !== 'string' || !notes) {
    return { salePrice: null, landAppraisalPrice: null };
  }

  let salePrice: number | null = null;
  // 1. Explicit net sale price: "• ราคาขายสุทธิ: ฿2,793,000 บาท"
  const netMatch = notes.match(/•?\s*ราคาขายสุทธิ:\s*฿?([\d,.]+)\s*(?:บาท|บ(?:\.|\s|$))/);
  if (netMatch) {
    salePrice = Number(netMatch[1].replace(/,/g, ''));
  } else {
    // 2. Agreed price from sales: "ราคา: 4,657,000 บ." (avoid matching "ราคาทด" or "ราคาประเมิน")
    const priceMatch = notes.match(/(?:^|[·\s\n•])ราคา(?!\s*ทด)(?:\s*ขาย)?:\s*฿?([\d,.]+)\s*(?:บ(?:\.|\s|$)|บาท)/);
    if (priceMatch) {
      salePrice = Number(priceMatch[1].replace(/,/g, ''));
    }
  }

  let landAppraisalPrice: number | null = null;
  // 3. Land office price: "ราคาทด13: 2,950,000 บ." or "ราคาทด: 2,950,000 บ." or "ราคา ทด: ..."
  const landMatch = notes.match(/(?:^|[·\s\n•])(?:ราคา\s*ทด(?:\.|\s*13)?|ราคาทด(?:13)?|ราคาประเมิน(?:\s*ทด)?):\s*฿?([\d,.]+)\s*(?:บ(?:\.|\s|$)|บาท)/i);
  if (landMatch) {
    landAppraisalPrice = Number(landMatch[1].replace(/,/g, ''));
  }

  return {
    salePrice: salePrice !== null && Number.isFinite(salePrice) && salePrice >= 0 ? salePrice : null,
    landAppraisalPrice: landAppraisalPrice !== null && Number.isFinite(landAppraisalPrice) && landAppraisalPrice >= 0 ? landAppraisalPrice : null
  };
}

/** Extracts expected transfer date (YYYY-MM-DD) from lead notes */
export function extractExpectedTransferDate(notes: unknown): string | null {
  if (typeof notes !== 'string' || !notes) return null;
  const thaiMonths: Record<string, string> = {
    'ม.ค.': '01', 'มกรา': '01', 'มกราคม': '01',
    'ก.พ.': '02', 'กุมภา': '02', 'กุมภาพันธ์': '02',
    'มี.ค.': '03', 'มีนา': '03', 'มีนาคม': '03',
    'เม.ย.': '04', 'เมษา': '04', 'เมษายน': '04',
    'พ.ค.': '05', 'พฤษภา': '05', 'พฤษภาคม': '05',
    'มิ.ย.': '06', 'มิถุนา': '06', 'มิถุนายน': '06',
    'ก.ค.': '07', 'กรกฎา': '07', 'กรกฎาคม': '07',
    'ส.ค.': '08', 'สิงหา': '08', 'สิงหาคม': '08',
    'ก.ย.': '09', 'กันยา': '09', 'กันยายน': '09',
    'ต.ค.': '10', 'ตุลา': '10', 'ตุลาคม': '10',
    'พ.ย.': '11', 'พฤศจิกา': '11', 'พฤศจิกายน': '11',
    'ธ.ค.': '12', 'ธันวา': '12', 'ธันวาคม': '12'
  };

  // 1. Specific date: "คาดโอน: 15 ต.ค. 2569" or "คาดโอน: 15/10/2569"
  const fullDateMatch = notes.match(/คาด(?:ว่าจะ|การณ์)?โอน:\s*(\d{1,2})[\/\s-]([^\s·\n\/]+)[\/\s-](\d{4})/);
  if (fullDateMatch) {
    const day = fullDateMatch[1].padStart(2, '0');
    const m = fullDateMatch[2];
    let year = parseInt(fullDateMatch[3], 10);
    if (year > 2400) year -= 543;
    const month = thaiMonths[m] || (parseInt(m, 10) ? String(parseInt(m, 10)).padStart(2, '0') : null);
    if (month) return `${year}-${month}-${day}`;
  }

  // 2. Month format: "คาดโอน: ต.ค. 2569"
  const monthMatch = notes.match(/คาด(?:ว่าจะ|การณ์)?โอน:\s*([^\s·\n]+)\s*(\d{4})/);
  if (monthMatch) {
    const m = monthMatch[1];
    let year = parseInt(monthMatch[2], 10);
    if (year > 2400) year -= 543;
    const month = thaiMonths[m];
    if (month) {
      const lastDay = new Date(year, parseInt(month, 10), 0).getDate();
      return `${year}-${month}-${String(lastDay).padStart(2, '0')}`;
    }
  }

  // 3. ISO / YYYY-MM-DD
  const isoMatch = notes.match(/คาด(?:ว่าจะ|การณ์)?โอน:\s*(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    let year = parseInt(isoMatch[1], 10);
    if (year > 2400) year -= 543;
    return `${year}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  return null;
}


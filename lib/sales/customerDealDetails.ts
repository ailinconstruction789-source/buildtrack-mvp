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

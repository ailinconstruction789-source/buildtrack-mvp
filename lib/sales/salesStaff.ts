export interface SalesStaffOption {
  userId: string;
  displayName: string;
}

export function isSalesStaffRole(role: unknown): boolean {
  if (typeof role !== 'string') return false;
  const normalized = role.trim().toLowerCase();
  return normalized === 'sale' || normalized === 'sales';
}

// Prefer the existing sales owner/current salesperson only when they are in
// the eligible list. Never reintroduce another role through a default value.
export function selectSalesStaffName(
  options: readonly SalesStaffOption[],
  preferredNames: readonly unknown[]
): string {
  for (const name of preferredNames) {
    if (typeof name === 'string' && options.some(option => option.displayName === name)) return name;
  }
  return options[0]?.displayName || '';
}

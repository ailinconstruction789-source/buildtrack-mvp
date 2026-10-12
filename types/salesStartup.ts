/** Raw rows shared by the app shell and Sales Hub during one authenticated load. */
export interface SalesStartupData {
  leads: Record<string, unknown>[];
  plots: Record<string, unknown>[];
}

export type LoadSalesStartupData = (options?: { fresh?: boolean }) => Promise<SalesStartupData>;

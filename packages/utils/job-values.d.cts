export interface SalaryDetails {
  raw: string;
  low: number | null;
  high: number | null;
  unit: 'month' | 'year' | 'day' | 'hour' | null;
  month: number | null;
  status: 'parsed' | 'negotiable' | 'unknown';
}
export function parseSalaryDetails(value: unknown): SalaryDetails;
export function matchesSalaryDetails(actual: SalaryDetails, expected?: {
  low?: number | null; high?: number | null; unit?: number;
}): boolean;
export function parseCompanySize(value: unknown): [number | null, number | null];
export function explicitJobNature(job?: Record<string, unknown>): string | null;
export const DETAIL_JOB_NATURES: Readonly<Record<number, string>>;

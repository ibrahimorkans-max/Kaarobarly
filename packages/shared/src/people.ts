/** People: employees, salary advances, payroll runs and payslips, expense claims, approvals. */

export const PAY_TYPES = ['monthly', 'daily'] as const;
export type PayType = (typeof PAY_TYPES)[number];

export interface Employee {
  id: string;
  businessId: string;
  name: string;
  phone: string;
  cnic: string;
  designation: string;
  joinDate: string;
  payType: PayType;
  /** monthly salary, or the daily wage, minor units */
  rate: number;
  bankAccount: string;
  status: 'active' | 'left';
  notes: string;
  /** salary advances not yet recovered */
  advanceDue: number;
  createdAt: string;
  /** linked login (attendance check-in, sales credit) */
  userId?: string | null;
  salesTarget?: number;
  commissionBp?: number;
}

export interface Payslip {
  id: string;
  runId: string;
  employeeId: string;
  employeeName: string;
  designation: string;
  payType: PayType;
  rate: number;
  /** days worked (monthly: out of daysInMonth) */
  days: number;
  daysInMonth: number;
  /** pay for the days worked */
  earned: number;
  overtime: number;
  allowances: number;
  bonus: number;
  deductions: number;
  tax: number;
  /** taken back from salary advances */
  advanceRecovery: number;
  /** what the employee receives */
  net: number;
  notes: string;
}

export const RUN_STATUSES = ['draft', 'submitted', 'approved', 'paid'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export const RUN_STATUS_LABELS: Record<RunStatus, string> = { draft: 'Draft', submitted: 'Waiting for approval', approved: 'Approved', paid: 'Paid' };

export interface PayrollRun {
  id: string;
  businessId: string;
  /** YYYY-MM */
  month: string;
  status: RunStatus;
  slips: Payslip[];
  /** salary cost: what was paid plus advances recovered */
  gross: number;
  net: number;
  createdByName: string;
  approvedByName: string;
  paidDate: string | null;
  accountId: string | null;
  currency: string;
  currencyPrecision: number;
  createdAt: string;
}

export const CLAIM_STATUSES = ['pending', 'approved', 'rejected', 'paid'] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];
export interface ExpenseClaim {
  id: string;
  businessId: string;
  number: string;
  date: string;
  category: string;
  amount: number;
  description: string;
  hasReceipt: boolean;
  status: ClaimStatus;
  claimedBy: string;
  claimedByName: string;
  decidedByName: string;
  decisionNote: string;
  financeEntryId: string | null;
  createdAt: string;
}

/** One thing waiting for a manager's decision. */
export interface ApprovalItem {
  kind: 'purchase_request' | 'expense_claim' | 'payroll' | 'recurring_draft';
  id: string;
  title: string;
  sub: string;
  amount: number;
  date: string;
  byName: string;
}

/** Days in a YYYY-MM month. */
export const daysInMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

/** Payslip arithmetic shared by the server and the phone. All amounts are minor units. */
export function computeSlip(s: { payType: PayType; rate: number; days: number; daysInMonth: number; overtime: number; allowances: number; bonus: number; deductions: number; tax: number; advanceRecovery: number }) {
  const earned = s.payType === 'monthly' ? (s.days >= s.daysInMonth ? s.rate : Math.round((s.rate * s.days) / s.daysInMonth)) : s.rate * s.days;
  const net = earned + s.overtime + s.allowances + s.bonus - s.deductions - s.tax - s.advanceRecovery;
  return { earned, net };
}

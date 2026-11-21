/** Advanced finance: cheques, loans, budgets, bills calendar, cash forecast, balance sheet, day close. */

export const CHEQUE_STATUSES = ['pending', 'deposited', 'cleared', 'bounced', 'cancelled'] as const;
export type ChequeStatus = (typeof CHEQUE_STATUSES)[number];
export const CHEQUE_STATUS_LABELS: Record<ChequeStatus, string> = { pending: 'In hand', deposited: 'Deposited', cleared: 'Cleared', bounced: 'Bounced', cancelled: 'Cancelled' };

export interface Cheque {
  id: string;
  businessId: string;
  /** in = received from a client, out = issued to a supplier */
  direction: 'in' | 'out';
  number: string;
  bank: string;
  party: string;
  clientId: string | null;
  supplierId: string | null;
  amount: number;
  /** date written on the cheque (post-dated cheques: in the future) */
  chequeDate: string;
  receivedDate: string;
  status: ChequeStatus;
  statusDate: string | null;
  accountId: string | null;
  paymentId: string | null;
  purchaseId: string | null;
  notes: string;
  currency: string;
  currencyPrecision: number;
  createdAt: string;
}

export interface Loan {
  id: string;
  businessId: string;
  /** borrowed = the business owes; lent = someone owes the business */
  direction: 'borrowed' | 'lent';
  party: string;
  principal: number;
  /** yearly interest in basis points (1200 = 12%) */
  rateBp: number;
  startDate: string;
  endDate: string;
  /** expected regular repayment, 0 when not set */
  installmentAmount: number;
  notes: string;
  status: 'active' | 'closed';
  /** principal given/taken minus principal repaid */
  outstanding: number;
  repaid: number;
  interestPaid: number;
  nextDue: string | null;
  currency: string;
  currencyPrecision: number;
  createdAt: string;
}

export const LOAN_TXN_KINDS = ['disbursement', 'repayment', 'interest'] as const;
export type LoanTxnKind = (typeof LOAN_TXN_KINDS)[number];
export interface LoanTxn {
  id: string;
  loanId: string;
  kind: LoanTxnKind;
  amount: number;
  date: string;
  accountId: string;
  accountName: string;
  notes: string;
}

export interface BudgetLine {
  category: string;
  budget: number;
  actual: number;
  remaining: number;
  /** actual as a share of budget, basis points */
  usedBp: number;
}
export interface BudgetReport {
  month: string;
  lines: BudgetLine[];
  totalBudget: number;
  totalActual: number;
  /** spending in categories that have no budget */
  unbudgeted: { category: string; actual: number }[];
  currency: string;
  currencyPrecision: number;
}

export type CalendarKind = 'invoice' | 'installment' | 'bill' | 'cheque_in' | 'cheque_out' | 'loan' | 'recurring';
export interface CalendarEvent {
  date: string;
  kind: CalendarKind;
  direction: 'in' | 'out';
  title: string;
  party: string;
  amount: number;
  overdue: boolean;
  refType: string;
  refId: string;
}

export interface ForecastWeek {
  start: string;
  end: string;
  moneyIn: number;
  moneyOut: number;
  /** expected balance at the end of the week */
  closing: number;
}
export interface CashForecast {
  today: string;
  days: number;
  opening: number;
  /** already overdue: may or may not arrive / need paying */
  overdueIn: number;
  overdueOut: number;
  /** average monthly running costs (not bills) spread over the period */
  regularCosts: number;
  weeks: ForecastWeek[];
  lowest: { date: string; balance: number };
  events: CalendarEvent[];
  currency: string;
  currencyPrecision: number;
}

export interface BalanceSheetLine {
  label: string;
  amount: number;
}
export interface BalanceSheet {
  date: string;
  assets: BalanceSheetLine[];
  totalAssets: number;
  liabilities: BalanceSheetLine[];
  totalLiabilities: number;
  /** what the business is worth to its owner: assets − liabilities */
  equity: number;
  currency: string;
  currencyPrecision: number;
}

export interface DayClose {
  id: string;
  businessId: string;
  accountId: string;
  accountName: string;
  date: string;
  expected: number;
  counted: number;
  /** counted − expected: + cash over, − cash short */
  difference: number;
  notes: string;
  closedByName: string;
  createdAt: string;
}

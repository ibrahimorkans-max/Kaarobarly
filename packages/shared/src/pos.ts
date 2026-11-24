/** Point of sale: counter sales, shifts, held bills, returns and the Z-report. */
import type { PaymentMethod } from './types';

/** How a POS bill can be paid; several can be combined on one bill. 'credit' = udhaar. */
export const POS_TENDERS = ['cash', 'card', 'jazzcash', 'easypaisa', 'bank_transfer', 'credit'] as const;
export type PosTender = (typeof POS_TENDERS)[number];
export const POS_TENDER_LABELS: Record<PosTender, string> = { cash: 'Cash', card: 'Card', jazzcash: 'JazzCash', easypaisa: 'Easypaisa', bank_transfer: 'Bank / Raast', credit: 'Udhaar (credit)' };
/** The payment method each tender is recorded with ('credit' is not a payment). */
export const TENDER_METHOD: Record<Exclude<PosTender, 'credit'>, PaymentMethod> = { cash: 'cash', card: 'card', jazzcash: 'jazzcash', easypaisa: 'easypaisa', bank_transfer: 'bank_transfer' };

/** A cashier without the manage permission may give at most this much discount on a bill. */
export const CASHIER_DISCOUNT_LIMIT_BP = 1000;

export interface PosLine {
  serviceId: string | null;
  name: string;
  /** thousandths */
  qty: number;
  unit: string;
  unitPrice: number;
  discountType: 'percent' | 'fixed';
  discountValue: number;
  taxRateBp: number;
}

export interface PosShift {
  id: string;
  businessId: string;
  accountId: string;
  accountName: string;
  openedByName: string;
  openedAt: string;
  openingFloat: number;
  status: 'open' | 'closed';
  closedAt: string | null;
  closedByName: string;
  counted: number | null;
  expected: number | null;
  difference: number | null;
  notes: string;
}

export interface ZReport {
  shift: PosShift;
  sales: number;
  salesTotal: number;
  /** money taken per tender (credit = sold on udhaar) */
  byTender: { tender: PosTender; amount: number }[];
  discounts: number;
  tax: number;
  returns: number;
  returnsTotal: number;
  cashIn: number;
  cashOut: number;
  cashRefunds: number;
  /** what the drawer should hold now */
  expectedCash: number;
  moves: { id: string; kind: 'in' | 'out'; amount: number; reason: string; at: string; byName: string }[];
  currency: string;
  currencyPrecision: number;
}

export interface HeldBill {
  id: string;
  name: string;
  clientId: string | null;
  lines: PosLine[];
  billDiscount: number;
  byName: string;
  createdAt: string;
}

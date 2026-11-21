/**
 * Buying and stock: suppliers, the stock ledger, and the demand → purchase order → goods
 * received → bill flow. Quantities are thousandths (1000 = 1), money is minor units.
 */
import type { CustomValues } from './workspace';

export interface Supplier {
  id: string;
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  ntn: string;
  /** what the business already owed this supplier when it started using the app */
  openingBalance: number;
  notes: string;
  status: 'active' | 'inactive';
  custom: CustomValues;
  /** list/detail only: bills not yet paid plus the opening balance */
  owed?: number;
  /** list/detail only: everything bought, all time */
  bought?: number;
}

export const STOCK_MOVE_KINDS = ['opening', 'receipt', 'purchase', 'sale', 'adjust', 'return'] as const;
export type StockMoveKind = (typeof STOCK_MOVE_KINDS)[number];
export const STOCK_MOVE_LABELS: Record<StockMoveKind, string> = {
  opening: 'Opening stock',
  receipt: 'Goods received',
  purchase: 'Purchase bill',
  sale: 'Sold',
  adjust: 'Adjustment',
  return: 'Returned',
};

export interface StockMove {
  id: string;
  itemId: string;
  date: string;
  /** thousandths; positive = in, negative = out */
  qty: number;
  unitCost: number;
  kind: StockMoveKind;
  refType: string;
  refId: string | null;
  /** document number the move came from, e.g. INV-00012 or GRN-0003 */
  refNumber: string;
  note: string;
  createdAt: string;
}

export interface StockItem {
  id: string;
  name: string;
  sku: string;
  barcode: string;
  unit: string;
  itemType: string;
  category: string;
  /** thousandths */
  onHand: number;
  reorderLevel: number;
  costPrice: number;
  salePrice: number;
  /** onHand × cost, minor units */
  value: number;
  low: boolean;
}

export interface StockSummary {
  items: StockItem[];
  totalValue: number;
  lowCount: number;
  outCount: number;
}

export interface DocLine {
  itemId: string | null;
  name: string;
  /** thousandths */
  qty: number;
  unit: string;
  /** minor units per 1 */
  unitPrice: number;
  amount: number;
  /** purchase orders: quantity received so far */
  received?: number;
  note?: string;
}

export const REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'ordered'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export interface PurchaseRequest {
  id: string;
  number: string;
  businessId: string;
  date: string;
  neededBy: string;
  lines: DocLine[];
  notes: string;
  status: RequestStatus;
  requestedBy: string;
  requestedByName: string;
  decidedByName: string;
  decidedAt: string | null;
  decisionNote: string;
  orderId: string | null;
  createdAt: string;
}

export const ORDER_STATUSES = ['draft', 'sent', 'partial', 'received', 'closed', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  partial: 'Partly received',
  received: 'Received',
  closed: 'Closed',
  cancelled: 'Cancelled',
};
export interface PurchaseOrder {
  id: string;
  number: string;
  businessId: string;
  supplierId: string;
  supplierName: string;
  requestId: string | null;
  date: string;
  expectedDate: string;
  lines: DocLine[];
  total: number;
  notes: string;
  terms: string;
  status: OrderStatus;
  currency: string;
  currencyPrecision: number;
  createdAt: string;
}

export interface GoodsReceipt {
  id: string;
  number: string;
  businessId: string;
  supplierId: string;
  supplierName: string;
  orderId: string | null;
  orderNumber: string;
  date: string;
  lines: (DocLine & { orderLine?: number })[];
  total: number;
  notes: string;
  /** the purchase bill made from this receipt */
  purchaseId: string | null;
  purchaseNumber: string;
  currency: string;
  currencyPrecision: number;
  createdAt: string;
}

/** qty (thousandths) × unit price, rounded to minor units */
export const lineAmount = (qty: number, unitPrice: number) => Math.round((qty * unitPrice) / 1000);

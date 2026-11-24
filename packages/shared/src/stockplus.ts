/** Batches and expiry, the reorder slip, and the stock alert centre. */

export interface StockBatch {
  batchNo: string;
  /** YYYY-MM-DD, or '' when the batch has no expiry */
  expiry: string;
  /** thousandths */
  qty: number;
  value: number;
  /** days until expiry (negative = expired); null without an expiry */
  daysLeft: number | null;
}

export interface ReorderLine {
  itemId: string;
  name: string;
  barcode: string;
  unit: string;
  onHand: number;
  reorderLevel: number;
  maxLevel: number;
  packSize: number;
  /** maximum − on hand, rounded up to the pack size (thousandths) */
  suggested: number;
  lastPrice: number;
  estCost: number;
}
export interface ReorderGroup {
  /** '' = no supplier known yet */
  supplierId: string;
  supplierName: string;
  supplierPhone: string;
  lines: ReorderLine[];
  total: number;
}
export interface ReorderSlip {
  date: string;
  groups: ReorderGroup[];
  total: number;
  currency: string;
  currencyPrecision: number;
}

export interface ExpiryBatch extends StockBatch {
  itemId: string;
  name: string;
  barcode: string;
  unit: string;
  salePrice: number;
  supplierId: string;
  supplierName: string;
  /** basis points: a clearance discount to move it before it expires */
  suggestedDiscountBp: number;
}
export interface ExpiryBucket {
  count: number;
  value: number;
}
export interface ExpiryReport {
  buckets: { expired: ExpiryBucket; d7: ExpiryBucket; d30: ExpiryBucket; d90: ExpiryBucket };
  batches: ExpiryBatch[];
  /** written off as expired, this month and in total */
  lossThisMonth: number;
  currency: string;
  currencyPrecision: number;
}

export const STOCK_ALERT_TYPES = [
  'out_of_stock',
  'low_stock',
  'running_out',
  'negative',
  'expired',
  'expiring',
  'overstock',
  'dead_stock',
  'overdue_po',
  'price_rise',
  'below_cost',
  'label_pending',
] as const;
export type StockAlertType = (typeof STOCK_ALERT_TYPES)[number];

export const STOCK_ALERT_INFO: Record<StockAlertType, { label: string; hint: string }> = {
  out_of_stock: { label: 'Out of stock', hint: 'A selling item has none left' },
  low_stock: { label: 'Low stock', hint: 'At or below the reorder level' },
  running_out: { label: 'Running out soon', hint: 'At the last 30 days’ sales speed, stock lasts fewer days than set' },
  negative: { label: 'Negative stock', hint: 'More sold than recorded: count it' },
  expired: { label: 'Expired', hint: 'A batch is past its expiry date' },
  expiring: { label: 'Expiring soon', hint: 'Within the item’s warning period' },
  overstock: { label: 'Overstock', hint: 'Above the maximum level' },
  dead_stock: { label: 'Dead stock', hint: 'In stock but not sold for the set number of days' },
  overdue_po: { label: 'Overdue order', hint: 'A purchase order is past its expected date' },
  price_rise: { label: 'Supplier price rise', hint: 'Bought for more than last time' },
  below_cost: { label: 'Selling below cost', hint: 'Sale price is under the latest cost' },
  label_pending: { label: 'New price labels', hint: 'Price changed since labels were printed' },
};

export interface StockAlertSettings {
  off: StockAlertType[];
  /** dead stock after this many days without a sale */
  deadDays: number;
  /** expiry warning when the item has none of its own */
  expiryDays: number;
  /** running out when stock lasts fewer days than this */
  runningOutDays: number;
}
export const DEFAULT_STOCK_ALERT_SETTINGS: StockAlertSettings = { off: [], deadDays: 60, expiryDays: 30, runningOutDays: 7 };

export type StockAlertAction = 'reorder' | 'count' | 'item' | 'expiry' | 'order' | 'labels' | 'price';
export interface StockAlert {
  key: string;
  type: StockAlertType;
  level: 'info' | 'warn' | 'danger';
  title: string;
  sub: string;
  itemId?: string;
  refId?: string;
  action: StockAlertAction;
}

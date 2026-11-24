/** Product and shelf labels: sizes, what a template shows, and the built-in templates. */

export const LABEL_SIZES = {
  roll38x25: { label: 'Roll 38 × 25 mm', w: 38, h: 25 },
  roll50x25: { label: 'Roll 50 × 25 mm', w: 50, h: 25 },
  roll50x30: { label: 'Roll 50 × 30 mm', w: 50, h: 30 },
  roll60x40: { label: 'Roll 60 × 40 mm', w: 60, h: 40 },
  shelf80x40: { label: 'Shelf 80 × 40 mm', w: 80, h: 40 },
  a4_65: { label: 'A4 sheet · 65 labels (38 × 21 mm)', w: 38.1, h: 21.2, sheet: { cols: 5, rows: 13, top: 10.7, left: 4.7, gapX: 2.5, gapY: 0 } },
  a4_40: { label: 'A4 sheet · 40 labels (52 × 30 mm)', w: 52.5, h: 29.7, sheet: { cols: 4, rows: 10, top: 0, left: 0, gapX: 0, gapY: 0 } },
  a4_24: { label: 'A4 sheet · 24 labels (64 × 34 mm)', w: 63.5, h: 33.9, sheet: { cols: 3, rows: 8, top: 13.1, left: 7.2, gapX: 2.5, gapY: 0 } },
} as const;
export type LabelSize = keyof typeof LABEL_SIZES;
export const LABEL_SIZE_KEYS = Object.keys(LABEL_SIZES) as LabelSize[];

/** What the code on the label is: the item's barcode (or SKU) as bars, a QR, or nothing. */
export type LabelCode = 'barcode' | 'qr' | 'none';
/** What the QR holds. */
export type LabelQrContent = 'code' | 'code_price' | 'name_price';
export const LABEL_QR_LABELS: Record<LabelQrContent, string> = { code: 'Barcode / SKU only', code_price: 'Code + price', name_price: 'Name + price' };

export interface LabelShow {
  business: boolean;
  logo: boolean;
  name: boolean;
  nameUr: boolean;
  price: boolean;
  mrp: boolean;
  sku: boolean;
  unit: boolean;
}
export const LABEL_SHOW_LABELS: Record<keyof LabelShow, string> = {
  business: 'Shop name',
  logo: 'Logo',
  name: 'Item name',
  nameUr: 'Urdu name',
  price: 'Price',
  mrp: 'MRP (struck out when higher)',
  sku: 'SKU',
  unit: 'Unit (per kg, per pc)',
};

export interface LabelDesign {
  size: LabelSize;
  code: LabelCode;
  qrContent: LabelQrContent;
  show: LabelShow;
  /** S, M or L: how big the price prints */
  priceSize: 'S' | 'M' | 'L';
  /** a fixed line, e.g. "Made in Pakistan" or "Packed fresh daily" */
  extra: string;
  border: boolean;
}

export interface LabelTemplate extends LabelDesign {
  id: string;
  name: string;
  /** built into the app; copy it to change it */
  builtIn?: boolean;
  updatedAt?: string;
}

const show = (s: Partial<LabelShow>): LabelShow => ({ business: false, logo: false, name: true, nameUr: false, price: true, mrp: false, sku: false, unit: false, ...s });

export const BUILT_IN_LABELS: LabelTemplate[] = [
  { id: 'builtin-small', builtIn: true, name: 'Small price tag', size: 'roll38x25', code: 'barcode', qrContent: 'code', show: show({}), priceSize: 'M', extra: '', border: false },
  { id: 'builtin-product', builtIn: true, name: 'Product label', size: 'roll50x30', code: 'barcode', qrContent: 'code', show: show({ business: true, nameUr: true, mrp: true }), priceSize: 'M', extra: '', border: false },
  { id: 'builtin-shelf', builtIn: true, name: 'Shelf label', size: 'shelf80x40', code: 'qr', qrContent: 'code_price', show: show({ nameUr: true, unit: true, sku: true }), priceSize: 'L', extra: '', border: true },
  { id: 'builtin-sheet', builtIn: true, name: 'A4 sticker sheet', size: 'a4_65', code: 'barcode', qrContent: 'code', show: show({}), priceSize: 'S', extra: '', border: false },
];

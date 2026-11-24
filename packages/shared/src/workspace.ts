/**
 * Workspace setup: what kind of business this is, which modules are switched on, what things are
 * called (wording), extra fields people want on their records, and the kinds of items they sell.
 * Stored as JSON on the tenant row, so it reaches phones with the rest of the data.
 */

// ---------------------------------------------------------------- modules

export const MODULES = [
  'pos',
  'invoices',
  'quotations',
  'recurring',
  'installments',
  'payments',
  'purchases',
  'inventory',
  'finance',
  'accounts',
  'cheques',
  'loans',
  'budgets',
  'dayClose',
  'payroll',
  'expenseClaims',
  'multiCurrency',
  'reports',
] as const;
export type ModuleKey = (typeof MODULES)[number];

export const MODULE_INFO: Record<ModuleKey, { name: string; hint: string; icon: string; core?: boolean }> = {
  pos: { name: 'Point of sale (POS)', hint: 'Fast counter sales with scanning, shifts, receipts and returns', icon: 'calculator-outline' },
  invoices: { name: 'Invoices', hint: 'Bills you send to customers', icon: 'document-text-outline', core: true },
  quotations: { name: 'Quotations', hint: 'Price quotes you can turn into invoices', icon: 'document-outline' },
  recurring: { name: 'Recurring invoices', hint: 'Bill the same customer every week, month or year', icon: 'repeat-outline' },
  installments: { name: 'Installments', hint: 'Split an invoice into dated parts', icon: 'calendar-outline' },
  payments: { name: 'Payments & receipts', hint: 'Record money received and print receipts', icon: 'cash-outline', core: true },
  purchases: { name: 'Purchases & suppliers', hint: 'Bills for things you buy', icon: 'bag-handle-outline' },
  inventory: { name: 'Stock', hint: 'Quantities in hand, stock in and out', icon: 'cube-outline' },
  finance: { name: 'Money in / out', hint: 'Expenses and other income', icon: 'stats-chart-outline' },
  accounts: { name: 'Cash & bank', hint: 'Balances, transfers and the daily cashbook', icon: 'wallet-outline' },
  cheques: { name: 'Cheques', hint: 'Post-dated cheques in hand and issued, clearing and bounces', icon: 'card-outline' },
  loans: { name: 'Loans', hint: 'Money borrowed or lent, repayments and interest', icon: 'git-compare-outline' },
  budgets: { name: 'Budgets', hint: 'Monthly spending limits by category', icon: 'pie-chart-outline' },
  dayClose: { name: 'Day close', hint: 'Count the cash each evening and lock the day', icon: 'lock-closed-outline' },
  payroll: { name: 'Payroll', hint: 'Employees, salaries, advances and payslips', icon: 'people-outline' },
  expenseClaims: { name: 'Expense claims', hint: 'Staff claim money they spent; a manager approves', icon: 'receipt-outline' },
  multiCurrency: { name: 'Multiple currencies', hint: 'Invoices and accounts in other currencies', icon: 'globe-outline' },
  reports: { name: 'Reports', hint: 'Profit & loss, cash flow, PDF and Excel', icon: 'bar-chart-outline' },
};

// ---------------------------------------------------------------- wording

export const TERM_KEYS = ['client', 'clients', 'item', 'items', 'invoice', 'invoices', 'quotation', 'quotations', 'purchase', 'purchases', 'supplier', 'suppliers'] as const;
export type TermKey = (typeof TERM_KEYS)[number];
export type Terms = Record<TermKey, string>;

export const DEFAULT_TERMS: Terms = {
  client: 'Client',
  clients: 'Clients',
  item: 'Service',
  items: 'Services & Products',
  invoice: 'Invoice',
  invoices: 'Invoices',
  quotation: 'Quotation',
  quotations: 'Quotations',
  purchase: 'Purchase',
  purchases: 'Purchases',
  supplier: 'Supplier',
  suppliers: 'Suppliers',
};

/** Pairs shown on the wording screen: one row edits the singular and plural together. */
export const TERM_PAIRS: { one: TermKey; many: TermKey; label: string; examples: string }[] = [
  { one: 'client', many: 'clients', label: 'People you bill', examples: 'Customer, Patient, Student, Tenant, Member' },
  { one: 'item', many: 'items', label: 'Things you sell', examples: 'Product, Treatment, Course, Dish, Job' },
  { one: 'invoice', many: 'invoices', label: 'Your bills', examples: 'Bill, Sale, Fee voucher, Challan' },
  { one: 'quotation', many: 'quotations', label: 'Price quotes', examples: 'Estimate, Proposal, Offer' },
  { one: 'purchase', many: 'purchases', label: 'Things you buy', examples: 'Purchase bill, Expense bill' },
  { one: 'supplier', many: 'suppliers', label: 'People you buy from', examples: 'Vendor, Distributor, Mill' },
];

// ---------------------------------------------------------------- custom fields

export const FIELD_ENTITIES = ['client', 'item', 'invoice', 'supplier', 'purchase'] as const;
export type FieldEntity = (typeof FIELD_ENTITIES)[number];
export const FIELD_TYPES = ['text', 'number', 'date', 'select', 'checkbox'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
export const FIELD_TYPE_LABELS: Record<FieldType, string> = { text: 'Text', number: 'Number', date: 'Date', select: 'Choice list', checkbox: 'Yes / No' };

export interface CustomField {
  /** stable key used in each record's `custom` values */
  id: string;
  entity: FieldEntity;
  label: string;
  type: FieldType;
  options: string[];
  required: boolean;
  /** print it on invoices and quotations */
  showOnPdf: boolean;
}

export type CustomValue = string | number | boolean;
export type CustomValues = Record<string, CustomValue>;

/** Problems with the values for one record; empty when everything is fine. */
export function checkCustomValues(fields: CustomField[], entity: FieldEntity, values: CustomValues | undefined): string[] {
  const out: string[] = [];
  for (const f of fields.filter((x) => x.entity === entity)) {
    const v = values?.[f.id];
    const empty = v === undefined || v === '' || v === null;
    if (f.required && (empty || (f.type === 'checkbox' && v !== true))) {
      if (f.type !== 'checkbox' || empty) out.push(`${f.label} is required`);
      continue;
    }
    if (empty) continue;
    if (f.type === 'number' && (typeof v !== 'number' || !Number.isFinite(v))) out.push(`${f.label} must be a number`);
    if (f.type === 'date' && (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v))) out.push(`${f.label} must be a date (YYYY-MM-DD)`);
    if (f.type === 'select' && !f.options.includes(String(v))) out.push(`${f.label}: choose one of ${f.options.join(', ')}`);
    if (f.type === 'checkbox' && typeof v !== 'boolean') out.push(`${f.label} must be yes or no`);
  }
  return out;
}

/** Text for showing a value: dates stay ISO here, the app formats them. */
export function customValueText(f: CustomField, v: CustomValue | undefined): string {
  if (v === undefined || v === '') return '';
  if (f.type === 'checkbox') return v ? 'Yes' : 'No';
  return String(v);
}

/** Lowercase id from a label, unique among `taken`. */
export function fieldIdFor(label: string, taken: string[]): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'field';
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}_${n}`;
  return id;
}

// ---------------------------------------------------------------- business types

export const BUSINESS_TYPES = [
  'services',
  'retail',
  'wholesale',
  'manufacturing',
  'restaurant',
  'clinic',
  'construction',
  'transport',
  'education',
  'rental',
  'freelancer',
  'other',
] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

export interface Preset {
  name: string;
  hint: string;
  icon: string;
  modules: ModuleKey[];
  terms: Partial<Terms>;
  itemTypes: string[];
  fields: Omit<CustomField, 'id'>[];
}

const ALL: ModuleKey[] = [...MODULES];
const BASIC: ModuleKey[] = ['invoices', 'payments', 'quotations', 'finance', 'accounts', 'reports', 'budgets', 'payroll', 'expenseClaims'];
const field = (entity: FieldEntity, label: string, type: FieldType = 'text', options: string[] = [], showOnPdf = false): Omit<CustomField, 'id'> => ({ entity, label, type, options, required: false, showOnPdf });

export const PRESETS: Record<BusinessType, Preset> = {
  services: {
    name: 'Services company',
    hint: 'Consultancy, IT, labs, repairs, agencies',
    icon: 'briefcase-outline',
    modules: [...BASIC, 'recurring', 'installments', 'purchases'],
    terms: {},
    itemTypes: ['Service', 'Product'],
    fields: [field('invoice', 'Work order no.', 'text', [], true)],
  },
  retail: {
    name: 'Shop / retail',
    hint: 'General store, pharmacy, electronics, clothing',
    icon: 'storefront-outline',
    modules: ['pos', 'invoices', 'payments', 'purchases', 'inventory', 'finance', 'accounts', 'reports', 'dayClose', 'budgets'],
    terms: { client: 'Customer', clients: 'Customers', item: 'Product', items: 'Products', invoice: 'Sale', invoices: 'Sales' },
    itemTypes: ['Product', 'Service'],
    fields: [field('item', 'Barcode'), field('item', 'Brand')],
  },
  wholesale: {
    name: 'Wholesale / distribution',
    hint: 'Distributors, traders, dealers',
    icon: 'cube-outline',
    modules: ['invoices', 'payments', 'quotations', 'installments', 'purchases', 'inventory', 'finance', 'accounts', 'reports', 'cheques', 'loans', 'budgets', 'dayClose'],
    terms: { client: 'Customer', clients: 'Customers', item: 'Product', items: 'Products', supplier: 'Vendor', suppliers: 'Vendors' },
    itemTypes: ['Product', 'Service'],
    fields: [field('client', 'Route / area'), field('client', 'Salesman'), field('invoice', 'Vehicle no.', 'text', [], true)],
  },
  manufacturing: {
    name: 'Manufacturing',
    hint: 'Factories, mills, workshops',
    icon: 'construct-outline',
    modules: ALL,
    terms: { client: 'Customer', clients: 'Customers', item: 'Product', items: 'Products' },
    itemTypes: ['Finished goods', 'Raw material', 'Service'],
    fields: [field('invoice', 'Delivery challan no.', 'text', [], true), field('item', 'Grade')],
  },
  restaurant: {
    name: 'Restaurant / food',
    hint: 'Restaurants, cafés, bakeries, caterers',
    icon: 'restaurant-outline',
    modules: ['pos', 'invoices', 'payments', 'purchases', 'inventory', 'finance', 'accounts', 'reports', 'dayClose', 'budgets'],
    terms: { client: 'Customer', clients: 'Customers', item: 'Dish', items: 'Menu', invoice: 'Bill', invoices: 'Bills' },
    itemTypes: ['Dish', 'Drink', 'Deal'],
    fields: [field('invoice', 'Table no.', 'text', [], true), field('invoice', 'Order type', 'select', ['Dine-in', 'Takeaway', 'Delivery'], true)],
  },
  clinic: {
    name: 'Clinic / healthcare',
    hint: 'Clinics, doctors, dentists, labs',
    icon: 'medkit-outline',
    modules: ['invoices', 'payments', 'installments', 'purchases', 'finance', 'accounts', 'reports'],
    terms: { client: 'Patient', clients: 'Patients', item: 'Treatment', items: 'Treatments', invoice: 'Bill', invoices: 'Bills' },
    itemTypes: ['Consultation', 'Procedure', 'Test', 'Medicine'],
    fields: [field('client', 'MR number'), field('client', 'Date of birth', 'date'), field('client', 'Gender', 'select', ['Male', 'Female', 'Other']), field('invoice', 'Doctor', 'text', [], true)],
  },
  construction: {
    name: 'Construction / contractor',
    hint: 'Builders, contractors, interior work',
    icon: 'hammer-outline',
    modules: [...BASIC, 'installments', 'purchases', 'inventory', 'cheques', 'loans'],
    terms: { client: 'Client', clients: 'Clients', item: 'Work item', items: 'Work items', quotation: 'Estimate', quotations: 'Estimates' },
    itemTypes: ['Labour', 'Material', 'Equipment'],
    fields: [field('invoice', 'Project / site', 'text', [], true), field('invoice', 'Running bill no.', 'number', [], true)],
  },
  transport: {
    name: 'Transport / logistics',
    hint: 'Goods transport, couriers, rent-a-car',
    icon: 'bus-outline',
    modules: [...BASIC, 'recurring', 'purchases'],
    terms: { item: 'Trip', items: 'Trips & charges' },
    itemTypes: ['Trip', 'Loading', 'Other charge'],
    fields: [field('invoice', 'Vehicle no.', 'text', [], true), field('invoice', 'Bilty / GR no.', 'text', [], true), field('invoice', 'Route', 'text', [], true)],
  },
  education: {
    name: 'School / academy',
    hint: 'Schools, tuition centres, training',
    icon: 'school-outline',
    modules: ['invoices', 'payments', 'recurring', 'installments', 'finance', 'accounts', 'reports'],
    terms: { client: 'Student', clients: 'Students', item: 'Fee', items: 'Fee heads', invoice: 'Fee voucher', invoices: 'Fee vouchers' },
    itemTypes: ['Tuition', 'Admission', 'Exam', 'Transport'],
    fields: [field('client', 'Class', 'text'), field('client', 'Roll no.'), field('client', 'Guardian name'), field('invoice', 'Fee month', 'text', [], true)],
  },
  rental: {
    name: 'Rentals / property',
    hint: 'Property rent, equipment hire, hostels',
    icon: 'home-outline',
    modules: ['invoices', 'payments', 'recurring', 'installments', 'finance', 'accounts', 'reports'],
    terms: { client: 'Tenant', clients: 'Tenants', item: 'Charge', items: 'Charges' },
    itemTypes: ['Rent', 'Utility', 'Maintenance'],
    fields: [field('client', 'Unit / room no.'), field('client', 'Lease end', 'date'), field('invoice', 'Rent month', 'text', [], true)],
  },
  freelancer: {
    name: 'Freelancer',
    hint: 'Designers, developers, writers, tutors',
    icon: 'laptop-outline',
    modules: ['invoices', 'payments', 'quotations', 'recurring', 'finance', 'accounts', 'multiCurrency', 'reports'],
    terms: {},
    itemTypes: ['Service'],
    fields: [field('invoice', 'Project', 'text', [], true)],
  },
  other: {
    name: 'Something else',
    hint: 'Start with everything and switch off what you do not need',
    icon: 'apps-outline',
    modules: ALL,
    terms: {},
    itemTypes: ['Service', 'Product'],
    fields: [],
  },
};

// ---------------------------------------------------------------- the whole setup

export interface Workspace {
  /** false until the owner has gone through the setup wizard */
  configured: boolean;
  businessType: BusinessType;
  modules: Record<ModuleKey, boolean>;
  terms: Terms;
  customFields: CustomField[];
  itemTypes: string[];
}

export function defaultWorkspace(): Workspace {
  return {
    configured: false,
    businessType: 'other',
    modules: Object.fromEntries(MODULES.map((m) => [m, true])) as Record<ModuleKey, boolean>,
    terms: { ...DEFAULT_TERMS },
    customFields: [],
    itemTypes: ['Service', 'Product'],
  };
}

/** A complete workspace for a business type (wizard result before the owner tweaks it). */
export function workspaceFromPreset(type: BusinessType): Workspace {
  const p = PRESETS[type];
  const fields: CustomField[] = [];
  for (const f of p.fields) fields.push({ ...f, id: fieldIdFor(f.label, fields.map((x) => x.id)) });
  return {
    configured: true,
    businessType: type,
    modules: Object.fromEntries(MODULES.map((m) => [m, !!MODULE_INFO[m].core || p.modules.includes(m)])) as Record<ModuleKey, boolean>,
    terms: { ...DEFAULT_TERMS, ...p.terms },
    customFields: fields,
    itemTypes: [...p.itemTypes],
  };
}

/** Read stored JSON (possibly older or partial) into a complete workspace. */
export function resolveWorkspace(raw: unknown): Workspace {
  const base = defaultWorkspace();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<Workspace>;
  return {
    configured: !!r.configured,
    businessType: BUSINESS_TYPES.includes(r.businessType as BusinessType) ? (r.businessType as BusinessType) : base.businessType,
    // a module added after the shop was set up starts as its business type's preset has it
    modules: { ...(BUSINESS_TYPES.includes(r.businessType as BusinessType) ? workspaceFromPreset(r.businessType as BusinessType).modules : base.modules), ...(r.modules ?? {}), invoices: true, payments: true },
    terms: { ...base.terms, ...Object.fromEntries(Object.entries(r.terms ?? {}).filter(([, v]) => typeof v === 'string' && v.trim())) },
    customFields: Array.isArray(r.customFields) ? r.customFields : [],
    itemTypes: Array.isArray(r.itemTypes) && r.itemTypes.length ? r.itemTypes : base.itemTypes,
  };
}

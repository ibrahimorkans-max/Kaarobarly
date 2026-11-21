/** Collections and documents: reminders, the client portal, credit notes, document language and QR. */

export const REMINDER_CHANNELS = ['whatsapp', 'sms', 'email', 'call', 'visit'] as const;
export type ReminderChannel = (typeof REMINDER_CHANNELS)[number];
export const REMINDER_CHANNEL_LABELS: Record<ReminderChannel, string> = { whatsapp: 'WhatsApp', sms: 'SMS', email: 'Email', call: 'Phone call', visit: 'Visit' };

export interface Reminder {
  id: string;
  clientId: string;
  invoiceId: string | null;
  channel: ReminderChannel;
  note: string;
  /** the client promised to pay by this date */
  promiseDate: string;
  byName: string;
  createdAt: string;
}

export interface CollectionRow {
  clientId: string;
  clientName: string;
  phone: string;
  whatsapp: string;
  email: string;
  /** everything unpaid, business currency */
  outstanding: number;
  /** the part already past its due date */
  overdue: number;
  /** days since the oldest unpaid due date (0 when nothing is overdue) */
  daysOverdue: number;
  invoices: { id: string; number: string; dueDate: string; balance: number }[];
  lastReminder: Reminder | null;
  portalToken: string | null;
}

/** Document language: English, Urdu, or both side by side. */
export const DOC_LANGUAGES = ['en', 'ur', 'both'] as const;
export type DocLanguage = (typeof DOC_LANGUAGES)[number];
export const DOC_LANGUAGE_LABELS: Record<DocLanguage, string> = { en: 'English', ur: 'اردو (Urdu)', both: 'English + اردو' };

/** What the QR code printed on invoices opens. */
export const QR_MODES = ['none', 'portal', 'bank'] as const;
export type QrMode = (typeof QR_MODES)[number];
export const QR_MODE_LABELS: Record<QrMode, string> = { none: 'No QR code', portal: 'Client portal link', bank: 'Bank / IBAN details' };

export interface CreditNote {
  id: string;
  number: string;
  businessId: string;
  clientId: string;
  clientName: string;
  invoiceId: string;
  invoiceNumber: string;
  date: string;
  lines: { serviceId: string | null; name: string; qty: number; unit: string; unitPrice: number; amount: number }[];
  reason: string;
  total: number;
  /** returned goods went back into stock */
  restock: boolean;
  status: 'final' | 'cancelled';
  currency: string;
  currencyPrecision: number;
  createdAt: string;
}

/** Fill a reminder template: {client} {amount} {invoices} {business} {due} {link}. */
export function fillTemplate(template: string, v: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m)).replace(/\n{3,}/g, '\n\n').trim();
}

export const DEFAULT_REMINDER = 'Assalam o Alaikum {client},\n\nThis is a reminder from {business} that {amount} is due on {invoices}{due}.\n{link}\nPlease let us know when you can pay. Thank you!';

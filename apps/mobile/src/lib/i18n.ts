import { useSyncExternalStore } from 'react';
import { local } from './storage';

/**
 * App language. The shared building blocks (menus, section titles, buttons, field labels, tabs,
 * empty states) pass their text through tr(), so one dictionary translates most screens.
 * Names, amounts and anything the user typed are never translated.
 */
export type AppLang = 'en' | 'ur';
const KEY = 'kaarobarly.lang';
let lang: AppLang = 'en';
const listeners = new Set<() => void>();

local
  .get<AppLang>(KEY)
  .then((v) => {
    if (v === 'ur') {
      lang = v;
      listeners.forEach((l) => l());
    }
  })
  .catch(() => {});

export function setLang(next: AppLang) {
  lang = next;
  void local.set(KEY, next);
  listeners.forEach((l) => l());
}
export const getLang = () => lang;
export function useLang(): AppLang {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    () => lang,
  );
}

const UR: Record<string, string> = {
  // navigation
  Home: 'ہوم', More: 'مزید', Finance: 'مالیات', Invoices: 'انوائسز', Purchases: 'خریداری', Settings: 'ترتیبات', 'Go to': 'جائیں',
  Clients: 'کلائنٹس', Customers: 'گاہک', Patients: 'مریض', Students: 'طلباء', Tenants: 'کرایہ دار', Suppliers: 'سپلائرز', Vendors: 'وینڈرز',
  Payments: 'ادائیگیاں', Receipts: 'رسیدیں', Quotations: 'کوٹیشنز', Estimates: 'تخمینے', Reports: 'رپورٹس', Stock: 'اسٹاک', Buying: 'خریداری کا عمل',
  Accounts: 'اکاؤنٹس', Setup: 'سیٹ اپ', Installments: 'اقساط', Cheques: 'چیک', Loans: 'قرضے', Budgets: 'بجٹ', 'Day close': 'دن کا اختتام',
  'Bills calendar': 'بلوں کا کیلنڈر', Calendar: 'کیلنڈر', Forecast: 'پیشگوئی', 'Cash forecast · Balance sheet': 'نقد کی پیشگوئی · بیلنس شیٹ',
  Collections: 'وصولیاں', 'Business setup': 'کاروبار کا سیٹ اپ', 'Business Profiles': 'کاروباری پروفائل', 'Settings & Security': 'ترتیبات اور سیکیورٹی',
  'Cash & Bank Accounts': 'نقد اور بینک اکاؤنٹس', 'Daily Cashbook': 'روزانہ کیش بک', 'Profit & Loss · Cash Flow': 'نفع و نقصان · کیش فلو', 'Exchange Rates': 'شرح تبادلہ',
  'Recurring Invoices': 'بار بار انوائسز', 'Services & Products': 'خدمات اور مصنوعات', Products: 'مصنوعات', Menu: 'مینو', Treatments: 'علاج', 'Fee heads': 'فیس کی مدیں',
  'Custom fields': 'اضافی خانے', Businesses: 'کاروبار', 'Profit & Loss': 'نفع و نقصان', Recurring: 'بار بار',
  // common sections and labels
  Overview: 'خلاصہ', Details: 'تفصیلات', Items: 'اشیاء', Notes: 'نوٹس', History: 'تاریخچہ', Movements: 'نقل و حرکت', Modules: 'ماڈیولز', 'Your words': 'آپ کے الفاظ',
  Basics: 'بنیادی معلومات', 'Billing address': 'بلنگ کا پتہ', 'Tax & account': 'ٹیکس اور اکاؤنٹ', Contact: 'رابطہ', 'Payment details': 'ادائیگی کی تفصیل',
  Name: 'نام', Phone: 'فون', 'Phone number': 'فون نمبر', Email: 'ای میل', Address: 'پتہ', City: 'شہر', Country: 'ملک', Category: 'زمرہ', Amount: 'رقم', Date: 'تاریخ',
  Quantity: 'مقدار', Unit: 'اکائی', 'Price per unit': 'فی اکائی قیمت', 'Default price': 'طے شدہ قیمت', Total: 'کل', Paid: 'ادا شدہ', Unpaid: 'غیر ادا شدہ',
  Overdue: 'واجب الادا', Draft: 'مسودہ', Cancelled: 'منسوخ', Supplier: 'سپلائر', Reason: 'وجہ', 'Notes (optional)': 'نوٹس (اختیاری)', 'Note (optional)': 'نوٹ (اختیاری)',
  'Due date': 'آخری تاریخ', 'Invoice date': 'انوائس کی تاریخ', Reference: 'حوالہ', Status: 'حالت', Search: 'تلاش',
  // buttons
  Save: 'محفوظ کریں', 'Save changes': 'تبدیلیاں محفوظ کریں', Cancel: 'منسوخ کریں', Delete: 'حذف کریں', Edit: 'ترمیم', Add: 'شامل کریں', Done: 'ہو گیا', Share: 'شیئر', Copy: 'کاپی',
  Call: 'کال', SMS: 'ایس ایم ایس', WhatsApp: 'واٹس ایپ', Scan: 'اسکین', 'Scan barcode': 'بارکوڈ اسکین کریں', 'Record Payment': 'ادائیگی درج کریں', 'Add Payment': 'ادائیگی شامل کریں',
  'Create Invoice': 'انوائس بنائیں', 'New purchase': 'نئی خریداری', 'Record a loan': 'قرض درج کریں', 'Add cheque': 'چیک شامل کریں', 'Close the day': 'دن بند کریں',
  'Preview invoice': 'انوائس دیکھیں', 'Finish setup': 'سیٹ اپ مکمل کریں', Back: 'واپس', Approve: 'منظور کریں', Reject: 'مسترد کریں', 'Credit note': 'کریڈٹ نوٹ', 'Debit note': 'ڈیبٹ نوٹ',
  'Receive goods': 'مال وصول کریں', 'Make the bill': 'بل بنائیں', 'Request items': 'اشیاء کی درخواست', 'New purchase order': 'نیا خریداری آرڈر', 'Record goods received': 'وصول شدہ مال درج کریں',
  'Purchase orders': 'خریداری آرڈرز', 'Goods received': 'وصول شدہ مال', Requests: 'درخواستیں', All: 'تمام', Received: 'وصول شدہ', Issued: 'جاری کردہ', Open: 'کھلے',
  'Money in': 'آمدنی', 'Money out': 'اخراجات', 'To collect': 'وصول کرنا ہے', 'To pay': 'ادا کرنا ہے', 'You owe': 'آپ کے ذمے', 'Owed to you': 'آپ کا لینا',
  'Everyone who owes': 'تمام مقروض', 'Running low': 'کم ہو رہا ہے', 'Out of stock': 'ختم', Adjust: 'ایڈجسٹ', Count: 'گنتی', Repay: 'واپسی', Interest: 'سود',
  'Every Business Move,\nMade Smarter': 'ہر کاروباری قدم،\nزیادہ سمجھداری سے',
  Skip: 'چھوڑیں', Next: 'اگلا', 'Get started': 'شروع کریں', 'Start your\nBusiness Online': 'اپنا کاروبار\nآن لائن شروع کریں', 'Sell faster,\nanywhere': 'تیزی سے بیچیں،\nکہیں بھی', 'Choose\nYour plan': 'اپنا\nپلان چنیں',
  'Invoices, stock, payments and staff in one app, set up for your kind of business in minutes.': 'انوائس، اسٹاک، ادائیگیاں اور عملہ ایک ایپ میں، چند منٹ میں آپ کے کاروبار کے مطابق۔',
  'Scan, bill and print at the counter. It keeps working without internet and syncs when you are back online.': 'کاؤنٹر پر اسکین کریں، بل بنائیں اور پرنٹ کریں۔ انٹرنیٹ کے بغیر بھی چلتی ہے اور بعد میں سنک ہو جاتی ہے۔',
  'Start with a free 30-day Pro trial, then pick the plan that fits. You can upgrade any time.': '30 دن کے مفت پرو ٹرائل سے شروع کریں، پھر اپنا پلان چنیں۔ کبھی بھی اپگریڈ کریں۔',
  Language: 'زبان', 'Plan & usage': 'پلان اور استعمال', 'Smart tools': 'سمارٹ ٹولز', Alerts: 'الرٹس', 'Ask Tijar': 'تجار سے پوچھیں', 'Quick entry': 'فوری اندراج', Automation: 'آٹومیشن', People: 'لوگ', Approvals: 'منظوریاں', Payroll: 'تنخواہیں', Employees: 'ملازمین', 'Expense claims': 'اخراجات کے دعوے', Claims: 'دعوے', Team: 'ٹیم', 'App language': 'ایپ کی زبان', 'Sign out': 'سائن آؤٹ',
};

/** Translate fixed UI text when Urdu is on; anything not in the dictionary is shown as is. */
export function tr(s: string): string;
export function tr(s: string | undefined): string | undefined;
export function tr(s: string | undefined) {
  if (lang !== 'ur' || !s) return s;
  return UR[s] ?? UR[s.trim()] ?? s;
}

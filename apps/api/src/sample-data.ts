import { now, uid, type Db } from './core';
import { HttpError, type AuthContext } from './perm';

// No Node-only imports here: this runs on the phone too (offline routes).
// ================================================================ sample data for a new business

const SAMPLES: Record<string, { items: [string, string, number, boolean][]; clients: string[]; supplier: string }> = {
  restaurant: { items: [['Chicken Karahi (half)', 'Karahi', 145_000, false], ['Daal Mash', 'Curries', 65_000, false], ['Roghni Naan', 'Bread', 6_000, false], ['Mint Margarita', 'Drinks', 35_000, false], ['Mineral Water 500ml', 'Drinks', 8_000, true], ['Kheer', 'Dessert', 30_000, false]], clients: ['Office party (Ali)', 'Regular: Usman'], supplier: 'Lahore Meat Supply' },
  retail: { items: [['Basmati Rice 1kg', 'Grocery', 39_000, true], ['Cooking Oil 1L', 'Grocery', 58_000, true], ['Sugar 1kg', 'Grocery', 16_000, true], ['Tea 190g', 'Beverages', 52_000, true], ['Washing Powder 1kg', 'Household', 45_000, true], ['Biscuits Family Pack', 'Snacks', 25_000, true]], clients: ['Ahmed Khan', 'Mrs. Rabia'], supplier: 'Al-Madina Traders' },
  clinic: { items: [['Consultation', 'Visits', 150_000, false], ['Follow-up visit', 'Visits', 80_000, false], ['Dressing', 'Procedures', 50_000, false], ['Blood sugar test', 'Lab', 30_000, false]], clients: ['Patient: Hamid', 'Patient: Sana'], supplier: 'City Medical Store' },
  services: { items: [['Haircut', 'Hair', 80_000, false], ['Beard trim', 'Hair', 40_000, false], ['Facial', 'Skin', 250_000, false], ['Consultation (hour)', 'Consulting', 500_000, false]], clients: ['Bilal Ahmed', 'Nadia Textiles'], supplier: 'Beauty Supplies Co' },
  default: { items: [['Product A', 'General', 100_000, true], ['Product B', 'General', 250_000, true], ['Service visit', 'Services', 150_000, false], ['Delivery', 'Services', 20_000, false]], clients: ['Sample Customer 1', 'Sample Customer 2'], supplier: 'Sample Supplier' },
};

/** Fill an empty business with a few items, customers and a supplier so it can be tried right away. */
export function addSampleData(db: Db, auth: AuthContext, type: string) {
  return db.tx(() => {
    if (db.get('select count(*) as n from service where tenant_id = ?', auth.tenantId)!.n > 0) throw new HttpError(409, 'Your catalogue already has items. Sample data is only for an empty business.');
    const s = SAMPLES[type] ?? SAMPLES.default;
    const t = now();
    for (const [name, category, price, stock] of s.items) {
      const id = uid();
      db.run('insert into service (id, tenant_id, name, category, description, default_price, unit, tax_rate_bp, default_discount_bp, status, track_stock, created_at) values (?,?,?,?,?,?,?,0,0,?,?,?)', id, auth.tenantId, name, category, 'Sample item: edit or delete it', price, stock ? 'pcs' : '', 'active', stock ? 1 : 0, t);
    }
    for (const name of s.clients) db.run("insert into client (id, tenant_id, name, notes, created_at) values (?,?,?,'Sample customer',?)", uid(), auth.tenantId, name, t);
    db.run("insert into supplier (id, tenant_id, name, phone, status, created_at) values (?,?,?,'','active',?)", uid(), auth.tenantId, s.supplier, t);
    db.audit(auth.tenantId, auth.userId, 'sample.add', 'tenant', auth.tenantId, { type });
    return { items: s.items.length, clients: s.clients.length, suppliers: 1 };
  });
}

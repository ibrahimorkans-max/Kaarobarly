import { z } from 'zod';
import { now, today, uid, type Db } from './core';
import * as acc from './accounts';
import * as d from './domain';
import * as fin from './finance';
import * as fx from './fx';
import * as pur from './purchases';
import { HttpError, can, need, type Req, type Res } from './perm';
import * as quotes from './quotes';
import * as rec from './recurring';
import * as ws from './workspace';
import * as proc from './procurement';
import * as stock from './stock';
import * as adv from './advanced';
import * as col from './collections';
import * as ppl from './people';
import * as rules from './rules';
import { assertLimit } from './saas';
import * as pos from './pos';
import * as labels from './labels';
import * as stockplus from './stockplus';
import * as growth from './growth';
import * as fin2 from './finance2';
import * as people2 from './people2';
import * as insights from './insights';
import { addSampleData } from './sample-data';
import { buildReport, type ReportFilter } from './reports';

/** Anything with Express-style route methods: the Express app on the server, MiniApp on the phone. */
export interface AppLike {
  get(path: string, ...handlers: any[]): unknown;
  post(path: string, ...handlers: any[]): unknown;
  put(path: string, ...handlers: any[]): unknown;
  delete(path: string, ...handlers: any[]): unknown;
}

const camelToSnake = (s: string) => s.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
const toDb = (v: unknown) => (typeof v === 'boolean' ? (v ? 1 : 0) : Array.isArray(v) || (v && typeof v === 'object') ? JSON.stringify(v) : v);

/** Generic tenant-scoped insert/update for the simple master-data tables. */
export function upsert(db: Db, table: 'business' | 'client' | 'service', tenantId: string, data: Record<string, unknown>, id?: string): string {
  const cols = Object.keys(data).map(camelToSnake);
  const vals = Object.values(data).map(toDb) as any[];
  if (id) {
    d.ownedRow(db, table, tenantId, id);
    db.run(`update ${table} set ${cols.map((c) => `${c} = ?`).join(', ')} where id = ? and tenant_id = ?`, ...vals, id, tenantId);
    return id;
  }
  const newId = uid();
  db.run(
    `insert into ${table} (id, tenant_id, created_at, ${cols.join(', ')}) values (?, ?, ?, ${cols.map(() => '?').join(', ')})`,
    newId, tenantId, now(), ...vals,
  );
  return newId;
}

/**
 * Every business route (clients, invoices, payments, finance, reports…). The server registers
 * them on Express; the phone registers the same code on MiniApp to work offline.
 * All handlers are synchronous and use only the portable database interface.
 */
export function registerRoutes(app: AppLike, db: Db) {
  const T = (req: Req) => req.auth.tenantId;
  const page = (req: Req) => ({
    limit: Math.min(Math.max(Number(req.query.limit) || 30, 1), 100),
    offset: Math.max(Number(req.query.offset) || 0, 0),
    q: String(req.query.q ?? '').trim(),
  });

  const withCustom = <B extends { custom?: Record<string, unknown> }>(tenantId: string, entity: 'client' | 'item', body: B): B => ({ ...body, custom: ws.cleanCustom(db, tenantId, entity, body.custom as any) });

  // ------------------------------------------------------------ workspace: business type, modules, wording, custom fields

  app.get('/workspace', (req: Req, res: Res) => res.json(ws.getWorkspace(db, T(req))));
  app.put('/workspace', need('businesses.manage'), (req: Req, res: Res) => res.json(ws.saveWorkspace(db, req.auth, ws.workspaceSchema.parse(req.body))));
  app.post('/workspace/preset', need('businesses.manage'), (req: Req, res: Res) => {
    const { businessType } = z.object({ businessType: ws.workspaceSchema.shape.businessType }).parse(req.body);
    res.json(ws.applyPreset(db, req.auth, businessType));
  });

  // ------------------------------------------------------------ business profiles

  app.get('/businesses', (req: Req, res: Res) => {
    res.json(db.all('select * from business where tenant_id = ? order by created_at', T(req)).map(d.mapBusiness));
  });
  app.post('/businesses', need('businesses.manage'), (req: Req, res: Res) => {
    assertLimit(db, T(req), 'business');
    const id = upsert(db, 'business', T(req), d.businessSchema.parse(req.body));
    acc.ensureAccounts(db, { businessId: id });
    db.audit(T(req), req.auth.userId, 'business.create', 'business', id);
    res.status(201).json(d.mapBusiness(d.ownedRow(db, 'business', T(req), id)));
  });
  app.put('/businesses/:id', need('businesses.manage'), (req: Req, res: Res) => {
    upsert(db, 'business', T(req), d.businessSchema.parse(req.body), String(req.params.id));
    db.audit(T(req), req.auth.userId, 'business.update', 'business', String(req.params.id));
    res.json(d.mapBusiness(d.ownedRow(db, 'business', T(req), String(req.params.id))));
  });

  // ------------------------------------------------------------ clients

  app.get('/clients', (req: Req, res: Res) => {
    const { limit, offset, q } = page(req);
    res.json(d.listClients(db, T(req), q, limit, offset));
  });
  app.get('/clients/:id', (req: Req, res: Res) => res.json(d.getClient(db, T(req), String(req.params.id))));
  app.get('/clients/:id/ledger', need('invoices.view'), (req: Req, res: Res) => res.json(d.clientLedger(db, T(req), String(req.params.id))));
  app.post('/clients', need('clients.manage'), (req: Req, res: Res) => {
    const id = upsert(db, 'client', T(req), withCustom(T(req), 'client', d.clientSchema.parse(req.body)));
    db.audit(T(req), req.auth.userId, 'client.create', 'client', id);
    res.status(201).json(d.getClient(db, T(req), id));
  });
  app.put('/clients/:id', need('clients.manage'), (req: Req, res: Res) => {
    upsert(db, 'client', T(req), withCustom(T(req), 'client', d.clientSchema.parse(req.body)), String(req.params.id));
    db.audit(T(req), req.auth.userId, 'client.update', 'client', String(req.params.id));
    res.json(d.getClient(db, T(req), String(req.params.id)));
  });

  // ------------------------------------------------------------ services & products

  app.get('/services', (req: Req, res: Res) => {
    const { limit, offset, q } = page(req);
    const like = `%${q}%`;
    res.json(
      db
        .all(
          `select s.*, case when s.track_stock = 1 then coalesce((select sum(m.qty) from stock_move m where m.item_id = s.id), 0) end as on_hand
           from service s where s.tenant_id = ? and (s.name like ? or s.category like ? or s.sku like ? or s.barcode = ?) order by s.name collate nocase limit ? offset ?`,
          T(req), like, like, like, q, Math.max(limit, 100), offset,
        )
        .map((r) => d.mapService(r.on_hand === null ? { ...r, on_hand: undefined } : r)),
    );
  });
  /** Exact barcode / SKU lookup for scanners. */
  app.get('/services/by-code/:code', (req: Req, res: Res) => {
    const r = stock.findByCode(db, T(req), String(req.params.code));
    if (!r) throw new HttpError(404, 'No item has this barcode.');
    res.json(d.mapService(r));
  });
  app.post('/services', need('invoices.create'), (req: Req, res: Res) => {
    const body = d.serviceSchema.parse(req.body);
    labels.assertBarcodeFree(db, T(req), body.barcode);
    // stock items without a maker's barcode get the shop's own, so they can be scanned and labelled
    if (!body.barcode && body.trackStock && req.body?.autoCode !== false) body.barcode = labels.freeStoreBarcode(db, T(req));
    const id = upsert(db, 'service', T(req), withCustom(T(req), 'item', body));
    res.status(201).json(d.mapService(d.ownedRow(db, 'service', T(req), id)));
  });
  app.put('/services/:id', need('invoices.create'), (req: Req, res: Res) => {
    const id = String(req.params.id);
    const body = d.serviceSchema.parse(req.body);
    labels.assertBarcodeFree(db, T(req), body.barcode, id);
    const before = d.ownedRow(db, 'service', T(req), id);
    upsert(db, 'service', T(req), withCustom(T(req), 'item', body), id);
    // a new price means the shelf and product labels are out of date
    if (before.default_price !== body.defaultPrice || (before.mrp ?? 0) !== body.mrp) db.run('update service set label_pending = 1 where id = ?', id);
    res.json(d.mapService(d.ownedRow(db, 'service', T(req), id)));
  });
  app.post('/services/auto-codes', need('invoices.create'), (req: Req, res: Res) => res.json(labels.fillMissingCodes(db, req.auth, labels.autoCodesSchema.parse(req.body ?? {}))));

  // ------------------------------------------------------------ labels

  app.get('/labels/templates', (req: Req, res: Res) => res.json(labels.listTemplates(db, T(req))));
  app.post('/labels/templates', need('invoices.create'), (req: Req, res: Res) => res.status(201).json(labels.saveTemplate(db, req.auth, labels.templateSchema.parse(req.body))));
  app.put('/labels/templates/:id', need('invoices.create'), (req: Req, res: Res) => res.json(labels.saveTemplate(db, req.auth, labels.templateSchema.parse(req.body), String(req.params.id))));
  app.delete('/labels/templates/:id', need('invoices.create'), (req: Req, res: Res) => res.json(labels.deleteTemplate(db, req.auth, String(req.params.id))));
  app.get('/labels/pending', (req: Req, res: Res) => res.json(labels.pendingLabels(db, T(req))));
  app.post('/labels/printed', (req: Req, res: Res) => res.json(labels.markPrinted(db, req.auth, labels.printedSchema.parse(req.body))));

  // ------------------------------------------------------------ stock

  app.get('/stock', (req: Req, res: Res) => res.json(stock.stockSummary(db, T(req), String(req.query.q ?? '').trim())));
  app.get('/stock/reorder', (req: Req, res: Res) => res.json(proc.reorderList(db, T(req))));
  app.get('/stock/reorder-slip', (req: Req, res: Res) => res.json(stockplus.reorderSlip(db, T(req))));
  app.post('/stock/reorder-slip/orders', need('purchases.manage'), (req: Req, res: Res) => res.status(201).json(stockplus.ordersFromSlip(db, req.auth, stockplus.slipOrdersSchema.parse(req.body))));
  app.get('/stock/expiry', (req: Req, res: Res) => res.json(stockplus.expiryReport(db, T(req))));
  app.get('/stock/alerts', (req: Req, res: Res) => res.json(stockplus.stockAlerts(db, T(req))));
  app.get('/stock/alert-settings', (req: Req, res: Res) => res.json(stockplus.getAlertSettings(db, T(req))));
  app.put('/stock/alert-settings', need('stock.manage'), (req: Req, res: Res) => res.json(stockplus.saveAlertSettings(db, req.auth, stockplus.settingsSchema.parse(req.body))));
  app.post('/stock/write-off', need('stock.manage'), (req: Req, res: Res) => res.status(201).json(stockplus.writeOff(db, req.auth, stockplus.writeOffSchema.parse(req.body))));
  app.get('/stock/:id', (req: Req, res: Res) => res.json({ item: stock.stockItem(db, T(req), String(req.params.id)), moves: stock.moves(db, T(req), String(req.params.id)), batches: stockplus.batchesOf(db, T(req), String(req.params.id)) }));
  app.post('/stock/adjust', need('stock.manage'), (req: Req, res: Res) => res.status(201).json(stock.adjust(db, req.auth, stock.adjustSchema.parse(req.body))));

  // ------------------------------------------------------------ suppliers

  app.get('/suppliers', (req: Req, res: Res) => res.json(proc.listSuppliers(db, T(req), String(req.query.q ?? '').trim())));
  app.get('/suppliers/:id', (req: Req, res: Res) => res.json(proc.supplierActivity(db, T(req), String(req.params.id))));
  app.post('/suppliers', need('purchases.manage'), (req: Req, res: Res) => res.status(201).json(proc.saveSupplier(db, req.auth, proc.supplierSchema.parse(req.body))));
  app.put('/suppliers/:id', need('purchases.manage'), (req: Req, res: Res) => res.json(proc.saveSupplier(db, req.auth, proc.supplierSchema.parse(req.body), String(req.params.id))));

  // ------------------------------------------------------------ demand → purchase order → goods received → bill

  app.get('/purchase-requests', (req: Req, res: Res) => res.json(proc.listRequests(db, T(req), String(req.query.status ?? ''))));
  app.get('/purchase-requests/:id', (req: Req, res: Res) => res.json(proc.getRequest(db, T(req), String(req.params.id))));
  app.post('/purchase-requests', need('purchases.request'), (req: Req, res: Res) => res.status(201).json(proc.saveRequest(db, req.auth, proc.requestSchema.parse(req.body))));
  app.put('/purchase-requests/:id', need('purchases.request'), (req: Req, res: Res) => res.json(proc.saveRequest(db, req.auth, proc.requestSchema.parse(req.body), String(req.params.id))));
  app.post('/purchase-requests/:id/decide', need('purchases.approve'), (req: Req, res: Res) => {
    const b = z.object({ decision: z.enum(['approved', 'rejected']), note: z.string().trim().max(500).default('') }).parse(req.body);
    res.json(proc.decideRequest(db, req.auth, String(req.params.id), b.decision, b.note));
  });
  app.delete('/purchase-requests/:id', need('purchases.request'), (req: Req, res: Res) => {
    proc.deleteRequest(db, req.auth, String(req.params.id));
    res.json({ ok: true });
  });

  app.get('/purchase-orders', (req: Req, res: Res) => res.json(proc.listOrders(db, T(req), String(req.query.status ?? ''))));
  app.get('/purchase-orders/:id', (req: Req, res: Res) => {
    const order = proc.getOrder(db, T(req), String(req.params.id));
    res.json({ order, supplier: proc.getSupplier(db, T(req), order.supplierId), business: d.mapBusiness(d.ownedRow(db, 'business', T(req), order.businessId)), receipts: proc.listReceipts(db, T(req)).filter((g) => g.orderId === order.id) });
  });
  app.post('/purchase-orders', need('purchases.manage'), (req: Req, res: Res) => res.status(201).json(proc.saveOrder(db, req.auth, proc.orderSchema.parse(req.body))));
  app.put('/purchase-orders/:id', need('purchases.manage'), (req: Req, res: Res) => res.json(proc.saveOrder(db, req.auth, proc.orderSchema.parse(req.body), String(req.params.id))));
  app.post('/purchase-orders/:id/status', need('purchases.manage'), (req: Req, res: Res) => {
    const { status } = z.object({ status: z.enum(['sent', 'cancelled', 'closed']) }).parse(req.body);
    res.json(proc.setOrderStatus(db, req.auth, String(req.params.id), status));
  });
  app.delete('/purchase-orders/:id', need('purchases.manage'), (req: Req, res: Res) => {
    proc.deleteOrder(db, req.auth, String(req.params.id));
    res.json({ ok: true });
  });

  app.get('/goods-receipts', (req: Req, res: Res) => res.json(proc.listReceipts(db, T(req), req.query.unbilled === '1')));
  app.get('/goods-receipts/:id', (req: Req, res: Res) => res.json(proc.getReceipt(db, T(req), String(req.params.id))));
  app.post('/goods-receipts', need('purchases.manage'), (req: Req, res: Res) => res.status(201).json(proc.createReceipt(db, req.auth, proc.receiptSchema.parse(req.body))));
  app.post('/goods-receipts/:id/bill', need('finance.manage'), (req: Req, res: Res) => res.status(201).json(proc.billReceipt(db, req.auth, String(req.params.id), proc.billSchema.parse(req.body ?? {}))));
  app.delete('/goods-receipts/:id', need('purchases.manage'), (req: Req, res: Res) => {
    proc.deleteReceipt(db, req.auth, String(req.params.id));
    res.json({ ok: true });
  });

  // ------------------------------------------------------------ advanced finance

  const biz = (req: Req) => (req.query.businessId ? String(req.query.businessId) : undefined);
  const isoQ = (req: Req, key: string, fallback: string) => (/^\d{4}-\d{2}-\d{2}$/.test(String(req.query[key] ?? '')) ? String(req.query[key]) : fallback);
  const todayQ = () => new Date().toISOString().slice(0, 10);

  app.get('/cheques', need('reports.view'), (req: Req, res: Res) => res.json(adv.listCheques(db, T(req), { direction: req.query.direction ? String(req.query.direction) : undefined, status: req.query.status ? String(req.query.status) : undefined })));
  app.get('/cheques/:id', need('reports.view'), (req: Req, res: Res) => res.json(adv.getCheque(db, T(req), String(req.params.id))));
  app.post('/cheques', need('finance.manage'), (req: Req, res: Res) => res.status(201).json(adv.saveCheque(db, req.auth, adv.chequeSchema.parse(req.body))));
  app.put('/cheques/:id', need('finance.manage'), (req: Req, res: Res) => res.json(adv.saveCheque(db, req.auth, adv.chequeSchema.parse(req.body), String(req.params.id))));
  app.post('/cheques/:id/status', need('finance.manage'), (req: Req, res: Res) => {
    const b = z.object({ status: z.enum(['deposited', 'cleared', 'bounced', 'cancelled']), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), accountId: z.string().nullable().optional() }).parse(req.body);
    res.json(adv.setChequeStatus(db, req.auth, String(req.params.id), b.status, { date: b.date, accountId: b.accountId }));
  });
  app.delete('/cheques/:id', need('finance.manage'), (req: Req, res: Res) => {
    adv.deleteCheque(db, req.auth, String(req.params.id));
    res.json({ ok: true });
  });

  app.get('/loans', need('reports.view'), (req: Req, res: Res) => res.json(adv.listLoans(db, T(req))));
  app.get('/loans/:id', need('reports.view'), (req: Req, res: Res) => res.json(adv.getLoan(db, T(req), String(req.params.id))));
  app.post('/loans', need('finance.manage'), (req: Req, res: Res) => res.status(201).json(adv.createLoan(db, req.auth, adv.loanSchema.parse(req.body))));
  app.post('/loans/:id/txns', need('finance.manage'), (req: Req, res: Res) => res.status(201).json(adv.addLoanTxn(db, req.auth, String(req.params.id), adv.loanTxnSchema.parse(req.body))));
  app.delete('/loans/:id/txns/:txnId', need('finance.manage'), (req: Req, res: Res) => {
    adv.deleteLoanTxn(db, req.auth, String(req.params.id), String(req.params.txnId));
    res.json({ ok: true });
  });
  app.delete('/loans/:id', need('finance.manage'), (req: Req, res: Res) => {
    adv.deleteLoan(db, req.auth, String(req.params.id));
    res.json({ ok: true });
  });

  app.get('/budgets', need('reports.view'), (req: Req, res: Res) => {
    const month = /^\d{4}-\d{2}$/.test(String(req.query.month ?? '')) ? String(req.query.month) : todayQ().slice(0, 7);
    res.json(adv.budgetReport(db, T(req), biz(req), month));
  });
  app.put('/budgets', need('finance.manage'), (req: Req, res: Res) => {
    const body = adv.budgetSchema.parse(req.body);
    adv.saveBudget(db, req.auth, body);
    res.json(adv.budgetReport(db, T(req), body.businessId, body.month === 'default' ? todayQ().slice(0, 7) : body.month));
  });

  app.get('/calendar', need('reports.view'), (req: Req, res: Res) => {
    const from = isoQ(req, 'from', todayQ());
    res.json(adv.calendar(db, T(req), biz(req), from, isoQ(req, 'to', from.slice(0, 8) + '31')));
  });
  app.get('/forecast', need('reports.view'), (req: Req, res: Res) => res.json(adv.forecast(db, T(req), biz(req), Math.min(Math.max(Number(req.query.days) || 30, 7), 180))));
  app.get('/reports/balance-sheet', need('reports.view'), (req: Req, res: Res) => res.json(adv.balanceSheet(db, T(req), biz(req))));

  app.get('/day-close', need('reports.view'), (req: Req, res: Res) => res.json(adv.listCloses(db, T(req), biz(req))));
  app.get('/day-close/expected', need('reports.view'), (req: Req, res: Res) =>
    res.json(adv.expectedCash(db, T(req), biz(req), req.query.accountId ? String(req.query.accountId) : null, isoQ(req, 'date', todayQ()))),
  );
  app.post('/day-close', need('finance.manage'), (req: Req, res: Res) => res.status(201).json(adv.closeDay(db, req.auth, adv.dayCloseSchema.parse(req.body))));
  app.delete('/day-close/:id', need('finance.manage'), (req: Req, res: Res) => {
    adv.reopenDay(db, req.auth, String(req.params.id));
    res.json({ ok: true });
  });

  // ------------------------------------------------------------ collections, portal, credit notes

  app.get('/collections', need('invoices.view'), (req: Req, res: Res) => res.json(col.collections(db, T(req), req.query.businessId ? String(req.query.businessId) : undefined)));
  app.post('/reminders', need('payments.record'), (req: Req, res: Res) => res.status(201).json(col.logReminder(db, req.auth, col.reminderSchema.parse(req.body))));
  app.get('/clients/:id/reminders', need('invoices.view'), (req: Req, res: Res) => res.json(col.clientReminders(db, T(req), String(req.params.id))));
  app.post('/clients/:id/portal', need('clients.manage'), (req: Req, res: Res) => res.json(col.enablePortal(db, req.auth, String(req.params.id), req.query.renew === '1')));
  app.delete('/clients/:id/portal', need('clients.manage'), (req: Req, res: Res) => {
    col.disablePortal(db, req.auth, String(req.params.id));
    res.json({ ok: true });
  });
  app.get('/credit-notes', need('invoices.view'), (req: Req, res: Res) =>
    res.json(col.listCreditNotes(db, T(req), { clientId: req.query.clientId ? String(req.query.clientId) : undefined, invoiceId: req.query.invoiceId ? String(req.query.invoiceId) : undefined })),
  );
  app.get('/credit-notes/:id', need('invoices.view'), (req: Req, res: Res) => {
    const note = col.getCreditNote(db, T(req), String(req.params.id));
    res.json({ note, client: d.getClient(db, T(req), note.clientId), business: d.mapBusiness(d.ownedRow(db, 'business', T(req), note.businessId)) });
  });
  app.post('/credit-notes', need('invoices.cancel'), (req: Req, res: Res) => res.status(201).json(col.createCreditNote(db, req.auth, col.creditNoteSchema.parse(req.body))));
  app.post('/credit-notes/:id/cancel', need('invoices.cancel'), (req: Req, res: Res) => res.json(col.cancelCreditNote(db, req.auth, String(req.params.id))));

  // ------------------------------------------------------------ people: employees, payroll, expense claims, approvals

  app.get('/employees', need('payroll.manage'), (req: Req, res: Res) => res.json(ppl.listEmployees(db, T(req))));
  app.get('/employees/:id', need('payroll.manage'), (req: Req, res: Res) => res.json(ppl.getEmployee(db, T(req), String(req.params.id))));
  app.post('/employees', need('payroll.manage'), (req: Req, res: Res) => res.status(201).json(ppl.saveEmployee(db, req.auth, ppl.employeeSchema.parse(req.body))));
  app.put('/employees/:id', need('payroll.manage'), (req: Req, res: Res) => res.json(ppl.saveEmployee(db, req.auth, ppl.employeeSchema.parse(req.body), String(req.params.id))));
  app.post('/employees/:id/advance', need('payroll.manage'), (req: Req, res: Res) => res.status(201).json(ppl.giveAdvance(db, req.auth, String(req.params.id), ppl.advanceSchema.parse(req.body))));

  app.get('/payroll', need('payroll.manage'), (req: Req, res: Res) => res.json(ppl.listRuns(db, T(req))));
  app.get('/payroll/:id', need('payroll.manage'), (req: Req, res: Res) => res.json(ppl.getRun(db, T(req), String(req.params.id))));
  app.post('/payroll', need('payroll.manage'), (req: Req, res: Res) => {
    const b = z.object({ businessId: z.string().min(1), month: z.string().regex(/^\d{4}-\d{2}$/) }).parse(req.body);
    assertLimit(db, T(req), 'payroll');
    res.status(201).json(ppl.createRun(db, req.auth, b.businessId, b.month));
  });
  app.put('/payroll/:id/slips/:slipId', need('payroll.manage'), (req: Req, res: Res) => res.json(ppl.updateSlip(db, req.auth, String(req.params.id), String(req.params.slipId), ppl.slipSchema.parse(req.body))));
  app.post('/payroll/:id/status', (req: Req, res: Res) => {
    const { status } = z.object({ status: z.enum(['submitted', 'approved', 'draft']) }).parse(req.body);
    res.json(ppl.moveRun(db, req.auth, String(req.params.id), status));
  });
  app.post('/payroll/:id/pay', need('payroll.manage'), (req: Req, res: Res) => res.json(ppl.payRun(db, req.auth, String(req.params.id), ppl.payRunSchema.parse(req.body))));
  app.delete('/payroll/:id', need('payroll.manage'), (req: Req, res: Res) => {
    ppl.deleteRun(db, req.auth, String(req.params.id));
    res.json({ ok: true });
  });

  app.get('/expense-claims', (req: Req, res: Res) => res.json(ppl.listClaims(db, req.auth)));
  app.get('/expense-claims/:id', (req: Req, res: Res) => {
    const c = ppl.getClaim(db, T(req), String(req.params.id));
    if (c.claimedBy !== req.auth.userId && !can(req, 'approvals.decide') && !can(req, 'finance.manage')) throw new HttpError(403, 'You can only see your own claims.');
    res.json(c);
  });
  app.post('/expense-claims', need('expenses.claim'), (req: Req, res: Res) => res.status(201).json(ppl.createClaim(db, req.auth, ppl.claimSchema.parse(req.body))));
  app.post('/expense-claims/:id/decide', need('approvals.decide'), (req: Req, res: Res) => res.json(ppl.decideClaim(db, req.auth, String(req.params.id), ppl.decideClaimSchema.parse(req.body))));
  app.post('/expense-claims/:id/pay', need('finance.manage'), (req: Req, res: Res) => {
    const b = z.object({ accountId: z.string().nullable().default(null), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(req.body ?? {});
    res.json(ppl.payClaim(db, req.auth, String(req.params.id), b));
  });

  app.get('/approvals', (req: Req, res: Res) => res.json(ppl.approvals(db, req.auth)));

  // ------------------------------------------------------------ automation: rules and alerts

  app.get('/rules', (req: Req, res: Res) => res.json(rules.listRules(db, T(req))));
  app.get('/rules/suggested', (_req: Req, res: Res) => res.json(rules.suggestedRules()));
  app.post('/rules', need('businesses.manage'), (req: Req, res: Res) => res.status(201).json(rules.saveRule(db, req.auth, rules.ruleSchema.parse(req.body))));
  app.put('/rules/:id', need('businesses.manage'), (req: Req, res: Res) => res.json(rules.saveRule(db, req.auth, rules.ruleSchema.parse(req.body), String(req.params.id))));
  app.delete('/rules/:id', need('businesses.manage'), (req: Req, res: Res) => {
    rules.deleteRule(db, req.auth, String(req.params.id));
    res.json({ ok: true });
  });
  app.get('/alerts', (req: Req, res: Res) => res.json(rules.alerts(db, T(req))));
  app.post('/alerts/dismiss', (req: Req, res: Res) => {
    rules.dismissAlert(db, req.auth, z.object({ key: z.string().min(1).max(300) }).parse(req.body).key);
    res.json({ ok: true });
  });

  // ------------------------------------------------------------ point of sale

  app.get('/pos/shift', need('pos.sell'), (req: Req, res: Res) => {
    const s = pos.myShift(db, req.auth);
    res.json({ shift: s, report: s ? pos.zReport(db, T(req), s.id) : null });
  });
  app.get('/pos/shifts', need('pos.manage'), (req: Req, res: Res) => res.json(pos.listShifts(db, T(req))));
  app.get('/pos/shifts/:id', need('pos.sell'), (req: Req, res: Res) => res.json(pos.zReport(db, T(req), String(req.params.id))));
  app.post('/pos/shifts', need('pos.sell'), (req: Req, res: Res) => res.status(201).json(pos.openShift(db, req.auth, pos.openSchema.parse(req.body))));
  app.post('/pos/shifts/:id/cash', need('pos.sell'), (req: Req, res: Res) => res.json(pos.cashMove(db, req.auth, String(req.params.id), pos.cashMoveSchema.parse(req.body))));
  app.post('/pos/shifts/:id/close', need('pos.sell'), (req: Req, res: Res) => res.json(pos.closeShift(db, req.auth, String(req.params.id), pos.closeSchema.parse(req.body))));
  app.post('/pos/sales', need('pos.sell'), (req: Req, res: Res) => res.status(201).json(pos.sell(db, req.auth, pos.saleSchema.parse(req.body))));
  app.get('/pos/sales/find', need('pos.sell'), (req: Req, res: Res) => res.json(pos.findSale(db, T(req), String(req.query.number ?? ''))));
  app.post('/pos/returns', need('pos.sell'), (req: Req, res: Res) => res.status(201).json(pos.returnSale(db, req.auth, pos.returnSchema.parse(req.body))));
  app.post('/pos/preview', need('pos.sell'), (req: Req, res: Res) => {
    const b = z.object({ lines: z.array(pos.posLineSchema).max(300), clientId: z.string().nullable().default(null), coupon: z.string().trim().max(30).default('') }).parse(req.body);
    const r = pos.priceBill(db, req.auth, { ...b, applyPromotions: true });
    res.json({ lineDiscounts: r.promo.lineDiscounts, billDiscount: r.promo.billDiscount, applied: r.promo.applied, memberDiscount: r.memberDiscount, member: r.member, pointValue: r.loyalty.pointValue, minRedeem: r.loyalty.minRedeem });
  });

  // ------------------------------------------------------------ promotions, loyalty, gift cards

  app.get('/promotions', (req: Req, res: Res) => res.json(growth.listPromotions(db, T(req))));
  app.post('/promotions', need('pos.manage'), (req: Req, res: Res) => res.status(201).json(growth.savePromotion(db, req.auth, growth.promotionSchema.parse(req.body))));
  app.put('/promotions/:id', need('pos.manage'), (req: Req, res: Res) => res.json(growth.savePromotion(db, req.auth, growth.promotionSchema.parse(req.body), String(req.params.id))));
  app.delete('/promotions/:id', need('pos.manage'), (req: Req, res: Res) => res.json(growth.deletePromotion(db, req.auth, String(req.params.id))));
  app.get('/loyalty/settings', (req: Req, res: Res) => res.json(growth.getLoyalty(db, T(req))));
  app.put('/loyalty/settings', need('pos.manage'), (req: Req, res: Res) => res.json(growth.saveLoyalty(db, req.auth, growth.loyaltySchema.parse(req.body))));
  app.get('/loyalty/find', (req: Req, res: Res) => res.json(growth.findMember(db, T(req), String(req.query.phone ?? ''))));
  app.get('/loyalty/clients/:id', (req: Req, res: Res) => res.json(growth.loyaltyAccount(db, T(req), String(req.params.id))));
  app.post('/loyalty/clients/:id/adjust', need('pos.manage'), (req: Req, res: Res) => {
    const b = growth.adjustPointsSchema.parse(req.body);
    growth.loyaltyAccount(db, T(req), String(req.params.id));
    growth.addPoints(db, req.auth, String(req.params.id), b.points, b.reason);
    db.audit(T(req), req.auth.userId, 'loyalty.adjust', 'client', String(req.params.id), b);
    res.json(growth.loyaltyAccount(db, T(req), String(req.params.id)));
  });
  app.get('/gift-cards', (req: Req, res: Res) => res.json(growth.listGiftCards(db, T(req))));
  app.get('/gift-cards/:code', (req: Req, res: Res) => res.json(growth.giftCardByCode(db, T(req), String(req.params.code))));
  app.post('/gift-cards', need('pos.sell'), (req: Req, res: Res) => res.status(201).json(growth.issueGiftCard(db, req.auth, growth.giftCardSchema.parse(req.body))));

  // ------------------------------------------------------------ restaurant

  app.get('/restaurant/tables', (req: Req, res: Res) => res.json(growth.getTables(db, T(req))));
  app.put('/restaurant/tables', need('pos.manage'), (req: Req, res: Res) => {
    growth.setSetting(db, T(req), 'tables', growth.tablesSchema.parse(req.body));
    res.json(growth.getTables(db, T(req)));
  });
  app.get('/orders', need('pos.sell'), (req: Req, res: Res) => res.json(growth.listOrders(db, T(req), String(req.query.status ?? 'open'))));
  app.post('/orders', need('pos.sell'), (req: Req, res: Res) => res.status(201).json(growth.openOrder(db, req.auth, growth.orderSchema.parse(req.body))));
  app.get('/orders/:id', need('pos.sell'), (req: Req, res: Res) => res.json(growth.getOrder(db, T(req), String(req.params.id))));
  app.put('/orders/:id', need('pos.sell'), (req: Req, res: Res) => res.json(growth.updateOrder(db, req.auth, String(req.params.id), growth.orderUpdateSchema.parse(req.body))));
  app.post('/orders/:id/kot', need('pos.sell'), (req: Req, res: Res) => res.status(201).json(growth.sendToKitchen(db, req.auth, String(req.params.id))));
  app.post('/orders/:id/cancel', need('pos.manage'), (req: Req, res: Res) => res.json(growth.cancelOrder(db, req.auth, String(req.params.id), z.object({ reason: z.string().trim().max(200).default('') }).parse(req.body ?? {}).reason)));
  app.get('/kots', need('pos.sell'), (req: Req, res: Res) => res.json(growth.listKots(db, T(req), String(req.query.section ?? ''))));
  app.post('/kots/:id/status', need('pos.sell'), (req: Req, res: Res) => res.json(growth.setKotStatus(db, req.auth, String(req.params.id), z.object({ status: z.enum(['new', 'ready', 'served']) }).parse(req.body).status)));

  // ------------------------------------------------------------ appointments

  app.get('/appointments', (req: Req, res: Res) => res.json(growth.listAppointments(db, T(req), String(req.query.date ?? '') || today())));
  app.post('/appointments', need('invoices.create'), (req: Req, res: Res) => res.status(201).json(growth.saveAppointment(db, req.auth, growth.appointmentSchema.parse(req.body))));
  app.put('/appointments/:id', need('invoices.create'), (req: Req, res: Res) => res.json(growth.saveAppointment(db, req.auth, growth.appointmentSchema.parse(req.body), String(req.params.id))));
  app.post('/appointments/:id/status', need('invoices.create'), (req: Req, res: Res) => res.json(growth.setAppointmentStatus(db, req.auth, String(req.params.id), z.object({ status: z.enum(['booked', 'waiting', 'in_service', 'done', 'no_show', 'cancelled']) }).parse(req.body).status)));

  // ------------------------------------------------------------ online shop (settings; the public page is in app.ts)

  app.get('/shop/settings', (req: Req, res: Res) => res.json(growth.getShop(db, T(req))));
  app.put('/shop/settings', need('pos.manage'), (req: Req, res: Res) => res.json(growth.saveShop(db, req.auth, growth.shopSchema.parse(req.body))));

  // ------------------------------------------------------------ tax centre, reconciliation, profitability

  const range = (req: Req) => ({ from: String(req.query.from ?? '') || `${today().slice(0, 4)}-01-01`, to: String(req.query.to ?? '') || today() });
  app.get('/tax/summary', need('reports.view'), (req: Req, res: Res) => {
    const r = range(req);
    res.json(fin2.taxSummary(db, T(req), r.from, r.to));
  });
  app.post('/reconcile/preview', need('finance.manage'), (req: Req, res: Res) => res.json(fin2.reconcilePreview(db, T(req), fin2.statementSchema.parse(req.body))));
  app.post('/reconcile/confirm', need('finance.manage'), (req: Req, res: Res) => res.json(fin2.reconcileConfirm(db, req.auth, fin2.confirmSchema.parse(req.body))));
  app.get('/reconcile/status/:accountId', need('finance.manage'), (req: Req, res: Res) => res.json(fin2.reconcileStatus(db, T(req), String(req.params.accountId))));
  app.get('/reports/profit', need('reports.view'), (req: Req, res: Res) => {
    const r = range(req);
    const by = z.enum(['item', 'client', 'category', 'cashier']).catch('item').parse(req.query.by);
    res.json(fin2.profitability(db, T(req), by, r.from, r.to));
  });

  // ------------------------------------------------------------ attendance, targets, cashier performance

  app.get('/attendance', (req: Req, res: Res) => res.json(people2.attendanceDay(db, T(req), String(req.query.date ?? '') || today())));
  app.get('/attendance/month', need('payroll.manage'), (req: Req, res: Res) => res.json(people2.attendanceMonth(db, T(req), people2.monthSchema.parse(String(req.query.month ?? today().slice(0, 7))))));
  app.post('/attendance/check', (req: Req, res: Res) => res.json(people2.checkByCode(db, req.auth, z.object({ code: z.string().min(1).max(60) }).parse(req.body).code)));
  app.post('/attendance/mark', need('payroll.manage'), (req: Req, res: Res) => res.json(people2.markAttendance(db, req.auth, people2.markSchema.parse(req.body))));
  app.get('/attendance/settings', need('payroll.manage'), (req: Req, res: Res) => res.json(people2.attendanceSettings(db, T(req))));
  app.put('/attendance/settings', need('payroll.manage'), (req: Req, res: Res) => res.json(people2.saveAttendanceSettings(db, req.auth, people2.attendanceSettingsSchema.parse(req.body))));
  app.get('/people/leaderboard', (req: Req, res: Res) => res.json(people2.leaderboard(db, T(req), people2.monthSchema.parse(String(req.query.month ?? today().slice(0, 7))))));
  app.get('/reports/cashiers', need('pos.manage'), (req: Req, res: Res) => {
    const r = range(req);
    res.json(people2.cashierPerformance(db, T(req), r.from, r.to));
  });

  app.post('/workspace/sample-data', need('businesses.manage'), (req: Req, res: Res) => res.status(201).json(addSampleData(db, req.auth, z.object({ type: z.string().max(30).default('') }).parse(req.body ?? {}).type)));
  app.get('/insights/anomalies', need('reports.view'), (req: Req, res: Res) => res.json(insights.anomalies(db, T(req))));
  app.get('/insights/monthly', need('reports.view'), (req: Req, res: Res) => res.json(insights.monthlyReport(db, T(req), people2.monthSchema.parse(String(req.query.month ?? today().slice(0, 7))), req.query.lang === 'ur' ? 'ur' : 'en')));

  app.get('/pos/held', need('pos.sell'), (req: Req, res: Res) => res.json(pos.listHeld(db, T(req))));
  app.post('/pos/held', need('pos.sell'), (req: Req, res: Res) => res.status(201).json(pos.holdBill(db, req.auth, pos.holdSchema.parse(req.body))));
  app.delete('/pos/held/:id', need('pos.sell'), (req: Req, res: Res) => {
    pos.dropHeld(db, req.auth, String(req.params.id));
    res.json({ ok: true });
  });

  // ------------------------------------------------------------ invoices

  app.get('/invoices', need('invoices.view'), (req: Req, res: Res) => {
    const { limit, offset, q } = page(req);
    const where: string[] = ['i.tenant_id = ?'];
    const args: any[] = [T(req)];
    if (q) {
      where.push('(i.number like ? or c.name like ? or i.reference like ?)');
      args.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    for (const [param, col] of [['clientId', 'i.client_id'], ['businessId', 'i.business_id']] as const) {
      if (req.query[param]) {
        where.push(`${col} = ?`);
        args.push(String(req.query[param]));
      }
    }
    if (req.query.from) (where.push('i.issue_date >= ?'), args.push(String(req.query.from)));
    if (req.query.to) (where.push('i.issue_date <= ?'), args.push(String(req.query.to)));
    const status = String(req.query.status ?? '');
    const having: Record<string, string> = {
      draft: "status = 'draft'",
      cancelled: "status = 'cancelled'",
      paid: "status = 'final' and paid >= total",
      unpaid: "status = 'final' and paid = 0 and total > 0",
      partially_paid: "status = 'final' and paid > 0 and paid < total",
      overdue: "status = 'final' and paid < total and due_date < date('now')",
      outstanding: "status = 'final' and paid < total",
    };
    const sql = `select * from (${d.INVOICE_SELECT} where ${where.join(' and ')}) ${having[status] ? `where ${having[status]}` : ''}
                 order by issue_date desc, created_at desc limit ? offset ?`;
    res.json(db.all(sql, ...args, limit, offset).map((r) => d.mapInvoice(r)));
  });

  app.get('/invoices/:id', need('invoices.view'), (req: Req, res: Res) => {
    const invoice = d.getInvoice(db, T(req), String(req.params.id));
    const payments = d.listPayments(db, T(req), 'and p.id in (select payment_id from payment_allocation where invoice_id = ?)', [invoice.id], 200);
    const client = d.getClient(db, T(req), invoice.clientId);
    const business = d.mapBusiness(d.ownedRow(db, 'business', T(req), invoice.businessId));
    res.json({ invoice, payments, client, business });
  });

  app.post('/invoices', need('invoices.create'), (req: Req, res: Res) => {
    const body = d.invoiceSchema.parse(req.body);
    if (body.finalize) assertLimit(db, T(req), 'invoice');
    if (body.overrideCreditLimit && !can(req, 'invoices.approve')) throw new HttpError(403, 'Only a manager can approve going over a credit limit.');
    if (body.finalize && !can(req, 'invoices.finalize')) throw new HttpError(403, 'You can save drafts, but finalizing needs a higher permission.');
    if (body.initialPayment && !can(req, 'payments.record')) throw new HttpError(403, 'You do not have permission to record payments.');
    res.status(201).json(d.createInvoice(db, req.auth, body, can(req, 'payments.verify')));
  });

  app.put('/invoices/:id', need('invoices.edit_draft'), (req: Req, res: Res) => {
    const body = d.invoiceSchema.parse(req.body);
    if (body.finalize) assertLimit(db, T(req), 'invoice');
    if (body.overrideCreditLimit && !can(req, 'invoices.approve')) throw new HttpError(403, 'Only a manager can approve going over a credit limit.');
    if (body.finalize && !can(req, 'invoices.finalize')) throw new HttpError(403, 'You can save drafts, but finalizing needs a higher permission.');
    if (body.initialPayment && !can(req, 'payments.record')) throw new HttpError(403, 'You do not have permission to record payments.');
    res.json(d.updateDraft(db, req.auth, String(req.params.id), body, can(req, 'payments.verify')));
  });

  app.post('/invoices/:id/finalize', need('invoices.finalize'), (req: Req, res: Res) => {
    assertLimit(db, T(req), 'invoice');
    const { overrideCreditLimit } = z.object({ overrideCreditLimit: z.boolean().default(false) }).parse(req.body ?? {});
    if (overrideCreditLimit && !can(req, 'invoices.approve')) throw new HttpError(403, 'Only a manager can approve going over a credit limit.');
    res.json(d.finalizeInvoice(db, req.auth, String(req.params.id), overrideCreditLimit));
  });
  app.post('/invoices/:id/cancel', need('invoices.cancel'), (req: Req, res: Res) => {
    const { reason } = z.object({ reason: z.string().trim().max(500).default('') }).parse(req.body ?? {});
    res.json(d.cancelInvoice(db, req.auth, String(req.params.id), reason));
  });
  app.delete('/invoices/:id', need('invoices.edit_draft'), (req: Req, res: Res) => {
    d.deleteDraft(db, req.auth, String(req.params.id));
    res.json({ ok: true });
  });
  app.put('/invoices/:id/installments', need('invoices.finalize'), (req: Req, res: Res) => {
    res.json(d.replaceInstallments(db, req.auth, String(req.params.id), d.installmentsSchema.parse(req.body).installments));
  });
  app.post('/invoices/:id/apply-credit', need('payments.record'), (req: Req, res: Res) => {
    const { amount } = z.object({ amount: z.number().int().min(1).optional() }).parse(req.body ?? {});
    res.json(d.applyCredit(db, req.auth, String(req.params.id), amount));
  });

  // ------------------------------------------------------------ payments & receipts

  app.get('/payments', need('invoices.view'), (req: Req, res: Res) => {
    const { limit, offset, q } = page(req);
    const where: string[] = [];
    const args: any[] = [];
    if (q) (where.push('and (p.number like ? or c.name like ? or p.reference like ?)'), args.push(`%${q}%`, `%${q}%`, `%${q}%`));
    if (req.query.clientId) (where.push('and p.client_id = ?'), args.push(String(req.query.clientId)));
    if (req.query.businessId) (where.push('and p.business_id = ?'), args.push(String(req.query.businessId)));
    res.json(d.listPayments(db, T(req), where.join(' '), args, limit, offset));
  });
  app.get('/payments/:id', need('invoices.view'), (req: Req, res: Res) => {
    const payment = d.getPayment(db, T(req), String(req.params.id));
    res.json({
      payment,
      client: d.getClient(db, T(req), payment.clientId),
      business: d.mapBusiness(d.ownedRow(db, 'business', T(req), payment.businessId)),
      invoices: payment.allocations.map((a) => d.getInvoice(db, T(req), a.invoiceId)),
    });
  });
  app.post('/payments', need('payments.record'), (req: Req, res: Res) => {
    res.status(201).json(d.recordPayment(db, req.auth, d.paymentSchema.parse(req.body), can(req, 'payments.verify')));
  });
  app.post('/payments/:id/verify', need('payments.verify'), (req: Req, res: Res) => res.json(d.setPaymentVerification(db, req.auth, String(req.params.id), 'verified')));
  app.post('/payments/:id/reject', need('payments.verify'), (req: Req, res: Res) => res.json(d.setPaymentVerification(db, req.auth, String(req.params.id), 'rejected')));

  // ------------------------------------------------------------ dashboard, installments, audit

  app.get('/dashboard', need('invoices.view'), (req: Req, res: Res) => {
    const s = (k: string) => (req.query[k] ? String(req.query[k]) : undefined);
    res.json(d.dashboard(db, T(req), { businessId: s('businessId'), from: s('from'), to: s('to') }));
  });
  app.get('/installments', need('invoices.view'), (req: Req, res: Res) => {
    res.json(d.listInstallments(db, T(req), req.query.businessId ? String(req.query.businessId) : undefined));
  });
  app.get('/audit', need('reports.view'), (req: Req, res: Res) => {
    const { limit, offset } = page(req);
    res.json(db.all('select a.*, u.name as user_name from audit_log a left join app_user u on u.id = a.user_id where a.tenant_id = ? order by a.at desc limit ? offset ?', T(req), limit, offset));
  });

  // ------------------------------------------------------------ finance: money in and money out

  const financeFilter = (req: Req): fin.FinanceFilter => {
    const s = (k: string) => (req.query[k] ? String(req.query[k]) : undefined);
    return { businessId: s('businessId'), from: s('from'), to: s('to'), type: s('type') };
  };
  app.get('/finance/categories', need('reports.view'), (req: Req, res: Res) => res.json(fin.usedCategories(db, T(req))));
  app.get('/finance/summary', need('reports.view'), (req: Req, res: Res) => res.json(fin.summary(db, T(req), financeFilter(req))));
  app.get('/finance/entries', need('reports.view'), (req: Req, res: Res) => {
    const { limit, offset } = page(req);
    res.json(fin.listEntries(db, T(req), financeFilter(req), limit, offset));
  });
  app.post('/finance/entries', need('finance.manage'), (req: Req, res: Res) => res.status(201).json(fin.saveEntry(db, req.auth, fin.financeSchema.parse(req.body))));
  app.put('/finance/entries/:id', need('finance.manage'), (req: Req, res: Res) => res.json(fin.saveEntry(db, req.auth, fin.financeSchema.parse(req.body), String(req.params.id))));
  app.delete('/finance/entries/:id', need('finance.manage'), (req: Req, res: Res) => {
    fin.deleteEntry(db, req.auth, String(req.params.id));
    res.json({ ok: true });
  });

  // ------------------------------------------------------------ purchases: bills for things bought (each one is Money out)

  const purchaseFilter = (req: Req): pur.PurchaseFilter => {
    const s = (k: string) => (req.query[k] ? String(req.query[k]) : undefined);
    return { businessId: s('businessId'), from: s('from'), to: s('to'), q: s('q') };
  };
  app.get('/purchases/summary', need('reports.view'), (req: Req, res: Res) => res.json(pur.purchaseSummary(db, T(req), purchaseFilter(req))));
  app.get('/purchases/suppliers', need('reports.view'), (req: Req, res: Res) => res.json(pur.suppliers(db, T(req))));
  app.get('/purchases', need('reports.view'), (req: Req, res: Res) => {
    const { limit, offset } = page(req);
    res.json(pur.listPurchases(db, T(req), purchaseFilter(req), limit, offset));
  });
  app.get('/purchases/:id', need('reports.view'), (req: Req, res: Res) => res.json(pur.getPurchase(db, T(req), String(req.params.id))));
  app.post('/purchases', need('finance.manage'), (req: Req, res: Res) => res.status(201).json(pur.savePurchase(db, req.auth, pur.purchaseSchema.parse(req.body))));
  app.put('/purchases/:id', need('finance.manage'), (req: Req, res: Res) => res.json(pur.savePurchase(db, req.auth, pur.purchaseSchema.parse(req.body), String(req.params.id))));
  app.put('/purchases/:id/installments/:n', need('finance.manage'), (req: Req, res: Res) =>
    res.json(pur.setInstallmentPaid(db, req.auth, String(req.params.id), Number(req.params.n), z.object({ paid: z.boolean() }).parse(req.body).paid)),
  );
  app.delete('/purchases/:id', need('finance.manage'), (req: Req, res: Res) => {
    pur.deletePurchase(db, req.auth, String(req.params.id));
    res.json({ ok: true });
  });

  // ------------------------------------------------------------ quotations

  app.get('/quotations', need('invoices.view'), (req: Req, res: Res) => {
    const { limit, offset, q } = page(req);
    res.json(quotes.listQuotes(db, T(req), { q, status: String(req.query.status ?? ''), clientId: req.query.clientId ? String(req.query.clientId) : undefined }, limit, offset));
  });
  app.get('/quotations/:id', need('invoices.view'), (req: Req, res: Res) => {
    const quotation = quotes.getQuote(db, T(req), String(req.params.id));
    res.json({
      quotation,
      client: d.getClient(db, T(req), quotation.clientId),
      business: d.mapBusiness(d.ownedRow(db, 'business', T(req), quotation.businessId)),
    });
  });
  app.post('/quotations', need('invoices.create'), (req: Req, res: Res) => res.status(201).json(quotes.saveQuote(db, req.auth, quotes.quotationSchema.parse(req.body))));
  app.put('/quotations/:id', need('invoices.edit_draft'), (req: Req, res: Res) => res.json(quotes.saveQuote(db, req.auth, quotes.quotationSchema.parse(req.body), String(req.params.id))));
  app.post('/quotations/:id/status', need('invoices.create'), (req: Req, res: Res) => {
    const { status } = z.object({ status: z.enum(['draft', 'sent', 'accepted', 'rejected']) }).parse(req.body);
    res.json(quotes.setQuoteStatus(db, req.auth, String(req.params.id), status));
  });
  app.post('/quotations/:id/convert', need('invoices.create'), (req: Req, res: Res) => res.json(quotes.convertQuote(db, req.auth, String(req.params.id), can(req, 'payments.verify'))));
  app.delete('/quotations/:id', need('invoices.edit_draft'), (req: Req, res: Res) => {
    quotes.deleteQuote(db, req.auth, String(req.params.id));
    res.json({ ok: true });
  });

  // ------------------------------------------------------------ recurring invoices

  app.get('/recurring', need('invoices.view'), (req: Req, res: Res) => res.json(rec.listRecurring(db, T(req))));
  app.get('/recurring/:id', need('invoices.view'), (req: Req, res: Res) => {
    const schedule = rec.getRecurring(db, T(req), String(req.params.id));
    const invoices = db.all(`${d.INVOICE_SELECT} where i.tenant_id = ? and i.recurring_id = ? order by i.issue_date desc limit 50`, T(req), schedule.id).map((r) => d.mapInvoice(r));
    res.json({ schedule, invoices });
  });
  app.post('/recurring', need('invoices.create'), (req: Req, res: Res) => {
    const saved = rec.saveRecurring(db, req.auth, rec.recurringSchema.parse(req.body), can(req, 'invoices.finalize'));
    rec.runDue(db, { id: saved.id }); // a start date of today or earlier produces its invoice straight away
    res.status(201).json(rec.getRecurring(db, T(req), saved.id));
  });
  app.put('/recurring/:id', need('invoices.create'), (req: Req, res: Res) => {
    const saved = rec.saveRecurring(db, req.auth, rec.recurringSchema.parse(req.body), can(req, 'invoices.finalize'), String(req.params.id));
    rec.runDue(db, { id: saved.id });
    res.json(rec.getRecurring(db, T(req), saved.id));
  });
  app.post('/recurring/:id/status', need('invoices.create'), (req: Req, res: Res) => {
    const { status } = z.object({ status: z.enum(['active', 'paused']) }).parse(req.body);
    const saved = rec.setRecurringStatus(db, req.auth, String(req.params.id), status);
    if (status === 'active') rec.runDue(db, { id: saved.id });
    res.json(rec.getRecurring(db, T(req), saved.id));
  });
  app.delete('/recurring/:id', need('invoices.create'), (req: Req, res: Res) => {
    rec.deleteRecurring(db, req.auth, String(req.params.id));
    res.json({ ok: true });
  });
  /** Drafts generated by schedules that are waiting for someone to approve them. */
  app.get('/recurring-pending', need('invoices.view'), (req: Req, res: Res) => {
    res.json(db.all(`${d.INVOICE_SELECT} where i.tenant_id = ? and i.status = 'draft' and i.recurring_id is not null order by i.issue_date`, T(req)).map((r) => d.mapInvoice(r)));
  });

  // ------------------------------------------------------------ reports

  const reportFilter = (req: Req): ReportFilter => {
    const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
    const t = new Date().toISOString().slice(0, 10);
    const from = date.safeParse(req.query.from).success ? String(req.query.from) : `${t.slice(0, 7)}-01`;
    const to = date.safeParse(req.query.to).success ? String(req.query.to) : t;
    if (to < from) throw new HttpError(422, 'The end of the period is before its start.');
    return { from, to, businessId: req.query.businessId ? String(req.query.businessId) : undefined };
  };
  app.get('/reports', need('reports.view'), (req: Req, res: Res) => res.json(buildReport(db, T(req), reportFilter(req))));

  // ------------------------------------------------------------ money accounts, transfers, cashbook

  const dateQ = (req: Req, key: string, fallback: string) => (/^\d{4}-\d{2}-\d{2}$/.test(String(req.query[key] ?? '')) ? String(req.query[key]) : fallback);
  const monthStart = () => `${new Date().toISOString().slice(0, 7)}-01`;
  const todayIso = () => new Date().toISOString().slice(0, 10);
  const bizQ = (req: Req) => (req.query.businessId ? String(req.query.businessId) : undefined);

  app.get('/accounts', need('invoices.view'), (req: Req, res: Res) => {
    acc.ensureAccounts(db, { tenantId: T(req) });
    res.json(acc.listAccounts(db, T(req), bizQ(req), req.query.all === '1'));
  });
  app.get('/accounts/:id', need('invoices.view'), (req: Req, res: Res) => res.json(acc.getAccount(db, T(req), String(req.params.id))));
  app.post('/accounts', need('finance.manage'), (req: Req, res: Res) => res.status(201).json(acc.saveAccount(db, req.auth, acc.accountSchema.parse(req.body))));
  app.put('/accounts/:id', need('finance.manage'), (req: Req, res: Res) => res.json(acc.saveAccount(db, req.auth, acc.accountSchema.parse(req.body), String(req.params.id))));
  app.get('/transfers', need('invoices.view'), (req: Req, res: Res) => res.json(acc.listTransfers(db, T(req), bizQ(req))));
  app.post('/transfers', need('finance.manage'), (req: Req, res: Res) => res.status(201).json(acc.saveTransfer(db, req.auth, acc.transferSchema.parse(req.body))));
  app.delete('/transfers/:id', need('finance.manage'), (req: Req, res: Res) => {
    acc.deleteTransfer(db, req.auth, String(req.params.id));
    res.json({ ok: true });
  });
  app.get('/cashbook', need('reports.view'), (req: Req, res: Res) => {
    acc.ensureAccounts(db, { tenantId: T(req) });
    res.json(acc.cashbook(db, T(req), { businessId: bizQ(req), accountId: req.query.accountId ? String(req.query.accountId) : undefined, from: dateQ(req, 'from', todayIso()), to: dateQ(req, 'to', todayIso()) }));
  });
  app.get('/reports/pnl', need('reports.view'), (req: Req, res: Res) => {
    res.json(acc.profitLoss(db, T(req), { businessId: bizQ(req), from: dateQ(req, 'from', monthStart()), to: dateQ(req, 'to', todayIso()), basis: req.query.basis === 'cash' ? 'cash' : 'accrual' }));
  });
  app.get('/reports/cashflow', need('reports.view'), (req: Req, res: Res) => {
    acc.ensureAccounts(db, { tenantId: T(req) });
    res.json(acc.cashFlow(db, T(req), { businessId: bizQ(req), from: dateQ(req, 'from', monthStart()), to: dateQ(req, 'to', todayIso()) }));
  });

  // ------------------------------------------------------------ client advance, credit limits

  app.post('/clients/:id/apply-credit', need('payments.record'), (req: Req, res: Res) => res.json({ applied: d.applyCreditAll(db, req.auth, String(req.params.id)) }));
  app.post('/clients/:id/refunds', need('payments.refund'), (req: Req, res: Res) => res.status(201).json(acc.refundCredit(db, req.auth, String(req.params.id), acc.refundSchema.parse(req.body))));
  app.get('/clients/:id/credit-check', need('invoices.view'), (req: Req, res: Res) => {
    const extra = Number(req.query.amount) || 0;
    res.json(d.creditCheck(db, T(req), String(req.params.id), extra));
  });

  // ------------------------------------------------------------ exchange rates

  app.get('/exchange-rates', need('invoices.view'), (req: Req, res: Res) => res.json({ reportingCurrency: fx.reportingCurrency(db, T(req)), rates: fx.listRates(db, T(req)) }));
  app.post('/exchange-rates', need('finance.manage'), (req: Req, res: Res) => res.status(201).json(fx.saveRate(db, req.auth, fx.rateSchema.parse(req.body))));
  app.delete('/exchange-rates/:id', need('finance.manage'), (req: Req, res: Res) => {
    fx.deleteRate(db, req.auth, String(req.params.id));
    res.json({ ok: true });
  });
  app.get('/exchange-rates/lookup', need('invoices.view'), (req: Req, res: Res) => {
    const q = z.object({ currency: z.string().length(3), base: z.string().length(3), date: z.string().optional() }).parse(req.query);
    res.json({ rate: fx.findRate(db, T(req), q.currency.toUpperCase(), q.base.toUpperCase(), q.date) });
  });
  app.put('/settings/reporting-currency', need('businesses.manage'), (req: Req, res: Res) => {
    const { currency } = z.object({ currency: z.string().trim().length(3).toUpperCase() }).parse(req.body);
    db.run('update tenant set reporting_currency = ? where id = ?', currency, T(req));
    res.json({ reportingCurrency: currency });
  });

}

export { HttpError };

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import { createApp } from '../src/app';
import { Db } from '../src/db';

let server: Server;
let base = '';

before(() => {
  server = createApp(new Db(':memory:')).listen(0);
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
after(() => server.close());

async function call(token: string, method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as any };
}

const day = new Date().toISOString().slice(0, 10);

async function setup(email: string) {
  const r = await call('', 'POST', '/auth/register', { businessName: 'Stock Co', name: 'Owner', email, password: 'test-pass-123' });
  const token = r.body.accessToken as string;
  const businessId = (await call(token, 'GET', '/businesses')).body[0].id as string;
  const item = (await call(token, 'POST', '/services', { name: 'Cement bag', unit: 'bag', defaultPrice: 150_000, trackStock: true, barcode: '8964000123', sku: 'CEM-50', reorderLevel: 10_000 })).body;
  return { token, businessId, item };
}
const onHand = async (token: string, id: string) => (await call(token, 'GET', `/stock/${id}`)).body.item.onHand as number;

test('opening stock, sales out, cancelling puts stock back, counts record the difference', async () => {
  const { token, businessId, item } = await setup('stock1@test.dev');
  assert.equal(item.trackStock, true);
  assert.equal((await call(token, 'POST', '/stock/adjust', { itemId: item.id, qty: 50_000, mode: 'opening', unitCost: 120_000 })).status, 201);
  assert.equal(await onHand(token, item.id), 50_000);

  // barcode lookup and the list show the count
  const byCode = await call(token, 'GET', '/services/by-code/8964000123');
  assert.equal(byCode.body.id, item.id);
  assert.equal((await call(token, 'GET', '/services/by-code/000')).status, 404);
  assert.equal((await call(token, 'GET', '/services?q=CEM')).body[0].onHand, 50_000);

  const client = (await call(token, 'POST', '/clients', { name: 'Builder' })).body;
  const inv = { businessId, clientId: client.id, issueDate: day, dueDate: day, lines: [{ serviceId: item.id, name: 'Cement bag', qty: 12_000, unitPrice: 150_000 }] };
  // a draft does not touch stock
  const draft = (await call(token, 'POST', '/invoices', inv)).body;
  assert.equal(await onHand(token, item.id), 50_000);
  await call(token, 'POST', `/invoices/${draft.id}/finalize`, {});
  assert.equal(await onHand(token, item.id), 38_000);
  const moves = (await call(token, 'GET', `/stock/${item.id}`)).body.moves;
  assert.equal(moves[0].kind, 'sale');
  assert.equal(moves[0].refNumber, 'INV-00001');
  await call(token, 'POST', `/invoices/${draft.id}/cancel`, { reason: 'wrong' });
  assert.equal(await onHand(token, item.id), 50_000);

  // physical count: 47 found, the 3 missing are recorded as an adjustment
  const counted = await call(token, 'POST', '/stock/adjust', { itemId: item.id, qty: 47_000, mode: 'count' });
  assert.equal(counted.body.onHand, 47_000);
  const summary = (await call(token, 'GET', '/stock')).body;
  assert.equal(summary.items.length, 1);
  assert.equal(summary.totalValue, 47 * 120_000);
});

test('demand → approval → purchase order → partial and full receipt → bill', async () => {
  const { token, businessId, item } = await setup('stock2@test.dev');
  // staff can raise demand but not approve it
  await call(token, 'POST', '/users', { name: 'Store Keeper', email: 'keeper2@test.dev', password: 'test-pass-123', role: 'staff' });
  const staff = (await call('', 'POST', '/auth/login', { email: 'keeper2@test.dev', password: 'test-pass-123' })).body.accessToken;
  const req = await call(staff, 'POST', '/purchase-requests', { businessId, lines: [{ itemId: item.id, name: 'Cement bag', qty: 100_000, unit: 'bag' }], notes: 'Site 2' });
  assert.equal(req.status, 201, JSON.stringify(req.body));
  assert.equal(req.body.number, 'REQ-0001');
  assert.equal((await call(staff, 'POST', `/purchase-requests/${req.body.id}/decide`, { decision: 'approved' })).status, 403);

  const supplier = (await call(token, 'POST', '/suppliers', { name: 'Lucky Cement Depot', phone: '0300' })).body;
  // an order cannot be made from an unapproved request
  const order = { businessId, supplierId: supplier.id, requestId: req.body.id, date: day, lines: [{ itemId: item.id, name: 'Cement bag', qty: 100_000, unit: 'bag', unitPrice: 125_000 }] };
  assert.equal((await call(token, 'POST', '/purchase-orders', order)).status, 409);
  const ok = await call(token, 'POST', `/purchase-requests/${req.body.id}/decide`, { decision: 'approved', note: 'go ahead' });
  assert.equal(ok.body.status, 'approved');
  const po = await call(token, 'POST', '/purchase-orders', order);
  assert.equal(po.status, 201, JSON.stringify(po.body));
  assert.equal(po.body.number, 'PO-0001');
  assert.equal(po.body.total, 12_500_000);
  assert.equal((await call(token, 'GET', `/purchase-requests/${req.body.id}`)).body.status, 'ordered');

  // receiving against a draft order is refused; send it first
  const grnBody = (qty: number) => ({ businessId, supplierId: supplier.id, orderId: po.body.id, date: day, lines: [{ itemId: item.id, name: 'Cement bag', qty, unit: 'bag', unitPrice: 125_000, orderLine: 0 }] });
  assert.equal((await call(token, 'POST', '/goods-receipts', grnBody(60_000))).status, 409);
  await call(token, 'POST', `/purchase-orders/${po.body.id}/status`, { status: 'sent' });
  const g1 = await call(token, 'POST', '/goods-receipts', grnBody(60_000));
  assert.equal(g1.status, 201, JSON.stringify(g1.body));
  assert.equal(await onHand(token, item.id), 60_000);
  assert.equal((await call(token, 'GET', `/purchase-orders/${po.body.id}`)).body.order.status, 'partial');
  // cannot receive more than is still due
  assert.equal((await call(token, 'POST', '/goods-receipts', grnBody(50_000))).status, 422);
  const g2 = await call(token, 'POST', '/goods-receipts', grnBody(40_000));
  const full = (await call(token, 'GET', `/purchase-orders/${po.body.id}`)).body;
  assert.equal(full.order.status, 'received');
  assert.equal(full.order.lines[0].received, 100_000);
  assert.equal(full.receipts.length, 2);

  // bill the first receipt on credit: owed to the supplier, stock not counted twice
  const bill = await call(token, 'POST', `/goods-receipts/${g1.body.id}/bill`, { billNo: 'LC-881', method: 'bank_transfer', installments: [{ dueDate: day, amount: 7_500_000 }] });
  assert.equal(bill.status, 201, JSON.stringify(bill.body));
  assert.equal(bill.body.total, 7_500_000);
  assert.equal(bill.body.receiptId, g1.body.id);
  assert.equal(bill.body.supplierId, supplier.id);
  assert.equal(await onHand(token, item.id), 100_000);
  const s = (await call(token, 'GET', `/suppliers/${supplier.id}`)).body;
  assert.equal(s.supplier.owed, 7_500_000);
  assert.equal(s.purchases.length, 1);
  assert.equal(s.receipts.length, 2);
  // a billed receipt cannot be deleted; an unbilled one can, and its stock goes away
  assert.equal((await call(token, 'DELETE', `/goods-receipts/${g1.body.id}`)).status, 409);
  assert.equal((await call(token, 'DELETE', `/goods-receipts/${g2.body.id}`)).status, 200);
  assert.equal(await onHand(token, item.id), 60_000);
  assert.equal((await call(token, 'GET', `/purchase-orders/${po.body.id}`)).body.order.status, 'partial');
  // the item's cost follows the latest buying price
  assert.equal((await call(token, 'GET', `/stock/${item.id}`)).body.item.costPrice, 125_000);
});

test('a direct purchase bill adds stock and finds or creates its supplier by name', async () => {
  const { token, businessId, item } = await setup('stock3@test.dev');
  const p = await call(token, 'POST', '/purchases', { businessId, supplier: 'Ali Traders', date: day, method: 'cash', lines: [{ itemId: item.id, name: 'Cement bag', qty: 20_000, unit: 'bag', unitPrice: 130_000 }] });
  assert.equal(p.status, 201, JSON.stringify(p.body));
  assert.equal(await onHand(token, item.id), 20_000);
  const suppliers = (await call(token, 'GET', '/suppliers')).body;
  assert.equal(suppliers.length, 1);
  assert.equal(suppliers[0].name, 'Ali Traders');
  assert.equal(p.body.supplierId, suppliers[0].id);
  // editing the quantity re-posts the stock; deleting removes it
  await call(token, 'PUT', `/purchases/${p.body.id}`, { businessId, supplier: 'ali traders', date: day, method: 'cash', lines: [{ itemId: item.id, name: 'Cement bag', qty: 25_000, unit: 'bag', unitPrice: 130_000 }] });
  assert.equal(await onHand(token, item.id), 25_000);
  assert.equal((await call(token, 'GET', '/suppliers')).body.length, 1);
  await call(token, 'DELETE', `/purchases/${p.body.id}`);
  assert.equal(await onHand(token, item.id), 0);
  // low stock shows on the reorder list
  assert.equal((await call(token, 'GET', '/stock/reorder')).body[0].itemId, item.id);
});

test('stock and buying records reach phones', async () => {
  const { token, item } = await setup('stock4@test.dev');
  await call(token, 'POST', '/stock/adjust', { itemId: item.id, qty: 5_000, mode: 'opening' });
  await call(token, 'POST', '/suppliers', { name: 'Vendor' });
  const snap = (await call(token, 'GET', '/sync/pull')).body;
  assert.equal(snap.tables.stock_move.length, 1);
  assert.equal(snap.tables.supplier.length, 1);
  assert.ok(Array.isArray(snap.tables.purchase_order));
});

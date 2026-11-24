import { z } from 'zod';
import { LABEL_SIZE_KEYS, ean13CheckDigit, isEan13, type LabelSize, type LabelTemplate } from '../../../packages/shared/src/index';
import { now, uid, type Db, type Row } from './core';
import { HttpError, type AuthContext } from './perm';

// ---------------------------------------------------------------- item codes

/** Another active item already using this barcode, if any. */
export function barcodeOwner(db: Db, tenantId: string, barcode: string, exceptId?: string): Row | undefined {
  if (!barcode) return undefined;
  return db.get("select id, name from service where tenant_id = ? and barcode = ? and status = 'active' and id <> ? limit 1", tenantId, barcode, exceptId ?? '');
}

export function assertBarcodeFree(db: Db, tenantId: string, barcode: string, exceptId?: string) {
  const other = barcodeOwner(db, tenantId, barcode, exceptId);
  if (other) throw new HttpError(409, `Barcode ${barcode} is already on ${other.name}.`);
}

/** A new in-store EAN-13 that no item in this business uses. */
export function freeStoreBarcode(db: Db, tenantId: string): string {
  for (let i = 0; i < 50; i++) {
    // digits from uid(), so an offline sale replayed on the server gets the same code
    const digits = [...uid()].map((c) => c.charCodeAt(0) % 10).join('').slice(-10).padStart(10, '0');
    const code = `20${digits}${ean13CheckDigit(`20${digits}`)}`;
    if (!db.get('select 1 from service where tenant_id = ? and barcode = ?', tenantId, code)) return code;
  }
  throw new HttpError(500, 'Could not make a free barcode. Try again.');
}

export const autoCodesSchema = z.object({ ids: z.array(z.string()).max(2000).optional() });

/** Give every listed item (or every stock item) without a barcode its own in-store EAN-13. */
export function fillMissingCodes(db: Db, auth: AuthContext, body: z.infer<typeof autoCodesSchema>) {
  return db.tx(() => {
    const rows = body.ids?.length
      ? db.all(`select id from service where tenant_id = ? and barcode = '' and id in (${body.ids.map(() => '?').join(',')})`, auth.tenantId, ...body.ids)
      : db.all("select id from service where tenant_id = ? and barcode = '' and status = 'active' and track_stock = 1", auth.tenantId);
    for (const r of rows) db.run('update service set barcode = ? where id = ?', freeStoreBarcode(db, auth.tenantId), r.id);
    if (rows.length) db.audit(auth.tenantId, auth.userId, 'items.autocode', 'service', '', { count: rows.length });
    return { filled: rows.length };
  });
}

export const isStoreCode = (code: string) => isEan13(code) && code.startsWith('20');

// ---------------------------------------------------------------- price-change queue

/** Items whose price changed since their labels were last printed. */
export function pendingLabels(db: Db, tenantId: string): string[] {
  return db.all("select id from service where tenant_id = ? and label_pending = 1 and status = 'active' order by name collate nocase", tenantId).map((r) => r.id as string);
}

export const printedSchema = z.object({ ids: z.array(z.string()).min(1).max(2000) });

export function markPrinted(db: Db, auth: AuthContext, body: z.infer<typeof printedSchema>) {
  db.run(`update service set label_pending = 0 where tenant_id = ? and id in (${body.ids.map(() => '?').join(',')})`, auth.tenantId, ...body.ids);
  return { ok: true };
}

// ---------------------------------------------------------------- templates

const showSchema = z.object({
  business: z.boolean(),
  logo: z.boolean(),
  name: z.boolean(),
  nameUr: z.boolean(),
  price: z.boolean(),
  mrp: z.boolean(),
  sku: z.boolean(),
  unit: z.boolean(),
});

export const templateSchema = z.object({
  name: z.string().trim().min(1, 'Name the template').max(60),
  size: z.enum(LABEL_SIZE_KEYS as [LabelSize, ...LabelSize[]]),
  code: z.enum(['barcode', 'qr', 'none']),
  qrContent: z.enum(['code', 'code_price', 'name_price']).default('code'),
  show: showSchema,
  priceSize: z.enum(['S', 'M', 'L']).default('M'),
  extra: z.string().trim().max(80).default(''),
  border: z.boolean().default(false),
});

function mapTemplate(r: Row): LabelTemplate {
  return { id: r.id, name: r.name, ...JSON.parse(r.config), updatedAt: r.updated_at };
}

export function listTemplates(db: Db, tenantId: string): LabelTemplate[] {
  return db.all('select * from label_template where tenant_id = ? order by name collate nocase', tenantId).map(mapTemplate);
}

export function saveTemplate(db: Db, auth: AuthContext, body: z.infer<typeof templateSchema>, id?: string): LabelTemplate {
  const { name, ...config } = body;
  if (id) {
    if (!db.get('select 1 from label_template where id = ? and tenant_id = ?', id, auth.tenantId)) throw new HttpError(404, 'Template not found.');
    db.run('update label_template set name = ?, config = ?, updated_at = ? where id = ?', name, JSON.stringify(config), now(), id);
  } else {
    if ((db.get('select count(*) as n from label_template where tenant_id = ?', auth.tenantId)?.n ?? 0) >= 50) throw new HttpError(422, 'Keep at most 50 label templates.');
    id = uid();
    db.run('insert into label_template (id, tenant_id, name, config, created_at, updated_at) values (?,?,?,?,?,?)', id, auth.tenantId, name, JSON.stringify(config), now(), now());
  }
  return mapTemplate(db.get('select * from label_template where id = ?', id)!);
}

export function deleteTemplate(db: Db, auth: AuthContext, id: string) {
  db.run('delete from label_template where id = ? and tenant_id = ?', id, auth.tenantId);
  return { ok: true };
}

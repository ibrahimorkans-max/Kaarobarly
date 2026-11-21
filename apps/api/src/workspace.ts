import { z } from 'zod';
import {
  BUSINESS_TYPES,
  FIELD_ENTITIES,
  FIELD_TYPES,
  MODULES,
  TERM_KEYS,
  checkCustomValues,
  resolveWorkspace,
  workspaceFromPreset,
  type CustomValues,
  type FieldEntity,
  type ModuleKey,
  type Workspace,
} from '../../../packages/shared/src/index';
import type { Db } from './core';
import { HttpError, type AuthContext } from './perm';

const fieldSchema = z
  .object({
    id: z.string().trim().regex(/^[a-z0-9_]{1,40}$/, 'Field ids use lowercase letters, numbers and _'),
    entity: z.enum(FIELD_ENTITIES),
    label: z.string().trim().min(1, 'Every field needs a name').max(60),
    type: z.enum(FIELD_TYPES),
    options: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
    required: z.boolean().default(false),
    showOnPdf: z.boolean().default(false),
  })
  .refine((f) => f.type !== 'select' || f.options.length > 0, { message: 'A choice list needs at least one choice' });

export const workspaceSchema = z.object({
  businessType: z.enum(BUSINESS_TYPES),
  modules: z.object(Object.fromEntries(MODULES.map((m) => [m, z.boolean()])) as Record<ModuleKey, z.ZodBoolean>).partial(),
  terms: z.object(Object.fromEntries(TERM_KEYS.map((k) => [k, z.string().trim().max(40)])) as Record<string, z.ZodString>).partial().default({}),
  customFields: z
    .array(fieldSchema)
    .max(60)
    .default([])
    .refine((fs) => new Set(fs.map((f) => `${f.entity}:${f.id}`)).size === fs.length, { message: 'Two fields have the same id' }),
  itemTypes: z.array(z.string().trim().min(1).max(40)).min(1, 'Keep at least one item type').max(20),
});

/** Values sent with a record: plain strings, numbers and yes/no only. */
export const customValuesSchema = z.record(z.string().max(40), z.union([z.string().max(1000), z.number(), z.boolean()]));
export const customSchema = customValuesSchema.default({});

export function getWorkspace(db: Db, tenantId: string): Workspace {
  const raw = db.get('select settings from tenant where id = ?', tenantId)?.settings;
  let parsed: unknown = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {}
  return resolveWorkspace(parsed);
}

export function saveWorkspace(db: Db, auth: AuthContext, body: z.infer<typeof workspaceSchema>): Workspace {
  const ws = resolveWorkspace({ ...body, configured: true });
  db.run('update tenant set settings = ? where id = ?', JSON.stringify(ws), auth.tenantId);
  db.audit(auth.tenantId, auth.userId, 'workspace.update', 'tenant', auth.tenantId, { businessType: ws.businessType });
  return ws;
}

/** Set up from a business-type preset (replaces modules, wording, fields and item types). */
export function applyPreset(db: Db, auth: AuthContext, type: Workspace['businessType']): Workspace {
  const ws = workspaceFromPreset(type);
  db.run('update tenant set settings = ? where id = ?', JSON.stringify(ws), auth.tenantId);
  db.audit(auth.tenantId, auth.userId, 'workspace.preset', 'tenant', auth.tenantId, { businessType: type });
  return ws;
}

export function moduleOn(db: Db, tenantId: string, m: ModuleKey): boolean {
  return getWorkspace(db, tenantId).modules[m];
}

/**
 * Check a record's custom values against the workspace's field definitions and keep only known
 * fields. Values for fields that were deleted later are dropped on the next save.
 */
export function cleanCustom(db: Db, tenantId: string, entity: FieldEntity, values: CustomValues | undefined, enforceRequired = true): CustomValues {
  const fields = getWorkspace(db, tenantId).customFields.filter((f) => f.entity === entity);
  const problems = checkCustomValues(enforceRequired ? fields : fields.map((f) => ({ ...f, required: false })), entity, values);
  if (problems.length) throw new HttpError(422, problems[0]);
  const out: CustomValues = {};
  for (const f of fields) {
    const v = values?.[f.id];
    if (v !== undefined && v !== '') out[f.id] = v;
  }
  return out;
}

export const parseCustom = (raw: string | null | undefined): CustomValues => {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

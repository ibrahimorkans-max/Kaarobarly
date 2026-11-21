import { api } from '@/lib/api';
import { useState } from 'react';
import { useToast } from '@/lib/app-context';
import { moneyToInput, parseMoney, type CustomValues, type Supplier } from '@/lib/shared';
import { lower, useWorkspace } from '@/lib/workspace';
import { CustomFieldInputs } from './custom-fields';
import { Btn, Field, Row, Sheet } from './ui';

export interface SupplierForm {
  id?: string;
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  ntn: string;
  openingBalance: string;
  notes: string;
  status: 'active' | 'inactive';
  custom: CustomValues;
}
export const blankSupplier: SupplierForm = { name: '', contactPerson: '', phone: '', email: '', address: '', ntn: '', openingBalance: '', notes: '', status: 'active', custom: {} };
export const supplierToForm = (s: Supplier): SupplierForm => ({ ...s, openingBalance: s.openingBalance ? moneyToInput(s.openingBalance) : '' });

/** Add / edit sheet shared by the list and the supplier profile. */
export function SupplierSheet({ form, setForm, onSaved }: { form: SupplierForm | null; setForm: (f: SupplierForm | null) => void; onSaved: (s: Supplier) => void }) {
  const toast = useToast();
  const { t } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<SupplierForm>) => form && setForm({ ...form, ...p });
  async function save() {
    if (!form) return;
    if (!form.name.trim()) return toast(`Enter the ${lower(t('supplier'))} name`, 'error');
    const openingBalance = form.openingBalance.trim() ? parseMoney(form.openingBalance) : 0;
    if (openingBalance === null) return toast('Opening balance is not a valid amount', 'error');
    setBusy(true);
    try {
      const { id, ...rest } = form;
      const s = await api<Supplier>(id ? `/suppliers/${id}` : '/suppliers', { method: id ? 'PUT' : 'POST', body: { ...rest, openingBalance } });
      toast(id ? `${t('supplier')} updated` : `${t('supplier')} added`);
      setForm(null);
      onSaved(s);
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet visible={!!form} title={form?.id ? `Edit ${lower(t('supplier'))}` : `New ${lower(t('supplier'))}`} onClose={() => setForm(null)}>
      <Field label="Name" value={form?.name ?? ''} onChangeText={(v) => set({ name: v })} autoCapitalize="words" />
      <Field label="Contact person" value={form?.contactPerson ?? ''} onChangeText={(v) => set({ contactPerson: v })} />
      <Row gap={10} style={{ alignItems: 'flex-start' }}>
        <Field style={{ flex: 1 }} label="Phone" value={form?.phone ?? ''} onChangeText={(v) => set({ phone: v })} keyboardType="phone-pad" />
        <Field style={{ flex: 1 }} label="NTN (optional)" value={form?.ntn ?? ''} onChangeText={(v) => set({ ntn: v })} />
      </Row>
      <Field label="Email" value={form?.email ?? ''} onChangeText={(v) => set({ email: v })} keyboardType="email-address" autoCapitalize="none" />
      <Field label="Address" value={form?.address ?? ''} onChangeText={(v) => set({ address: v })} multiline />
      <Field label="Opening balance (you owe them)" value={form?.openingBalance ?? ''} onChangeText={(v) => set({ openingBalance: v })} keyboardType="numbers-and-punctuation" placeholder="0" />
      <CustomFieldInputs entity="supplier" values={form?.custom ?? {}} onChange={(custom) => set({ custom })} />
      <Field label="Notes" value={form?.notes ?? ''} onChangeText={(v) => set({ notes: v })} multiline />
      <Btn title="Save" onPress={save} loading={busy} />
    </Sheet>
  );
}

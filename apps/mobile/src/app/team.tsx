import { useState } from 'react';
import { View } from 'react-native';
import { Badge, Btn, Card, Chips, Empty, Field, Loader, Row, Screen, Sheet, Txt, confirm } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useAuth, useToast } from '@/lib/app-context';
import { ROLES, type Role } from '@/lib/shared';

interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: 'active' | 'disabled';
}
const ROLE_HINT: Record<Role, string> = {
  owner: 'Everything, including team and business profiles',
  manager: 'Everything except team and business profiles; approves',
  accountant: 'Invoices, payments, money, buying, stock and payroll',
  staff: 'Makes invoices and records payments; can request and claim',
  viewer: 'Can look at invoices only',
};

/** People who use this account, and what each may do. Needs a connection. */
export default function Team() {
  const toast = useToast();
  const { user, can } = useAuth();
  const { data, loading, error, reload, refreshing } = useApi<Member[]>('/users');
  const [form, setForm] = useState<{ name: string; email: string; password: string; role: Role } | null>(null);
  const [edit, setEdit] = useState<Member | null>(null);
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!form) return;
    setBusy(true);
    try {
      await api('/users', { body: { ...form, name: form.name.trim(), email: form.email.trim() } });
      toast(`${form.name} can now sign in`);
      setForm(null);
      reload();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function update(m: Member, patch: Partial<Pick<Member, 'role' | 'status'>>) {
    if (patch.status === 'disabled' && !(await confirm(`Turn off ${m.name}?`, 'They are signed out on every device and cannot sign in until you turn them on again.', 'Turn off'))) return;
    setBusy(true);
    try {
      await api(`/users/${m.id}`, { method: 'PUT', body: patch });
      toast('Saved');
      setEdit(null);
      reload();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!can('users.manage'))
    return (
      <Screen>
        <Empty icon="lock-closed-outline" title="Owner only" hint="Ask the account owner to add people or change roles." />
      </Screen>
    );

  return (
    <Screen onRefresh={reload} refreshing={refreshing}>
      <Btn icon="person-add-outline" title="Add a person" onPress={() => setForm({ name: '', email: '', password: '', role: 'staff' })} />
      <Loader loading={loading && !data} error={data ? '' : error} onRetry={reload}>
        {(data ?? []).map((m) => (
          <Card key={m.id} label={`Team member ${m.name}`} onPress={m.id === user?.id ? undefined : () => setEdit(m)}>
            <Row style={{ justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <Txt style={{ fontWeight: '700' }}>
                  {m.name}
                  {m.id === user?.id ? ' (you)' : ''}
                </Txt>
                <Txt v="small">{m.email}</Txt>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Badge status={m.role === 'owner' ? 'paid' : 'unpaid'} label={m.role[0].toUpperCase() + m.role.slice(1)} />
                {m.status === 'disabled' && <Badge status="cancelled" label="Turned off" />}
              </View>
            </Row>
          </Card>
        ))}
      </Loader>
      <Sheet visible={!!form} title="Add a person" onClose={() => setForm(null)}>
        <Field label="Name" value={form?.name ?? ''} onChangeText={(v) => setForm((f) => f && { ...f, name: v })} />
        <Field label="Email (they sign in with this)" value={form?.email ?? ''} onChangeText={(v) => setForm((f) => f && { ...f, email: v })} keyboardType="email-address" autoCapitalize="none" />
        <Field label="Temporary password" value={form?.password ?? ''} onChangeText={(v) => setForm((f) => f && { ...f, password: v })} secureTextEntry hint="At least 8 characters. Share it with them privately." />
        <Chips value={form?.role ?? 'staff'} onChange={(v) => setForm((f) => f && { ...f, role: v })} options={ROLES.filter((r) => r !== 'owner').map((r) => ({ value: r, label: r[0].toUpperCase() + r.slice(1) }))} />
        {form && <Txt v="small">{ROLE_HINT[form.role]}</Txt>}
        <Btn title="Add" onPress={add} loading={busy} />
      </Sheet>
      <Sheet visible={!!edit} title={edit?.name ?? ''} onClose={() => setEdit(null)}>
        {edit && (
          <>
            <Txt v="label">Role</Txt>
            <Chips value={edit.role} onChange={(v) => setEdit({ ...edit, role: v })} options={ROLES.map((r) => ({ value: r, label: r[0].toUpperCase() + r.slice(1) }))} />
            <Txt v="small">{ROLE_HINT[edit.role]}</Txt>
            <Btn title="Save role" onPress={() => update(edit, { role: edit.role })} loading={busy} />
            {edit.status === 'active' ? <Btn kind="danger" title="Turn off access" onPress={() => update(edit, { status: 'disabled' })} /> : <Btn kind="secondary" title="Turn access back on" onPress={() => update(edit, { status: 'active' })} />}
          </>
        )}
      </Sheet>
    </Screen>
  );
}

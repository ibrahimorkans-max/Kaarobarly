import { Stack, router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Badge, Btn, Card, Chips, DateField, Empty, Field, IconBtn, Loader, Row, Screen, Section, Select, Sheet, Txt, addDays, fd, fm, todayStr } from '@/components/ui';
import { api, useApi } from '@/lib/api';
import { useTheme, useToast } from '@/lib/app-context';
import { APPOINTMENT_STATUS_LABELS, type Appointment, type AppointmentStatus, type Employee, type Service } from '@/lib/shared';

const NEXT: Partial<Record<AppointmentStatus, { to: AppointmentStatus; label: string }[]>> = {
  booked: [
    { to: 'waiting', label: 'Arrived' },
    { to: 'no_show', label: 'No-show' },
  ],
  waiting: [{ to: 'in_service', label: 'Start' }],
  in_service: [{ to: 'done', label: 'Done · bill' }],
};

/** Bookings for a day by staff member, plus the walk-in queue. Done parks a bill at the counter. */
export default function AppointmentsScreen() {
  const th = useTheme();
  const toast = useToast();
  const [date, setDate] = useState(todayStr());
  const { data, loading, error, reload } = useApi<Appointment[]>(`/appointments?date=${date}`);
  const services = useApi<Service[]>('/services?limit=100');
  const staff = useApi<Employee[]>('/employees');
  const [staffFilter, setStaffFilter] = useState('');
  const [form, setForm] = useState<{ walkIn: boolean; clientName: string; phone: string; serviceId: string | null; staffId: string | null; time: string; minutes: string; notes: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const list = (data ?? []).filter((a) => !staffFilter || a.staffId === staffFilter);
  const queue = list.filter((a) => a.status === 'waiting');
  const booked = list.filter((a) => a.status !== 'waiting');
  const svc = (services.data ?? []).filter((s) => s.status === 'active');
  const people = (staff.data ?? []).filter((e) => e.status === 'active');

  async function save() {
    if (!form) return;
    if (!form.clientName.trim()) return toast('Enter the customer name', 'error');
    if (!form.walkIn && !/^\d{2}:\d{2}$/.test(form.time)) return toast('Enter the time as HH:MM', 'error');
    setBusy(true);
    try {
      const minutes = Number(form.minutes) || 30;
      await api('/appointments', { body: { clientName: form.clientName.trim(), phone: form.phone, serviceId: form.serviceId, staffId: form.staffId, date, time: form.walkIn ? '' : form.time, minutes, notes: form.notes, walkIn: form.walkIn } });
      setForm(null);
      reload();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  }
  async function move(a: Appointment, to: AppointmentStatus) {
    try {
      await api(`/appointments/${a.id}/status`, { body: { status: to } });
      if (to === 'done') toast('Bill parked at the counter');
      reload();
    } catch (e: any) {
      toast(e.message, 'error');
    }
  }

  const row = (a: Appointment) => (
    <Card key={a.id} style={{ gap: 6 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <Txt style={{ fontWeight: '700' }}>
            {a.time || 'Walk-in'} · {a.clientName}
          </Txt>
          <Txt v="small">{[a.serviceName && `${a.serviceName} ${fm(a.price)}`, a.staffName, a.minutes ? `${a.minutes} min` : '', a.phone].filter(Boolean).join(' · ')}</Txt>
          {!!a.notes && <Txt v="small">{a.notes}</Txt>}
        </View>
        <Badge status={a.status === 'done' ? 'paid' : a.status === 'no_show' || a.status === 'cancelled' ? 'cancelled' : a.status === 'in_service' ? 'partially_paid' : 'unpaid'} label={APPOINTMENT_STATUS_LABELS[a.status]} />
      </Row>
      {(NEXT[a.status]?.length ?? 0) > 0 && (
        <Row gap={8}>
          {NEXT[a.status]!.map((n) => (
            <Btn key={n.to} small style={{ flex: 1 }} kind={n.to === 'no_show' ? 'ghost' : 'secondary'} title={n.label} onPress={() => move(a, n.to)} />
          ))}
          {a.status === 'booked' && <IconBtn icon="close" label="Cancel booking" onPress={() => move(a, 'cancelled')} />}
        </Row>
      )}
      {a.status === 'done' && a.heldId && <Btn small kind="ghost" title="Take payment at the counter" onPress={() => router.push('/(tabs)/pos')} />}
    </Card>
  );

  return (
    <Screen onRefresh={reload}>
      <Stack.Screen options={{ title: 'Appointments' }} />
      <Row style={{ alignItems: 'flex-end' }}>
        <IconBtn icon="chevron-back" label="Previous day" onPress={() => setDate(addDays(date, -1))} />
        <View style={{ flex: 1 }}>
          <DateField label={date === todayStr() ? 'Today' : fd(date)} value={date} onChange={setDate} />
        </View>
        <IconBtn icon="chevron-forward" label="Next day" onPress={() => setDate(addDays(date, 1))} />
      </Row>
      <Row gap={8}>
        <Btn style={{ flex: 1 }} icon="add" title="Booking" onPress={() => setForm({ walkIn: false, clientName: '', phone: '', serviceId: null, staffId: staffFilter || null, time: '', minutes: '30', notes: '' })} />
        <Btn style={{ flex: 1 }} kind="secondary" icon="walk-outline" title="Walk-in" onPress={() => setForm({ walkIn: true, clientName: '', phone: '', serviceId: null, staffId: null, time: '', minutes: '30', notes: '' })} />
      </Row>
      {people.length > 1 && <Chips value={staffFilter} onChange={setStaffFilter} options={[{ value: '', label: 'Everyone' }, ...people.map((p) => ({ value: p.id, label: p.name }))]} />}
      <Loader loading={loading && !data} error={data ? '' : error} onRetry={reload}>
        {queue.length > 0 && <Section title={`Waiting (${queue.length})`}>{queue.map(row)}</Section>}
        <Section title="Bookings">{booked.length ? booked.map(row) : <Empty icon="calendar-outline" title="No bookings" hint="Add a booking or a walk-in." />}</Section>
      </Loader>
      <Sheet visible={!!form} title={form?.walkIn ? 'Walk-in' : 'New booking'} onClose={() => setForm(null)}>
        <Field label="Customer name" value={form?.clientName ?? ''} onChangeText={(v) => setForm((f) => f && { ...f, clientName: v })} />
        <Field label="Phone" keyboardType="phone-pad" value={form?.phone ?? ''} onChangeText={(v) => setForm((f) => f && { ...f, phone: v })} />
        <Select<Service> label="Service" placeholder="Choose a service" value={svc.find((s) => s.id === form?.serviceId)?.name ?? ''} items={svc} getKey={(s) => s.id} getLabel={(s) => s.name} getSub={(s) => fm(s.defaultPrice)} onSelect={(s) => setForm((f) => f && { ...f, serviceId: s.id })} />
        {people.length > 0 && <Select<Employee> label="Staff" placeholder="Anyone" value={people.find((p) => p.id === form?.staffId)?.name ?? ''} items={people} getKey={(p) => p.id} getLabel={(p) => p.name} getSub={(p) => p.designation} onSelect={(p) => setForm((f) => f && { ...f, staffId: p.id })} />}
        {!form?.walkIn && (
          <Row gap={10} style={{ alignItems: 'flex-start' }}>
            <Field style={{ flex: 1 }} label="Time (HH:MM)" value={form?.time ?? ''} onChangeText={(v) => setForm((f) => f && { ...f, time: v })} placeholder="15:30" keyboardType="numbers-and-punctuation" />
            <Field style={{ flex: 1 }} label="Minutes" keyboardType="number-pad" value={form?.minutes ?? ''} onChangeText={(v) => setForm((f) => f && { ...f, minutes: v })} />
          </Row>
        )}
        <Field label="Notes" value={form?.notes ?? ''} onChangeText={(v) => setForm((f) => f && { ...f, notes: v })} />
        <Btn title={form?.walkIn ? 'Add to queue' : 'Book'} onPress={save} loading={busy} />
        {!people.length && <Txt v="small" color={th.sub}>Add staff in People to book by person.</Txt>}
      </Sheet>
    </Screen>
  );
}

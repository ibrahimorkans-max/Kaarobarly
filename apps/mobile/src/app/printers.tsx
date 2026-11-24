import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Platform, Switch, View } from 'react-native';
import { Btn, Card, Chips, Notice, Row, Screen, Section, Select, Txt } from '@/components/ui';
import { useApi } from '@/lib/api';
import { useToast } from '@/lib/app-context';
import { labelsTspl, labelsZpl, testEscPos } from '@/lib/escpos';
import { SAMPLE_LABEL_ITEM } from '@/lib/labels';
import { bluetoothAvailable, desktop, getPrinters, pairedPrinters, savePrinters, sendBytes, type PrinterSettings } from '@/lib/printer';
import { BUILT_IN_LABELS, type BusinessProfile } from '@/lib/shared';
import type { PairedPrinter } from '../../modules/kb-printer';

type Role = 'receipt' | 'kitchen' | 'label';

/** Choose the receipt, kitchen and label printers on this device, and test them. */
export default function PrintersScreen() {
  const toast = useToast();
  const businesses = useApi<BusinessProfile[]>('/businesses');
  const [s, setS] = useState<PrinterSettings | null>(null);
  const [paired, setPaired] = useState<PairedPrinter[] | null>(null);
  const [winPrinters, setWinPrinters] = useState<{ name: string; isDefault: boolean }[]>([]);
  const [busy, setBusy] = useState('');
  const bt = bluetoothAvailable();

  useEffect(() => {
    void getPrinters().then(setS);
    if (desktop) void desktop.printers().then(setWinPrinters);
  }, []);

  const update = (p: PrinterSettings) => {
    setS(p);
    void savePrinters(p);
  };
  async function scan() {
    setBusy('scan');
    try {
      setPaired(await pairedPrinters());
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  }
  async function test(role: Role) {
    if (!s) return;
    setBusy(role);
    try {
      if (role === 'label' && s.label) {
        const b = businesses.data?.[0];
        if (!b) throw new Error('Add a business profile first');
        const d = BUILT_IN_LABELS[0];
        await sendBytes(s.label.address, (s.label.language === 'zpl' ? labelsZpl : labelsTspl)(d, [{ item: SAMPLE_LABEL_ITEM, copies: 1 }], b));
      } else {
        const p = role === 'receipt' ? s.receipt : s.kitchen;
        if (p) await sendBytes(p.address, testEscPos(p.widthMm));
      }
      toast('Sent to the printer');
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  }

  const pick = (role: Role) => (
    <Select<PairedPrinter>
      label="Printer"
      placeholder={paired ? 'Choose a paired printer' : 'Tap “Find paired printers” first'}
      value={(role === 'label' ? s?.label?.name : role === 'receipt' ? s?.receipt?.name : s?.kitchen?.name) ?? ''}
      items={paired ?? []}
      getKey={(p) => p.address}
      getLabel={(p) => p.name}
      getSub={(p) => p.address}
      onSelect={(p) => {
        if (!s) return;
        if (role === 'label') update({ ...s, label: { address: p.address, name: p.name, language: s.label?.language ?? 'tspl' } });
        else if (role === 'receipt') update({ ...s, receipt: { address: p.address, name: p.name, widthMm: s.receipt?.widthMm ?? 80, autoPrint: s.receipt?.autoPrint ?? true, openDrawer: s.receipt?.openDrawer ?? false } });
        else update({ ...s, kitchen: { address: p.address, name: p.name, widthMm: s.kitchen?.widthMm ?? 80, autoPrint: s.kitchen?.autoPrint ?? true } });
      }}
    />
  );

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Printers' }} />
      {s && bt && (
        <>
          <Row gap={8}>
            <Btn style={{ flex: 1 }} icon="bluetooth-outline" title="Find paired printers" onPress={scan} loading={busy === 'scan'} />
            <Btn style={{ flex: 1 }} kind="secondary" title="Pair a new one" onPress={() => Linking.sendIntent('android.settings.BLUETOOTH_SETTINGS').catch(() => Linking.openSettings())} />
          </Row>
          <Txt v="small">Pair the printer in Android Bluetooth settings first (PIN is usually 0000 or 1234). Works with Bluetooth printers that speak ESC/POS (receipts) and TSPL or ZPL (labels).</Txt>
          {paired && paired.length === 0 && <Notice kind="warn">No paired devices. Pair the printer in Bluetooth settings, then try again.</Notice>}

          <Section title="Receipt printer">
            {pick('receipt')}
            {s.receipt && (
              <Card style={{ gap: 8 }}>
                <Chips value={String(s.receipt.widthMm)} onChange={(v) => update({ ...s, receipt: { ...s.receipt!, widthMm: Number(v) as 58 | 80 } })} options={[{ value: '80', label: '80 mm' }, { value: '58', label: '58 mm' }]} />
                <Row style={{ justifyContent: 'space-between' }}>
                  <Txt style={{ flex: 1 }}>Print each sale automatically</Txt>
                  <Switch accessibilityLabel="Print each sale automatically" value={s.receipt.autoPrint} onValueChange={(v) => update({ ...s, receipt: { ...s.receipt!, autoPrint: v } })} />
                </Row>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Txt style={{ flex: 1 }}>Open the cash drawer on cash sales</Txt>
                  <Switch accessibilityLabel="Open the cash drawer" value={s.receipt.openDrawer} onValueChange={(v) => update({ ...s, receipt: { ...s.receipt!, openDrawer: v } })} />
                </Row>
                <Row gap={8}>
                  <Btn style={{ flex: 1 }} small kind="secondary" title="Test print" onPress={() => test('receipt')} loading={busy === 'receipt'} />
                  <Btn style={{ flex: 1 }} small kind="ghost" title="Remove" onPress={() => update({ ...s, receipt: undefined })} />
                </Row>
              </Card>
            )}
          </Section>

          <Section title="Kitchen printer">
            {pick('kitchen')}
            {s.kitchen && (
              <Card style={{ gap: 8 }}>
                <Chips value={String(s.kitchen.widthMm)} onChange={(v) => update({ ...s, kitchen: { ...s.kitchen!, widthMm: Number(v) as 58 | 80 } })} options={[{ value: '80', label: '80 mm' }, { value: '58', label: '58 mm' }]} />
                <Row style={{ justifyContent: 'space-between' }}>
                  <Txt style={{ flex: 1 }}>Print tickets when sent to the kitchen</Txt>
                  <Switch accessibilityLabel="Print kitchen tickets automatically" value={s.kitchen.autoPrint} onValueChange={(v) => update({ ...s, kitchen: { ...s.kitchen!, autoPrint: v } })} />
                </Row>
                <Row gap={8}>
                  <Btn style={{ flex: 1 }} small kind="secondary" title="Test print" onPress={() => test('kitchen')} loading={busy === 'kitchen'} />
                  <Btn style={{ flex: 1 }} small kind="ghost" title="Remove" onPress={() => update({ ...s, kitchen: undefined })} />
                </Row>
              </Card>
            )}
          </Section>

          <Section title="Label printer">
            {pick('label')}
            {s.label && (
              <Card style={{ gap: 8 }}>
                <Txt v="label">Printer language</Txt>
                <Chips value={s.label.language} onChange={(v) => update({ ...s, label: { ...s.label!, language: v as 'tspl' | 'zpl' } })} options={[{ value: 'tspl', label: 'TSPL (TSC, Xprinter, most)' }, { value: 'zpl', label: 'ZPL (Zebra)' }]} />
                <Txt v="small">Set the label size on the printer to match your label design.</Txt>
                <Row gap={8}>
                  <Btn style={{ flex: 1 }} small kind="secondary" title="Test label" onPress={() => test('label')} loading={busy === 'label'} />
                  <Btn style={{ flex: 1 }} small kind="ghost" title="Remove" onPress={() => update({ ...s, label: undefined })} />
                </Row>
              </Card>
            )}
          </Section>
        </>
      )}

      {s && desktop && (
        <>
          <Txt v="small">Kaarobarly prints straight to these Windows printers, without the print dialog.</Txt>
          {(['desktopReceipt', 'desktopLabel', 'desktopDocument'] as const).map((k) => (
            <Select<{ name: string; isDefault: boolean }>
              key={k}
              label={k === 'desktopReceipt' ? 'Receipt printer' : k === 'desktopLabel' ? 'Label printer' : 'Invoices and reports (A4)'}
              placeholder="Ask each time"
              value={s[k] ?? ''}
              items={winPrinters}
              getKey={(p) => p.name}
              getLabel={(p) => p.name}
              getSub={(p) => (p.isDefault ? 'Windows default' : '')}
              onSelect={(p) => update({ ...s, [k]: p.name })}
            />
          ))}
          <Btn kind="ghost" title="Ask each time for all" onPress={() => update({ ...s, desktopReceipt: undefined, desktopLabel: undefined, desktopDocument: undefined })} />
        </>
      )}

      {s && !bt && !desktop && (
        <Notice kind="info">
          {Platform.OS === 'web' ? 'In the browser, printing uses the print dialog. Install the Kaarobarly Windows app to print silently, or use the Android app for Bluetooth printers.' : 'This build has no Bluetooth printing. Update the app.'}
        </Notice>
      )}
      <View style={{ height: 20 }} />
    </Screen>
  );
}

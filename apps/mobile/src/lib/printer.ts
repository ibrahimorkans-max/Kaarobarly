import { PermissionsAndroid, Platform } from 'react-native';
import { KbPrinter, type PairedPrinter } from '../../modules/kb-printer';
import { toBase64 } from './escpos';
import { local } from './storage';

/**
 * Where things print. On Android: paired Bluetooth printers by role. On the Windows desktop app:
 * installed Windows printers (silent printing). Saved on this device only.
 */
export interface BtPrinter {
  address: string;
  name: string;
  widthMm: 58 | 80;
}
export interface PrinterSettings {
  receipt?: BtPrinter & { autoPrint: boolean; openDrawer: boolean };
  kitchen?: BtPrinter & { autoPrint: boolean };
  label?: { address: string; name: string; language: 'tspl' | 'zpl' };
  /** Windows desktop: printer names */
  desktopReceipt?: string;
  desktopLabel?: string;
  desktopDocument?: string;
}

const KEY = 'kaarobarly.printers';
let cache: PrinterSettings | null = null;

export async function getPrinters(): Promise<PrinterSettings> {
  if (cache) return cache;
  cache = (await local.get<PrinterSettings>(KEY)) ?? {};
  return cache;
}
export async function savePrinters(s: PrinterSettings) {
  cache = s;
  await local.set(KEY, s);
}

export const bluetoothAvailable = () => Platform.OS === 'android' && !!KbPrinter && KbPrinter.isAvailable();

/** Android 12+ asks for "Nearby devices" before paired devices can be listed or used. */
export async function askBluetooth(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  if (Platform.Version < 31) return true;
  const r = await PermissionsAndroid.request('android.permission.BLUETOOTH_CONNECT' as any);
  return r === PermissionsAndroid.RESULTS.GRANTED;
}

export async function pairedPrinters(): Promise<PairedPrinter[]> {
  if (!KbPrinter) throw new Error('Bluetooth printing needs the Android app.');
  if (!(await askBluetooth())) throw new Error('Allow "Nearby devices" for Tijar to use Bluetooth printers.');
  const list = await KbPrinter.bondedDevices();
  // printers first (imaging class), then the rest
  return list.sort((a, b) => Number(b.major === 0x600) - Number(a.major === 0x600) || a.name.localeCompare(b.name));
}

export async function sendBytes(address: string, bytes: Uint8Array) {
  if (!KbPrinter) throw new Error('Bluetooth printing needs the Android app.');
  if (!(await askBluetooth())) throw new Error('Allow "Nearby devices" for Tijar to use Bluetooth printers.');
  await KbPrinter.write(address, toBase64(bytes));
}

// ================================================================ Windows desktop bridge

interface DesktopBridge {
  printers(): Promise<{ name: string; isDefault: boolean }[]>;
  print(html: string, opts: { printer?: string; widthMicrons?: number; heightMicrons?: number; silent?: boolean }): Promise<boolean>;
  openDrawer?(printer: string): Promise<boolean>;
}
export const desktop: DesktopBridge | null = (Platform.OS === 'web' && (globalThis as any).kaarobarlyDesktop) || null;

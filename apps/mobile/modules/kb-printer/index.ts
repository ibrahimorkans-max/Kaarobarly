import { requireOptionalNativeModule } from 'expo';

export interface PairedPrinter {
  name: string;
  address: string;
  /** Bluetooth major class (0x600 = imaging, i.e. printers) */
  major: number;
}

interface KbPrinterNative {
  isAvailable(): boolean;
  isEnabled(): boolean;
  bondedDevices(): Promise<PairedPrinter[]>;
  write(address: string, base64: string): Promise<boolean>;
  disconnect(): Promise<boolean>;
}

/** The native Bluetooth printer module; null on web, iOS and builds without it. */
export const KbPrinter = requireOptionalNativeModule<KbPrinterNative>('KbPrinter');

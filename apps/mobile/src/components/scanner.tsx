import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef, useState } from 'react';
import { Modal, Vibration, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/app-context';
import { Btn, Field, IconBtn, Row, Txt } from './ui';

/**
 * Full-screen barcode scanner. Calls onCode once per scan and closes. Typing the code works too
 * (for a USB / Bluetooth scanner that types like a keyboard, or when the camera is not allowed).
 * `continuous` keeps the camera open for the next item (the same code is ignored for 1.5 s).
 */
export function BarcodeScanner({ visible, onCode, onClose, title = 'Scan barcode', continuous, status }: { visible: boolean; onCode: (code: string) => void; onClose: () => void; title?: string; continuous?: boolean; status?: string }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [permission, request] = useCameraPermissions();
  const [typed, setTyped] = useState('');
  const done = useRef(false);

  const last = useRef({ code: '', at: 0 });
  const finish = (code: string) => {
    if (done.current || !code.trim()) return;
    if (continuous) {
      const c = code.trim();
      if (c === last.current.code && Date.now() - last.current.at < 1500) return;
      last.current = { code: c, at: Date.now() };
      Vibration.vibrate(40);
      setTyped('');
      onCode(c);
      return;
    }
    done.current = true;
    setTyped('');
    onCode(code.trim());
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} onShow={() => {
        done.current = false;
      }}>
      <View style={{ flex: 1, backgroundColor: '#000', paddingTop: insets.top }}>
        <Row style={{ justifyContent: 'space-between', padding: 12 }}>
          <Txt v="h" color="#fff">
            {title}
          </Txt>
          <IconBtn icon="close" label="Close scanner" onPress={onClose} />
        </Row>
        <View style={{ flex: 1, overflow: 'hidden' }}>
          {permission?.granted ? (
            <CameraView
              style={{ flex: 1 }}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'code93', 'itf14', 'codabar', 'qr', 'datamatrix'] }}
              onBarcodeScanned={(r) => finish(r.data)}
            />
          ) : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 }}>
              <Txt color="#fff" style={{ textAlign: 'center' }}>
                {permission && !permission.canAskAgain ? 'Camera access is off for Tijar. Allow it in your phone settings, or type the code below.' : 'Allow the camera to scan barcodes.'}
              </Txt>
              {(!permission || permission.canAskAgain) && <Btn icon="camera-outline" title="Allow camera" onPress={() => void request()} />}
            </View>
          )}
          {permission?.granted && (
            <View pointerEvents="none" style={{ position: 'absolute', left: '12%', right: '12%', top: '35%', height: '22%', borderWidth: 3, borderColor: '#2ED3A6', borderRadius: 14 }} />
          )}
        </View>
        <View style={{ padding: 16, paddingBottom: Math.max(insets.bottom, 16), backgroundColor: t.bg, gap: 10 }}>
          <Row style={{ alignItems: 'flex-end' }}>
            <Field style={{ flex: 1 }} label="Or type the code" value={typed} onChangeText={setTyped} autoCapitalize="none" autoFocus={!permission?.granted} onSubmitEditing={() => finish(typed)} returnKeyType="done" />
            <Btn small title="Use" onPress={() => finish(typed)} disabled={!typed.trim()} />
          </Row>
          {!!status && <Txt style={{ fontWeight: '700', textAlign: 'center' }}>{status}</Txt>}
          {continuous && <Btn title="Done scanning" onPress={onClose} />}
        </View>
      </View>
    </Modal>
  );
}

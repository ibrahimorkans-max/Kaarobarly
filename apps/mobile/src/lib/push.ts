import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { api } from './api';
import { local } from './storage';

const TOKEN_KEY = 'kaarobarly.pushToken';
export type PushState = 'ok' | 'denied' | 'unavailable';

if (Platform.OS !== 'web') {
  // show notifications that arrive while the app is open too
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

/**
 * Ask for permission and send this phone's push token to the server. The channel must exist
 * first: Android 13+ only shows the permission prompt once a channel is created.
 * "unavailable" means this build has no Firebase setup (or there is no network).
 */
export async function registerPush(ask = true): Promise<PushState> {
  if (Platform.OS === 'web') return 'unavailable';
  try {
    await Notifications.setNotificationChannelAsync('default', { name: 'Kaarobarly', importance: Notifications.AndroidImportance.HIGH, lightColor: '#3D5AF1' });
    let granted = (await Notifications.getPermissionsAsync()).granted;
    if (!granted && ask) granted = (await Notifications.requestPermissionsAsync()).granted;
    if (!granted) return 'denied';
    const t = await Notifications.getDevicePushTokenAsync();
    const token = String(t.data);
    await api('/push/register', { body: { token, platform: Platform.OS === 'ios' ? 'ios' : 'android' } });
    await local.set(TOKEN_KEY, token);
    return 'ok';
  } catch {
    return 'unavailable';
  }
}

/** On sign-out: this phone stops getting the business's notifications. */
export async function unregisterPush() {
  const token = await local.get<string>(TOKEN_KEY);
  if (!token) return;
  await api('/push/unregister', { body: { token } }).catch(() => {});
  await local.remove(TOKEN_KEY);
}

/** Register once signed in (quietly, without a prompt after the first time) and open tapped notifications. */
export function usePush(signedIn: boolean) {
  useEffect(() => {
    if (!signedIn || Platform.OS === 'web') return;
    void (async () => {
      const asked = await local.get<boolean>('kaarobarly.pushAsked');
      await local.set('kaarobarly.pushAsked', true);
      await registerPush(!asked);
    })();
    const open = (url: unknown) => {
      if (typeof url === 'string' && url.startsWith('/')) router.push(url as any);
    };
    const sub = Notifications.addNotificationResponseReceivedListener((r) => open(r.notification.request.content.data?.url));
    void Notifications.getLastNotificationResponseAsync().then((r) => r && open(r.notification.request.content.data?.url));
    return () => sub.remove();
  }, [signedIn]);
}

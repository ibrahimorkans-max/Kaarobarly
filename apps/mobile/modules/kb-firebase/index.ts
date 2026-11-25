import { requireOptionalNativeModule } from 'expo';

interface KbFirebaseNative {
  currentAppId(): string;
  configure(projectId: string, appId: string, apiKey: string, senderId: string, storageBucket: string): 'started' | 'running' | 'restart' | 'failed';
}

/** Starts Firebase from values the server hands out; null on web, iOS and builds without it. */
export const KbFirebase = requireOptionalNativeModule<KbFirebaseNative>('KbFirebase');

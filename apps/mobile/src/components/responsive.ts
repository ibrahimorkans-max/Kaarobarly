import { useWindowDimensions } from 'react-native';

/** From this width (browser, desktop app, large tablet) the app uses its desktop layout: a sidebar instead of the bottom bar. */
export const WIDE_BREAK = 1000;
/** Widest a page's content grows on the desktop layout. */
export const WIDE_CONTENT = 1120;

export function useWide() {
  return useWindowDimensions().width >= WIDE_BREAK;
}

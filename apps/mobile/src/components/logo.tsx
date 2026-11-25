import { useId } from 'react';
import { Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

export const BRAND = {
  name: 'Tijar',
  tagline: 'Every Business Move, Made Smarter',
  taglineParts: ['Every Business Move,', 'Made Smarter'] as const,
  navy: '#0F2A3B',
  navyDeep: '#081A25',
  green: '#19B892',
  mint: '#2BD8B0',
  splash: ['#06141D', '#0C2433', '#0F3444'] as const,
};

// Geometry on a 266 x 249 grid. brand/tijar-mark.svg and apps/api/site use the same paths.
/** The crossbar: a leaf that sweeps up into the arrow. */
export const MARK_LEAF = 'M18 106 C30 78 52 57 84 56 L158 56 C180 56 194 46 208 30 L232 52 C192 90 150 104 96 106 Z';
/** The stem, whose right edge rises into the arrow's shaft. */
export const MARK_STEM = 'M80 113 C132 112 178 96 236 58 L244 68 C200 104 162 120 160 160 L160 200 C160 226 142 242 114 242 L80 242 Z';
/** The arrow head. */
export const MARK_ARROW = 'M266 0 L252 74 L192 20 Z';
export const MARK_VIEWBOX = '0 0 266 249';
export const MARK_RATIO = 249 / 266;

type Variant = 'color' | 'dark';
// the stem fades from navy (or white on dark backgrounds) into green along the diagonal
const STEM_LIGHT: [string, string][] = [['0', BRAND.navy], ['0.5', '#103F4C'], ['0.64', '#17A487'], ['1', BRAND.green]];
const STEM_DARK: [string, string][] = [['0', '#FFFFFF'], ['0.55', '#BFF3E5'], ['1', BRAND.green]];

/** Gradient definitions for one mark (ids made unique so several marks can share a screen). */
function MarkDefs({ id, variant }: { id: string; variant: Variant }) {
  return (
    <Defs>
      <LinearGradient id={`${id}l`} x1="18" y1="0" x2="222" y2="0" gradientUnits="userSpaceOnUse">
        <Stop offset="0" stopColor={BRAND.mint} />
        <Stop offset="1" stopColor="#14AE8B" />
      </LinearGradient>
      <LinearGradient id={`${id}s`} x1="92" y1="240" x2="214" y2="96" gradientUnits="userSpaceOnUse">
        {(variant === 'dark' ? STEM_DARK : STEM_LIGHT).map(([o, c]) => (
          <Stop key={o} offset={o} stopColor={c} />
        ))}
      </LinearGradient>
      <LinearGradient id={`${id}a`} x1="200" y1="66" x2="264" y2="2" gradientUnits="userSpaceOnUse">
        <Stop offset="0" stopColor={BRAND.green} />
        <Stop offset="1" stopColor={BRAND.mint} />
      </LinearGradient>
    </Defs>
  );
}

/** One part of the mark on its own (used by the onboarding animation to move the parts separately). */
export function MarkPart({ part, size, variant = 'color', mono }: { part: 'leaf' | 'stem' | 'arrow'; size: number; variant?: Variant; mono?: string }) {
  const id = useId().replace(/:/g, '');
  const d = part === 'leaf' ? MARK_LEAF : part === 'stem' ? MARK_STEM : MARK_ARROW;
  const key = part === 'leaf' ? 'l' : part === 'stem' ? 's' : 'a';
  return (
    <Svg width={size} height={size * MARK_RATIO} viewBox={MARK_VIEWBOX}>
      {!mono && <MarkDefs id={id} variant={variant} />}
      <Path d={d} fill={mono ?? `url(#${id}${key})`} />
    </Svg>
  );
}

/** The Tijar mark: a T whose crossbar and stem rise together into an arrow. */
export function LogoMark({ size = 48, mono, variant = 'color' }: { size?: number; mono?: string; variant?: Variant }) {
  const id = useId().replace(/:/g, '');
  const fill = (k: string) => mono ?? `url(#${id}${k})`;
  return (
    <Svg width={size} height={size} viewBox="-8 -12 282 282" accessibilityLabel="Tijar logo">
      {!mono && <MarkDefs id={id} variant={variant} />}
      <Path d={MARK_STEM} fill={fill('s')} />
      <Path d={MARK_LEAF} fill={fill('l')} />
      <Path d={MARK_ARROW} fill={fill('a')} />
    </Svg>
  );
}

// The TIJAR letters on a 446 x 100 grid; the A has no crossbar, a green triangle sits inside it.
export const WORD_PATHS = {
  T: 'M0 0 H92 V24 H58 V100 H34 V24 H0 Z',
  I: 'M106 0 H130 V100 H106 Z',
  J: 'M186 0 H210 V64 C210 87 195 100 172 100 H148 V77 H168 C180 77 186 71 186 61 Z',
  A: 'M226 100 L266 0 H294 L334 100 H308 L280 28 L252 100 Z',
  R: 'M350 0 H400 C426 0 442 15 442 38 C442 55 432 67 417 72 L446 100 H414 L389 75 H374 V100 H350 Z M374 23 V52 H398 C410 52 417 47 417 38 C417 28 410 23 398 23 Z',
};
export const WORD_TRIANGLE = 'M280 60 L296 100 H264 Z';

/** The TIJAR wordmark. */
export function Wordmark({ height = 28, onDark }: { height?: number; onDark?: boolean }) {
  const ink = onDark ? '#FFFFFF' : BRAND.navy;
  return (
    <Svg width={(height * 446) / 100} height={height} viewBox="0 0 446 100" accessibilityLabel="Tijar">
      {Object.values(WORD_PATHS).map((d) => (
        <Path key={d} d={d} fill={ink} fillRule="evenodd" />
      ))}
      <Path d={WORD_TRIANGLE} fill={BRAND.green} />
    </Svg>
  );
}

/** Mark with the wordmark and tagline beside it. `onDark` switches the letters to white. */
export function LogoLockup({ size = 44, onDark }: { size?: number; onDark?: boolean }) {
  const ink = onDark ? '#FFFFFF' : BRAND.navy;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: size * 0.26 }}>
      <LogoMark size={size} variant={onDark ? 'dark' : 'color'} />
      <View style={{ gap: size * 0.1 }}>
        <Wordmark height={size * 0.5} onDark={onDark} />
        <Text style={{ color: ink, opacity: 0.85, fontSize: size * 0.21, fontWeight: '600' }}>
          {BRAND.taglineParts[0]} <Text style={{ color: BRAND.green, fontWeight: '800', opacity: 1 }}>{BRAND.taglineParts[1]}</Text>
        </Text>
      </View>
    </View>
  );
}

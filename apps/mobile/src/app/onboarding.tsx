import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { LogoReveal } from '@/components/logo-reveal';
import { Animated, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Polygon } from 'react-native-svg';
import { LogoMark } from '@/components/logo';
import { tr } from '@/lib/i18n';
import { local } from '@/lib/storage';

const ONBOARDED_KEY = 'kaarobarly.onboarded';

const PEACH = '#9FE6D2';
const PEACH_SOFT = '#E3F7F0';
const INK = '#0F2A3B';
const MUTED = '#6E7F88';
const RING = '#19B892';
const ACCENT = '#0F8A6F';

interface Slide {
  title: string;
  text: string;
  shape: 'diagonal' | 'arch' | 'corner';
  icon: React.ComponentProps<typeof Ionicons>['name'];
  props: React.ComponentProps<typeof Ionicons>['name'][];
}
const SLIDES: Slide[] = [
  { title: 'Start your\nBusiness Online', text: 'Invoices, stock, payments and staff in one app, set up for your kind of business in minutes.', shape: 'diagonal', icon: 'storefront', props: ['receipt-outline', 'cube-outline'] },
  { title: 'Sell faster,\nanywhere', text: 'Scan, bill and print at the counter. It keeps working without internet and syncs when you are back online.', shape: 'arch', icon: 'scan', props: ['chatbubble-ellipses-outline', 'wifi-outline'] },
  { title: 'Every Business Move,\nMade Smarter', text: 'Start with a free 30-day Pro trial, then pick the plan that fits. You can upgrade any time.', shape: 'corner', icon: 'diamond', props: ['bulb-outline', 'sparkles-outline'] },
];

/** The peach background shape and the drawn illustration of one slide. */
function Art({ slide, w, h }: { slide: Slide; w: number; h: number }) {
  const r = Math.min(w, h) * 0.36;
  const cx = w / 2;
  const cy = h * 0.5;
  return (
    <View style={{ width: w, height: h }}>
      <Svg width={w} height={h} style={StyleSheet.absoluteFill}>
        {slide.shape === 'diagonal' && <Polygon points={`0,0 ${w * 0.55},0 ${w},${h * 0.52} ${w},${h * 0.82} 0,${h * 0.18}`} fill={PEACH} />}
        {slide.shape === 'arch' && <Path d={`M ${cx - r * 1.05} ${h} L ${cx - r * 1.05} ${cy + r * 0.25} A ${r * 1.05} ${r * 1.05} 0 0 1 ${cx + r * 1.05} ${cy + r * 0.25} L ${cx + r * 1.05} ${h} Z`} fill={PEACH} />}
        {slide.shape === 'corner' && <Polygon points={`${w * 0.35},0 ${w},0 ${w},${h * 0.75}`} fill={PEACH} />}
        <Circle cx={cx} cy={cy} r={r} fill="#FFFFFF" />
        <Circle cx={cx} cy={cy} r={r * 0.8} fill={PEACH_SOFT} />
      </Svg>
      {/* the main symbol, with two smaller props floating around it */}
      <View style={[styles.center, { left: cx - r * 0.55, top: cy - r * 0.55, width: r * 1.1, height: r * 1.1, borderRadius: r * 0.3 }]}>
        {slide.shape === 'diagonal' ? <LogoMark size={r * 0.8} /> : <Ionicons name={slide.icon} size={r * 0.7} color={INK} />}
      </View>
      <View style={[styles.prop, { left: cx + r * 0.55, top: cy - r * 1.05 }]}>
        <Ionicons name={slide.props[0]} size={26} color={ACCENT} />
      </View>
      <View style={[styles.prop, { left: cx - r * 1.1, top: cy + r * 0.45 }]}>
        <Ionicons name={slide.props[1]} size={26} color={RING} />
      </View>
    </View>
  );
}

/** Round "next" button inside a ring that fills a third more on each slide. */
function NextButton({ step, total, onPress, last }: { step: number; total: number; onPress: () => void; last: boolean }) {
  const size = 76;
  const stroke = 4;
  const rad = (size - stroke) / 2;
  const len = 2 * Math.PI * rad;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={last ? tr('Get started') : tr('Next')} onPress={onPress} hitSlop={10} style={({ pressed }) => ({ width: size, height: size, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.8 : 1 })}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={rad} stroke="#E9EBF3" strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={rad}
          stroke={last ? ACCENT : RING}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${(len * (step + 1)) / total} ${len}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={{ width: size - 20, height: size - 20, borderRadius: (size - 20) / 2, backgroundColor: last ? ACCENT : INK, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="arrow-forward" size={24} color="#FFFFFF" />
      </View>
    </Pressable>
  );
}

/** First-launch introduction: three slides, then sign in or create an account. */
export default function Onboarding() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [step, setStep] = useState(0);
  const fade = useRef(new Animated.Value(1)).current;
  // a phone-sized card, centred on tablets and in a browser
  const cardW = Math.min(width - 32, 420);
  const cardH = Math.min(height - insets.top - insets.bottom - 32, 820);
  const artH = Math.min(cardH * 0.5, cardW * 1.05);
  const slide = SLIDES[step];
  const last = step === SLIDES.length - 1;

  const finish = async () => {
    await local.set(ONBOARDED_KEY, true).catch(() => {});
    router.replace('/login');
  };
  const go = (next: number) => {
    Animated.timing(fade, { toValue: 0, duration: 140, useNativeDriver: true }).start(() => {
      setStep(next);
      Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    });
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
      <View style={[styles.card, { width: cardW, height: cardH }]}>
        <View style={styles.top}>
          <View style={styles.dots}>
            {SLIDES.map((_, i) => (
              <View key={i} style={[styles.dot, i === step && styles.dotOn]} />
            ))}
          </View>
          {!last && (
            <Pressable accessibilityRole="button" onPress={finish} hitSlop={10}>
              <Text style={styles.skip}>{tr('Skip')}</Text>
            </Pressable>
          )}
        </View>
        <Animated.View style={{ flex: 1, opacity: fade, alignItems: 'center' }}>
          {last ? <LogoReveal w={cardW} h={artH} /> : <Art slide={slide} w={cardW} h={artH} />}
          <View style={styles.copy}>
            <Text style={styles.title}>{tr(slide.title)}</Text>
            <Text style={styles.text}>{tr(slide.text)}</Text>
          </View>
        </Animated.View>
        <View style={{ alignItems: 'center', paddingBottom: 24 }}>
          <NextButton step={step} total={SLIDES.length} last={last} onPress={() => (last ? finish() : go(step + 1))} />
          {last && <Text style={[styles.skip, { marginTop: 12, color: INK }]}>{tr('Get started')}</Text>}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#E4F0ED', alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: '#FFFFFF', borderRadius: 32, overflow: 'hidden', boxShadow: '0 12px 32px rgba(15, 42, 59, 0.12)' } as any,
  top: { position: 'absolute', zIndex: 2, top: 18, left: 22, right: 22, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dots: { flexDirection: 'row', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(15,42,59,0.18)' },
  dotOn: { width: 22, backgroundColor: INK },
  skip: { fontSize: 15, fontWeight: '700', color: MUTED },
  center: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  prop: { position: 'absolute', width: 48, height: 48, borderRadius: 14, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', boxShadow: '0 6px 14px rgba(15, 42, 59, 0.12)' } as any,
  copy: { flex: 1, paddingHorizontal: 28, paddingTop: 28, alignItems: 'center', justifyContent: 'flex-start', gap: 12 },
  title: { fontSize: 30, lineHeight: 36, fontWeight: '800', color: INK, textAlign: 'center', letterSpacing: -0.5 },
  text: { fontSize: 15, lineHeight: 22, color: MUTED, textAlign: 'center' },
});

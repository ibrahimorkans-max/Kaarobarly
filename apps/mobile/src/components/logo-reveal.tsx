import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { BRAND, MARK_RATIO, MarkPart, Wordmark } from './logo';

const NATIVE = Platform.OS !== 'web';
const SPARKS = 10;

/**
 * The last onboarding slide: the Tijar mark builds itself (the stem rises, the crossbar sweeps in,
 * the arrow shoots up and throws sparks), the wordmark wipes in, then the mark keeps floating
 * inside slowly turning rings.
 */
export function LogoReveal({ w, h }: { w: number; h: number }) {
  const size = Math.min(w * 0.44, h * 0.52);
  const markH = size * MARK_RATIO;
  const cx = w / 2;
  const cy = h * 0.47;

  const stem = useRef(new Animated.Value(0)).current;
  const leaf = useRef(new Animated.Value(0)).current;
  const arrow = useRef(new Animated.Value(0)).current;
  const burst = useRef(new Animated.Value(0)).current;
  const word = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;
  const float = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let loops: Animated.CompositeAnimation[] = [];
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduce) => {
        if (cancelled) return;
        if (reduce) {
          [stem, leaf, arrow, word, glow].forEach((v) => v.setValue(1));
          return;
        }
        Animated.sequence([
          Animated.parallel([
            Animated.timing(glow, { toValue: 1, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE }),
            Animated.spring(stem, { toValue: 1, useNativeDriver: NATIVE, speed: 9, bounciness: 9 }),
          ]),
          Animated.spring(leaf, { toValue: 1, useNativeDriver: NATIVE, speed: 10, bounciness: 8 }),
          Animated.timing(arrow, { toValue: 1, duration: 420, easing: Easing.out(Easing.back(2.2)), useNativeDriver: NATIVE }),
          Animated.parallel([
            Animated.timing(burst, { toValue: 1, duration: 650, easing: Easing.out(Easing.quad), useNativeDriver: NATIVE }),
            Animated.timing(word, { toValue: 1, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE }),
          ]),
        ]).start(({ finished }) => {
          if (!finished || cancelled) return;
          loops = [
            Animated.loop(
              Animated.sequence([
                Animated.timing(float, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: NATIVE }),
                Animated.timing(float, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: NATIVE }),
              ]),
            ),
            Animated.loop(Animated.timing(spin, { toValue: 1, duration: 14000, easing: Easing.linear, useNativeDriver: NATIVE })),
          ];
          loops.forEach((l) => l.start());
        });
      });
    return () => {
      cancelled = true;
      loops.forEach((l) => l.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lift = float.interpolate({ inputRange: [0, 1], outputRange: [0, -8] });
  const turn = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const turnBack = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-360deg'] });
  const ring = size * 1.32;
  const box = { position: 'absolute' as const, left: 0, top: 0, width: size, height: markH };

  return (
    <View style={{ width: w, height: h }} accessible accessibilityLabel={`${BRAND.name}. ${BRAND.tagline}`}>
      {/* soft green glow behind everything */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: glow }]}>
        <Svg width={w} height={h}>
          <Defs>
            <RadialGradient id="rvGlow" cx={cx} cy={cy} r={size * 1.2} gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor={BRAND.mint} stopOpacity={0.45} />
              <Stop offset="0.55" stopColor={BRAND.green} stopOpacity={0.12} />
              <Stop offset="1" stopColor={BRAND.green} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={cx} cy={cy} r={size * 1.2} fill="url(#rvGlow)" />
        </Svg>
      </Animated.View>

      {/* two dashed orbits turning in opposite directions */}
      {[
        { r: ring, rot: turn, dash: '2 10', color: BRAND.green },
        { r: ring * 0.78, rot: turnBack, dash: '14 8', color: BRAND.navy },
      ].map((o, i) => (
        <Animated.View key={i} style={{ position: 'absolute', left: cx - o.r / 2, top: cy - o.r / 2, width: o.r, height: o.r, opacity: glow, transform: [{ rotate: o.rot }] }}>
          <Svg width={o.r} height={o.r}>
            <Circle cx={o.r / 2} cy={o.r / 2} r={o.r / 2 - 2} stroke={o.color} strokeOpacity={i ? 0.14 : 0.45} strokeWidth={2} strokeDasharray={o.dash} fill="none" />
            {!i && <Circle cx={o.r / 2} cy={2} r={5} fill={BRAND.green} />}
          </Svg>
        </Animated.View>
      ))}

      {/* the mark, built from its three parts */}
      <Animated.View style={{ position: 'absolute', left: cx - size / 2, top: cy - markH / 2, width: size, height: markH, transform: [{ translateY: lift }] }}>
        <Animated.View
          style={[
            box,
            {
              opacity: stem,
              transform: [{ translateY: stem.interpolate({ inputRange: [0, 1], outputRange: [size * 0.5, 0] }) }, { scaleY: stem.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }],
            },
          ]}>
          <MarkPart part="stem" size={size} />
        </Animated.View>
        <Animated.View
          style={[
            box,
            {
              opacity: leaf,
              transform: [
                { translateX: leaf.interpolate({ inputRange: [0, 1], outputRange: [-size * 0.7, 0] }) },
                { rotate: leaf.interpolate({ inputRange: [0, 1], outputRange: ['-35deg', '0deg'] }) },
              ],
            },
          ]}>
          <MarkPart part="leaf" size={size} />
        </Animated.View>
        <Animated.View
          style={[
            box,
            {
              opacity: arrow,
              transform: [
                { translateX: arrow.interpolate({ inputRange: [0, 1], outputRange: [-size * 0.35, 0] }) },
                { translateY: arrow.interpolate({ inputRange: [0, 1], outputRange: [size * 0.35, 0] }) },
                { scale: arrow.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) },
              ],
            },
          ]}>
          <MarkPart part="arrow" size={size} />
        </Animated.View>

        {/* sparks thrown from the arrow tip */}
        {Array.from({ length: SPARKS }, (_, i) => {
          const a = (i / SPARKS) * Math.PI * 2;
          const d = size * (0.28 + (i % 3) * 0.08);
          return (
            <Animated.View
              key={i}
              style={{
                position: 'absolute',
                left: size * 0.985 - 4,
                top: 0,
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: i % 2 ? BRAND.mint : '#FFC23D',
                opacity: burst.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 1, 0] }),
                transform: [
                  { translateX: burst.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(a) * d] }) },
                  { translateY: burst.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(a) * d] }) },
                  { scale: burst.interpolate({ inputRange: [0, 1], outputRange: [1.2, 0.3] }) },
                ],
              }}
            />
          );
        })}
      </Animated.View>

      {/* the wordmark wipes in under the mark */}
      <Animated.View
        style={{
          position: 'absolute',
          top: cy + markH / 2 + size * 0.16,
          left: 0,
          right: 0,
          alignItems: 'center',
          opacity: word,
          transform: [{ translateY: word.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }, { scale: word.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }],
        }}>
        <Wordmark height={size * 0.22} />
      </Animated.View>
    </View>
  );
}

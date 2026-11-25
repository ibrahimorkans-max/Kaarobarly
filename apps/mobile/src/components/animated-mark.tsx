import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, View } from 'react-native';
import { MARK_RATIO, MarkPart } from './logo';

const NATIVE = Platform.OS !== 'web';

/**
 * The Tijar mark for the top bar, always moving: the arrow keeps shooting up and coming back,
 * the crossbar sways, and every few seconds the whole mark turns once in 3D.
 * Stays still when the phone asks for reduced motion.
 */
export function AnimatedMark({ size = 30 }: { size?: number }) {
  const shoot = useRef(new Animated.Value(0)).current;
  const sway = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;
  const h = size * MARK_RATIO;

  useEffect(() => {
    let loops: Animated.CompositeAnimation[] = [];
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduce) => {
        if (reduce || cancelled) return;
        loops = [
          Animated.loop(
            Animated.sequence([
              Animated.delay(900),
              Animated.timing(shoot, { toValue: 1, duration: 450, easing: Easing.in(Easing.cubic), useNativeDriver: NATIVE }),
              Animated.timing(shoot, { toValue: 2, duration: 0, useNativeDriver: NATIVE }),
              Animated.timing(shoot, { toValue: 3, duration: 520, easing: Easing.out(Easing.back(1.8)), useNativeDriver: NATIVE }),
              Animated.timing(shoot, { toValue: 0, duration: 0, useNativeDriver: NATIVE }),
            ]),
          ),
          Animated.loop(
            Animated.sequence([
              Animated.timing(sway, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: NATIVE }),
              Animated.timing(sway, { toValue: 0, duration: 1200, easing: Easing.inOut(Easing.sin), useNativeDriver: NATIVE }),
            ]),
          ),
          Animated.loop(
            Animated.sequence([
              Animated.delay(4200),
              Animated.timing(spin, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.cubic), useNativeDriver: NATIVE }),
              Animated.timing(spin, { toValue: 0, duration: 0, useNativeDriver: NATIVE }),
            ]),
          ),
        ];
        loops.forEach((l) => l.start());
      });
    return () => {
      cancelled = true;
      loops.forEach((l) => l.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 0 → 1: flies off up-right; 2 → 3: comes back in from below-left
  const dx = shoot.interpolate({ inputRange: [0, 1, 2, 3], outputRange: [0, size * 0.45, -size * 0.35, 0] });
  const op = shoot.interpolate({ inputRange: [0, 0.7, 1, 2, 2.4, 3], outputRange: [1, 0.6, 0, 0, 1, 1] });
  const layer = { position: 'absolute' as const, left: 0, top: 0 };

  return (
    <Animated.View
      accessible
      accessibilityLabel="Tijar"
      style={{
        width: size,
        height: h,
        transform: [{ perspective: 300 }, { rotateY: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }],
      }}>
      <View style={layer}>
        <MarkPart part="stem" size={size} />
      </View>
      <Animated.View style={[layer, { transform: [{ rotate: sway.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-6deg'] }) }, { translateY: sway.interpolate({ inputRange: [0, 1], outputRange: [0, -1] }) }] }]}>
        <MarkPart part="leaf" size={size} />
      </Animated.View>
      <Animated.View style={[layer, { opacity: op, transform: [{ translateX: dx }, { translateY: Animated.multiply(dx, -1) }] }]}>
        <MarkPart part="arrow" size={size} />
      </Animated.View>
    </Animated.View>
  );
}

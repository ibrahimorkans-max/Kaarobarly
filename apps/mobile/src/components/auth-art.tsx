import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useId, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View, type TextInputProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { tr } from '@/lib/i18n';

/** The friendly illustration style of the sign-in pages: soft mint, Tijar green accent, a waving character. */
export const AUTH = {
  bg: '#EEF7F4',
  card: '#FFFFFF',
  accent: '#0F8A6F',
  accentDark: '#0B6F59',
  accentSoft: '#D8F1E8',
  text: '#132430',
  sub: '#6E7F88',
  border: '#D7E8E3',
  input: '#FFFFFF',
  danger: '#D92D20',
  success: '#12A15E',
};

export type Pose = 'wave' | 'star' | 'mail' | 'key';

/** A cheerful person drawn in SVG, with confetti around; the pose changes per page. */
export function AuthArt({ pose = 'wave', size = 240 }: { pose?: Pose; size?: number }) {
  const skin = '#F7C9A6';
  const hair = '#2A2238';
  const shirt = '#19B892';
  // gradient ids must be unique: several pages can be mounted at once
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const ball = `ball${uid}`;
  const blob = `blob${uid}`;
  return (
    <Svg width={size * (320 / 230)} height={size} viewBox="0 0 320 230">
      <Defs>
        <LinearGradient id={ball} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#B69CFF" />
          <Stop offset="1" stopColor="#6E4BF2" />
        </LinearGradient>
        <LinearGradient id={blob} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#D6F2E8" />
          <Stop offset="1" stopColor="#ECF8F4" />
        </LinearGradient>
      </Defs>
      {/* soft backdrop */}
      <Ellipse cx="160" cy="128" rx="118" ry="96" fill={`url(#${blob})`} />
      {/* confetti */}
      <Circle cx="62" cy="58" r="11" stroke="#F2A33A" strokeWidth="5" fill="none" />
      <Path d="M246 52 q8 -10 16 0 t16 0 t16 0" stroke="#5B7CFA" strokeWidth="5" fill="none" strokeLinecap="round" />
      <Path d="M40 140 q10 -16 22 -6 q-6 14 -22 6z" fill="#46B37A" />
      <Path d="M270 180 l8 -14 l8 14z" fill="#19B892" />
      <Circle cx="266" cy="128" r="15" fill={`url(#${ball})`} />
      <Circle cx="92" cy="30" r="4" fill="#5B7CFA" />
      <Circle cx="240" cy="96" r="3.5" fill="#F2A33A" />
      <Circle cx="70" cy="190" r="4" fill="#B69CFF" />
      <Rect x="226" y="20" width="8" height="8" rx="2" fill="#19B892" transform="rotate(20 230 24)" />

      {/* body */}
      <Path d="M100 230 C100 170 118 148 160 148 C202 148 220 170 220 230 Z" fill={shirt} />
      <Path d="M146 146 h28 v12 a14 14 0 0 1 -28 0z" fill={skin} />
      {/* left arm (down, or holding something) */}
      {pose === 'mail' || pose === 'key' ? <Path d="M112 176 C96 186 96 200 112 206" stroke={skin} strokeWidth="15" strokeLinecap="round" fill="none" /> : <Path d="M112 172 C100 196 104 214 112 228" stroke={skin} strokeWidth="15" strokeLinecap="round" fill="none" />}
      {/* right arm waving up, or holding */}
      {pose === 'wave' || pose === 'star' ? (
        <G>
          <Path d="M206 170 C226 150 232 120 236 96" stroke={skin} strokeWidth="15" strokeLinecap="round" fill="none" />
          <Circle cx="238" cy="88" r="12" fill={skin} />
          <Path d="M232 76 v-10 M239 74 v-12 M246 77 v-10" stroke={skin} strokeWidth="5" strokeLinecap="round" />
          <Path d="M252 70 q8 4 8 14 M256 60 q12 6 12 22" stroke="#19B892" strokeWidth="3" fill="none" strokeLinecap="round" />
        </G>
      ) : (
        <Path d="M208 176 C224 186 222 200 206 206" stroke={skin} strokeWidth="15" strokeLinecap="round" fill="none" />
      )}

      {/* head */}
      <Circle cx="160" cy="34" r="17" fill={hair} />
      <Ellipse cx="160" cy="88" rx="41" ry="44" fill={hair} />
      <Ellipse cx="160" cy="96" rx="32" ry="36" fill={skin} />
      <Path d="M126 86 C128 58 150 50 170 54 C186 57 196 70 196 86 C182 78 170 66 160 62 C152 74 140 82 126 86Z" fill={hair} />
      <Circle cx="125" cy="100" r="6" fill={skin} />
      <Circle cx="195" cy="100" r="6" fill={skin} />
      <Circle cx="147" cy="100" r="3.6" fill="#2A2238" />
      <Circle cx="173" cy="100" r="3.6" fill="#2A2238" />
      <Circle cx="148.2" cy="98.8" r="1.1" fill="#fff" />
      <Circle cx="174.2" cy="98.8" r="1.1" fill="#fff" />
      <Ellipse cx="140" cy="112" rx="6" ry="3.6" fill="#FF9F8A" opacity={0.6} />
      <Ellipse cx="180" cy="112" rx="6" ry="3.6" fill="#FF9F8A" opacity={0.6} />
      <Path d="M150 116 q10 10 20 0" stroke="#B5523A" strokeWidth="3" fill="#fff" strokeLinecap="round" />

      {/* what they hold */}
      {pose === 'mail' && (
        <G>
          <Rect x="132" y="178" width="58" height="40" rx="6" fill="#fff" stroke="#0F8A6F" strokeWidth="3" />
          <Path d="M134 182 l27 20 l27 -20" stroke="#0F8A6F" strokeWidth="3" fill="none" strokeLinejoin="round" />
          <Circle cx="190" cy="180" r="9" fill="#12A15E" />
          <Path d="M186 180 l3 3 l5 -6" stroke="#fff" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        </G>
      )}
      {pose === 'key' && (
        <G>
          <Circle cx="146" cy="196" r="13" fill="none" stroke="#F2A33A" strokeWidth="6" />
          <Path d="M158 196 h34 M182 196 v9 M190 196 v7" stroke="#F2A33A" strokeWidth="6" strokeLinecap="round" />
        </G>
      )}
      {pose === 'star' && <Path d="M86 92 l6 12 l13 2 l-9 9 l2 13 l-12 -6 l-12 6 l2 -13 l-9 -9 l13 -2z" fill="#FFC23D" stroke="#F2A33A" strokeWidth="2" strokeLinejoin="round" />}
    </Svg>
  );
}

/** Page frame for the sign-in pages: back button, illustration, title, then the form. */
export function AuthShell({ pose, title, subtitle, children, back = true, footer }: { pose: Pose; title: string; subtitle?: string; children: ReactNode; back?: boolean; footer?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: AUTH.bg }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingTop: insets.top + 6, paddingBottom: insets.bottom + 24, paddingHorizontal: 22, alignItems: 'center' }}>
        <View style={{ width: '100%', maxWidth: 460 }}>
          <View style={{ height: 40, justifyContent: 'center' }}>
            {back && (
              <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/login'))} hitSlop={12} style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="arrow-back" size={24} color={AUTH.text} />
              </Pressable>
            )}
          </View>
          <View style={{ alignItems: 'center' }}>
            <AuthArt pose={pose} size={196} />
          </View>
          <Text style={{ fontSize: 26, fontWeight: '800', color: AUTH.text, textAlign: 'center', marginTop: 6 }}>{tr(title)}</Text>
          {!!subtitle && <Text style={{ fontSize: 14.5, color: AUTH.sub, textAlign: 'center', marginTop: 6, lineHeight: 20 }}>{tr(subtitle)}</Text>}
          <View style={{ gap: 12, marginTop: 22 }}>{children}</View>
          {footer && <View style={{ marginTop: 22, alignItems: 'center' }}>{footer}</View>}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** A rounded input with an icon, as in the illustration style. Password fields get a show/hide eye. */
export function AuthField({ icon, label, password, error, ...rest }: TextInputProps & { icon: keyof typeof Ionicons.glyphMap; label: string; password?: boolean; error?: string }) {
  const [focus, setFocus] = useState(false);
  const [show, setShow] = useState(false);
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: AUTH.input, borderRadius: 14, borderWidth: 1.5, borderColor: error ? AUTH.danger : focus ? AUTH.accent : AUTH.border, paddingHorizontal: 14, minHeight: 54, boxShadow: '0 2px 10px rgba(15,42,59,0.06)' } as any}>
        <Ionicons name={icon} size={20} color={focus ? AUTH.accent : '#6E9A8E'} />
        <TextInput
          accessibilityLabel={label}
          placeholder={tr(label)}
          placeholderTextColor="#B3A7A0"
          secureTextEntry={password && !show}
          onFocus={(e) => (setFocus(true), rest.onFocus?.(e))}
          onBlur={(e) => (setFocus(false), rest.onBlur?.(e))}
          style={{ flex: 1, fontSize: 15.5, color: AUTH.text, paddingVertical: 14, outlineStyle: 'none' } as any}
          {...rest}
        />
        {password && (
          <Pressable accessibilityRole="button" accessibilityLabel={show ? 'Hide password' : 'Show password'} onPress={() => setShow(!show)} hitSlop={10}>
            <Ionicons name={show ? 'eye-off-outline' : 'eye-outline'} size={20} color="#B3A7A0" />
          </Pressable>
        )}
      </View>
      {!!error && <Text style={{ color: AUTH.danger, fontSize: 12.5, marginTop: 4, marginLeft: 4 }}>{error}</Text>}
    </View>
  );
}

export function AuthButton({ title, onPress, loading, disabled, kind = 'primary' }: { title: string; onPress: () => void; loading?: boolean; disabled?: boolean; kind?: 'primary' | 'ghost' }) {
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => ({ height: 54, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: kind === 'primary' ? (pressed ? AUTH.accentDark : AUTH.accent) : 'transparent', opacity: off ? 0.6 : 1, boxShadow: kind === 'primary' ? '0 8px 18px rgba(15,138,111,0.3)' : undefined }) as any}>
      <Text style={{ color: kind === 'primary' ? '#fff' : AUTH.accent, fontSize: 16, fontWeight: '800' }}>{loading ? tr('Please wait…') : tr(title)}</Text>
    </Pressable>
  );
}

/** "or continue with" and round option buttons (WhatsApp code, email code). */
export function AuthAlternatives({ items }: { items: { icon: keyof typeof Ionicons.glyphMap; color: string; label: string; onPress: () => void }[] }) {
  if (!items.length) return null;
  return (
    <View style={{ gap: 14, marginTop: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1, height: 1, backgroundColor: AUTH.border }} />
        <Text style={{ color: AUTH.sub, fontSize: 13 }}>{tr('or continue with')}</Text>
        <View style={{ flex: 1, height: 1, backgroundColor: AUTH.border }} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 14 }}>
        {items.map((i) => (
          <Pressable key={i.label} accessibilityRole="button" accessibilityLabel={i.label} onPress={i.onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, height: 50, borderRadius: 14, backgroundColor: '#fff', borderWidth: 1, borderColor: AUTH.border, opacity: pressed ? 0.7 : 1, boxShadow: '0 4px 12px rgba(232,98,26,0.08)' }) as any}>
            <Ionicons name={i.icon} size={22} color={i.color} />
            <Text style={{ color: AUTH.text, fontWeight: '700' }}>{tr(i.label)}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/** Six boxes for a one-time code; typing goes into one hidden input. */
export function CodeBoxes({ value, onChange, onDone }: { value: string; onChange: (v: string) => void; onDone?: (v: string) => void }) {
  const [focus, setFocus] = useState(false);
  return (
    <View>
      <TextInput
        accessibilityLabel="6-digit code"
        value={value}
        onChangeText={(t) => {
          const v = t.replace(/\D/g, '').slice(0, 6);
          onChange(v);
          if (v.length === 6) onDone?.(v);
        }}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={6}
        autoFocus
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={{ position: 'absolute', opacity: 0.02, width: '100%', height: 60, zIndex: 2 } as any}
      />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }} pointerEvents="none">
        {Array.from({ length: 6 }, (_, i) => {
          const active = focus && i === Math.min(value.length, 5);
          return (
            <View key={i} style={{ flex: 1, maxWidth: 54, height: 60, borderRadius: 14, backgroundColor: '#fff', borderWidth: 1.5, borderColor: active ? AUTH.accent : value[i] ? '#8FD8C3' : AUTH.border, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 24, fontWeight: '800', color: AUTH.text }}>{value[i] ?? ''}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

export function AuthLink({ text, link, onPress }: { text: string; link: string; onPress: () => void }) {
  return (
    <Text style={{ color: AUTH.sub, fontSize: 14 }}>
      {tr(text)}{' '}
      <Text accessibilityRole="link" onPress={onPress} style={{ color: AUTH.accent, fontWeight: '800' }}>
        {tr(link)}
      </Text>
    </Text>
  );
}

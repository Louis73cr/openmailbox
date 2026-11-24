// Web stand-in for expo-glass-effect: Liquid Glass approximated with CSS backdrop blur.
import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

export const isLiquidGlassAvailable = () => true;
export const isGlassEffectAPIAvailable = () => true;

interface Props {
  style?: StyleProp<ViewStyle>;
  colorScheme?: 'light' | 'dark' | 'auto';
  tintColor?: string;
  children?: ReactNode;
}

export function GlassView({ style, colorScheme, tintColor, children }: Props) {
  const dark = colorScheme === 'dark' || (colorScheme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  const glass = {
    backgroundColor: tintColor ?? (dark ? 'rgba(44,44,46,0.55)' : 'rgba(255,255,255,0.6)'),
    backdropFilter: 'blur(18px) saturate(180%)',
    WebkitBackdropFilter: 'blur(18px) saturate(180%)',
    boxShadow: dark
      ? 'inset 0 0 0 0.5px rgba(255,255,255,0.18), 0 4px 16px rgba(0,0,0,0.35)'
      : 'inset 0 0 0 0.5px rgba(255,255,255,0.9), 0 0 0 0.5px rgba(0,0,0,0.08), 0 4px 16px rgba(0,0,0,0.08)',
  } as ViewStyle;
  return <View style={[style, glass]}>{children}</View>;
}

export const GlassContainer = View;

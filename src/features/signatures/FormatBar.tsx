import { Fragment, memo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { GlassView } from 'expo-glass-effect';
import { useTheme } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ALargeSmall, Baseline, Bold, Highlighter, Italic, Link, RemoveFormatting, Strikethrough, Underline, type LucideIcon } from 'lucide-react-native';

import { LIQUID_GLASS } from '@/ui/nativeChrome';

export type EditorState = { bold: boolean; italic: boolean; underline: boolean; strike: boolean; link: string | null; empty: boolean };

export const INITIAL_EDITOR_STATE: EditorState = { bold: false, italic: false, underline: false, strike: false, link: null, empty: true };

type Tool = { key: string; label: string; icon: LucideIcon; active?: boolean; onPress: () => void };

interface Props {
  state: EditorState;
  onCommand: (command: string) => void;
  onLink: () => void;
  onSize: () => void;
  onColor: (kind: 'text' | 'highlight') => void;
}

function FormatBarImpl({ state, onCommand, onLink, onSize, onColor }: Props) {
  const { t } = useTranslation();
  const { colors, dark } = useTheme();

  const groups: Tool[][] = [
    [{ key: 'size', label: t('signature.textSize'), icon: ALargeSmall, onPress: onSize }],
    [
      { key: 'bold', label: t('signature.bold'), icon: Bold, active: state.bold, onPress: () => onCommand('bold') },
      { key: 'italic', label: t('signature.italic'), icon: Italic, active: state.italic, onPress: () => onCommand('italic') },
      { key: 'underline', label: t('signature.underline'), icon: Underline, active: state.underline, onPress: () => onCommand('underline') },
      { key: 'strike', label: t('signature.strikethrough'), icon: Strikethrough, active: state.strike, onPress: () => onCommand('strikeThrough') },
      { key: 'link', label: t('signature.link'), icon: Link, active: state.link !== null, onPress: onLink },
    ],
    [
      { key: 'color', label: t('signature.textColor'), icon: Baseline, onPress: () => onColor('text') },
      { key: 'highlight', label: t('signature.highlight'), icon: Highlighter, onPress: () => onColor('highlight') },
      { key: 'clear', label: t('signature.clearFormatting'), icon: RemoveFormatting, onPress: () => onCommand('removeFormat') },
    ],
  ];

  return (
    <View style={styles.wrap}>
      <View style={[styles.pill, LIQUID_GLASS ? null : [styles.raised, { backgroundColor: colors.card, borderColor: colors.border }]]}>
        {LIQUID_GLASS ? (
          <GlassView key={dark ? 'dark' : 'light'} glassEffectStyle="regular" colorScheme={dark ? 'dark' : 'light'} style={[StyleSheet.absoluteFill, styles.glass]} />
        ) : null}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={styles.row}>
          {groups.map((tools, index) => (
            <Fragment key={tools[0].key}>
              {index > 0 ? <View style={[styles.divider, { backgroundColor: colors.border }]} /> : null}
              {tools.map(({ key, label, icon: Icon, active = false, onPress }) => (
                <Pressable
                  key={key}
                  accessibilityRole="button"
                  accessibilityLabel={label}
                  accessibilityState={{ selected: active }}
                  onPress={onPress}
                  hitSlop={4}
                  style={({ pressed }) => [styles.tool, pressed ? styles.pressed : null]}
                >
                  {active ? <View style={[StyleSheet.absoluteFill, styles.active, { backgroundColor: colors.primary }]} /> : null}
                  <Icon size={20} color={active ? colors.primary : colors.text} strokeWidth={active ? 2.4 : 2} />
                </Pressable>
              ))}
            </Fragment>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

export const FormatBar = memo(FormatBarImpl);

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 12, paddingBottom: 8, paddingTop: 4 },
  pill: { borderRadius: 26 },
  raised: {
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  glass: { borderRadius: 26 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingVertical: 5, gap: 2 },
  tool: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  active: { opacity: 0.16, borderRadius: 21 },
  pressed: { opacity: 0.55 },
  divider: { width: StyleSheet.hairlineWidth, height: 22, marginHorizontal: 6 },
});

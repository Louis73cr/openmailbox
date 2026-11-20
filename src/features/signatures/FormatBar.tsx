import { Fragment, memo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { GlassView } from 'expo-glass-effect';
import { useTheme } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ALargeSmall, Baseline, Bold, Highlighter, Italic, Link, List, ListOrdered, RemoveFormatting, Strikethrough, Underline, type LucideIcon } from 'lucide-react-native';

import { LIQUID_GLASS } from '@/ui/nativeChrome';

export type EditorState = { bold: boolean; italic: boolean; underline: boolean; strike: boolean; ul: boolean; ol: boolean; link: string | null };

export const INITIAL_EDITOR_STATE: EditorState = { bold: false, italic: false, underline: false, strike: false, ul: false, ol: false, link: null };

export const sameState = (a: EditorState, b: EditorState) =>
  (Object.keys(a) as (keyof EditorState)[]).every((key) => a[key] === b[key]);

type Tool = { key: string; label: string; icon: LucideIcon; active?: boolean; onPress: () => void };

interface Props {
  state: EditorState;
  compact?: boolean;
  onCommand: (command: string) => void;
  onLink: () => void;
  onSize: () => void;
  onColor: (kind: 'text' | 'highlight') => void;
}

function FormatBarImpl({ state, compact = false, onCommand, onLink, onSize, onColor }: Props) {
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
    ...(compact
      ? [
          [
            { key: 'ul', label: t('signature.bulletList'), icon: List, active: state.ul, onPress: () => onCommand('insertUnorderedList') },
            { key: 'ol', label: t('signature.numberedList'), icon: ListOrdered, active: state.ol, onPress: () => onCommand('insertOrderedList') },
          ],
        ]
      : []),
    [
      { key: 'color', label: t('signature.textColor'), icon: Baseline, onPress: () => onColor('text') },
      { key: 'highlight', label: t('signature.highlight'), icon: Highlighter, onPress: () => onColor('highlight') },
      { key: 'clear', label: t('signature.clearFormatting'), icon: RemoveFormatting, onPress: () => onCommand('removeFormat') },
    ],
  ];

  return (
    <View style={compact ? styles.compactWrap : styles.wrap}>
      <View
        style={[
          styles.pill,
          compact ? styles.compactPill : null,
          LIQUID_GLASS ? null : compact ? [styles.outlined, { borderColor: colors.border, backgroundColor: colors.background }] : [styles.raised, { backgroundColor: colors.card, borderColor: colors.border }],
        ]}
      >
        {LIQUID_GLASS ? (
          <GlassView key={dark ? 'dark' : 'light'} glassEffectStyle="regular" colorScheme={dark ? 'dark' : 'light'} style={[StyleSheet.absoluteFill, compact ? styles.compactPill : styles.glass]} />
        ) : null}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={[styles.row, compact ? styles.compactRow : null]}>
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
                  style={({ pressed }) => [styles.tool, compact ? styles.compactTool : null, pressed ? styles.pressed : null]}
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
  compactWrap: { flex: 1, justifyContent: 'center', paddingLeft: 8, paddingRight: 12 },
  compactPill: { height: 40, borderRadius: 20, justifyContent: 'center' },
  outlined: { borderWidth: 1.5 },
  compactRow: { paddingVertical: 0, paddingHorizontal: 4 },
  compactTool: { width: 36, height: 36, borderRadius: 18 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingVertical: 5, gap: 2 },
  tool: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  active: { opacity: 0.16, borderRadius: 21 },
  pressed: { opacity: 0.55 },
  divider: { width: StyleSheet.hairlineWidth, height: 22, marginHorizontal: 6 },
});

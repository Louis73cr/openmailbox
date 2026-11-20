import { memo, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useTheme } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Type, X } from 'lucide-react-native';

import { FormatBar, type EditorState } from '@/features/signatures/FormatBar';
import { IconButton } from '@/ui/components';
import { LIQUID_GLASS } from '@/ui/nativeChrome';

const SPRING = { damping: 18, stiffness: 230, mass: 0.9 };
export const FORMAT_BAR_HEIGHT = 52;

interface Props {
  visible: boolean;
  expanded: boolean;
  onToggle: () => void;
  state: EditorState;
  onCommand: (command: string) => void;
  onLink: () => void;
  onSize: () => void;
  onColor: (kind: 'text' | 'highlight') => void;
}

function KeyboardFormatBarImpl({ visible, expanded, onToggle, state, onCommand, onLink, onSize, onColor }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const progress = useSharedValue(0);
  const shown = useSharedValue(visible ? 1 : 0);

  useEffect(() => {
    progress.value = withSpring(expanded ? 1 : 0, SPRING);
  }, [expanded, progress]);

  useEffect(() => {
    shown.value = withTiming(visible ? 1 : 0, { duration: 150 });
  }, [visible, shown]);

  const fade = useAnimatedStyle(() => ({ opacity: shown.value }));
  const reveal = useAnimatedStyle(() => ({ opacity: progress.value, transform: [{ translateX: (1 - progress.value) * -16 }] }));

  return (
    <Animated.View
      testID="format-bar"
      pointerEvents={visible ? 'box-none' : 'none'}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
      style={[styles.row, fade]}
    >
      <View style={LIQUID_GLASS ? null : [styles.outlined, { borderColor: colors.border, backgroundColor: colors.background }]}>
        <IconButton
          round
          glass
          size={LIQUID_GLASS ? 40 : 37}
          variant={LIQUID_GLASS ? 'ghost' : 'plain'}
          accessibilityLabel={expanded ? t('compose.hideFormatting') : t('compose.formatting')}
          onPress={onToggle}
        >
          {expanded ? <X size={20} color={colors.text} /> : <Type size={20} color={colors.text} />}
        </IconButton>
      </View>
      {expanded ? (
        <Animated.View style={[styles.tools, reveal]}>
          <FormatBar compact state={state} onCommand={onCommand} onLink={onLink} onSize={onSize} onColor={onColor} />
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

export const KeyboardFormatBar = memo(KeyboardFormatBarImpl);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', height: FORMAT_BAR_HEIGHT, paddingLeft: 12 },
  outlined: { borderWidth: 1.5, borderRadius: 20 },
  tools: { flex: 1 },
});

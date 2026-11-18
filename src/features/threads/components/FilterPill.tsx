import { Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ListFilter } from 'lucide-react-native';

import { Typography } from '@/ui/components';
import { haptic } from '@/utils/haptics';

const TOGGLE_SIZE = 44;
const BARE_TOGGLE_SIZE = 38;
const LABEL_GAP = 10;
const LABEL_END_PADDING = 12;
const CHEVRON_WIDTH = 16;
// ponytail: estimated caption glyph width; the native toolbar needs a fixed width up front. Measure the text if locales overflow.
const CAPTION_CHARACTER_WIDTH = 7.8;

export function barePillWidth(filteredBy: string, summary: string): number {
  const label = Math.max(filteredBy.length, summary.length + CHEVRON_WIDTH / CAPTION_CHARACTER_WIDTH) * CAPTION_CHARACTER_WIDTH;
  return Math.min(BARE_TOGGLE_SIZE + LABEL_GAP + label + LABEL_END_PADDING, 220);
}

interface FilterPillProps {
  enabled: boolean;
  summary: string;
  onToggle: () => void;
  onOpen: () => void;
  bare?: boolean;
}

export function FilterPill({ enabled, summary, onToggle, onOpen, bare = false }: FilterPillProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const filteredBy = t('threads.filters.filteredBy');
  const toggleSize = bare ? BARE_TOGGLE_SIZE : TOGGLE_SIZE;

  return (
    <View
      style={[
        styles.pill,
        bare
          ? { width: enabled ? barePillWidth(filteredBy, summary) : BARE_TOGGLE_SIZE, height: BARE_TOGGLE_SIZE, padding: 0 }
          : [styles.raised, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }],
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('threads.filters.toggle')}
        accessibilityState={{ selected: enabled }}
        onPress={() => {
          haptic();
          onToggle();
        }}
        style={[
          styles.toggle,
          { width: toggleSize, height: toggleSize, borderRadius: toggleSize / 2, backgroundColor: enabled ? colors.primary : 'transparent' },
        ]}
      >
        <ListFilter size={bare ? 20 : 22} color={enabled ? colors.background : colors.text} />
      </Pressable>
      {enabled ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`${filteredBy} ${summary}`} onPress={onOpen} style={styles.summary}>
          <Typography variant="caption" weight="600" numberOfLines={1}>
            {filteredBy}
          </Typography>
          <View style={styles.criteria}>
            <Typography variant="caption" weight="600" color={colors.primary} numberOfLines={1} style={styles.criteriaText}>
              {summary}
            </Typography>
            <ChevronDown size={14} color={colors.primary} />
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', borderRadius: 25, padding: 3, gap: LABEL_GAP, maxWidth: 220 },
  raised: {
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  toggle: { alignItems: 'center', justifyContent: 'center' },
  summary: { flexShrink: 1, paddingRight: LABEL_END_PADDING },
  criteria: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  criteriaText: { flexShrink: 1 },
});

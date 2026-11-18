import { Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ListFilter } from 'lucide-react-native';

import { Typography } from '@/ui/components';
import { haptic } from '@/utils/haptics';

const BARE_SIZE = 50;
const BARE_ENABLED_WIDTH = 180;

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

  return (
    <View
      style={[
        styles.pill,
        bare ? { width: enabled ? BARE_ENABLED_WIDTH : BARE_SIZE, height: BARE_SIZE } : [styles.raised, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }],
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
        style={[styles.toggle, { backgroundColor: enabled ? colors.primary : 'transparent' }]}
      >
        <ListFilter size={22} color={enabled ? colors.background : colors.primary} />
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
  pill: { flexDirection: 'row', alignItems: 'center', borderRadius: 25, padding: 3, gap: 10, maxWidth: 220 },
  raised: {
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  toggle: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  summary: { flexShrink: 1, paddingRight: 14 },
  criteria: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  criteriaText: { flexShrink: 1 },
});

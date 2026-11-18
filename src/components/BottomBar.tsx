import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useTheme } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Search, SquarePen } from 'lucide-react-native';

import { useSettingsStore } from '@/stores/settingsStore';
import { IconButton, Typography } from '@/ui/components';

const SIZE = 50;
const ICON_SIZE = 18;
const BORDER_WIDTH = 1.5;
const SPRING = { damping: 18, stiffness: 230, mass: 0.9 };

interface BottomBarProps {
  composeAccountId?: string;
  left?: React.ReactNode;
  collapseSearch?: boolean;
}

export function BottomBar({ composeAccountId, left, collapseSearch = false }: BottomBarProps) {
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const motion = !useSettingsStore((state) => state.reduceMotion);
  const collapsed = useSharedValue(collapseSearch ? 1 : 0);

  useEffect(() => {
    const target = collapseSearch ? 1 : 0;
    collapsed.value = motion ? withSpring(target, SPRING) : target;
  }, [collapseSearch, motion, collapsed]);

  const capsule = useAnimatedStyle(() => ({ width: `${Math.min(1, Math.max(0, 1 - collapsed.value)) * 100}%` }));
  const placeholder = useAnimatedStyle(() => ({ opacity: 1 - collapsed.value }));

  return (
    <View pointerEvents="box-none" style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      {left}
      <View pointerEvents="box-none" style={styles.slot}>
        <Animated.View style={[styles.search, { backgroundColor: colors.surface, borderColor: colors.border }, capsule]}>
          <Pressable
            accessibilityRole="search"
            accessibilityLabel={t('search.placeholder')}
            onPress={() => router.push('/search')}
            style={styles.searchContent}
          >
            <Search size={ICON_SIZE} color={colors.textSecondary} />
            <Animated.View style={placeholder}>
              <Typography color="secondary" numberOfLines={1}>
                {t('search.placeholder')}
              </Typography>
            </Animated.View>
          </Pressable>
        </Animated.View>
      </View>
      <IconButton
        round
        glass
        size={SIZE}
        accessibilityLabel={t('compose.newMessage')}
        onPress={() => router.push({ pathname: '/compose', params: composeAccountId ? { accountId: composeAccountId } : {} })}
      >
        <SquarePen size={22} color={colors.primary} />
      </IconButton>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16 },
  slot: { flexGrow: 1, width: 0, alignItems: 'flex-end' },
  search: {
    minWidth: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    borderWidth: BORDER_WIDTH,
  },
  searchContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: (SIZE - ICON_SIZE) / 2 - BORDER_WIDTH,
    borderRadius: SIZE / 2,
    overflow: 'hidden',
  },
});

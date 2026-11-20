import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Pressable } from 'react-native-gesture-handler';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Typography } from '@/ui/components';

const LINES = 3;
const TIMING = { duration: 260, easing: Easing.out(Easing.cubic) };

export function SubjectTitle({ subject }: { subject: string }) {
  const [open, setOpen] = useState(false);
  const clamped = useSharedValue(0);
  const full = useSharedValue(0);
  const progress = useSharedValue(0);

  const clip = useAnimatedStyle(() =>
    clamped.value > 0 && full.value > clamped.value
      ? { height: clamped.value + (full.value - clamped.value) * progress.value }
      : {},
  );

  const toggle = () => {
    if (full.value <= clamped.value) return;
    if (open) {
      progress.value = withTiming(0, TIMING, (finished) => {
        if (finished) scheduleOnRN(setOpen, false);
      });
    } else {
      setOpen(true);
      progress.value = withTiming(1, TIMING);
    }
  };

  return (
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={toggle}>
      <Animated.View style={[styles.clip, clip]}>
        <View style={styles.hidden} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Typography variant="h4" numberOfLines={LINES} onLayout={(event) => (clamped.value = event.nativeEvent.layout.height)}>
            {subject}
          </Typography>
        </View>
        <Typography variant="h4" numberOfLines={open ? undefined : LINES} style={styles.overlay}>
          {subject}
        </Typography>
      </Animated.View>
      <View style={[styles.hidden, styles.overlay]} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Typography variant="h4" onLayout={(event) => (full.value = event.nativeEvent.layout.height)}>
          {subject}
        </Typography>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  hidden: { opacity: 0 },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0 },
});

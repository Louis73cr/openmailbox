import { useEffect, useId, useState } from 'react';
import { BackHandler, Keyboard, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useTheme } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { GlassView } from 'expo-glass-effect';
import { Check, X } from 'lucide-react-native';

import { Button, IconButton, Stack, TextField, Typography } from '@/ui/components';
import { LIQUID_GLASS } from '@/ui/nativeChrome';

interface Props {
  link: string | null;
  accessoryId?: string;
  onClose: () => void;
  onSave: (url: string) => void;
  onRemove: () => void;
}

function linkTarget(value: string): string {
  const target = value.trim().replace(/"/g, '%22').replace(/\s/g, '%20').replace(/</g, '%3C').replace(/>/g, '%3E');
  return !target || /^[a-z][a-z0-9+.-]*:/i.test(target) ? target : `https://${target}`;
}

export function LinkPrompt({ link, accessoryId, onClose, onSave, onRemove }: Props) {
  const { t } = useTranslation();
  const { colors, dark } = useTheme();
  const mountId = useId();
  const [url, setUrl] = useState(link ?? '');
  const [keyboard, setKeyboard] = useState(() => Keyboard.metrics()?.height ?? 0);

  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', ({ endCoordinates }) => setKeyboard(endCoordinates.height));
    const hidden = Keyboard.addListener('keyboardDidHide', () => setKeyboard(0));
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => {
      shown.remove();
      hidden.remove();
      back.remove();
    };
  }, [onClose]);

  const save = () => {
    onClose();
    const target = linkTarget(url);
    if (target) onSave(target);
  };

  return (
    <Animated.View
      entering={FadeIn.duration(150)}
      exiting={FadeOut.duration(150)}
      style={[StyleSheet.absoluteFill, styles.backdrop, { paddingBottom: keyboard + 16 }]}
    >
      <Pressable accessibilityLabel={t('common.cancel')} onPress={onClose} style={StyleSheet.absoluteFill} />
      <View style={styles.card}>
        <Stack card={!LIQUID_GLASS} gap={14} padding={18} radius={LIQUID_GLASS ? 26 : 0} hAlign="center">
          {LIQUID_GLASS ? (
            <GlassView
              key={dark ? 'dark' : 'light'}
              glassEffectStyle="regular"
              colorScheme={dark ? 'dark' : 'light'}
              style={[StyleSheet.absoluteFill, styles.glass]}
            />
          ) : null}
          <View style={styles.header}>
            <IconButton round glass size={40} accessibilityLabel={t('common.cancel')} onPress={onClose}>
              <X size={20} color={colors.text} />
            </IconButton>
            <Typography variant="title">{t('signature.link')}</Typography>
            <IconButton round glass size={40} accessibilityLabel={t('common.ok')} disabled={!url.trim()} onPress={save}>
              <Check size={20} color={colors.primary} />
            </IconButton>
          </View>
          <TextField
            testID="link-url"
            value={url}
            onChangeText={setUrl}
            placeholder={t('signature.linkPlaceholder')}
            accessibilityLabel={t('signature.link')}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="done"
            inputAccessoryViewID={accessoryId && `${accessoryId}.${mountId}`}
            autoFocus
            onSubmitEditing={save}
          />
          {link !== null ? (
            <Button variant="link" size="small" color="danger" title={t('signature.removeLink')} onPress={() => (onClose(), onRemove())} />
          ) : null}
        </Stack>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  backdrop: { justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: 'rgba(0,0,0,0.3)' },
  card: { width: '84%', maxWidth: 340 },
  glass: { borderRadius: 26 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', alignSelf: 'stretch' },
});

import { Alert, Linking } from 'react-native';
import type { TFunction } from 'i18next';

export function confirmOpenLink(url: string, t: TFunction): void {
  let target = url;
  try {
    target = new URL(url).host || url;
  } catch {}
  Alert.alert(t('reader.openLinkTitle'), target, [
    { text: t('common.cancel'), style: 'cancel' },
    { text: t('reader.openLink'), onPress: () => Linking.openURL(url).catch(() => undefined) },
  ]);
}

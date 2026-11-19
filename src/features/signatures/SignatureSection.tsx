import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter, useTheme } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Plus } from 'lucide-react-native';

import { HtmlBody } from '@/features/reader/components/HtmlBody';
import { isBlankSignature, type Signature } from '@/stores/settingsStore';
import { FormSection, ListRow } from '@/ui/components';

import { useSignatureEditor } from './signatureEditorStore';

interface Props {
  value: Signature;
  footer: string;
  onChange: (signature: Signature) => void;
}

export function SignatureSection({ value, footer, onChange }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const open = useSignatureEditor((state) => state.open);

  const edit = () => {
    open(value, onChange);
    router.push('/signature');
  };

  return (
    <FormSection title={t('accounts.signature')} footer={footer}>
      {isBlankSignature(value) ? (
        <ListRow title={t('accounts.addSignature')} leading={<Plus size={20} color={colors.primary} />} chevron={false} onPress={edit} />
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('accounts.editSignature')}
          onPress={edit}
          style={({ pressed }) => [styles.preview, pressed && styles.pressed]}
        >
          <View pointerEvents="none" style={styles.body}>
            <HtmlBody html={value.html} allowRemoteContent />
          </View>
          <ChevronRight size={18} color={colors.textTertiary} />
        </Pressable>
      )}
    </FormSection>
  );
}

const styles = StyleSheet.create({
  preview: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingLeft: 14, paddingRight: 16, gap: 8 },
  pressed: { opacity: 0.6 },
  body: { flex: 1 },
});

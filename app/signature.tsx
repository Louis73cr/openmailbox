import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { Alert, KeyboardAvoidingView, Pressable, StyleSheet, View } from 'react-native';
import WebView, { type WebViewMessageEvent } from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useTheme } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Check, CodeXml, X } from 'lucide-react-native';

import { EDITOR_SCRIPT, editorDocument } from '@/features/signatures/editorScript';
import { FormatBar, INITIAL_EDITOR_STATE, type EditorState } from '@/features/signatures/FormatBar';
import { useSignatureEditor } from '@/features/signatures/signatureEditorStore';
import { darkTheme, lightTheme } from '@/theme';
import { ActionList, Button, Dialog, IconButton, ScreenHeader, Sheet, TextField, Typography, ViewContainer } from '@/ui/components';
import { NATIVE_CHROME } from '@/ui/nativeChrome';
import { goBack } from '@/utils/navigation';

const MAX_BYTES = 32 * 1024;
const SIZES = [
  { key: 'small', px: 13 },
  { key: 'normal', px: 15 },
  { key: 'large', px: 18 },
  { key: 'title', px: 22 },
] as const;
const PALETTES = {
  text: [
    ['black', '#1a1a1a'],
    ['grey', '#6b7280'],
    ['red', '#dc2626'],
    ['orange', '#ea580c'],
    ['yellow', '#ca8a04'],
    ['green', '#16a34a'],
    ['blue', '#2563eb'],
    ['purple', '#7c3aed'],
  ],
  highlight: [
    ['yellow', '#fef08a'],
    ['green', '#bbf7d0'],
    ['blue', '#bfdbfe'],
    ['purple', '#e9d5ff'],
    ['pink', '#fbcfe8'],
    ['orange', '#fed7aa'],
    ['red', '#fecaca'],
    ['grey', '#e5e7eb'],
  ],
} as const;

type Panel = 'size' | 'text' | 'highlight' | null;

const sameState = (a: EditorState, b: EditorState) =>
  a.bold === b.bold && a.italic === b.italic && a.underline === b.underline && a.strike === b.strike && a.link === b.link && a.empty === b.empty;

export default function SignatureScreen() {
  const { t } = useTranslation();
  const { colors, dark } = useTheme();
  const value = useSignatureEditor((state) => state.value);
  const onDone = useSignatureEditor((state) => state.onDone);
  const webView = useRef<ComponentRef<typeof WebView>>(null);
  const openedDark = useRef(dark).current;
  const [editorState, setEditorState] = useState(INITIAL_EDITOR_STATE);
  const [codeMode, setCodeMode] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [linking, setLinking] = useState(false);
  const [url, setUrl] = useState('');
  const source = useMemo(
    () => ({ html: editorDocument(value.html, { dark: openedDark, light: lightTheme.colors, darkColors: darkTheme.colors, placeholder: t('signature.placeholder'), codePlaceholder: t('signature.codePlaceholder') }) }),
    [value.html, openedDark, t],
  );

  useEffect(() => {
    webView.current?.injectJavaScript(`document.documentElement.classList.toggle('dark', ${dark}); true;`);
  }, [dark]);

  const inject = (code: string) => webView.current?.injectJavaScript(`${code}; true;`);
  const run = useCallback(
    (command: string, argument?: string | number) =>
      webView.current?.injectJavaScript(`window.editor.run(${JSON.stringify(command)}, ${JSON.stringify(argument ?? null)}); true;`),
    [],
  );
  const finish = () => inject('window.editor.finish()');

  const toggleCode = () => {
    const next = !codeMode;
    inject(`window.editor.setMode(${JSON.stringify(next ? 'code' : 'rich')})`);
    setCodeMode(next);
  };

  const onMessage = (event: WebViewMessageEvent) => {
    let message: Partial<EditorState> & { type?: string; html?: string; text?: string };
    try {
      message = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (message.type === 'state') {
      const next: EditorState = {
        bold: message.bold === true,
        italic: message.italic === true,
        underline: message.underline === true,
        strike: message.strike === true,
        link: typeof message.link === 'string' ? message.link : null,
        empty: message.empty === true,
      };
      setEditorState((current) => (sameState(current, next) ? current : next));
      return;
    }
    if (message.type !== 'done' || typeof message.html !== 'string' || typeof message.text !== 'string') return;
    if (new TextEncoder().encode(message.html).length > MAX_BYTES) {
      Alert.alert(t('signature.tooLarge'));
      return;
    }
    onDone?.({ html: message.html, text: message.text });
    goBack();
  };

  const onShouldStartLoadWithRequest = (request: ShouldStartLoadRequest) =>
    request.url === 'about:blank' || request.url.startsWith('data:');

  const openLink = useCallback(() => {
    setUrl(editorState.link ?? '');
    setLinking(true);
  }, [editorState.link]);
  const openSize = useCallback(() => setPanel('size'), []);
  const openColor = useCallback((kind: 'text' | 'highlight') => setPanel(kind), []);

  const saveLink = () => {
    const target = url.trim();
    setLinking(false);
    if (target) run('createLink', /^[a-z][a-z0-9+.-]*:/i.test(target) ? target : `https://${target}`);
  };
  const removeLink = () => {
    setLinking(false);
    run('unlink');
  };
  const choose = (command: string, argument: string | number) => {
    setPanel(null);
    run(command, argument);
  };

  return (
    <ViewContainer>
      <SafeAreaView edges={NATIVE_CHROME ? ['bottom'] : ['top', 'bottom']} style={styles.flex}>
        {NATIVE_CHROME ? null : (
          <ScreenHeader
            title={t('accounts.signature')}
            left={
              <IconButton round glass size={40} accessibilityLabel={t('common.cancel')} onPress={goBack}>
                <X size={20} color={colors.text} />
              </IconButton>
            }
            right={
              <View style={styles.headerActions}>
                <IconButton round glass size={40} accessibilityLabel="HTML" accessibilityState={{ selected: codeMode }} onPress={toggleCode}>
                  <CodeXml size={20} color={codeMode ? colors.primary : colors.text} />
                </IconButton>
                <IconButton round size={40} variant="filled" accessibilityLabel={t('common.done')} onPress={finish}>
                  <Check size={20} color={colors.primary} />
                </IconButton>
              </View>
            }
          />
        )}
        <KeyboardAvoidingView style={styles.flex} behavior="padding">
          <WebView
            ref={webView}
            source={source}
            originWhitelist={['*']}
            injectedJavaScript={EDITOR_SCRIPT}
            onMessage={onMessage}
            onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
            hideKeyboardAccessoryView
            keyboardDisplayRequiresUserAction={false}
            allowFileAccess={false}
            allowsLinkPreview={false}
            javaScriptCanOpenWindowsAutomatically={false}
            setSupportMultipleWindows={false}
            style={[styles.flex, { backgroundColor: colors.background }]}
          />
          {codeMode ? null : <FormatBar state={editorState} onCommand={run} onLink={openLink} onSize={openSize} onColor={openColor} />}
        </KeyboardAvoidingView>
      </SafeAreaView>

      <Sheet visible={panel === 'size'} onClose={() => setPanel(null)} title={t('signature.textSize')}>
        <ActionList actions={SIZES.map(({ key, px }) => ({ key, title: t(`signature.sizes.${key}`), onPress: () => choose('size', px) }))} />
      </Sheet>
      <Sheet
        visible={panel === 'text' || panel === 'highlight'}
        onClose={() => setPanel(null)}
        title={panel === 'highlight' ? t('signature.highlight') : t('signature.textColor')}
      >
        <View style={styles.swatches}>
          {(panel === 'highlight' ? PALETTES.highlight : PALETTES.text).map(([name, color]) => (
            <Pressable
              key={name}
              accessibilityRole="button"
              accessibilityLabel={t(`signature.colors.${name}`)}
              onPress={() => choose(panel === 'highlight' ? 'hiliteColor' : 'foreColor', color)}
              style={({ pressed }) => [styles.swatch, { backgroundColor: color, borderColor: colors.textTertiary }, pressed ? styles.pressed : null]}
            />
          ))}
        </View>
      </Sheet>

      <Dialog visible={linking} onClose={() => setLinking(false)}>
        <Typography variant="h3">{t('signature.link')}</Typography>
        <TextField
          value={url}
          onChangeText={setUrl}
          placeholder={t('signature.linkPlaceholder')}
          accessibilityLabel={t('signature.link')}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          autoFocus
          onSubmitEditing={saveLink}
          style={styles.field}
        />
        <View style={styles.actions}>
          {editorState.link !== null ? <Button variant="link" color="danger" title={t('signature.removeLink')} onPress={removeLink} /> : null}
          <View style={styles.flex} />
          <Button variant="link" title={t('common.cancel')} onPress={() => setLinking(false)} />
          <Button variant="link" title={t('common.ok')} disabled={!url.trim()} onPress={saveLink} />
        </View>
      </Dialog>

      {NATIVE_CHROME ? (
        <>
          <Stack.Toolbar placement="left">
            <Stack.Toolbar.Button icon="xmark" accessibilityLabel={t('common.cancel')} onPress={goBack} />
          </Stack.Toolbar>
          <Stack.Toolbar placement="right">
            <Stack.Toolbar.Button
              icon="chevron.left.forwardslash.chevron.right"
              variant={codeMode ? 'prominent' : undefined}
              accessibilityLabel="HTML"
              onPress={toggleCode}
            />
            <Stack.Toolbar.Button icon="checkmark" variant="prominent" accessibilityLabel={t('common.done')} onPress={finish} />
          </Stack.Toolbar>
        </>
      ) : null}
    </ViewContainer>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  field: { alignSelf: 'stretch' },
  actions: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', gap: 8 },
  swatches: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 20 },
  swatch: { width: 36, height: 36, borderRadius: 18, borderWidth: 1 },
  pressed: { opacity: 0.6 },
});

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { Alert, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';
import WebView, { type WebViewMessageEvent } from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useTheme } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Check, CodeXml, X } from 'lucide-react-native';

import { EDITOR_SCRIPT, editorDocument } from '@/features/signatures/editorScript';
import { FormatBar, INITIAL_EDITOR_STATE, sameState, type EditorState } from '@/features/signatures/FormatBar';
import { FormatSheets, type FormatPanel } from '@/features/signatures/FormatSheets';
import { useSignatureEditor } from '@/features/signatures/signatureEditorStore';
import { darkTheme, lightTheme } from '@/theme';
import { IconButton, ScreenHeader, ViewContainer } from '@/ui/components';
import { NATIVE_CHROME } from '@/ui/nativeChrome';
import { goBack } from '@/utils/navigation';

const MAX_BYTES = 32 * 1024;

export default function SignatureScreen() {
  const { t } = useTranslation();
  const { colors, dark } = useTheme();
  const value = useSignatureEditor((state) => state.value);
  const onDone = useSignatureEditor((state) => state.onDone);
  const webView = useRef<ComponentRef<typeof WebView>>(null);
  const openedDark = useRef(dark).current;
  const [editorState, setEditorState] = useState(INITIAL_EDITOR_STATE);
  const [codeMode, setCodeMode] = useState(false);
  const [focused, setFocused] = useState(false);
  const [panel, setPanel] = useState<FormatPanel>(null);
  const ios = Platform.OS === 'ios';
  const bottomInset = useSafeAreaInsets().bottom;
  const keyboard = useAnimatedKeyboard();
  const lift = useAnimatedStyle(() => ({ transform: [{ translateY: -Math.max(0, keyboard.height.value - bottomInset) }] }));
  const barShown = !codeMode && (focused || (panel !== null && panel !== 'link'));
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
    let message: Partial<EditorState> & { type?: string; html?: string; text?: string; focused?: boolean };
    try {
      message = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (message.type === 'focus') {
      setFocused(message.focused === true);
      return;
    }
    if (message.type === 'state') {
      const next: EditorState = {
        bold: message.bold === true,
        italic: message.italic === true,
        underline: message.underline === true,
        strike: message.strike === true,
        ul: false,
        ol: false,
        link: typeof message.link === 'string' ? message.link : null,
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

  const openLink = useCallback(() => setPanel('link'), []);
  const openSize = useCallback(() => setPanel('size'), []);
  const openColor = useCallback((kind: 'text' | 'highlight') => setPanel(kind), []);

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
        <KeyboardAvoidingView style={styles.flex} behavior="padding" enabled={!ios}>
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
          {barShown ? (
            <Animated.View style={ios ? [styles.floating, lift] : null}>
              <FormatBar state={editorState} onCommand={run} onLink={openLink} onSize={openSize} onColor={openColor} />
            </Animated.View>
          ) : null}
        </KeyboardAvoidingView>
      </SafeAreaView>

      <FormatSheets
        panel={panel}
        link={editorState.link}
        onClose={() => setPanel(null)}
        onSize={(px) => run('size', px)}
        onColor={(kind, hex) => run(kind === 'highlight' ? 'hiliteColor' : 'foreColor', hex)}
        onSaveLink={(url) => run('createLink', url)}
        onRemoveLink={() => run('unlink')}
      />

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
  floating: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});

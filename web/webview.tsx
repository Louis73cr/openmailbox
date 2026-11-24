// Web stand-in for react-native-webview (subset used by the signature editor): a scripted iframe
// with an opaque origin; ReactNativeWebView.postMessage and injectJavaScript go through postMessage.
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

export type WebViewMessageEvent = { nativeEvent: { data: string } };

interface Props {
  source: { html?: string; uri?: string };
  injectedJavaScript?: string;
  onMessage?: (event: WebViewMessageEvent) => void;
  style?: StyleProp<ViewStyle>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- other WebView props are ignored on web
  [key: string]: any;
}

export interface WebViewHandle {
  injectJavaScript(code: string): void;
}

const bridge = (injected: string) => `<script>
window.ReactNativeWebView = { postMessage: function (data) { parent.postMessage({ omwWebView: true, data: String(data) }, '*'); } };
addEventListener('message', function (event) {
  if (event.source === parent && event.data && typeof event.data.omwInject === 'string') (0, eval)(event.data.omwInject);
});
addEventListener('DOMContentLoaded', function () { (0, eval)(${JSON.stringify(injected)}); });
</script>`;

const WebView = forwardRef<WebViewHandle, Props>(function WebView({ source, injectedJavaScript = '', onMessage, style }, ref) {
  const frame = useRef<HTMLIFrameElement>(null);
  const srcDoc = useMemo(() => {
    // Native injected scripts bypass the page CSP; here they are inline scripts, so let them run
    // (the iframe stays sandboxed with an opaque origin).
    const html = (source.html ?? '').replace(
      /(<meta[^>]+Content-Security-Policy[^>]+content=")([^"]*)"/i,
      (_match: string, start: string, policy: string) =>
        `${start}${policy.replace(/script-src[^;]*;?/i, '')}; script-src 'unsafe-inline' 'unsafe-eval'"`,
    );
    const script = bridge(injectedJavaScript);
    return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (head: string) => head + script) : script + html;
  }, [source.html, injectedJavaScript]);

  useImperativeHandle(ref, () => ({
    injectJavaScript: (code: string) => frame.current?.contentWindow?.postMessage({ omwInject: code }, '*'),
  }));

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.source === frame.current?.contentWindow && event.data?.omwWebView) onMessage?.({ nativeEvent: { data: event.data.data } });
    };
    addEventListener('message', listener);
    return () => removeEventListener('message', listener);
  }, [onMessage]);

  return (
    <View style={style}>
      <iframe ref={frame} srcDoc={srcDoc} sandbox="allow-scripts" style={{ border: 0, width: '100%', height: '100%' }} />
    </View>
  );
});

export default WebView;

import { memo, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from 'expo-router';

import { ADAPT_COLOR, documentFor, PAGE } from '../readerPage';

type AdaptColor = (color: string, background: boolean) => string | null;
const adaptColor = new Function(`${ADAPT_COLOR}; return adaptColor;`)() as AdaptColor;

/** Same recoloring as the phone (HtmlBody.tsx darken()), run from the parent on the sandboxed document. */
function darken(document: Document) {
  const view = document.defaultView;
  if (!view) return;
  const changes: [HTMLElement, string, string | null][] = [];
  document.querySelectorAll<HTMLElement>('body, body *').forEach((element) => {
    const style = view.getComputedStyle(element);
    changes.push([element, 'color', adaptColor(style.color, false)]);
    changes.push([element, 'background-color', adaptColor(style.backgroundColor, true)]);
    for (const side of ['top', 'right', 'bottom', 'left']) {
      if (parseFloat(style.getPropertyValue(`border-${side}-width`))) {
        changes.push([element, `border-${side}-color`, adaptColor(style.getPropertyValue(`border-${side}-color`), true)]);
      }
    }
  });
  for (const [element, property, value] of changes) if (value) element.style.setProperty(property, value, 'important');
}

const INITIAL_HEIGHT = 120;

/** Like the phone's refetch of broken images: sites that refuse hotlinking still answer the server. */
function retryThroughProxy(document: Document) {
  const retry = (image: HTMLImageElement) => {
    if (image.dataset.proxied || !/^https:/i.test(image.src)) return;
    image.dataset.proxied = '1';
    image.src = `/api/image?url=${encodeURIComponent(image.src)}`;
  };
  for (const image of Array.from(document.images)) {
    if (image.complete && image.naturalWidth === 0) retry(image);
    else image.addEventListener('error', () => retry(image));
  }
}

interface HtmlBodyProps {
  html: string;
  allowRemoteContent: boolean;
  background?: string;
}

// Web: a sandboxed iframe (no scripts) replaces the WebView; the parent measures it and opens links.
function HtmlBodyImpl({ html, allowRemoteContent, background }: HtmlBodyProps) {
  const { dark } = useTheme();
  const base = dark ? PAGE.dark : PAGE.light;
  const page = useMemo(() => (background ? { ...base, background } : base), [base, background]);
  const [height, setHeight] = useState(INITIAL_HEIGHT);
  const frame = useRef<HTMLIFrameElement>(null);
  // 'self' lets broken remote images fall back to the server's image proxy (see retryThroughProxy).
  const srcDoc = useMemo(
    () => documentFor(html, allowRemoteContent, page).replace('img-src data: https: http:', "img-src data: https: http: 'self'"),
    [html, allowRemoteContent, page],
  );

  const onLoad = () => {
    const document = frame.current?.contentDocument;
    if (!document) return;
    if (dark) darken(document);
    if (allowRemoteContent) retryThroughProxy(document);
    const measure = () => setHeight(Math.max(INITIAL_HEIGHT, Math.ceil(document.documentElement.scrollHeight)));
    measure();
    new ResizeObserver(measure).observe(document.documentElement);
    document.addEventListener('click', (event) => {
      const link = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!link) return;
      event.preventDefault();
      if (/^(https?|mailto):/i.test(link.href)) window.open(link.href, '_blank', 'noopener,noreferrer');
    });
  };

  return (
    <View style={[styles.container, { height, backgroundColor: page.background }]}>
      <iframe
        ref={frame}
        srcDoc={srcDoc}
        sandbox="allow-same-origin"
        referrerPolicy="no-referrer"
        onLoad={onLoad}
        style={{ border: 0, width: '100%', height: '100%', background: page.background }}
      />
    </View>
  );
}

export const HtmlBody = memo(HtmlBodyImpl);

const styles = StyleSheet.create({
  container: { width: '100%', borderRadius: 10, overflow: 'hidden' },
});

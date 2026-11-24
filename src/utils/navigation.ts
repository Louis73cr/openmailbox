import { router } from 'expo-router';

let splitBack: (() => boolean) | null = null;

/** The split layout closes the open pane instead of walking the browser history. */
export function setSplitBack(back: (() => boolean) | null): void {
  splitBack = back;
}

export function goBack(): void {
  if (splitBack?.()) return;
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

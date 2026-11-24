import { router } from 'expo-router';

let splitBack: (() => void) | null = null;

/** The split layout closes the open pane instead of walking the browser history. */
export function setSplitBack(back: (() => void) | null): void {
  splitBack = back;
}

export function goBack(): void {
  if (splitBack) splitBack();
  else if (router.canGoBack()) router.back();
  else router.replace('/');
}

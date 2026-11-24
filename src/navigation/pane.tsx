import { createContext, useContext, type ComponentType } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

type Params = Record<string, string | undefined>;

/** Set when a screen is rendered as a pane of the wide (desktop web) split layout. */
export const PaneContext = createContext<{ params: Params; selectedThreadId?: string } | null>(null);
/** The routed copy of a screen renders nothing while the split layout shows it as a pane. */
export const SplitHiddenContext = createContext(false);

export const SPLIT_MIN_WIDTH = 1000;

export function useSplitLayout(): boolean {
  return Platform.OS === 'web' && useWindowDimensions().width >= SPLIT_MIN_WIDTH;
}

export function usePaneParams<T extends Params>(): T {
  const pane = useContext(PaneContext);
  const local = useLocalSearchParams();
  return (pane?.params ?? local) as T;
}

export const useInPane = () => useContext(PaneContext) !== null;
export const useSelectedThreadId = () => useContext(PaneContext)?.selectedThreadId;

export function routeScreen(Screen: ComponentType): ComponentType {
  return function RouteScreen() {
    return useContext(SplitHiddenContext) ? null : <Screen />;
  };
}

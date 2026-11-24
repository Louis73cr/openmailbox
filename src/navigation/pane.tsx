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

export interface PaneThread {
  threadId: string;
  mailboxId: string;
}

let paneThreads: PaneThread[] = [];
/** The thread list shown in the middle pane, in display order (keyboard navigation). */
export const setPaneThreads = (threads: PaneThread[]) => {
  paneThreads = threads;
};
export const getPaneThreads = () => paneThreads;

export type ThreadCommand = 'delete' | 'archive' | 'reply' | 'replyAll' | 'forward' | 'flag' | 'markUnread' | 'move';

let threadCommands: ((command: ThreadCommand) => void) | null = null;
/** Registered by the open thread pane so keyboard shortcuts act on it. */
export const setThreadCommands = (run: ((command: ThreadCommand) => void) | null) => {
  threadCommands = run;
};
export const runThreadCommand = (command: ThreadCommand) => threadCommands?.(command);

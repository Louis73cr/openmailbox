import { memo, useMemo, type RefObject } from 'react';
import { StyleSheet } from 'react-native';
import { useTheme } from 'expo-router';
import { EnrichedTextInput, type EnrichedTextInputInstance, type OnChangeStateEvent, type OnLinkDetected } from 'react-native-enriched-html';

import type { EditorState } from '@/features/signatures/FormatBar';

interface RichBodyProps {
  ref: RefObject<EnrichedTextInputInstance | null>;
  nativeID?: string;
  placeholder: string;
  onFocusChange: (focused: boolean) => void;
  onTextChange: (text: string) => void;
  onStateChange: (state: EditorState) => void;
  onSelectionChange: (selection: { start: number; end: number; text: string }) => void;
  onLinkDetected: (link: OnLinkDetected) => void;
}

function RichBodyImpl({ ref, nativeID, placeholder, onFocusChange, onTextChange, onStateChange, onSelectionChange, onLinkDetected }: RichBodyProps) {
  const { colors } = useTheme();
  const htmlStyle = useMemo(
    () => ({ ul: { bulletColor: colors.text }, ol: { markerColor: colors.text }, a: { color: colors.primary }, blockquote: { borderColor: colors.border } }),
    [colors],
  );

  const toState = (state: OnChangeStateEvent): EditorState => ({
    bold: state.bold.isActive,
    italic: state.italic.isActive,
    underline: state.underline.isActive,
    strike: state.strikeThrough.isActive,
    ul: state.unorderedList.isActive,
    ol: state.orderedList.isActive,
    link: state.link.isActive ? '' : null,
  });

  return (
    <EnrichedTextInput
      ref={ref}
      testID="rich-body"
      nativeID={nativeID}
      scrollEnabled={false}
      useHtmlNormalizer
      linkRegex={null}
      placeholder={placeholder}
      placeholderTextColor={colors.textTertiary}
      cursorColor={colors.primary}
      selectionColor={colors.primary}
      htmlStyle={htmlStyle}
      onFocus={() => onFocusChange(true)}
      onBlur={() => onFocusChange(false)}
      onChangeText={(event) => onTextChange(event.nativeEvent.value)}
      onChangeState={(event) => onStateChange(toState(event.nativeEvent))}
      onChangeSelection={(event) => onSelectionChange(event.nativeEvent)}
      onLinkDetected={onLinkDetected}
      style={{ ...styles.body, color: colors.text }}
    />
  );
}

export const RichBody = memo(RichBodyImpl);

const styles = StyleSheet.create({
  body: { fontSize: 16, lineHeight: 22, minHeight: 160, paddingTop: 16 },
});

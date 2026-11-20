import { create } from 'zustand';

import type { Signature } from '@/stores/settingsStore';

interface SignatureEditorState {
  value: Signature;
  onDone: ((signature: Signature) => void) | null;
  open: (value: Signature, onDone: (signature: Signature) => void) => void;
}

export const useSignatureEditor = create<SignatureEditorState>()((set) => ({
  value: { html: '', text: '' },
  onDone: null,
  open: (value, onDone) => set({ value, onDone }),
}));

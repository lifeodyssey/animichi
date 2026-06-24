"use client";

import { createContext, useContext } from "react";

export interface SuggestContextValue {
  onSuggest: (text: string) => void;
}

const defaultValue: SuggestContextValue = {
  onSuggest: () => {
    // Default no-op: overridden by the provider.
  },
};

export const SuggestContext = createContext<SuggestContextValue>(defaultValue);

export function useSuggest(): (text: string) => void {
  return useContext(SuggestContext).onSuggest;
}

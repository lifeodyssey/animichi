"use client";

import { createContext, useContext } from "react";

export interface PointSelectionContextValue {
  selectedIds: Set<string>;
  toggle: (id: string) => void;
  clear: () => void;
}

const defaultValue: PointSelectionContextValue = {
  selectedIds: new Set<string>(),
  toggle: () => {
    // Default no-op: overridden by the provider.
  },
  clear: () => {
    // Default no-op: overridden by the provider.
  },
};

export const PointSelectionContext =
  createContext<PointSelectionContextValue>(defaultValue);

export function usePointSelectionContext(): PointSelectionContextValue {
  return useContext(PointSelectionContext);
}

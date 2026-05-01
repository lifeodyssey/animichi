"use client";

import { useState } from "react";
import { Drawer } from "vaul";
import type { RuntimeResponse } from "@/lib/types";
import { Skeleton } from "@/components/ui/skeleton";
import GenerativeUIRenderer from "../generative/GenerativeUIRenderer";
import { usePointSelectionContext } from "../../contexts/PointSelectionContext";
import { useSuggest } from "../../contexts/SuggestContext";
import SelectionBar from "../generative/SelectionBar";

interface ResultSheetProps {
  response: RuntimeResponse | null;
  open: boolean;
  onClose: () => void;
  onRouteSelected?: (origin: string) => void;
  defaultOrigin?: string;
  loading?: boolean;
}

export default function ResultSheet({
  response,
  open,
  onClose,
  onRouteSelected,
  defaultOrigin,
  loading,
}: ResultSheetProps) {
  const { selectedIds, clear } = usePointSelectionContext();
  const onSuggest = useSuggest();
  const [snap, setSnap] = useState<number | string | null>(0.4);

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(o) => !o && onClose()}
      snapPoints={[0.4, 0.9]}
      activeSnapPoint={snap}
      setActiveSnapPoint={setSnap}
    >
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Drawer.Content
          className="fixed bottom-0 left-0 right-0 z-50 flex max-h-[90vh] flex-col rounded-t-2xl bg-card border-t border-border"
          aria-label="Result panel"
          role="region"
        >
          <Drawer.Handle
            data-drag-handle
            className="mx-auto mt-3 mb-2 h-1 w-9 shrink-0 rounded-full bg-muted-foreground opacity-40"
          />

          {selectedIds.size > 0 && (
            <SelectionBar
              count={selectedIds.size}
              defaultOrigin={defaultOrigin ?? ""}
              onRoute={(origin) => onRouteSelected?.(origin)}
              onClear={clear}
              disabled={loading}
            />
          )}

          <div className="flex-1 overflow-y-auto min-h-0 p-4">
            {response ? (
              <GenerativeUIRenderer response={response} onSuggest={onSuggest} />
            ) : loading ? (
              <div className="flex flex-col gap-4">
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-48 w-full" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ) : null}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

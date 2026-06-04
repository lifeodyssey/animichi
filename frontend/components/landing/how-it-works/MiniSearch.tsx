import { Search } from "lucide-react";

/** Evocative (non-functional) search-row preview for the "search" step. */
export default function MiniSearch() {
  return (
    <div className="flex items-center gap-2 rounded-[50px] border border-border bg-background px-3 py-2 shadow-3d-sm">
      <Search size={13} className="text-primary" aria-hidden="true" />
      <span className="text-[12px] text-muted-foreground">君の名は。</span>
    </div>
  );
}

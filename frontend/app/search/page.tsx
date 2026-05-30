import { Suspense } from "react";
import SearchContent from "./SearchContent";
import { Skeleton } from "../../components/ui/skeleton";

function SearchSkeleton() {
  return (
    <div className="min-h-screen bg-background font-sans">
      <div className="h-16 border-b border-border bg-background" />
      <div className="mx-auto max-w-[960px] px-5 py-10 sm:px-8 sm:py-16">
        <Skeleton className="mb-8 h-4 w-24" />
        <Skeleton className="mb-4 h-10 w-64" />
        <div className="flex flex-col gap-3">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<SearchSkeleton />}>
      <SearchContent />
    </Suspense>
  );
}

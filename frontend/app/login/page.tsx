import { Suspense } from "react";
import LoginContent from "./LoginContent";
import { Skeleton } from "../../components/ui/skeleton";

function LoginSkeleton() {
  return (
    <div className="bg-gradient-soft flex min-h-[100svh] flex-col">
      <div className="h-16 border-b border-border bg-background" />
      <div className="flex flex-1 flex-col items-center justify-center px-4 pb-16">
        <div className="w-full max-w-[380px]">
          <Skeleton className="mb-6 mx-auto h-6 w-48" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginSkeleton />}>
      <LoginContent />
    </Suspense>
  );
}

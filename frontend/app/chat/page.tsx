import { Suspense } from "react";
import ChatContent from "./ChatContent";

export default function ChatPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <ChatContent />
    </Suspense>
  );
}

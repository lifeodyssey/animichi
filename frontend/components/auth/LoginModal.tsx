"use client";

import LoginForm from "./LoginForm";

interface LoginModalProps {
  redirect: string;
  onClose: () => void;
}

/**
 * Lightweight modal wrapper around LoginForm.
 * Used on Guide page for in-context login without leaving the page.
 */
export default function LoginModal({ redirect, onClose }: LoginModalProps) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-label="Login"
        className="entrance-up-quick relative mx-4 w-full max-w-[420px] rounded-xl bg-background p-8 shadow-2xl"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 min-h-[44px] min-w-[44px] text-muted-foreground hover:text-foreground"
          aria-label="Close"
        >
          ✕
        </button>
        <LoginForm redirect={redirect} />
      </div>
    </div>
  );
}

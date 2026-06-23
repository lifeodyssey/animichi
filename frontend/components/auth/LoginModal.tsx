"use client";

import { useEffect } from "react";

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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); };
  }, [onClose]);

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-overlay-soft backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
    >
      <div
        role="dialog"
        aria-label="Login"
        className="entrance-up-quick relative mx-4 w-full max-w-[420px] rounded-lg bg-card p-8 shadow-popup"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 flex h-[44px] w-[44px] items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
          aria-label="Close"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M3 3l10 10M13 3L3 13" />
          </svg>
        </button>
        <LoginForm redirect={redirect} />
      </div>
    </div>
  );
}

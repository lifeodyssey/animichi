"use client";

import type { ConversationRecord } from "@/lib/types";
import { getConversationDisplayTitle } from "../../lib/conversation-history";
import { relativeTime } from "../../lib/time-utils";
import { useDict } from "../../lib/i18n-context";
import { RecentRouteCard } from "@/components/generative/RecentRouteCard";
import { cn } from "@/lib/utils";

/** Route-related keywords used to select card style vs plain item. */
const ROUTE_KEYWORDS = /route|ルート|路线|plan|計画|计划/i;

// ---------------------------------------------------------------------------
// SafeConversationCard — renders a single record; falls back gracefully
// ---------------------------------------------------------------------------

interface SafeConversationCardProps {
  record: ConversationRecord;
  isActive: boolean;
  onSelect: () => void;
}

export function SafeConversationCard({
  record,
  isActive,
  onSelect,
}: SafeConversationCardProps) {
  const displayTitle = getConversationDisplayTitle(record);
  const isRoute = ROUTE_KEYWORDS.test(record.first_query);
  const updatedWhen = relativeTime(record.updated_at) || "-";

  if (isRoute) {
    return (
      <div
        data-testid={`conversation-item-${record.session_id}`}
        data-active={isActive || undefined}
        className="mb-2"
      >
        <RecentRouteCard
          title={displayTitle}
          locations={[]}
          spotCount={0}
          updatedWhen={updatedWhen}
          onClick={onSelect}
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      data-testid={`conversation-item-${record.session_id}`}
      data-active={isActive || undefined}
      onClick={onSelect}
      className={cn(
        "mb-0.5 flex w-full items-start gap-2 rounded-lg px-3 py-2.5 text-left",
        "cursor-pointer transition",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1",
        isActive ? "bg-primary text-primary-foreground" : "hover:bg-muted",
      )}
    >
      <span className="mt-0.5 shrink-0 text-sm leading-none" aria-hidden="true">
        {"\u{1F5FE}"}
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "truncate text-xs font-medium",
            isActive ? "text-primary-foreground" : "text-foreground",
          )}
        >
          {displayTitle.length > 25 ? displayTitle.slice(0, 25) + "…" : displayTitle}
        </p>
        {updatedWhen && (
          <p
            className={cn(
              "mt-0.5 text-xs opacity-60",
              isActive ? "text-primary-foreground" : "text-muted-foreground",
            )}
          >
            {updatedWhen}
          </p>
        )}
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// EmptyConversations
// ---------------------------------------------------------------------------

export function EmptyConversations() {
  const { drawer: t } = useDict();
  return (
    <div
      data-testid="conversation-drawer-empty"
      className="flex flex-col items-center justify-center h-32 gap-2 text-muted-foreground"
    >
      <span className="text-2xl" aria-hidden="true">{"\u{1F5FE}"}</span>
      <p className="text-xs text-center">{t.empty}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ConversationList
// ---------------------------------------------------------------------------

interface ConversationListProps {
  conversations: ConversationRecord[];
  activeSessionId: string | null;
  onSelectConversation: (sessionId: string) => void;
  onItemClick?: () => void;
}

export function ConversationList({
  conversations,
  activeSessionId,
  onSelectConversation,
  onItemClick,
}: ConversationListProps) {
  const { drawer: t } = useDict();
  const valid = conversations.filter((r) => Boolean(r.session_id));
  if (valid.length === 0) return <EmptyConversations />;

  return (
    <>
      <p className="pb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground opacity-60">
        {t.recent}
      </p>
      {valid.map((record) => (
        <SafeConversationCard
          key={record.session_id}
          record={record}
          isActive={record.session_id === activeSessionId}
          onSelect={() => {
            onSelectConversation(record.session_id);
            onItemClick?.();
          }}
        />
      ))}
    </>
  );
}

// Legacy compat shim — kept for any consumers that imported ConversationItem before D4
export { SafeConversationCard as ConversationItem };

import { LayoutDashboard, MessageSquare, Settings } from "lucide-react";
import { t } from "../../lib/i18n";
import { useKeptList } from "../../shared/react/use-presence";
import { MOTION_MS } from "../../shared/ui/dom/motion";
import { Swap } from "../../shared/ui/primitives";
import type { LayoutMode } from "../layout";
export type TabId = "sessions" | "board" | "settings";

const markKey = () => "mark";

/**
 * A tab's mark, while it has one: the item is what it says (the waiting count;
 * the update dot says nothing). One that turns up under a bar already on screen
 * is marked as entering; a bar that mounts with its marks draws them still, and
 * a mark that goes is gone at once. The rail's foot marks Settings the same way.
 */
export function useTabMark<Mark>(mark: Mark | undefined) {
  const kept = useKeptList(mark === undefined ? [] : [mark], markKey, MOTION_MS.press).at(0);
  return kept && !kept.leaving ? kept : undefined;
}

export const tabMarkClass = (base: string, mark: { entering: boolean }) => `${base}${mark.entering ? " pop-in" : ""}`;

export function TabBarView({ mode, count = 0, update = false, onSwitch = () => {} }: {
  mode: LayoutMode; count?: number; update?: boolean; onSwitch?: (tab: TabId) => void;
}) {
  const active: TabId = mode === "board" ? "board" : mode === "settings" ? "settings" : "sessions";
  const locked = mode === "boot" || mode === "pick";
  const badge = useTabMark(count > 0 ? count : undefined);
  const dot = useTabMark(update ? true : undefined);
  const tabs: Array<{ id: TabId; label: string; icon: typeof MessageSquare; badge?: typeof badge; dot?: typeof dot; aria?: string }> = [
    { id: "sessions", label: t("tabs.sessions"), icon: MessageSquare, badge,
      aria: count > 0 ? t("tabs.attentionAria", { count: String(count) }) : undefined },
    { id: "board", label: t("tabs.board"), icon: LayoutDashboard },
    { id: "settings", label: t("tabs.settings"), icon: Settings, dot,
      aria: update ? t("tabs.updateAria") : undefined },
  ];
  return (
    <nav className="tab-bar" aria-label={t("tabs.aria")}>
      {tabs.map(({ id, label, icon: Icon, badge, dot, aria }) => (
        <button
          key={id}
          type="button"
          className={`tab-bar-item${active === id ? " on" : ""}`}
          aria-current={active === id ? "page" : undefined}
          disabled={locked && id !== "sessions"}
          onClick={() => { if (!locked) onSwitch(id); }}
        >
          <span className="tab-bar-icon">
            <Icon size={22} aria-hidden="true" />
            {badge ? (
              <span className={tabMarkClass("tab-bar-badge", badge)} aria-hidden="true"><Swap on={badge.item}>{badge.item}</Swap></span>
            ) : null}
            {dot ? <span className={tabMarkClass("tab-bar-dot", dot)} aria-hidden="true" /> : null}
          </span>
          <span className="tab-bar-label">{label}</span>
          {aria ? <span className="sr-only">{aria}</span> : null}
        </button>
      ))}
    </nav>
  );
}

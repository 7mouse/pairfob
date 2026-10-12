import { LayoutDashboard, MessageSquare, Settings } from "lucide-react";
import { t } from "../../lib/i18n";
import type { LayoutMode } from "../layout";
export type TabId = "sessions" | "board" | "settings";

export function TabBarView({ mode, count = 0, update = false, onSwitch = () => {} }: {
  mode: LayoutMode; count?: number; update?: boolean; onSwitch?: (tab: TabId) => void;
}) {
  const active: TabId = mode === "board" ? "board" : mode === "settings" ? "settings" : "sessions";
  const locked = mode === "boot" || mode === "pick";
  const tabs: Array<{ id: TabId; label: string; icon: typeof MessageSquare; badge?: string; dot?: boolean; aria?: string }> = [
    { id: "sessions", label: t("tabs.sessions"), icon: MessageSquare,
      badge: count > 0 ? String(count) : undefined,
      aria: count > 0 ? t("tabs.attentionAria", { count: String(count) }) : undefined },
    { id: "board", label: t("tabs.board"), icon: LayoutDashboard },
    { id: "settings", label: t("tabs.settings"), icon: Settings, dot: update,
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
            {badge ? <span className="tab-bar-badge" aria-hidden="true">{badge}</span> : null}
            {dot ? <span className="tab-bar-dot" aria-hidden="true" /> : null}
          </span>
          <span className="tab-bar-label">{label}</span>
          {aria ? <span className="sr-only">{aria}</span> : null}
        </button>
      ))}
    </nav>
  );
}

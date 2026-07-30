import { Landmark, CircleDollarSign, ShieldCheck, Unlock } from "lucide-react";

const ICONS = {
  deposit: Landmark,
  withdraw: Unlock,
  borrow: CircleDollarSign,
  repay: ShieldCheck,
};

const LABELS = {
  deposit: "Deposit",
  withdraw: "Withdraw",
  borrow: "Borrow",
  repay: "Repay",
};

const ICON_STROKE = 1.75;

function fmtAmount(wei) {
  if (!wei || wei === 0n) return "0 ETH";
  const num = Number(wei) / 1e18;
  const s = num >= 1
    ? num.toLocaleString(undefined, { maximumFractionDigits: 4 })
    : num.toFixed(4);
  return `${s} ETH`;
}

function timeAgo(ts) {
  if (!ts) return "";
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function ActivityFeed({ c, events, loading }) {
  return (
    <div className="fade-up" style={{ animationDelay: "300ms" }}>
      <h2 className="text-sm font-semibold mb-3" style={{ color: c.ink }}>Activity</h2>
      <div className="liquid-glass px-5 py-4" style={{ borderRadius: "28px", maxHeight: "400px", overflowY: "auto" }}>
        {!events || events.length === 0 ? (
          <p className="text-xs py-6 text-center" style={{ color: c.inkFaint }}>
            {loading ? "Loading..." : "No activity yet."}
          </p>
        ) : (
          <div className="space-y-2">
            {events.map((ev, i) => {
              const Icon = ICONS[ev.type] || Landmark;
              return (
                <div
                  key={`${ev.txHash}-${i}`}
                  className="flex items-center gap-3 px-2 py-2"
                  style={{ borderBottom: i < events.length - 1 ? `1px solid ${c.cardBorder}` : "none" }}
                >
                  <span
                    className="flex items-center justify-center w-8 h-8 rounded-full shrink-0"
                    style={{ background: c.greenSoft, color: c.green }}
                  >
                    <Icon size={14} strokeWidth={ICON_STROKE} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold" style={{ color: c.ink }}>{LABELS[ev.type] || ev.type}</div>
                    <div className="font-num text-xs" style={{ color: c.inkSoft }}>{fmtAmount(ev.assets)}</div>
                  </div>
                  <div className="text-xs shrink-0" style={{ color: c.inkFaint }}>{timeAgo(ev.timestamp)}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

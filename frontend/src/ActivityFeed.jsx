import { Landmark, CircleDollarSign, ShieldCheck, Unlock, Lock } from "lucide-react";

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

function fmtAmount(wei, unit) {
  if (!wei || wei === "0" || wei === 0) return "0 " + (unit || "ETH");
  const divisor = unit === "USDC" ? 1e6 : 1e18;
  const num = Number(wei) / divisor;
  const decimals = unit === "USDC" ? 2 : 4;
  const s = num >= 1
    ? num.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    : num.toFixed(decimals);
  return `${s} ${unit || "ETH"}`;
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
      <div className="liquid-glass px-5 py-4 no-scrollbar" style={{ borderRadius: "28px", maxHeight: "400px", overflowY: "auto" }}>
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
                    {ev.assets ? (
                      <div className="font-num text-xs" style={{ color: c.inkSoft }}>{fmtAmount(ev.assets, ev.unit)}</div>
                    ) : (
                      <div className="font-num text-xs flex items-center gap-1" style={{ color: c.inkSoft }}>
                        <Lock size={10} strokeWidth={2} />
                        Encrypted
                      </div>
                    )}
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

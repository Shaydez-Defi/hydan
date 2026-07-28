import { useState, useEffect } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { parseEther } from "viem";
import { useWriteContract, useReadContract } from "wagmi";
import {
  Moon,
  Sun,
  Github,
  Wallet,
  ShieldCheck,
  ShieldAlert,
  Landmark,
  CircleDollarSign,
  Unlock,
  CheckCircle2,
  Loader2,
  Search,
  Zap,
} from "lucide-react";
import {
  useVaultAddress,
  useVaultTotalAssets,
  useVaultHealthStatus,
  useUserWethBalance,
  useVaultAaveData,
} from "./hooks.js";
import vaultAbi from "./abi/HydanVault.json";

const WETH = "0xC558DBdd856501FCd9aaF1E62eae57A9F0629a3c";

const erc20Abi = [
  { inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], name: "approve", outputs: [{ type: "bool" }], stateMutability: "nonpayable", type: "function" },
  { inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], name: "allowance", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
];

function useGoogleFonts() {
  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@700;800&family=Pacifico&family=Bagel+Fat+One&family=Manrope:wght@400;500;600;700;800&display=swap";
    document.head.appendChild(link);
    return () => document.head.removeChild(link);
  }, []);
}

const PALETTES = {
  light: {
    bg: "#E4EADC",
    dot: "rgba(31,58,34,0.10)",
    surface: "#FAFAF6",
    surfaceGlass: "rgba(255,255,255,0.72)",
    heroCard: "#D1DCC6",
    chip: "#BECFAC",
    ink: "#1B3320",
    inkSoft: "rgba(27,51,32,0.60)",
    inkFaint: "rgba(27,51,32,0.38)",
    pill: "rgba(255,255,255,0.75)",
    ctaBg: "#17281B",
    ctaText: "#F4F7F1",
    green: "#4C8A5C",
    greenDeep: "#2E5B39",
    greenLight: "#7CBE8C",
    greenInk: "#122016",
    greenSoft: "rgba(76,138,92,0.14)",
    carmine: "#B23A30",
    carmineSoft: "rgba(178,58,48,0.12)",
    cardBorder: "rgba(27,51,32,0.08)",
    cardShadow: "0 1px 2px rgba(27,51,32,0.05), 0 14px 28px -12px rgba(27,51,32,0.16)",
    scrimBg: "rgba(20,32,22,0.32)",
    inputBg: "rgba(27,51,32,0.05)",
    glassRGB: "255,255,255",
  },
  dark: {
    bg: "#0B0F0C",
    dot: "rgba(237,241,234,0.06)",
    surface: "#161C13",
    surfaceGlass: "rgba(22,28,19,0.72)",
    heroCard: "#1D2B1F",
    chip: "#293A2C",
    ink: "#EDF1EA",
    inkSoft: "rgba(237,241,234,0.58)",
    inkFaint: "rgba(237,241,234,0.34)",
    pill: "#161C13",
    ctaBg: "#EDF1EA",
    ctaText: "#12180F",
    green: "#6FA97D",
    greenDeep: "#3F6B4C",
    greenLight: "#9BD1A7",
    greenInk: "#0D160F",
    greenSoft: "rgba(111,169,125,0.16)",
    carmine: "#D9695F",
    carmineSoft: "rgba(217,105,95,0.14)",
    cardBorder: "rgba(255,255,255,0.10)",
    cardShadow: "0 2px 4px rgba(0,0,0,0.3), 0 20px 40px -14px rgba(0,0,0,0.6)",
    scrimBg: "rgba(0,0,0,0.55)",
    inputBg: "rgba(255,255,255,0.06)",
    glassRGB: "63,107,76",
  },
};

function GlobalStyle({ c }) {
  return (
    <style>{`
      .hydan-root { --ease-out: cubic-bezier(0.23, 1, 0.32, 1); }
      html, body { overflow-x: hidden; }
      html { scrollbar-width: thin; scrollbar-color: ${c.chip} transparent; }
      html::-webkit-scrollbar { width: 8px; height: 8px; }
      html::-webkit-scrollbar-track { background: transparent; }
      html::-webkit-scrollbar-thumb { background: ${c.chip}; border-radius: 999px; }
      html::-webkit-scrollbar-thumb:hover { background: ${c.green}; }
      .font-wordmark { font-family: 'Pacifico', cursive; }
      .font-num { font-variant-numeric: tabular-nums; }
      .font-num-display { font-family: 'Bagel Fat One', cursive; font-variant-numeric: tabular-nums; }
      .press { transition: transform 150ms var(--ease-out), background-color 180ms ease, opacity 180ms ease; }
      .press:active { transform: scale(0.96); }
      .hydan-root button:focus-visible, .hydan-root a:focus-visible {
        outline: 2px solid ${c.green}; outline-offset: 2px;
      }
      .hydan-root input:focus, .hydan-root input:focus-visible { outline: none; }
      .liquid-glass {
        background: ${c.inputBg};
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        box-shadow: inset 0 1px 1px rgba(255,255,255,0.08), ${c.cardShadow};
      }
      .wordmark-solid {
        background: linear-gradient(180deg, ${c.greenLight} 0%, ${c.green} 45%, ${c.greenDeep} 100%);
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
        -webkit-text-fill-color: transparent;
      }
      .toggle-track { transition: background-color 220ms var(--ease-out); }
      .toggle-knob { transition: transform 260ms cubic-bezier(0.34, 1.56, 0.64, 1); }
      .btn-glass {
        background: rgba(${c.glassRGB},0.22);
        backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px);
        border: 1px solid rgba(${c.glassRGB},0.38);
        box-shadow: inset 0 1px 1px rgba(255,255,255,0.35), inset 0 -6px 10px -6px rgba(255,255,255,0.08), 0 10px 24px -8px rgba(0,0,0,0.30);
        transition: transform 320ms cubic-bezier(0.45, 0, 0.15, 1), box-shadow 320ms cubic-bezier(0.45, 0, 0.15, 1), background-color 280ms ease;
      }
      .btn-glass:hover {
        background: rgba(${c.glassRGB},0.30);
        transform: translateY(-2px);
        box-shadow: inset 0 1px 1px rgba(255,255,255,0.45), inset 0 -6px 10px -6px rgba(255,255,255,0.1), 0 16px 30px -8px rgba(0,0,0,0.35);
      }
      .btn-glass:active {
        transform: translateY(0px) scale(0.97);
        box-shadow: inset 0 1px 1px rgba(255,255,255,0.3), 0 4px 10px -4px rgba(0,0,0,0.25);
        transition: transform 140ms cubic-bezier(0.45, 0, 0.15, 1), box-shadow 140ms cubic-bezier(0.45, 0, 0.15, 1);
      }
      .action-card, .vault-card { transition: transform 180ms var(--ease-out), box-shadow 180ms var(--ease-out); }
      .action-card:hover, .vault-card:hover { transform: translateY(-3px); }
      @keyframes fadeUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
      .fade-up { animation: fadeUp 480ms var(--ease-out) both; }
      @keyframes scrimIn { from { opacity: 0; } to { opacity: 1; } }
      .scrim-in { animation: scrimIn 200ms ease-out both; }
      @keyframes modalIn { from { opacity: 0; transform: translateY(10px) scale(0.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
      .modal-in { animation: modalIn 260ms var(--ease-out) both; }
      .reveal-mask { filter: blur(7px); opacity: 0.5; transition: filter 220ms var(--ease-out), opacity 220ms var(--ease-out); }
      .reveal-group:hover .reveal-mask, .reveal-group:focus-within .reveal-mask { filter: blur(0); opacity: 1; }
      @media (prefers-reduced-motion: reduce) { .fade-up { animation: none !important; opacity: 1 !important; transform: none !important; } }
    `}</style>
  );
}

function DotGrid({ c }) {
  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{ backgroundImage: `radial-gradient(circle, ${c.dot} 1.4px, transparent 1.4px)`, backgroundSize: "26px 26px" }}
    />
  );
}

function ThemeToggle({ c, theme, onToggle }) {
  const isDark = theme === "dark";
  return (
    <button
      onClick={onToggle}
      aria-label="Toggle theme"
      className="press toggle-track relative w-14 h-8 rounded-full flex items-center px-1"
      style={{ background: isDark ? c.greenDeep : c.cardBorder }}
    >
      <span
        className="toggle-knob w-6 h-6 rounded-full flex items-center justify-center"
        style={{ background: c.surface, color: c.ink, transform: isDark ? "translateX(22px)" : "translateX(0)" }}
      >
        {isDark ? <Sun size={13} /> : <Moon size={13} />}
      </span>
    </button>
  );
}

function NavBar({ c, theme, onToggle, address, screen, onNavigate, onDisconnect }) {
  const links = [
    { key: "vault", label: "Vault" },
    { key: "explorer", label: "Explorer" },
    { key: "automation", label: "Automation" },
  ];
  const activeIndex = links.findIndex((l) => l.key === screen);

  return (
    <div className="sticky top-0 z-40 px-5 pt-5 pb-3">
      <div className="max-w-5xl mx-auto flex items-start justify-between gap-2">
        <div className="rounded-full px-4 py-2" style={{ background: c.pill, boxShadow: c.cardShadow, backdropFilter: "blur(10px)" }}>
          <span className="font-wordmark text-base" style={{ color: c.ink }}>h<span style={{ marginLeft: "-0.05em", marginRight: "-0.05em" }}>ý</span>dan</span>
        </div>

        <div
          className="flex items-center gap-2 rounded-full pl-3 pr-1.5 py-1.5"
          style={{ background: c.pill, boxShadow: c.cardShadow, backdropFilter: "blur(10px)" }}
        >
          {address && (
            <button
              onClick={onDisconnect}
              className="font-num text-xs hover:opacity-70 transition-opacity"
              style={{ color: c.inkSoft }}
              title="Disconnect"
            >
              {address.slice(0, 6)}...{address.slice(-4)}
            </button>
          )}
          <ThemeToggle c={c} theme={theme} onToggle={onToggle} />
          <a href="https://github.com/Shaydez-Defi/hydan" target="_blank" rel="noopener noreferrer" className="press w-8 h-8 rounded-full flex items-center justify-center" style={{ background: c.surface, color: c.ink, boxShadow: c.cardShadow }}>
            <Github size={14} />
          </a>
        </div>
      </div>

      {address && (
        <div className="flex justify-center mt-3">
          <div
            className="relative flex items-center gap-1 rounded-full p-1.5"
            style={{ background: c.pill, boxShadow: c.cardShadow, backdropFilter: "blur(10px)" }}
          >
            <div
              className="absolute top-1.5 bottom-1.5 rounded-full"
              style={{
                background: c.chip,
                width: `calc((100% - 12px) / 3)`,
                left: `calc(6px + ${activeIndex} * ((100% - 12px) / 3))`,
                transition: "left 320ms cubic-bezier(0.45, 0, 0.15, 1)",
              }}
            />
            {links.map((l) => (
              <button
                key={l.key}
                onClick={() => onNavigate(l.key)}
                className="relative z-10 text-sm font-medium px-4 py-1.5 rounded-full text-center"
                style={{
                  color: screen === l.key ? c.ink : c.inkSoft,
                  transition: "color 320ms cubic-bezier(0.45, 0, 0.15, 1)",
                  minWidth: "92px",
                }}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ProofCard({ c, healthStatusHandle }) {
  const handleStr = healthStatusHandle ? `${healthStatusHandle.slice(0, 18)}...` : null;
  return (
    <div
      className="fade-up liquid-glass px-7 py-6 max-w-sm w-full"
      style={{ borderRadius: "32px", animationDelay: "260ms" }}
    >
      <p className="text-xs font-semibold uppercase tracking-wide mb-5" style={{ color: c.inkFaint }}>
        Same loan, two views
      </p>

      <div className="pb-4" style={{ borderBottom: `1px solid ${c.cardBorder}` }}>
        <div className="font-semibold uppercase tracking-wide mb-2" style={{ color: c.inkFaint, fontSize: "10px" }}>
          Aave · public record
        </div>
        <div className="font-num text-xs font-mono" style={{ color: c.inkSoft, wordBreak: "break-all" }}>
          {handleStr || "—"}
        </div>
      </div>

      <div className="pt-4">
        <div className="font-semibold uppercase tracking-wide mb-2" style={{ color: c.inkFaint, fontSize: "10px" }}>
          hýdan · decrypted for you
        </div>
        <div className="font-num text-sm sm:text-base font-semibold" style={{ color: c.green }}>
          healthy
        </div>
      </div>
    </div>
  );
}

function LandingFooter({ c }) {
  return (
    <footer className="relative overflow-hidden mt-8" style={{ background: c.heroCard }}>
      <div className="relative z-10 max-w-5xl mx-auto px-6 md:px-12 pt-14 pb-10">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 mb-10">
          <div className="col-span-2 sm:col-span-1">
            <span className="font-wordmark text-2xl" style={{ color: c.ink }}>h<span style={{ marginLeft: "-0.05em", marginRight: "-0.05em" }}>ý</span>dan</span>
            <p className="text-xs mt-2 leading-relaxed max-w-[180px]" style={{ color: c.inkSoft }}>
              A confidential account layer for existing DeFi.
            </p>
          </div>
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: c.inkFaint }}>Product</h4>
            <ul className="space-y-2 text-sm" style={{ color: c.inkSoft }}>
              {/* TODO: No <section id="vault"> element exists yet. Replace href="#vault" anchor once it does. */}
              <li><a href="#" style={{ color: "inherit" }}>Vault</a></li>
              {/* TODO: No <section id="explorer"> element exists yet. Replace href="#explorer" anchor once it does. */}
              <li><a href="#" style={{ color: "inherit" }}>Explorer</a></li>
              {/* TODO: No <section id="automation"> element exists yet. Replace href="#automation" anchor once it does. */}
              <li><a href="#" style={{ color: "inherit" }}>Automation</a></li>
            </ul>
          </div>
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: c.inkFaint }}>Resources</h4>
            <ul className="space-y-2 text-sm" style={{ color: c.inkSoft }}>
              <li><a href="https://github.com/Shaydez-Defi/hydan" target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>GitHub</a></li>
              <li><a href="https://github.com/Shaydez-Defi/hydan#readme" target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>Docs</a></li>
              {/* TODO: swap href for the actual iExec WTF Hackathon submission page URL */}
              <li><a href="https://www.iex.ec" target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>iExec WTF Hackathon</a></li>
            </ul>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pt-6" style={{ borderTop: `1px solid ${c.cardBorder}` }}>
          <span className="font-num text-[11px]" style={{ color: c.inkFaint }}>Built on Nox × Aave — Sepolia testnet</span>
          <span className="font-num text-[11px]" style={{ color: c.inkFaint }}>iExec WTF Hackathon 2026</span>
        </div>
      </div>
      <div
        className="font-wordmark select-none pointer-events-none text-center leading-none"
        style={{ fontSize: "clamp(4.5rem, 22vw, 13rem)", color: c.green, opacity: 0.08, transform: "translateY(28%)" }}
        aria-hidden="true"
      >
        hýdan
      </div>
    </footer>
  );
}

function LandingScreen({ c, onConnect, healthStatusHandle }) {
  return (
    <main className="relative flex flex-col justify-center px-6 md:px-12 py-16 max-w-5xl mx-auto w-full" style={{ minHeight: "calc(100vh - 96px)" }}>
      <div className="relative z-10 flex flex-col lg:flex-row lg:items-center gap-10 lg:gap-16">
        <div className="flex-1">
          <h1 className="fade-up font-wordmark wordmark-solid text-left" style={{ fontSize: "clamp(4rem, 12vw, 8.5rem)", lineHeight: 1.05 }}>
            h<span style={{ marginLeft: "-0.05em", marginRight: "-0.05em" }}>ý</span>dan
          </h1>
          <p className="fade-up text-left text-base md:text-lg mt-2 mb-8 max-w-md" style={{ color: c.inkSoft, animationDelay: "90ms" }}>
            Borrow on Aave without broadcasting your balance sheet.
          </p>
          <div className="fade-up flex items-center gap-3" style={{ animationDelay: "160ms" }}>
            <button onClick={onConnect} className="press btn-glass inline-flex items-center gap-2 text-sm font-semibold px-7 py-3.5 rounded-full" style={{ color: c.ink }}>
              <Wallet size={15} />
              Connect wallet
            </button>
          </div>
        </div>
        <div className="lg:flex-1 lg:flex lg:justify-end">
          <ProofCard c={c} healthStatusHandle={healthStatusHandle} />
        </div>
      </div>
    </main>
  );
}

function buildActions(aaveData, userWethBalance, totalAssetsRaw) {
  const eth = (wei) => {
    if (!wei || wei === 0n) return "0";
    const num = Number(wei) / 1e18;
    if (num >= 10000) return num.toLocaleString(undefined, { maximumFractionDigits: 0 });
    return num.toFixed(num < 1 ? 4 : 2);
  };
  const base = (val) => {
    if (!val || val === 0n) return "0";
    const num = Number(val) / 1e8;
    if (num >= 10000) return num.toLocaleString(undefined, { maximumFractionDigits: 0 });
    return num.toFixed(num < 1 ? 4 : 2);
  };
  const depositMax = userWethBalance || 0n;
  const borrowMax = aaveData ? aaveData[2] : 0n;
  const repayMax = aaveData ? aaveData[1] : 0n;
  const withdrawMax = totalAssetsRaw || 0n;
  return [
    { key: "deposit", icon: Landmark, label: "Deposit", unit: "ETH", verb: "Deposit", tone: "green", helper: "Add collateral", max: eth(depositMax), hfAfter: "—" },
    { key: "borrow", icon: CircleDollarSign, label: "Borrow", unit: "ETH", verb: "Borrow", tone: "carmine", helper: "Draw more debt", max: base(borrowMax), hfAfter: "—" },
    { key: "repay", icon: ShieldCheck, label: "Repay", unit: "ETH", verb: "Repay", tone: "green", helper: "Pay down debt", max: base(repayMax), hfAfter: "—" },
    { key: "withdraw", icon: Unlock, label: "Withdraw", unit: "ETH", verb: "Withdraw", tone: "carmine", helper: "Free collateral", max: eth(withdrawMax), hfAfter: "—" },
  ];
}

function ActionCard({ c, action, onOpen, delay }) {
  const Icon = action.icon;
  return (
    <button
      onClick={() => onOpen(action.key)}
      className="fade-up action-card liquid-glass press text-left p-5 flex-1"
      style={{ animationDelay: delay, borderRadius: "36px", minWidth: "150px" }}
    >
      <span className="inline-flex items-center justify-center w-9 h-9 rounded-full mb-3" style={{ background: "rgba(255,255,255,0.10)", color: c.ink }}>
        <Icon size={16} strokeWidth={1.75} />
      </span>
      <div className="text-sm font-semibold mb-0.5" style={{ color: c.ink }}>{action.label}</div>
      <div className="text-xs" style={{ color: c.inkSoft }}>{action.helper}</div>
    </button>
  );
}

function ActionModal({ c, action, onClose, address, vaultAddress }) {
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState(null);
  const { writeContractAsync } = useWriteContract();
  const { data: allowance } = useReadContract({
    address: WETH, abi: erc20Abi, functionName: "allowance",
    args: [address, vaultAddress],
    query: { enabled: !!address && !!vaultAddress },
  });

  if (!action) return null;
  const Icon = action.icon;

  const weiAmount = (() => {
    try { return parseEther(amount || "0"); } catch { return 0n; }
  })();

  async function submit() {
    if (status === "pending" || !amount || weiAmount <= 0n) return;
    setStatus("pending");
    try {
      if (action.key === "deposit") {
        if (allowance < weiAmount) {
          await writeContractAsync({
            address: WETH, abi: erc20Abi, functionName: "approve",
            args: [vaultAddress, weiAmount],
          });
        }
        await writeContractAsync({
          address: vaultAddress, abi: vaultAbi, functionName: "deposit",
          args: [weiAmount, address],
        });
      } else if (action.key === "borrow") {
        await writeContractAsync({
          address: vaultAddress, abi: vaultAbi, functionName: "borrow",
          args: [weiAmount, 2, 0, address],
        });
      } else if (action.key === "repay") {
        await writeContractAsync({
          address: vaultAddress, abi: vaultAbi, functionName: "repay",
          args: [weiAmount, 2, address],
        });
      } else if (action.key === "withdraw") {
        await writeContractAsync({
          address: vaultAddress, abi: vaultAbi, functionName: "withdraw",
          args: [weiAmount, address, address],
        });
      }
      setStatus("success");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="scrim-in fixed inset-0 z-50 flex items-center justify-center px-5" style={{ background: c.scrimBg, backdropFilter: "blur(6px)" }} onClick={onClose}>
      <div className="modal-in relative w-full max-w-xs" onClick={(e) => e.stopPropagation()}>
        <div className="relative p-6" style={{ background: c.surfaceGlass, backdropFilter: "blur(24px)", boxShadow: c.cardShadow, borderRadius: "40px" }}>
          <div className="flex items-center gap-2 mb-1">
            <Icon size={16} strokeWidth={1.75} style={{ color: c.inkSoft }} />
            <h2 className="text-base font-semibold" style={{ color: c.ink }}>{action.verb} {action.unit}</h2>
          </div>
          <p className="text-xs mb-5" style={{ color: c.inkSoft }}>Available: {action.max} {action.unit}</p>

          <div className="liquid-glass flex items-center gap-2 rounded-full px-5 py-3.5 mb-5">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              inputMode="decimal"
              autoFocus
              className="font-num bg-transparent outline-none flex-1 min-w-0 text-base font-semibold"
              style={{ color: c.ink }}
            />
            <span className="font-num text-sm" style={{ color: c.inkSoft }}>{action.unit}</span>
          </div>

          <div className="flex gap-2">
            <button onClick={onClose} className="press flex-1 text-sm font-medium py-2.5 rounded-full" style={{ background: c.inputBg, color: c.inkSoft }}>
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={status === "pending" || !amount}
              className="press flex-1 text-sm font-semibold py-2.5 rounded-full flex items-center justify-center gap-1.5"
              style={{ background: c.ctaBg, color: c.ctaText }}
            >
              {status === "pending" && <Loader2 size={14} className="animate-spin" />}
              {status === "success" && <CheckCircle2 size={14} />}
              {status === "pending" ? "Confirming" : status === "success" ? "Confirmed" : action.verb}
              {status === "error" && " Error"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function VaultScreen({ c, aaveData, totalAssetsRaw, userWethBalance, address, vaultAddress }) {
  const [openAction, setOpenAction] = useState(null);

  const maxUintHalf = 2n ** 255n;
  const hf = aaveData ? aaveData[5] : null;
  const isHealthy = !hf || hf > 10n ** 27n;

  const fmtHf = () => {
    if (!hf) return "—";
    if (hf >= maxUintHalf) return "∞";
    const num = Number(hf) / 1e27;
    return num.toFixed(2);
  };
  const fmtEth = (wei) => {
    if (!wei || wei === 0n) return "0";
    const num = Number(wei) / 1e18;
    return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  const fmtBase = (val) => {
    if (!val || val === 0n) return "0";
    const num = Number(val) / 1e8;
    return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const collateral = totalAssetsRaw || 0n;
  const debt = aaveData ? aaveData[1] : 0n;
  const actions = buildActions(aaveData, userWethBalance, totalAssetsRaw);

  return (
    <main className="flex-1 w-full px-6 pt-6 pb-14 max-w-5xl mx-auto">
      <div className="fade-up mb-1">
        <h1 className="text-3xl font-extrabold" style={{ color: c.ink, letterSpacing: "-0.02em" }}>Your vault</h1>
        <p className="text-sm mt-1" style={{ color: c.inkSoft }}>Hover to reveal your numbers.</p>
      </div>

      <div className="fade-up px-8 py-8 mt-6 mb-10" style={{ background: c.heroCard, boxShadow: c.cardShadow, animationDelay: "60ms", borderRadius: "56px" }}>
        <div className="flex items-start justify-between mb-1">
          <div>
            <div className="text-base font-semibold" style={{ color: c.ink }}>Health factor</div>
            <div className="text-xs" style={{ color: c.inkSoft }}>Collateral minus debt exposure</div>
          </div>
          <span className="inline-flex items-center justify-center w-9 h-9 rounded-full" style={{ background: isHealthy ? c.greenSoft : c.carmineSoft, color: isHealthy ? c.green : c.carmine }}>
            {isHealthy ? <ShieldCheck size={16} /> : <ShieldAlert size={16} />}
          </span>
        </div>

        <div className="reveal-group flex flex-col lg:flex-row lg:items-end lg:justify-between lg:gap-8">
          <div className="reveal-mask mt-3 mb-5 lg:mb-0 lg:mt-3 shrink-0">
            <span className="font-num-display text-4xl lg:text-5xl" style={{ color: isHealthy ? c.green : c.carmine }} tabIndex={0}>
              {fmtHf()}
            </span>
          </div>
          <div className="flex gap-3 lg:flex-1 lg:max-w-md">
            <div className="reveal-mask flex-1 rounded-full px-5 py-3" style={{ background: c.chip }}>
              <div className="font-medium uppercase tracking-wide mb-0.5" style={{ color: c.inkFaint, fontSize: "10px" }}>Collateral</div>
              <div className="font-num-display text-base" style={{ color: c.ink }}>{fmtEth(collateral)} <span className="text-xs font-medium" style={{ color: c.inkSoft }}>ETH</span></div>
            </div>
            <div className="reveal-mask flex-1 rounded-full px-5 py-3" style={{ background: c.chip }}>
              <div className="font-medium uppercase tracking-wide mb-0.5" style={{ color: c.inkFaint, fontSize: "10px" }}>Debt</div>
              <div className="font-num-display text-base" style={{ color: c.ink }}>{fmtBase(debt)} <span className="text-xs font-medium" style={{ color: c.inkSoft }}>ETH</span></div>
            </div>
          </div>
        </div>

        <p className="text-xs mt-4" style={{ color: c.inkFaint }}>
          Publicly, this vault only ever shows as <span style={{ color: isHealthy ? c.green : c.carmine }}>{isHealthy ? "healthy" : "at risk"}</span>.
        </p>
      </div>

      <h2 className="fade-up text-sm font-semibold mb-3" style={{ color: c.ink, animationDelay: "220ms" }}>Manage position</h2>
      <div className="flex flex-wrap gap-3">
        {actions.map((a, i) => (
          <ActionCard key={a.key} c={c} action={a} onOpen={setOpenAction} delay={`${260 + i * 40}ms`} />
        ))}
      </div>

      {openAction && <ActionModal c={c} action={actions.find((a) => a.key === openAction)} onClose={() => setOpenAction(null)} address={address} vaultAddress={vaultAddress} />}
    </main>
  );
}

function StatChip({ c, label, value, tone }) {
  const color = tone === "green" ? c.green : tone === "carmine" ? c.carmine : c.ink;
  return (
    <div className="liquid-glass px-5 py-3 flex-1" style={{ borderRadius: "999px" }}>
      <div className="font-medium uppercase tracking-wide mb-0.5" style={{ color: c.inkFaint, fontSize: "10px" }}>{label}</div>
      <div className="font-num-display text-lg" style={{ color }}>{value}</div>
    </div>
  );
}

function VaultCard({ c, vault, delay }) {
  const isHealthy = vault.status === "healthy";
  return (
    <div className="fade-up vault-card liquid-glass px-5 py-4 flex items-center justify-between" style={{ borderRadius: "28px", animationDelay: delay }}>
      <span className="font-num-display text-sm" style={{ color: c.ink }}>{vault.id}</span>
      <span
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold"
        style={{ background: isHealthy ? c.greenSoft : c.carmineSoft, color: isHealthy ? c.green : c.carmine }}
      >
        {isHealthy ? <ShieldCheck size={12} /> : <ShieldAlert size={12} />}
        {isHealthy ? "Healthy" : "At risk"}
      </span>
    </div>
  );
}

function ExplorerScreen({ c, aaveData, vaultAddress }) {
  const [query, setQuery] = useState("");

  const hf = aaveData ? aaveData[5] : null;
  const isHealthy = !hf || hf > 10n ** 27n;
  const vault = {
    id: vaultAddress ? `${vaultAddress.slice(0, 6)}...${vaultAddress.slice(-4)}` : "—",
    status: isHealthy ? "healthy" : "risk",
  };
  const VAULTS = [vault];
  const healthyCount = VAULTS.filter((v) => v.status === "healthy").length;
  const riskCount = VAULTS.length - healthyCount;
  const filtered = VAULTS.filter((v) => v.id.toLowerCase().includes(query.toLowerCase()));

  return (
    <main className="flex-1 max-w-5xl mx-auto w-full px-6 pt-6 pb-14">
      <div className="fade-up mb-1">
        <h1 className="text-3xl font-extrabold" style={{ color: c.ink, letterSpacing: "-0.02em" }}>Public explorer</h1>
        <p className="text-sm mt-1" style={{ color: c.inkSoft }}>Anyone can see a vault's status. Nobody sees its numbers.</p>
      </div>

      <div className="fade-up flex gap-3 mt-6 mb-6" style={{ animationDelay: "60ms" }}>
        <StatChip c={c} label="Vaults" value={VAULTS.length} />
        <StatChip c={c} label="Healthy" value={healthyCount} tone="green" />
        <StatChip c={c} label="At risk" value={riskCount} tone="carmine" />
      </div>

      <div className="fade-up liquid-glass flex items-center gap-2 px-5 py-3 mb-6" style={{ borderRadius: "999px", animationDelay: "100ms" }}>
        <Search size={15} style={{ color: c.inkFaint }} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by vault ID"
          className="bg-transparent outline-none flex-1 min-w-0 text-sm"
          style={{ color: c.ink }}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {filtered.map((v, i) => (
          <VaultCard key={v.id} c={c} vault={v} delay={`${140 + i * 30}ms`} />
        ))}
        {filtered.length === 0 && <p className="text-sm text-center py-8" style={{ color: c.inkFaint }}>No vaults match that search.</p>}
      </div>
    </main>
  );
}

function AutomationSwitch({ c, on, onToggle }) {
  return (
    <button
      onClick={onToggle}
      aria-label="Toggle automation"
      className="press toggle-track relative w-16 h-9 rounded-full flex items-center px-1"
      style={{ background: on ? c.green : c.chip }}
    >
      <span className="toggle-knob w-7 h-7 rounded-full" style={{ background: c.surface, transform: on ? "translateX(28px)" : "translateX(0)" }} />
    </button>
  );
}

function AutomationScreen({ c, aaveData }) {
  const [on, setOn] = useState(true);
  const [threshold, setThreshold] = useState("1.20");

  const hf = aaveData ? aaveData[5] : null;
  const fmtHf = () => {
    if (!hf) return "—";
    if (hf >= 2n ** 255n) return "∞";
    return (Number(hf) / 1e27).toFixed(2);
  };
  const currentHF = fmtHf();

  return (
    <main className="flex-1 max-w-5xl mx-auto w-full px-6 pt-6 pb-14">
      <div className="fade-up mb-1">
        <h1 className="text-3xl font-extrabold" style={{ color: c.ink, letterSpacing: "-0.02em" }}>Automation</h1>
        <p className="text-sm mt-1" style={{ color: c.inkSoft }}>Repay automatically before you're at risk.</p>
      </div>

      <div className="fade-up mt-6 mb-6 px-8 py-8" style={{ background: c.heroCard, boxShadow: c.cardShadow, borderRadius: "48px", animationDelay: "60ms" }}>
        <div className="flex items-start justify-between mb-1">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: on ? c.greenSoft : c.chip, color: on ? c.green : c.inkFaint }}>
                <Zap size={14} />
              </span>
              <span className="text-base font-semibold" style={{ color: c.ink }}>Auto-repay</span>
            </div>
            <div className="text-xs" style={{ color: c.inkSoft }}>Repays USDC from idle balance if triggered</div>
          </div>
          <AutomationSwitch c={c} on={on} onToggle={() => setOn(!on)} />
        </div>

        <div className="flex items-center gap-2 mt-5 mb-6">
          <span className="w-2 h-2 rounded-full" style={{ background: on ? c.green : c.inkFaint }} />
          <span className="font-num-display text-lg" style={{ color: on ? c.green : c.inkFaint }}>{on ? "Active" : "Inactive"}</span>
          <span className="text-xs" style={{ color: c.inkSoft }}>— current health factor {currentHF}</span>
        </div>

        <div className="liquid-glass flex items-center justify-between px-5 py-4" style={{ borderRadius: "999px" }}>
          <div>
            <div className="font-medium uppercase tracking-wide mb-0.5" style={{ color: c.inkFaint, fontSize: "10px" }}>Trigger below</div>
            <div className="text-xs" style={{ color: c.inkSoft }}>Health factor threshold</div>
          </div>
          <div className="flex items-baseline gap-1.5">
            <input
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              inputMode="decimal"
              className="font-num-display bg-transparent outline-none text-right"
              style={{ color: c.ink, fontSize: "1.5rem", width: "4.5ch", minWidth: "4.5ch" }}
            />
            <span className="text-xs" style={{ color: c.inkSoft }}>HF</span>
          </div>
        </div>
      </div>

      <div className="fade-up liquid-glass flex items-center gap-3 px-6 py-4" style={{ borderRadius: "28px", animationDelay: "120ms" }}>
        <ShieldCheck size={16} style={{ color: c.inkSoft }} />
        <p className="text-xs" style={{ color: c.inkSoft }}>
          The trigger check runs inside Nox on your encrypted position. Nobody, including hýdan, sees the comparison happen.
        </p>
      </div>
    </main>
  );
}

export default function HydanApp() {
  useGoogleFonts();
  const [theme, setTheme] = useState("dark");
  const [screen, setScreen] = useState("vault");
  const c = PALETTES[theme];
  const { address } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();

  const vaultAddress = useVaultAddress();
  const { data: totalAssetsRaw } = useVaultTotalAssets();
  const { data: healthStatus } = useVaultHealthStatus();
  const { data: userWethBalance } = useUserWethBalance(address);
  const { data: aaveData } = useVaultAaveData(vaultAddress);

  function handleConnect() {
    connect({ connector: connectors[0] });
  }

  return (
    <div className="hydan-root min-h-screen relative transition-colors duration-300" style={{ background: c.bg, fontFamily: "'Manrope', sans-serif" }}>
      <GlobalStyle c={c} />
      <DotGrid c={c} />
      <div className="relative z-10 flex flex-col min-h-screen">
        <NavBar
          c={c}
          theme={theme}
          onToggle={() => setTheme(theme === "light" ? "dark" : "light")}
          address={address}
          screen={screen}
          onNavigate={setScreen}
          onDisconnect={() => { disconnect(); setScreen("vault"); }}
        />

        {!address && <LandingScreen c={c} onConnect={handleConnect} healthStatusHandle={healthStatus} />}
        {address && screen === "vault" && <VaultScreen c={c} aaveData={aaveData} totalAssetsRaw={totalAssetsRaw} userWethBalance={userWethBalance} address={address} vaultAddress={vaultAddress} />}
        {address && screen === "explorer" && <ExplorerScreen c={c} aaveData={aaveData} vaultAddress={vaultAddress} />}
        {address && screen === "automation" && <AutomationScreen c={c} aaveData={aaveData} />}

        {!address && <LandingFooter c={c} />}
        {address && (
          <footer className="px-6 py-6 text-center">
            <span className="font-num" style={{ color: c.inkFaint, fontSize: "11px" }}>Built on Nox × Aave — Sepolia testnet</span>
          </footer>
        )}
      </div>
    </div>
  );
}

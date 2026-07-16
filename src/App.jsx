import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { RefreshCw, AlertCircle, Plus, X, Undo2, PieChart as PieIcon, BookOpen } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

// Live endpoint: Money Spends 2026 sheet (Budget + Spends tabs)
const DATA_URL = "https://script.google.com/macros/s/AKfycbzn6DjtYfNTeOG9-8nwqllaxpsO5AldvP_REQnknDeOtP3Bh885Nuc0TNYlgND8H7i6/exec";

// Budget start month (YYYY-MM). Rollover accrues from here: each bucket's
// overall pot = monthly amount × months elapsed. Edit this one line if it changes.
const BUDGET_START = "2026-06";

const monthsElapsed = () => {
  const [sy, sm] = BUDGET_START.split("-").map(Number);
  const now = new Date();
  return Math.max(1, (now.getFullYear() - sy) * 12 + (now.getMonth() + 1 - sm) + 1);
};
const thisMonthKey = () => {
  const now = new Date();
  return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
};

/* Palette — grounded in banknote ink & warm paper */
const T = {
  paper: "#FAF8F3", card: "#FFFFFF", line: "#E7E2D6",
  ink: "#182420", muted: "#8A8578",
  green: "#1E6B4E", mint: "#DEF0E5", mintDeep: "#BCE0CB",
  gold: "#C98F1A", goldTint: "#F7ECD4",
  red: "#C43D2E", redTint: "#F8E4E0",
};
/* Bucket identity palette — distinct hues that sit well on warm paper.
   Order-stable: bucket N gets colour N unless the sheet's Color column overrides. */
const BUCKET_COLORS = ["#1E6B4E", "#3E7CB1", "#C98F1A", "#8A5A83", "#B5651D", "#2E5E6B", "#7A9E3B", "#A34A5E", "#5F7161"];
const tint = (hex, a = "26") => hex + a; // hex + alpha ≈ 15% wash

const post = (payload) =>
  fetch(DATA_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(payload) });

const money = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");
const fmtDate = (v) => {
  const s = String(v == null ? "" : v).trim();
  if (!s) return "";
  return s.includes("T") ? s.split("T")[0] : s;
};
const niceDate = (v) => {
  const s = fmtDate(v);
  const d = new Date(s + "T00:00:00");
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};

const CHIPS = [50, 100, 200, 500];

export default function App() {
  const [budgetRows, setBudgetRows] = useState([]);
  const [spendRows, setSpendRows] = useState([]);
  const [status, setStatus] = useState("loading");
  // view: "overall" or a month key "YYYY-MM"
  const [view, setView] = useState(thisMonthKey());
  const [page, setPage] = useState("budget"); // "budget" | "position"
  const [accountRows, setAccountRows] = useState([]);
  const [activeAccount, setActiveAccount] = useState(null);
  const [fBalance, setFBalance] = useState("");
  const balanceRef = useRef(null);

  const monthKeys = useMemo(() => {
    const keys = [];
    let [y, m] = BUDGET_START.split("-").map(Number);
    const now = thisMonthKey();
    while (true) {
      const k = y + "-" + String(m).padStart(2, "0");
      keys.push(k);
      if (k === now) break;
      m++; if (m > 12) { m = 1; y++; }
      if (keys.length > 240) break; // safety
    }
    return keys;
  }, []);
  const monthLabel = (k) => {
    const [y, m] = k.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
  };
  const stepMonth = (dir) => {
    if (view === "overall") return;
    const i = monthKeys.indexOf(view);
    const next = monthKeys[i + dir];
    if (next) setView(next);
  };
  const [activeBucket, setActiveBucket] = useState(null); // card in log mode
  const [fDesc, setFDesc] = useState("");
  const [fAmount, setFAmount] = useState("");
  const [fFlow, setFFlow] = useState("out"); // "out" spend | "in" money added
  const [toast, setToast] = useState(null); // {text, spend}
  const amountRef = useRef(null);
  const toastTimer = useRef(null);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const res = await fetch(DATA_URL + "?_=" + Date.now());
      if (!res.ok) throw new Error("http " + res.status);
      const json = await res.json();
      const clean = (rows) => (rows || [])
        .map((r) => (Array.isArray(r) ? r.map((c) => (c == null ? "" : String(c))) : []))
        .filter((r) => r.some((c) => c.trim() !== ""));
      setBudgetRows(clean(json.budget));
      setSpendRows(clean(json.spends));
      setAccountRows(clean(json.accounts));
      setStatus("ok");
    } catch (e) { setStatus("error"); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(() => { if (!activeBucket) load(); }, 60000);
    return () => clearInterval(id);
  }, [load, activeBucket]);

  /* ── parse ─────────────────────────────────────────── */
  const buckets = useMemo(() => {
    if (!budgetRows.length) return [];
    let hi = budgetRows.findIndex((r) => {
      const c = r.map((x) => String(x).toLowerCase().trim());
      return c.includes("bucket") && c.includes("amount");
    });
    if (hi === -1) hi = 0;
    const h = budgetRows[hi].map((x) => String(x).trim().toLowerCase());
    const bi = h.indexOf("bucket"), ai = h.indexOf("amount"), wi = h.indexOf("where"), ci = h.indexOf("color");
    return budgetRows.slice(hi + 1).map((r, idx) => {
      const custom = ci >= 0 ? String(r[ci] || "").trim() : "";
      return {
        bucket: String(r[bi] || "").trim(),
        amount: Number(String(r[ai] || "0").replace(/[^0-9.-]/g, "")) || 0,
        where: wi >= 0 ? String(r[wi] || "").trim() : "",
        color: /^#[0-9a-fA-F]{6}$/.test(custom) ? custom : BUCKET_COLORS[idx % BUCKET_COLORS.length],
      };
    }).filter((b) => b.bucket && b.bucket.toLowerCase() !== "total");
  }, [budgetRows]);

  const spends = useMemo(() => {
    if (!spendRows.length) return [];
    let hi = spendRows.findIndex((r) => {
      const c = r.map((x) => String(x).toLowerCase().trim());
      return c.includes("bucket") && c.includes("amount");
    });
    if (hi === -1) hi = 0;
    const h = spendRows[hi].map((x) => String(x).trim().toLowerCase());
    const di = h.indexOf("date"), bi = h.indexOf("bucket"), si = h.indexOf("description"), ai = h.indexOf("amount");
    return spendRows.slice(hi + 1).map((r) => ({
      date: fmtDate(r[di]),
      bucket: String(r[bi] || "").trim(),
      description: si >= 0 ? String(r[si] || "").trim() : "",
      amount: Number(String(r[ai] || "0").replace(/[^0-9.-]/g, "")) || 0,
    })).filter((s) => s.bucket || s.amount);
  }, [spendRows]);

  const scopedSpends = useMemo(() => {
    if (view === "overall") return spends;
    return spends.filter((s) => (s.date || "").slice(0, 7) === view);
  }, [spends, view]);

  const rows = useMemo(() => {
    const mult = view === "overall" ? monthsElapsed() : 1;
    return buckets.map((b) => {
      const pot = b.amount * mult;
      const spent = scopedSpends.filter((s) => s.bucket === b.bucket).reduce((n, s) => n + s.amount, 0);
      const left = pot - spent;
      return { ...b, pot, spent, left, leftPct: pot ? Math.max(0, Math.min(100, (left / pot) * 100)) : 0 };
    });
  }, [buckets, scopedSpends, view]);

  const totals = useMemo(() => {
    const allocated = rows.reduce((n, r) => n + r.pot, 0);
    const spent = rows.reduce((n, r) => n + r.spent, 0);
    return { allocated, spent, left: allocated - spent, pct: allocated ? (spent / allocated) * 100 : 0 };
  }, [rows]);

  const pieData = rows.filter((r) => r.spent > 0).map((r) => ({ name: r.bucket, value: r.spent, color: r.color }));
  const recent = [...scopedSpends].reverse().slice(0, 9);
  const colorOf = useMemo(() => {
    const m = {};
    rows.forEach((r) => { m[r.bucket] = r.color; });
    return (bucket) => m[bucket] || T.muted;
  }, [rows]);

  /* ── actions ───────────────────────────────────────── */
  const openCard = (bucket) => {
    setActiveBucket(bucket);
    setFDesc(""); setFAmount(""); setFFlow("out");
    setTimeout(() => amountRef.current?.focus(), 60);
  };
  const closeCard = () => { setActiveBucket(null); setFDesc(""); setFAmount(""); };

  const showToast = (text, spend) => {
    clearTimeout(toastTimer.current);
    setToast({ text, spend });
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  };

  const logSpend = async () => {
    const amt = Number(fAmount);
    if (!activeBucket || !amt) return;
    const today = localToday();
    const spend = { date: today, bucket: activeBucket, description: fDesc.trim(), amount: amt };
    setSpendRows((r) => [...r, [today, spend.bucket, spend.description, String(amt)]]);
    closeCard();
    if (view !== "overall") setView(today.slice(0, 7));
    showToast("Logged " + money(amt) + " to " + spend.bucket, spend);
    try { await post({ action: "addSpend", ...spend }); } catch {}
  };

  const undoSpend = async () => {
    const s = toast?.spend;
    if (!s) return;
    setToast(null);
    setSpendRows((r) => {
      const idx = [...r].reverse().findIndex((row) =>
        String(row[1]).trim() === s.bucket && String(row[2]).trim() === s.description && Number(row[3]) === s.amount);
      if (idx === -1) return r;
      const real = r.length - 1 - idx;
      return r.filter((_, i) => i !== real);
    });
    try { await post({ action: "deleteSpend", bucket: s.bucket, description: s.description, amount: s.amount }); } catch {}
  };

  const deleteSpend = async (s) => {
    setSpendRows((r) => r.filter((row) =>
      !(String(row[1]).trim() === s.bucket && String(row[2]).trim() === s.description && Number(row[3]) === s.amount)));
    try { await post({ action: "deleteSpend", bucket: s.bucket, description: s.description, amount: s.amount }); } catch {}
  };

  const chip = (v) => setFAmount(String((Number(fAmount) || 0) + v));

  /* fill colour by how empty the envelope is */
  /* ── accounts (Position page) ─────────────────────── */
  const ACCOUNT_COLORS = { "sbi": "#2D5D9F", "bob": "#D96C2C", "jupiter": "#E8590C", "amazon": "#B08A2E", "google": "#34A06B", "cash": "#5F7161" };
  const accountColor = (name, idx) => {
    const n = name.toLowerCase();
    for (const k in ACCOUNT_COLORS) if (n.includes(k)) return ACCOUNT_COLORS[k];
    return BUCKET_COLORS[idx % BUCKET_COLORS.length];
  };
  const accounts = useMemo(() => {
    if (!accountRows.length) return [];
    let hi = accountRows.findIndex((r) => {
      const c = r.map((x) => String(x).toLowerCase().trim());
      return c.includes("account") && c.includes("balance");
    });
    if (hi === -1) hi = 0;
    const h = accountRows[hi].map((x) => String(x).trim().toLowerCase());
    const ni = h.indexOf("account"), bi = h.indexOf("balance"), ui = h.indexOf("updated");
    return accountRows.slice(hi + 1).map((r, idx) => ({
      account: String(r[ni] || "").trim(),
      balance: Number(String(r[bi] || "0").replace(/[^0-9.-]/g, "")) || 0,
      updated: ui >= 0 ? fmtDate(r[ui]) : "",
      color: accountColor(String(r[ni] || ""), idx),
    })).filter((a) => a.account);
  }, [accountRows]);
  const positionTotal = accounts.reduce((n, a) => n + a.balance, 0);

  const localToday = () => {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  };

  const openAccount = (name, current) => {
    setActiveAccount(name); setFBalance(String(current));
    setTimeout(() => { balanceRef.current?.focus(); balanceRef.current?.select(); }, 60);
  };
  const closeAccount = () => { setActiveAccount(null); setFBalance(""); };
  const saveBalance = async () => {
    const bal = Number(fBalance);
    if (!activeAccount || isNaN(bal)) return;
    const name = activeAccount, today = localToday();
    setAccountRows((rows) => rows.map((r) =>
      String(r[0]).trim() === name ? [r[0], String(bal), today] : r));
    closeAccount();
    showToast("Updated " + name + " to " + money(bal), null);
    try { await post({ action: "setBalance", account: name, balance: bal }); } catch {}
  };

  /* identity colour carries the fill; health gets a badge */
  const fillTone = (r) => ({
    fill: r.left < 0 ? T.redTint : tint(r.color),
    badge: r.left < 0 ? { text: "over", bg: T.redTint, fg: T.red }
      : r.leftPct <= 25 ? { text: "low", bg: T.goldTint, fg: T.gold }
      : null,
  });

  return (
    <div style={{ background: T.paper, minHeight: "100vh", color: T.ink, fontFamily: "'Work Sans', system-ui, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Work+Sans:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: ${T.paper}; }
        .serif { font-family: 'Instrument Serif', serif; }
        .num { font-variant-numeric: tabular-nums; }
        .wrap { max-width: 1020px; margin: 0 auto; padding: 34px 20px 90px; }
        .cardgrid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
        .grid2 { display: grid; grid-template-columns: 5fr 6fr; gap: 14px; }
        .panel { background: ${T.card}; border: 1px solid ${T.line}; border-radius: 16px; padding: 20px; }
        .env { position: relative; overflow: hidden; background: ${T.card}; border: 1px solid ${T.line};
               border-radius: 16px; padding: 18px; cursor: pointer; min-height: 178px;
               display: flex; flex-direction: column; justify-content: space-between; }
        .env:focus-visible, button:focus-visible, input:focus-visible { outline: 2px solid ${T.green}; outline-offset: 2px; }
        .chipbtn { border: 1px solid ${T.line}; background: ${T.paper}; border-radius: 999px; padding: 5px 12px;
                   font-size: 12px; font-weight: 600; cursor: pointer; color: ${T.ink}; }
        .chipbtn:hover { border-color: ${T.green}; color: ${T.green}; }
        .ghost { border: 1px solid ${T.line}; background: transparent; border-radius: 10px; padding: 8px 10px;
                 cursor: pointer; color: ${T.muted}; display: inline-flex; align-items: center; }
        .primary { border: none; background: ${T.green}; color: #fff; border-radius: 10px; padding: 9px 18px;
                   font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit; }
        input { font-family: inherit; }
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: no-preference) {
          .env { transition: transform .16s ease, box-shadow .16s ease; }
          .env:hover { transform: translateY(-2px); box-shadow: 0 8px 22px rgba(24,36,32,.08); }
          .envfill { transition: height .45s cubic-bezier(.2,.7,.3,1); }
          .toastin { animation: rise .22s ease; }
          @keyframes rise { from { opacity: 0; transform: translate(-50%, 8px); } to { opacity: 1; transform: translate(-50%, 0); } }
        }
        @media (max-width: 880px) { .cardgrid { grid-template-columns: repeat(2, 1fr); } .grid2 { grid-template-columns: 1fr; } }
        @media (max-width: 540px) { .cardgrid { grid-template-columns: 1fr; } .wrap { padding: 22px 14px 90px; } }
      `}</style>

      <div className="wrap">
        {/* ── masthead: the one number that matters ── */}
        <header style={{ marginBottom: 30 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <nav aria-label="Pages" style={{ display: "flex", gap: 16, alignItems: "baseline" }}>
              {[["budget", "Budget"], ["position", "Position"]].map(([k, lbl]) => (
                <button key={k} onClick={() => setPage(k)}
                  style={{ border: "none", background: "transparent", cursor: "pointer", padding: 0, fontFamily: "inherit",
                    fontSize: 12, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase",
                    color: page === k ? T.ink : T.muted,
                    borderBottom: page === k ? `2px solid ${T.green}` : "2px solid transparent", paddingBottom: 3 }}>
                  {lbl}
                </button>
              ))}
            </nav>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {page === "budget" && (
              <div role="tablist" aria-label="View" style={{ display: "flex", alignItems: "center", background: "#EFEBE0", borderRadius: 999, padding: 3 }}>
                <button aria-label="Previous month" onClick={() => { view === "overall" ? setView(monthKeys[monthKeys.length - 1]) : stepMonth(-1); }}
                  disabled={view !== "overall" && monthKeys.indexOf(view) === 0}
                  style={{ border: "none", background: "transparent", cursor: "pointer", padding: "4px 7px", color: T.muted, fontFamily: "inherit",
                    opacity: (view !== "overall" && monthKeys.indexOf(view) === 0) ? 0.3 : 1 }}>‹</button>
                <button role="tab" aria-selected={view !== "overall"} onClick={() => view === "overall" && setView(thisMonthKey())}
                  style={{ border: "none", cursor: "pointer", borderRadius: 999, padding: "6px 12px", fontSize: 12, fontWeight: 700, fontFamily: "inherit", minWidth: 76,
                    background: view !== "overall" ? T.card : "transparent", color: view !== "overall" ? T.ink : T.muted,
                    boxShadow: view !== "overall" ? "0 1px 4px rgba(24,36,32,.12)" : "none" }}>
                  {view !== "overall" ? monthLabel(view) : monthLabel(thisMonthKey())}
                </button>
                <button aria-label="Next month" onClick={() => stepMonth(1)}
                  disabled={view === "overall" || monthKeys.indexOf(view) === monthKeys.length - 1}
                  style={{ border: "none", background: "transparent", cursor: "pointer", padding: "4px 7px", color: T.muted, fontFamily: "inherit",
                    opacity: (view === "overall" || monthKeys.indexOf(view) === monthKeys.length - 1) ? 0.3 : 1 }}>›</button>
                <button role="tab" aria-selected={view === "overall"} onClick={() => setView("overall")}
                  style={{ border: "none", cursor: "pointer", borderRadius: 999, padding: "6px 14px", fontSize: 12, fontWeight: 700, fontFamily: "inherit",
                    background: view === "overall" ? T.card : "transparent", color: view === "overall" ? T.ink : T.muted,
                    boxShadow: view === "overall" ? "0 1px 4px rgba(24,36,32,.12)" : "none" }}>
                  Overall
                </button>
              </div>
              )}
              <button className="ghost" onClick={load} aria-label="Refresh">
                <RefreshCw size={15} className={status === "loading" ? "spin" : ""} />
              </button>
            </div>
          </div>
          {page === "budget" ? (
            <>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginTop: 10 }}>
                <span className="serif num" style={{ fontSize: 64, lineHeight: 1, color: totals.left < 0 ? T.red : T.ink }}>
                  {money(totals.left)}
                </span>
                <span className="serif" style={{ fontSize: 26, color: T.muted, fontStyle: "italic" }}>
                  {view === "overall" ? "left overall" : view === thisMonthKey() ? "left this month" : "unspent in " + monthLabel(view)}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 12 }}>
                <div style={{ flex: 1, maxWidth: 340, background: "#EDE9DD", borderRadius: 999, height: 6, overflow: "hidden" }}>
                  <div style={{ width: Math.min(100, totals.pct) + "%", height: "100%", background: totals.pct > 90 ? T.red : T.green, borderRadius: 999 }} />
                </div>
                <span className="num" style={{ fontSize: 13, color: T.muted }}>
                  {money(totals.spent)} spent of {money(totals.allocated)}{view === "overall" ? " accrued since Jun 2026" : ""}
                </span>
              </div>
            </>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginTop: 10 }}>
                <span className="serif num" style={{ fontSize: 64, lineHeight: 1 }}>{money(positionTotal)}</span>
                <span className="serif" style={{ fontSize: 26, color: T.muted, fontStyle: "italic" }}>across your accounts</span>
              </div>
              {positionTotal > 0 && (
                <div style={{ display: "flex", maxWidth: 420, height: 8, borderRadius: 999, overflow: "hidden", marginTop: 14 }}>
                  {accounts.filter((a) => a.balance > 0).map((a, i) => (
                    <div key={i} title={a.account} style={{ width: (a.balance / positionTotal) * 100 + "%", background: a.color }} />
                  ))}
                </div>
              )}
            </>
          )}
        </header>

        {status === "error" && (
          <div style={{ display: "flex", gap: 9, background: T.redTint, color: T.red, padding: "12px 14px", borderRadius: 12, fontSize: 13, marginBottom: 18 }}>
            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>Couldn't reach the sheet. Open the <b>/exec</b> link in a tab to check it returns JSON, then refresh.</span>
          </div>
        )}

        {page === "budget" ? (<>
        {/* ── envelopes ── */}
        <section style={{ marginBottom: 26 }}>
          <div className="cardgrid">
            {rows.map((r, i) => {
              const tone = fillTone(r);
              const active = activeBucket === r.bucket;
              return (
                <div key={i} className="env" role="button" tabIndex={0}
                  onClick={() => !active && openCard(r.bucket)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !active) openCard(r.bucket); if (e.key === "Escape" && active) closeCard(); }}
                  style={active ? { cursor: "default", borderColor: r.color } : {}}>
                  {/* identity spine */}
                  <div aria-hidden style={{ position: "absolute", top: 0, left: 0, width: 5, height: "100%", background: r.color, zIndex: 1 }} />
                  {/* the draining fill */}
                  <div className="envfill" aria-hidden style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: (active ? 0 : r.leftPct) + "%", background: tone.fill }} />

                  {!active ? (
                    <>
                      <div style={{ position: "relative", paddingLeft: 6 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                          <div className="serif" style={{ fontSize: 22, lineHeight: 1.1, color: r.color }}>{r.bucket}</div>
                          {tone.badge && (
                            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", background: tone.badge.bg, color: tone.badge.fg, borderRadius: 999, padding: "3px 8px", flexShrink: 0 }}>
                              {tone.badge.text}
                            </span>
                          )}
                        </div>
                        {r.where && <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: T.muted, marginTop: 4 }}>{r.where}</div>}
                      </div>
                      <div style={{ position: "relative", paddingLeft: 6 }}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                          <span className="serif num" style={{ fontSize: 30, color: r.left < 0 ? T.red : T.ink }}>{money(r.left)}</span>
                          <span style={{ fontSize: 11, fontWeight: 600, color: r.left < 0 ? T.red : T.muted }}>{r.left < 0 ? "over" : "left"}</span>
                        </div>
                        <div className="num" style={{ fontSize: 11, color: T.muted, marginTop: 3 }}>{money(r.spent)} spent of {money(r.pot)}</div>
                      </div>
                    </>
                  ) : (
                    /* the card flips into a quick-log form */
                    <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 9 }} onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span className="serif" style={{ fontSize: 19 }}>{r.bucket}</span>
                        <button className="ghost" style={{ padding: 5 }} onClick={closeCard} aria-label="Cancel"><X size={15} /></button>
                      </div>
                      <div style={{ display: "flex", background: "#EFEBE0", borderRadius: 999, padding: 3 }}>
                        {[["out", "Spent"], ["in", "Add money"]].map(([k, lbl]) => (
                          <button key={k} onClick={() => setFFlow(k)}
                            style={{ flex: 1, border: "none", cursor: "pointer", borderRadius: 999, padding: "5px 0", fontSize: 12, fontWeight: 700, fontFamily: "inherit",
                              background: fFlow === k ? T.card : "transparent",
                              color: fFlow === k ? (k === "in" ? T.green : T.ink) : T.muted,
                              boxShadow: fFlow === k ? "0 1px 3px rgba(24,36,32,.12)" : "none" }}>
                            {lbl}
                          </button>
                        ))}
                      </div>
                      <input ref={amountRef} value={fAmount} onChange={(e) => setFAmount(e.target.value.replace(/[^0-9]/g, ""))}
                        onKeyDown={(e) => { if (e.key === "Enter") logSpend(); if (e.key === "Escape") closeCard(); }}
                        placeholder="₹ amount" inputMode="numeric"
                        style={{ border: `1px solid ${T.line}`, borderRadius: 10, padding: "10px 12px", fontSize: 17, fontWeight: 600, width: "100%" }} />
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {CHIPS.map((c) => <button key={c} className="chipbtn" onClick={() => chip(c)}>+{c}</button>)}
                      </div>
                      <input value={fDesc} onChange={(e) => setFDesc(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") logSpend(); if (e.key === "Escape") closeCard(); }}
                        placeholder="What was it? (optional)"
                        style={{ border: `1px solid ${T.line}`, borderRadius: 10, padding: "9px 12px", fontSize: 13, width: "100%" }} />
                      <button className="primary" onClick={logSpend} disabled={!Number(fAmount)}
                        style={{ opacity: Number(fAmount) ? 1 : 0.45 }}>
                        {fFlow === "in" ? "Add" : "Log"} {Number(fAmount) ? money(Number(fAmount)) : ""}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* ── where it went + passbook ── */}
        <section className="grid2">
          <div className="panel">
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <PieIcon size={15} color={T.green} />
              <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: T.green }}>Where it went</span>
            </div>
            {pieData.length === 0 ? (
              <div style={{ fontSize: 13, color: T.muted, marginTop: 10 }}>Log your first spend and the picture starts here.</div>
            ) : (
              <div style={{ height: 230 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={48} outerRadius={82} paddingAngle={2}>
                      {pieData.map((e, i) => <Cell key={i} fill={e.color} />)}
                    </Pie>
                    <Tooltip formatter={(v) => money(v)} contentStyle={{ borderRadius: 10, border: `1px solid ${T.line}`, fontFamily: "inherit", fontSize: 13 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="panel">
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <BookOpen size={15} color={T.ink} />
              <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase" }}>Passbook</span>
            </div>
            {recent.length === 0 ? (
              <div style={{ fontSize: 13, color: T.muted, marginTop: 10 }}>Nothing logged yet — tap any envelope above.</div>
            ) : (
              <div>
                {recent.map((s, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: i < recent.length - 1 ? `1px solid ${T.line}` : "none" }}>
                    <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999, background: colorOf(s.bucket), flexShrink: 0 }} />
                    <span className="num" style={{ fontSize: 11, color: T.muted, width: 52, flexShrink: 0 }}>{niceDate(s.date)}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 14, fontWeight: 600 }}>{s.description || s.bucket}</span>
                      <span style={{ fontSize: 11, color: T.muted, marginLeft: 7 }}>{s.bucket}</span>
                    </span>
                    <span className="serif num" style={{ fontSize: 17, color: s.amount < 0 ? T.green : T.ink }}>
                      {s.amount < 0 ? "+" + money(-s.amount) : money(s.amount)}
                    </span>
                    <button className="ghost" style={{ padding: 4 }} onClick={() => deleteSpend(s)} aria-label={"Delete " + s.description}>
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
        </>) : (
        /* ── Position page: account cards ── */
        <section className="cardgrid">
          {accounts.length === 0 ? (
            <div className="panel" style={{ fontSize: 13, color: T.muted, gridColumn: "1 / -1" }}>
              No accounts found. Add an <b>Accounts</b> tab to the sheet with Account / Balance / Updated headers on row 1.
            </div>
          ) : accounts.map((a, i) => {
            const active = activeAccount === a.account;
            return (
              <div key={i} className="env" role="button" tabIndex={0} style={{ minHeight: 140, ...(active ? { cursor: "default", borderColor: a.color } : {}) }}
                onClick={() => !active && openAccount(a.account, a.balance)}
                onKeyDown={(e) => { if (e.key === "Enter" && !active) openAccount(a.account, a.balance); if (e.key === "Escape" && active) closeAccount(); }}>
                <div aria-hidden style={{ position: "absolute", top: 0, left: 0, width: 5, height: "100%", background: a.color, zIndex: 1 }} />
                <div aria-hidden style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "34%", background: tint(a.color, "1C") }} />
                {!active ? (
                  <>
                    <div style={{ position: "relative", paddingLeft: 6 }}>
                      <div className="serif" style={{ fontSize: 21, lineHeight: 1.1, color: a.color }}>{a.account}</div>
                      {a.updated && <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: T.muted, marginTop: 4 }}>as of {niceDate(a.updated)}</div>}
                    </div>
                    <div style={{ position: "relative", paddingLeft: 6 }}>
                      <span className="serif num" style={{ fontSize: 30 }}>{money(a.balance)}</span>
                    </div>
                  </>
                ) : (
                  <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 9 }} onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span className="serif" style={{ fontSize: 19 }}>{a.account}</span>
                      <button className="ghost" style={{ padding: 5 }} onClick={closeAccount} aria-label="Cancel"><X size={15} /></button>
                    </div>
                    <input ref={balanceRef} value={fBalance} onChange={(e) => setFBalance(e.target.value.replace(/[^0-9]/g, ""))}
                      onKeyDown={(e) => { if (e.key === "Enter") saveBalance(); if (e.key === "Escape") closeAccount(); }}
                      placeholder="₹ current balance" inputMode="numeric"
                      style={{ border: `1px solid ${T.line}`, borderRadius: 10, padding: "10px 12px", fontSize: 17, fontWeight: 600, width: "100%" }} />
                    <button className="primary" onClick={saveBalance}>Update balance</button>
                  </div>
                )}
              </div>
            );
          })}
        </section>
        )}
      </div>

      {/* ── toast with undo ── */}
      {toast && (
        <div className="toastin" style={{ position: "fixed", bottom: 26, left: "50%", transform: "translateX(-50%)",
          background: T.ink, color: "#fff", borderRadius: 12, padding: "12px 16px", fontSize: 14,
          display: "flex", alignItems: "center", gap: 14, boxShadow: "0 10px 30px rgba(24,36,32,.25)", zIndex: 50 }}>
          <span>{toast.text}</span>
          {toast.spend && <button onClick={undoSpend} style={{ border: "none", background: "transparent", color: T.mintDeep, fontWeight: 700,
            fontSize: 13, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5, fontFamily: "inherit" }}>
            <Undo2 size={14} /> Undo
          </button>}
        </div>
      )}
    </div>
  );
}

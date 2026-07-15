import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { RefreshCw, AlertCircle, Plus, X, Undo2, PieChart as PieIcon, BookOpen } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

// Live endpoint: Money Spends 2026 sheet (Budget + Spends tabs)
const DATA_URL = "https://script.google.com/macros/s/AKfycbzC4jsXe7Zo_ga_soFnCWMVZF0wFCw1kbwbc0tmBxWqheX1yrTs9PvjuUtrI0HHVfQy/exec";

/* Palette — grounded in banknote ink & warm paper */
const T = {
  paper: "#FAF8F3", card: "#FFFFFF", line: "#E7E2D6",
  ink: "#182420", muted: "#8A8578",
  green: "#1E6B4E", mint: "#DEF0E5", mintDeep: "#BCE0CB",
  gold: "#C98F1A", goldTint: "#F7ECD4",
  red: "#C43D2E", redTint: "#F8E4E0",
};
const PIE = ["#1E6B4E", "#C98F1A", "#3E7CB1", "#8A5A83", "#C43D2E", "#5F7161", "#A0722D", "#2E5E6B", "#7A6B4F"];

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
  const [activeBucket, setActiveBucket] = useState(null); // card in log mode
  const [fDesc, setFDesc] = useState("");
  const [fAmount, setFAmount] = useState("");
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
    const bi = h.indexOf("bucket"), ai = h.indexOf("amount"), wi = h.indexOf("where");
    return budgetRows.slice(hi + 1).map((r) => ({
      bucket: String(r[bi] || "").trim(),
      amount: Number(String(r[ai] || "0").replace(/[^0-9.-]/g, "")) || 0,
      where: wi >= 0 ? String(r[wi] || "").trim() : "",
    })).filter((b) => b.bucket && b.bucket.toLowerCase() !== "total");
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

  const rows = useMemo(() => buckets.map((b) => {
    const spent = spends.filter((s) => s.bucket === b.bucket).reduce((n, s) => n + s.amount, 0);
    const left = b.amount - spent;
    return { ...b, spent, left, leftPct: b.amount ? Math.max(0, Math.min(100, (left / b.amount) * 100)) : 0 };
  }), [buckets, spends]);

  const totals = useMemo(() => {
    const allocated = rows.reduce((n, r) => n + r.amount, 0);
    const spent = rows.reduce((n, r) => n + r.spent, 0);
    return { allocated, spent, left: allocated - spent, pct: allocated ? (spent / allocated) * 100 : 0 };
  }, [rows]);

  const pieData = rows.filter((r) => r.spent > 0).map((r) => ({ name: r.bucket, value: r.spent }));
  const recent = [...spends].reverse().slice(0, 9);

  /* ── actions ───────────────────────────────────────── */
  const openCard = (bucket) => {
    setActiveBucket(bucket);
    setFDesc(""); setFAmount("");
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
    const today = new Date().toISOString().split("T")[0];
    const spend = { date: today, bucket: activeBucket, description: fDesc.trim(), amount: amt };
    setSpendRows((r) => [...r, [today, spend.bucket, spend.description, String(amt)]]);
    closeCard();
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
  const fillTone = (r) => r.left < 0 ? { fill: T.redTint, edge: T.red }
    : r.leftPct <= 25 ? { fill: T.goldTint, edge: T.gold }
    : { fill: T.mint, edge: T.green };

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
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: T.muted }}>
              Money Spends 2026
            </div>
            <button className="ghost" onClick={load} aria-label="Refresh">
              <RefreshCw size={15} className={status === "loading" ? "spin" : ""} />
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginTop: 10 }}>
            <span className="serif num" style={{ fontSize: 64, lineHeight: 1, color: totals.left < 0 ? T.red : T.ink }}>
              {money(totals.left)}
            </span>
            <span className="serif" style={{ fontSize: 26, color: T.muted, fontStyle: "italic" }}>left to spend</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 12 }}>
            <div style={{ flex: 1, maxWidth: 340, background: "#EDE9DD", borderRadius: 999, height: 6, overflow: "hidden" }}>
              <div style={{ width: Math.min(100, totals.pct) + "%", height: "100%", background: totals.pct > 90 ? T.red : T.green, borderRadius: 999 }} />
            </div>
            <span className="num" style={{ fontSize: 13, color: T.muted }}>
              {money(totals.spent)} spent of {money(totals.allocated)}
            </span>
          </div>
        </header>

        {status === "error" && (
          <div style={{ display: "flex", gap: 9, background: T.redTint, color: T.red, padding: "12px 14px", borderRadius: 12, fontSize: 13, marginBottom: 18 }}>
            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>Couldn't reach the sheet. Open the <b>/exec</b> link in a tab to check it returns JSON, then refresh.</span>
          </div>
        )}

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
                  style={active ? { cursor: "default", borderColor: T.green } : {}}>
                  {/* the draining fill */}
                  <div className="envfill" aria-hidden style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: (active ? 0 : r.leftPct) + "%", background: tone.fill }} />

                  {!active ? (
                    <>
                      <div style={{ position: "relative" }}>
                        <div className="serif" style={{ fontSize: 22, lineHeight: 1.1 }}>{r.bucket}</div>
                        {r.where && <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: T.muted, marginTop: 4 }}>{r.where}</div>}
                      </div>
                      <div style={{ position: "relative" }}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                          <span className="serif num" style={{ fontSize: 30, color: r.left < 0 ? T.red : T.ink }}>{money(r.left)}</span>
                          <span style={{ fontSize: 11, fontWeight: 600, color: tone.edge }}>{r.left < 0 ? "over" : "left"}</span>
                        </div>
                        <div className="num" style={{ fontSize: 11, color: T.muted, marginTop: 3 }}>{money(r.spent)} spent of {money(r.amount)}</div>
                      </div>
                    </>
                  ) : (
                    /* the card flips into a quick-log form */
                    <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 9 }} onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span className="serif" style={{ fontSize: 19 }}>{r.bucket}</span>
                        <button className="ghost" style={{ padding: 5 }} onClick={closeCard} aria-label="Cancel"><X size={15} /></button>
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
                        Log {Number(fAmount) ? money(Number(fAmount)) : "spend"}
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
                      {pieData.map((e, i) => <Cell key={i} fill={PIE[i % PIE.length]} />)}
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
                    <span className="num" style={{ fontSize: 11, color: T.muted, width: 52, flexShrink: 0 }}>{niceDate(s.date)}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 14, fontWeight: 600 }}>{s.description || s.bucket}</span>
                      <span style={{ fontSize: 11, color: T.muted, marginLeft: 7 }}>{s.bucket}</span>
                    </span>
                    <span className="serif num" style={{ fontSize: 17 }}>{money(s.amount)}</span>
                    <button className="ghost" style={{ padding: 4 }} onClick={() => deleteSpend(s)} aria-label={"Delete " + s.description}>
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* ── toast with undo ── */}
      {toast && (
        <div className="toastin" style={{ position: "fixed", bottom: 26, left: "50%", transform: "translateX(-50%)",
          background: T.ink, color: "#fff", borderRadius: 12, padding: "12px 16px", fontSize: 14,
          display: "flex", alignItems: "center", gap: 14, boxShadow: "0 10px 30px rgba(24,36,32,.25)", zIndex: 50 }}>
          <span>{toast.text}</span>
          <button onClick={undoSpend} style={{ border: "none", background: "transparent", color: T.mintDeep, fontWeight: 700,
            fontSize: 13, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5, fontFamily: "inherit" }}>
            <Undo2 size={14} /> Undo
          </button>
        </div>
      )}
    </div>
  );
}

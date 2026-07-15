import React, { useState, useEffect, useMemo, useCallback } from "react";
import { RefreshCw, AlertCircle, Plus, Wallet, TrendingDown, PieChart as PieIcon, Receipt, X } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

// Live endpoint: Money Spends 2026 sheet (Budget + Spends tabs)
const DATA_URL = "https://script.google.com/macros/s/AKfycbzC4jsXe7Zo_ga_soFnCWMVZF0wFCw1kbwbc0tmBxWqheX1yrTs9PvjuUtrI0HHVfQy/exec";

const C = {
  ink: "#1c2333", paper: "#f4f6f8", card: "#ffffff", line: "#e2e6ec",
  muted: "#78808f",
  teal: "#0e7c7b", green: "#2e7d51", greenBg: "#e4f2ea",
  amber: "#b8860b", amberBg: "#fbf0d9",
  red: "#c0392b", redBg: "#fbeae8",
  navy: "#1f2d4a",
};
const PALETTE = ["#0e7c7b", "#2e7d51", "#b8860b", "#c0392b", "#5b4b8a", "#1f6f8b", "#a0522d", "#556b2f", "#8b3a62"];

const post = (payload) =>
  fetch(DATA_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(payload) });

const money = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");
const fmtDate = (v) => {
  const s = String(v == null ? "" : v).trim();
  if (!s) return "";
  if (s.includes("T")) return s.split("T")[0];
  return s;
};

export default function App() {
  const [budgetRows, setBudgetRows] = useState([]);
  const [spendRows, setSpendRows] = useState([]);
  const [status, setStatus] = useState("loading");
  const [updated, setUpdated] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [fBucket, setFBucket] = useState("");
  const [fDesc, setFDesc] = useState("");
  const [fAmount, setFAmount] = useState("");

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
      setUpdated(new Date());
      setStatus("ok");
    } catch (e) { setStatus("error"); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(() => { if (!showForm) load(); }, 60000);
    return () => clearInterval(id);
  }, [load, showForm]);

  // parse budget: Bucket | Amount | Where
  const buckets = useMemo(() => {
    if (!budgetRows.length) return [];
    let hi = budgetRows.findIndex((r) => {
      const cells = r.map((c) => String(c).toLowerCase().trim());
      return cells.includes("bucket") && cells.includes("amount");
    });
    if (hi === -1) hi = 0;
    const headers = budgetRows[hi].map((h) => String(h).trim().toLowerCase());
    const bi = headers.indexOf("bucket"), ai = headers.indexOf("amount"), wi = headers.indexOf("where");
    return budgetRows.slice(hi + 1).map((r) => ({
      bucket: String(r[bi] || "").trim(),
      amount: Number(String(r[ai] || "0").replace(/[^0-9.-]/g, "")) || 0,
      where: wi >= 0 ? String(r[wi] || "").trim() : "",
    })).filter((b) => b.bucket && b.bucket.toLowerCase() !== "total");
  }, [budgetRows]);

  // parse spends: Date | Bucket | Description | Amount
  const spends = useMemo(() => {
    if (!spendRows.length) return [];
    let hi = spendRows.findIndex((r) => {
      const cells = r.map((c) => String(c).toLowerCase().trim());
      return cells.includes("bucket") && cells.includes("amount");
    });
    if (hi === -1) hi = 0;
    const headers = spendRows[hi].map((h) => String(h).trim().toLowerCase());
    const di = headers.indexOf("date"), bi = headers.indexOf("bucket"), si = headers.indexOf("description"), ai = headers.indexOf("amount");
    return spendRows.slice(hi + 1).map((r) => ({
      date: fmtDate(r[di]),
      bucket: String(r[bi] || "").trim(),
      description: si >= 0 ? String(r[si] || "").trim() : "",
      amount: Number(String(r[ai] || "0").replace(/[^0-9.-]/g, "")) || 0,
    })).filter((s) => s.bucket || s.amount);
  }, [spendRows]);

  // derive per-bucket spent / left
  const rows = useMemo(() => buckets.map((b) => {
    const spent = spends.filter((s) => s.bucket === b.bucket).reduce((n, s) => n + s.amount, 0);
    return { ...b, spent, left: b.amount - spent, pct: b.amount ? Math.min(100, (spent / b.amount) * 100) : 0 };
  }), [buckets, spends]);

  const totals = useMemo(() => {
    const allocated = rows.reduce((n, r) => n + r.amount, 0);
    const spent = rows.reduce((n, r) => n + r.spent, 0);
    return { allocated, spent, left: allocated - spent, pct: allocated ? (spent / allocated) * 100 : 0 };
  }, [rows]);

  const pieData = rows.filter((r) => r.spent > 0).map((r) => ({ name: r.bucket, value: r.spent }));
  const barData = rows.map((r) => ({ name: r.bucket.length > 12 ? r.bucket.slice(0, 11) + "…" : r.bucket, Spent: r.spent, Left: Math.max(0, r.left) }));
  const recent = [...spends].reverse().slice(0, 8);

  const openLogFor = (bucket) => {
    setFBucket(bucket);
    setShowForm(true);
    setTimeout(() => {
      const el = document.getElementById("spend-desc");
      if (el) { el.focus(); el.scrollIntoView({ behavior: "smooth", block: "center" }); }
    }, 60);
  };

  const addSpend = async () => {
    const amt = Number(fAmount);
    if (!fBucket || !amt) return;
    const today = new Date().toISOString().split("T")[0];
    const desc = fDesc.trim();
    setSpendRows((r) => [...r, [today, fBucket, desc, String(amt)]]);
    setFDesc(""); setFAmount(""); setShowForm(false);
    try { await post({ action: "addSpend", date: today, bucket: fBucket, description: desc, amount: amt }); } catch {}
  };

  const deleteSpend = async (s) => {
    setSpendRows((r) => r.filter((row) =>
      !(String(row[1]).trim() === s.bucket && String(row[2]).trim() === s.description && Number(row[3]) === s.amount)));
    try { await post({ action: "deleteSpend", bucket: s.bucket, description: s.description, amount: s.amount }); } catch {}
  };

  const barColor = (r) => r.left < 0 ? C.red : r.pct > 80 ? C.amber : C.green;

  return (
    <div style={{ background: C.paper, minHeight: "100vh", fontFamily: "'Inter', system-ui, sans-serif", color: C.ink }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Fraunces:opsz,wght@9..144,600;9..144,700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: ${C.paper}; }
        .display { font-family: 'Fraunces', serif; }
        .panel { background:${C.card}; border:1px solid ${C.line}; border-radius:14px; padding:18px; }
        .spin { animation: spin 1s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }
        .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
        .cardgrid { display:grid; grid-template-columns:repeat(3, 1fr); gap:14px; }
        .bucketcard { transition: box-shadow .15s, transform .15s, border-color .15s; }
        .bucketcard:hover { box-shadow:0 6px 18px rgba(31,45,74,.10); transform:translateY(-2px); border-color:#c9d2dd!important; }
        .cardhint { opacity:0; transition:opacity .15s; }
        .bucketcard:hover .cardhint { opacity:1; }
        input,select { font-family:inherit; }
        @media (max-width:900px){ .cardgrid{ grid-template-columns:repeat(2, 1fr); } }
        @media (max-width:800px){ .grid2{ grid-template-columns:1fr; } .wrap{ padding:16px 12px 60px!important; } .hdr{ flex-direction:column; align-items:flex-start!important; gap:14px!important; } }
        @media (max-width:560px){ .cardgrid{ grid-template-columns:1fr; } .cardhint{ opacity:1; } }
      `}</style>

      <div className="wrap" style={{ maxWidth: 1060, margin: "0 auto", padding: "26px 20px 80px" }}>
        {/* header */}
        <div style={{ background: C.navy, borderRadius: 16, padding: "20px 22px", marginBottom: 16 }}>
          <div className="hdr" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
            <div>
              <h1 className="display" style={{ fontSize: 26, color: "#fff", lineHeight: 1 }}>Money Spends 2026</h1>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".1em", color: "#98a4bd", textTransform: "uppercase", marginTop: 5 }}>Bucket budget · rolls over monthly</div>
            </div>
            <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
              <Stat label="Allocated" value={money(totals.allocated)} color="#fff" />
              <Stat label="Spent" value={money(totals.spent)} color="#f2b544" />
              <Stat label="Left" value={money(totals.left)} color={totals.left < 0 ? "#ff8a80" : "#7ddba3"} />
              <button onClick={load} style={{ border: "1px solid rgba(255,255,255,.25)", background: "rgba(255,255,255,.12)", borderRadius: 10, padding: 9, cursor: "pointer", color: "#fff", display: "inline-flex" }}>
                <RefreshCw size={15} className={status === "loading" ? "spin" : ""} />
              </button>
            </div>
          </div>
          {/* overall bar */}
          <div style={{ marginTop: 16, background: "rgba(255,255,255,.15)", borderRadius: 999, height: 8, overflow: "hidden" }}>
            <div style={{ width: Math.min(100, totals.pct) + "%", height: "100%", background: totals.pct > 90 ? "#ff8a80" : "#7ddba3", borderRadius: 999 }} />
          </div>
          <div style={{ fontSize: 11, color: "#98a4bd", marginTop: 6 }}>{totals.pct.toFixed(0)}% of budget used</div>
        </div>

        {status === "error" && (
          <Banner icon={<AlertCircle size={16} />}>
            Couldn't load. Check the Apps Script <b>/exec</b> URL returns JSON and access is <b>Anyone</b>.
          </Banner>
        )}

        {/* add spend */}
        <div className="panel" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Label icon={<Receipt size={15} color={C.teal} />} text="Log a spend" color={C.teal} />
            <button onClick={() => setShowForm((s) => !s)} style={{ border: `1px solid ${C.teal}`, color: C.teal, background: "#fff", borderRadius: 8, padding: "5px 11px", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5 }}>
              <Plus size={13} /> Add
            </button>
          </div>
          {showForm && (
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              <select value={fBucket} onChange={(e) => setFBucket(e.target.value)} style={{ border: `1px solid ${C.line}`, borderRadius: 8, padding: "9px 10px", fontSize: 13, minWidth: 160 }}>
                <option value="">Which bucket…</option>
                {rows.map((r, i) => <option key={i} value={r.bucket}>{r.bucket}</option>)}
              </select>
              <input id="spend-desc" value={fDesc} onChange={(e) => setFDesc(e.target.value)} placeholder="What was it?" style={{ border: `1px solid ${C.line}`, borderRadius: 8, padding: "9px 10px", fontSize: 13, flex: 1, minWidth: 140 }} />
              <input value={fAmount} onChange={(e) => setFAmount(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addSpend()} placeholder="Amount" inputMode="numeric" style={{ border: `1px solid ${C.line}`, borderRadius: 8, padding: "9px 10px", fontSize: 13, width: 110 }} />
              <button onClick={addSpend} style={{ background: C.teal, color: "#fff", border: "none", borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Log</button>
            </div>
          )}
        </div>

        {/* bucket cards */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 12 }}>
            <Label icon={<Wallet size={15} color={C.green} />} text="Buckets" color={C.green} count={rows.length} />
          </div>
          {rows.length === 0 ? (
            <div className="panel" style={{ fontSize: 13, color: C.muted }}>No buckets found. Check the Budget tab has Bucket / Amount headers on row 1.</div>
          ) : (
            <div className="cardgrid">
              {rows.map((r, i) => {
                const col = barColor(r);
                return (
                  <div key={i} className="bucketcard" onClick={() => openLogFor(r.bucket)}
                    style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: 16, cursor: "pointer", position: "relative", overflow: "hidden" }}>
                    <div style={{ position: "absolute", top: 0, left: 0, width: 4, height: "100%", background: col }} />
                    <div className="display" style={{ fontSize: 19, fontWeight: 700, lineHeight: 1.15, paddingLeft: 6 }}>{r.bucket}</div>
                    {r.where && <div style={{ fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 700, marginTop: 4, paddingLeft: 6 }}>{r.where}</div>}

                    <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 14, paddingLeft: 6 }}>
                      <span className="display" style={{ fontSize: 26, fontWeight: 700, color: r.left < 0 ? C.red : C.ink, lineHeight: 1 }}>{money(r.left)}</span>
                      <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>left</span>
                    </div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 4, paddingLeft: 6 }}>
                      {money(r.spent)} spent of {money(r.amount)}
                    </div>

                    <div style={{ background: "#eef1f5", borderRadius: 999, height: 6, overflow: "hidden", marginTop: 12, marginLeft: 6 }}>
                      <div style={{ width: r.pct + "%", height: "100%", background: col, borderRadius: 999, transition: "width .3s" }} />
                    </div>

                    <div className="cardhint" style={{ fontSize: 11, color: C.teal, fontWeight: 700, marginTop: 10, paddingLeft: 6, display: "flex", alignItems: "center", gap: 4 }}>
                      <Plus size={12} /> Log a spend
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* charts */}
        <div className="grid2" style={{ marginBottom: 16 }}>
          <div className="panel">
            <Label icon={<PieIcon size={15} color={C.teal} />} text="Where it went" color={C.teal} />
            {pieData.length === 0 ? <div style={{ fontSize: 13, color: C.muted, marginTop: 12 }}>No spends logged yet.</div> : (
              <div style={{ height: 240, marginTop: 10 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={85} label={(d) => d.name}>
                      {pieData.map((e, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v) => money(v)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
          <div className="panel">
            <Label icon={<TrendingDown size={15} color={C.amber} />} text="Spent vs left" color={C.amber} />
            <div style={{ height: 240, marginTop: 10 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barData} margin={{ top: 5, right: 5, left: -18, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef1f5" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-35} textAnchor="end" interval={0} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v) => money(v)} />
                  <Bar dataKey="Spent" stackId="a" fill={C.amber} />
                  <Bar dataKey="Left" stackId="a" fill="#dbe3ea" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* recent */}
        <div className="panel">
          <Label icon={<Receipt size={15} color={C.navy} />} text="Recent spends" color={C.navy} count={spends.length} />
          {recent.length === 0 ? <div style={{ fontSize: 13, color: C.muted, marginTop: 10 }}>Nothing logged yet.</div> : (
            <div style={{ display: "flex", flexDirection: "column", marginTop: 10 }}>
              {recent.map((s, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, fontSize: 13, borderBottom: i < recent.length - 1 ? `1px solid ${C.line}` : "none", padding: "9px 0" }}>
                  <span style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontWeight: 600 }}>{s.description || s.bucket}</span>
                    <span style={{ fontSize: 11, color: C.muted }}>{s.bucket} · {s.date}</span>
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <b>{money(s.amount)}</b>
                    <X size={14} color="#c4ccd6" style={{ cursor: "pointer" }} onClick={() => deleteSpend(s)} />
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {updated && status === "ok" && (
          <div style={{ fontSize: 12, color: C.muted, marginTop: 14 }}>Updated {updated.toLocaleTimeString()} · auto-refreshes every minute</div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div style={{ textAlign: "right" }}>
      <div className="display" style={{ fontSize: 19, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 9, color: "#98a4bd", textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 700, marginTop: 3 }}>{label}</div>
    </div>
  );
}
function Label({ icon, text, color, count }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {icon}
      <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color }}>{text}</span>
      {count != null && <span style={{ fontSize: 11, fontWeight: 700, color: "#78808f", background: "#eef1f5", borderRadius: 999, padding: "1px 8px" }}>{count}</span>}
    </div>
  );
}
function Banner({ icon, children }) {
  return (
    <div style={{ display: "flex", gap: 9, alignItems: "flex-start", background: "#fbeae8", color: "#c0392b", padding: "12px 14px", borderRadius: 12, fontSize: 13, lineHeight: 1.5, marginBottom: 16 }}>
      <span style={{ marginTop: 1 }}>{icon}</span><span>{children}</span>
    </div>
  );
}

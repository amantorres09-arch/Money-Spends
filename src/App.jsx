import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { RefreshCw, AlertCircle, Plus, X, Undo2, PieChart as PieIcon, BookOpen } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

// Live endpoint: Money Spends 2026 sheet (Budget + Spends tabs)
const DATA_URL = "https://script.google.com/macros/s/AKfycbwteEAC6RyVek1LHvDP_6Isj_vn--Yn6bKtC8i-ZznBW7fdwolKoMQUrWPKuO5dN4cf/exec";

// Budget start month (YYYY-MM). Rollover accrues from here: each bucket's
// overall pot = monthly amount × months elapsed. Edit this one line if it changes.
const BUDGET_START = "2026-06";

// months elapsed from BUDGET_START through a given YYYY-MM key (inclusive)
const monthsElapsedTo = (key) => {
  const [sy, sm] = BUDGET_START.split("-").map(Number);
  const [ky, km] = key.split("-").map(Number);
  return Math.max(1, (ky - sy) * 12 + (km - sm) + 1);
};
const thisMonthKey = () => {
  const now = new Date();
  return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
};
const monthsElapsed = () => monthsElapsedTo(thisMonthKey());
const addMonths = (key, n) => {
  let [y, m] = key.split("-").map(Number);
  m += n; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; }
  return y + "-" + String(m).padStart(2, "0");
};
// Collapses any reasonable spelling of a month to the one canonical "YYYY-MM"
// key everything else compares against. Handles a missing leading zero
// ("2026-7"), slashes ("2026/07"), and — the sneaky one — Google Sheets
// silently converting a typed "2026-07" into a real Date, which Apps Script
// then serializes as a full timestamp like "2026-07-01T00:00:00.000Z". Left
// unhandled, that timestamp still *displays* as "Jul 2026" (monthLabel parses
// loosely) but never matches the canonical key anywhere else — producing a
// second, phantom "Jul 2026" that looks identical but holds separate data.
const normalizeMonth = (raw) => {
  let s = String(raw == null ? "" : raw).trim();
  if (!s) return "";
  if (s.includes("T")) s = s.split("T")[0]; // strip the timestamp portion
  s = s.replace(/\//g, "-");
  const parts = s.split("-");
  if (parts.length >= 2 && /^\d{4}$/.test(parts[0]) && /^\d{1,2}$/.test(parts[1])) {
    return parts[0] + "-" + parts[1].padStart(2, "0");
  }
  return s;
};
const FUTURE_MONTHS_AHEAD = 3;

// Recurring income assumed to land each future month (e.g. salary). Purely
// additive to the projected "Total money you have" — edit this one line if it changes.
const MONTHLY_INCOME = 20000;

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
  const [npBucket, setNpBucket] = useState("");
  const [npMonth, setNpMonth] = useState("");
  const [npDesc, setNpDesc] = useState("");
  const [npAmount, setNpAmount] = useState("");
  const [planView, setPlanView] = useState("buckets"); // "buckets" | "monthly"
  const [monthlyRows, setMonthlyRows] = useState([]);
  const [mMonth, setMMonth] = useState("");
  const [mType, setMType] = useState("Fixed");
  const [mDesc, setMDesc] = useState("");
  const [mAmount, setMAmount] = useState("");
  const [mAccount, setMAccount] = useState("");
  const [posMonth, setPosMonth] = useState(""); // month stepper for the positioning summary strip
  const [showAddMoney, setShowAddMoney] = useState(false);
  const [amMonth, setAmMonth] = useState("");
  const [amDesc, setAmDesc] = useState("");
  const [amAmount, setAmAmount] = useState("");
  const [fBalance, setFBalance] = useState("");
  const balanceRef = useRef(null);

  const monthKeys = useMemo(() => {
    const keys = [];
    let [y, m] = BUDGET_START.split("-").map(Number);
    const lastFuture = addMonths(thisMonthKey(), FUTURE_MONTHS_AHEAD);
    while (true) {
      const k = y + "-" + String(m).padStart(2, "0");
      keys.push(k);
      if (k === lastFuture) break;
      m++; if (m > 12) { m = 1; y++; }
      if (keys.length > 240) break; // safety
    }
    return keys;
  }, []);
  const isFuture = (k) => k !== "overall" && k > thisMonthKey();
  useEffect(() => { if (!npMonth) setNpMonth(addMonths(thisMonthKey(), 1)); }, []);
  useEffect(() => { if (!mMonth) setMMonth(thisMonthKey()); }, []);
  useEffect(() => { if (!posMonth) setPosMonth(thisMonthKey()); }, []);
  useEffect(() => { if (!amMonth) setAmMonth(thisMonthKey()); }, []);
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
  const [plannedRows, setPlannedRows] = useState([]);
  const [activeBucket, setActiveBucket] = useState(null); // card in log mode
  const [fDesc, setFDesc] = useState("");
  const [fAmount, setFAmount] = useState("");
  const [fFlow, setFFlow] = useState("out"); // "out" spend | "in" money added | "plan" future expense
  const [fPlanMonth, setFPlanMonth] = useState("");
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
      setPlannedRows(clean(json.planned));
      setMonthlyRows(clean(json.monthly));
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

  const planned = useMemo(() => {
    if (!plannedRows.length) return [];
    let hi = plannedRows.findIndex((r) => {
      const c = r.map((x) => String(x).toLowerCase().trim());
      return c.includes("bucket") && c.includes("amount");
    });
    if (hi === -1) hi = 0;
    const h = plannedRows[hi].map((x) => String(x).trim().toLowerCase());
    const mi = h.indexOf("month"), bi = h.indexOf("bucket"), si = h.indexOf("description"), ai = h.indexOf("amount");
    return plannedRows.slice(hi + 1).map((r) => ({
      month: normalizeMonth(r[mi]),
      bucket: String(r[bi] || "").trim(),
      description: si >= 0 ? String(r[si] || "").trim() : "",
      amount: Number(String(r[ai] || "0").replace(/[^0-9.-]/g, "")) || 0,
    })).filter((p) => p.bucket && p.month);
  }, [plannedRows]);

  const scopedSpends = useMemo(() => {
    if (view === "overall") return spends;
    // A future month's pot must net out everything already spent to date —
    // not just spends dated in that (not-yet-arrived) month, which is always none.
    if (isFuture(view)) return spends;
    return spends.filter((s) => (s.date || "").slice(0, 7) === view);
  }, [spends, view]);

  // planned amounts scoped for MATH: cumulative through the viewed month, since
  // money planned for July is already spoken for by the time you're projecting August.
  const scopedPlanned = useMemo(() => {
    if (view === "overall") return planned.filter((p) => p.month >= thisMonthKey());
    if (isFuture(view)) return planned.filter((p) => p.month >= thisMonthKey() && p.month <= view);
    return [];
  }, [planned, view]);

  // planned amounts scoped for DISPLAY: only what's specifically slated for the
  // viewed month, so the Upcoming list doesn't mix in other months' plans.
  const monthPlanned = useMemo(() => planned.filter((p) => p.month === view), [planned, view]);

  const rows = useMemo(() => {
    const mult = view === "overall" ? monthsElapsed() : (isFuture(view) ? monthsElapsedTo(view) : 1);
    return buckets.map((b) => {
      const pot = b.amount * mult;
      const spent = scopedSpends.filter((s) => s.bucket === b.bucket).reduce((n, s) => n + s.amount, 0);
      const plannedAmt = scopedPlanned.filter((p) => p.bucket === b.bucket).reduce((n, p) => n + p.amount, 0);
      const left = pot - spent - plannedAmt;
      return { ...b, pot, spent, planned: plannedAmt, left, leftPct: pot ? Math.max(0, Math.min(100, (left / pot) * 100)) : 0 };
    });
  }, [buckets, scopedSpends, scopedPlanned, view]);

  const totals = useMemo(() => {
    const allocated = rows.reduce((n, r) => n + r.pot, 0);
    const spent = rows.reduce((n, r) => n + r.spent, 0);
    const reserved = rows.reduce((n, r) => n + r.planned, 0);
    return { allocated, spent, reserved, left: allocated - spent - reserved, pct: allocated ? ((spent + reserved) / allocated) * 100 : 0 };
  }, [rows]);

  const pieData = rows.filter((r) => r.spent > 0).map((r) => ({ name: r.bucket, value: r.spent, color: r.color }));
  const viewingFuture = isFuture(view);
  const recent = viewingFuture
    ? [...monthPlanned].reverse().slice(0, 9)
    : [...scopedSpends].reverse().slice(0, 9);
  const colorOf = useMemo(() => {
    const m = {};
    rows.forEach((r) => { m[r.bucket] = r.color; });
    return (bucket) => m[bucket] || T.muted;
  }, [rows]);

  /* ── actions ───────────────────────────────────────── */
  const openCard = (bucket) => {
    setActiveBucket(bucket);
    setFDesc(""); setFAmount("");
    const future = isFuture(view);
    setFFlow(future ? "plan" : "out");
    setFPlanMonth(future ? view : addMonths(thisMonthKey(), 1));
    setTimeout(() => amountRef.current?.focus(), 60);
  };
  const closeCard = () => { setActiveBucket(null); setFDesc(""); setFAmount(""); };

  const showToast = (text, spend) => {
    clearTimeout(toastTimer.current);
    setToast({ text, spend });
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  };

  const logSpend = async () => {
    const raw = Number(fAmount);
    if (!activeBucket || !raw) return;

    if (fFlow === "plan") {
      const month = fPlanMonth || addMonths(thisMonthKey(), 1);
      const item = { month, bucket: activeBucket, description: fDesc.trim(), amount: raw };
      setPlannedRows((r) => [...r, [month, item.bucket, item.description, String(raw)]]);
      closeCard();
      showToast("Planned " + money(raw) + " for " + item.bucket + " in " + monthLabel(month), null);
      try { await post({ action: "addPlanned", ...item }); } catch {}
      return;
    }

    const amt = fFlow === "in" ? -raw : raw;
    const today = localToday();
    const spend = { date: today, bucket: activeBucket, description: fDesc.trim(), amount: amt };
    setSpendRows((r) => [...r, [today, spend.bucket, spend.description, String(amt)]]);
    closeCard();
    if (view !== "overall") setView(today.slice(0, 7));
    showToast((fFlow === "in" ? "Added " : "Logged ") + money(raw) + " to " + spend.bucket, spend);
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

  const deletePlanned = async (p) => {
    setPlannedRows((r) => r.filter((row) =>
      !(String(row[0]).trim() === p.month && String(row[1]).trim() === p.bucket && String(row[2]).trim() === p.description && Number(row[3]) === p.amount)));
    try { await post({ action: "deletePlanned", month: p.month, bucket: p.bucket, description: p.description, amount: p.amount }); } catch {}
  };

  const addPlannedFromPage = async () => {
    const amt = Number(npAmount);
    if (!npBucket || !amt) return;
    const month = npMonth || addMonths(thisMonthKey(), 1);
    const item = { month, bucket: npBucket, description: npDesc.trim(), amount: amt };
    setPlannedRows((r) => [...r, [month, item.bucket, item.description, String(amt)]]);
    setNpDesc(""); setNpAmount("");
    showToast("Planned " + money(amt) + " for " + item.bucket + " in " + monthLabel(month), null);
    try { await post({ action: "addPlanned", ...item }); } catch {}
  };

  // everything currently planned (from now onward), grouped by month, chronological
  const plannedGroups = useMemo(() => {
    const upcoming = planned.filter((p) => p.month >= thisMonthKey()).sort((a, b) => a.month.localeCompare(b.month));
    const byMonth = {};
    const order = [];
    upcoming.forEach((p) => {
      if (!byMonth[p.month]) { byMonth[p.month] = []; order.push(p.month); }
      byMonth[p.month].push(p);
    });
    return order.map((m) => ({ month: m, items: byMonth[m], total: byMonth[m].reduce((n, p) => n + p.amount, 0) }));
  }, [planned]);
  const totalPlanned = plannedGroups.reduce((n, g) => n + g.total, 0);

  /* ── monthly ledger (Fixed / Saved / Misc) — independent of buckets ── */
  const monthlyEntries = useMemo(() => {
    if (!monthlyRows.length) return [];
    let hi = monthlyRows.findIndex((r) => {
      const c = r.map((x) => String(x).toLowerCase().trim());
      return c.includes("type") && c.includes("amount");
    });
    if (hi === -1) hi = 0;
    const h = monthlyRows[hi].map((x) => String(x).trim().toLowerCase());
    const mi = h.indexOf("month"), ti = h.indexOf("type"), si = h.indexOf("description"), ai = h.indexOf("amount"), acci = h.indexOf("account");
    return monthlyRows.slice(hi + 1).map((r) => ({
      month: normalizeMonth(r[mi]),
      type: String(r[ti] || "").trim() || "Misc",
      description: si >= 0 ? String(r[si] || "").trim() : "",
      amount: Number(String(r[ai] || "0").replace(/[^0-9.-]/g, "")) || 0,
      account: acci >= 0 ? String(r[acci] || "").trim() : "",
    })).filter((e) => e.month && e.amount);
  }, [monthlyRows]);

  // months shown: every month with an entry, plus current + 6 future always (per your ask)
  const ledgerMonths = useMemo(() => {
    const set = new Set(monthlyEntries.map((e) => e.month));
    let cur = thisMonthKey();
    for (let i = 0; i <= FUTURE_MONTHS_AHEAD; i++) set.add(addMonths(cur, i));
    return [...set].sort();
  }, [monthlyEntries]);

  const ledgerByMonth = useMemo(() => {
    return ledgerMonths.map((m) => {
      const items = monthlyEntries.filter((e) => e.month === m);
      const byType = (t) => items.filter((e) => e.type === t);
      const sum = (list) => list.reduce((n, e) => n + e.amount, 0);
      const fixed = byType("Fixed"), saved = byType("Saved"), misc = byType("Misc");
      return { month: m, fixed, saved, misc, fixedTotal: sum(fixed), savedTotal: sum(saved), miscTotal: sum(misc) };
    });
  }, [ledgerMonths, monthlyEntries]);

  const addMonthlyEntry = async () => {
    const amt = Number(mAmount);
    if (!mMonth || !amt) return;
    const item = { month: mMonth, type: mType, description: mDesc.trim(), amount: amt, account: (mType === "Saved" || mType === "Income") ? mAccount : "" };
    setMonthlyRows((r) => [...r, [item.month, item.type, item.description, String(amt), item.account]]);
    setMDesc(""); setMAmount("");
    showToast("Added " + money(amt) + " (" + mType + ") for " + monthLabel(mMonth), null);
    try { await post({ action: "addMonthly", ...item }); } catch {}
  };

  const addMoney = async () => {
    const amt = Number(amAmount);
    if (!amt) return;
    const month = amMonth || posMonth;
    const item = { month, type: "Income", description: amDesc.trim(), amount: amt, account: "" };
    setMonthlyRows((r) => [...r, [item.month, item.type, item.description, String(amt), ""]]);
    setAmDesc(""); setAmAmount(""); setShowAddMoney(false);
    showToast("Added " + money(amt) + " for " + monthLabel(month), null);
    try { await post({ action: "addMonthly", ...item }); } catch {}
  };

  const deleteMonthlyEntry = async (e) => {
    setMonthlyRows((r) => r.filter((row) =>
      !(String(row[0]).trim() === e.month && String(row[1]).trim() === e.type && String(row[2]).trim() === e.description && Number(row[3]) === e.amount)));
    try { await post({ action: "deleteMonthly", month: e.month, type: e.type, description: e.description, amount: e.amount }); } catch {}
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

  // ── positioning strip: total money you have, and what a given month
  // commits to buckets + fixed costs, leaving what's actually spendable ──
  const stepPosMonth = (dir) => {
    const i = ledgerMonths.indexOf(posMonth);
    const next = ledgerMonths[i + dir];
    if (next) setPosMonth(next);
  };
  const posSummary = useMemo(() => {
    const forMonth = ledgerByMonth.find((g) => g.month === posMonth);
    const fixedTotal = forMonth ? forMonth.fixedTotal : 0;
    const unplannedTotal = forMonth ? forMonth.miscTotal : 0;

    // Trip savings: the specific Budget-tab bucket, accrued through posMonth,
    // netted against everything actually spent or planned against it by then.
    const tripBucket = buckets.find((b) => b.bucket.toLowerCase().includes("trip"));
    let tripSavings = 0;
    if (tripBucket) {
      const pot = tripBucket.amount * monthsElapsedTo(posMonth);
      const spentByThen = spends
        .filter((s) => s.bucket === tripBucket.bucket && (s.date || "").slice(0, 7) <= posMonth)
        .reduce((n, s) => n + s.amount, 0);
      const plannedByThen = planned
        .filter((p) => p.bucket === tripBucket.bucket && p.month <= posMonth)
        .reduce((n, p) => n + p.amount, 0);
      tripSavings = pot - spentByThen - plannedByThen;
    }

    // Projected total: your real balance today, plus recurring income for every
    // month you've stepped past, plus anything you've manually logged as Income
    // for those months. Stepping to next month always adds MONTHLY_INCOME on top
    // of wherever the running total already was — additive, so nothing is lost.
    const [ty, tm] = posMonth.split("-").map(Number);
    const [cy, cm] = thisMonthKey().split("-").map(Number);
    const monthsAhead = Math.max(0, (ty - cy) * 12 + (tm - cm));
    const recurringIncome = MONTHLY_INCOME * monthsAhead;
    const manualIncome = monthlyEntries
      .filter((e) => e.type === "Income" && e.month > thisMonthKey() && e.month <= posMonth)
      .reduce((n, e) => n + e.amount, 0);
    const projectedTotal = positionTotal + recurringIncome + manualIncome;

    const spendable = projectedTotal - fixedTotal - unplannedTotal - tripSavings;
    return { fixedTotal, unplannedTotal, tripSavings, spendable, hasTripBucket: !!tripBucket, projectedTotal, monthsAhead };
  }, [buckets, ledgerByMonth, posMonth, positionTotal, spends, planned, monthlyEntries]);

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
        .grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
        .grid4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
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
        @media (max-width: 880px) { .cardgrid { grid-template-columns: repeat(2, 1fr); } .grid2 { grid-template-columns: 1fr; } .grid3 { grid-template-columns: 1fr; } .grid4 { grid-template-columns: repeat(2, 1fr); } }
        @media (max-width: 540px) { .cardgrid { grid-template-columns: 1fr; } .grid4 { grid-template-columns: 1fr; } .wrap { padding: 22px 14px 90px; } }
      `}</style>

      <div className="wrap">
        {/* ── masthead: the one number that matters ── */}
        <header style={{ marginBottom: 30 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <nav aria-label="Pages" style={{ display: "flex", gap: 16, alignItems: "baseline" }}>
              {[["budget", "Budget"], ["position", "Position"], ["planning", "Planning"]].map(([k, lbl]) => (
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
                    background: view !== "overall" ? T.card : "transparent",
                    color: view === "overall" ? T.muted : (isFuture(view) ? "#3E7CB1" : T.ink),
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
                  {view === "overall" ? "free after plans"
                    : view === thisMonthKey() ? "left this month"
                    : isFuture(view) ? "projected for " + monthLabel(view)
                    : "unspent in " + monthLabel(view)}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 12, flexWrap: "wrap" }}>
                <div style={{ flex: 1, maxWidth: 340, background: "#EDE9DD", borderRadius: 999, height: 6, overflow: "hidden" }}>
                  <div style={{ width: Math.min(100, totals.pct) + "%", height: "100%", background: totals.pct > 90 ? T.red : T.green, borderRadius: 999 }} />
                </div>
                <span className="num" style={{ fontSize: 13, color: T.muted }}>
                  {isFuture(view)
                    ? money(totals.spent) + " spent so far + " + money(totals.reserved) + " planned, of " + money(totals.allocated)
                    : money(totals.spent) + " spent of " + money(totals.allocated)}
                  {view === "overall" ? " accrued since Jun 2026" : ""}
                  {view === "overall" && totals.reserved > 0 ? " · " + money(totals.reserved) + " reserved for plans" : ""}
                </span>
              </div>
            </>
          ) : page === "position" ? (
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
          ) : (
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginTop: 10 }}>
              <span className="serif num" style={{ fontSize: 64, lineHeight: 1, color: "#3E7CB1" }}>{money(totalPlanned)}</span>
              <span className="serif" style={{ fontSize: 26, color: T.muted, fontStyle: "italic" }}>
                spoken for, {plannedGroups.length} month{plannedGroups.length === 1 ? "" : "s"} ahead
              </span>
            </div>
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
                        {[["out", "Spent"], ["in", "Add money"], ["plan", "Plan ahead"]].map(([k, lbl]) => (
                          <button key={k} onClick={() => setFFlow(k)}
                            style={{ flex: 1, border: "none", cursor: "pointer", borderRadius: 999, padding: "5px 0", fontSize: 11, fontWeight: 700, fontFamily: "inherit",
                              background: fFlow === k ? T.card : "transparent",
                              color: fFlow === k ? (k === "in" ? T.green : k === "plan" ? "#3E7CB1" : T.ink) : T.muted,
                              boxShadow: fFlow === k ? "0 1px 3px rgba(24,36,32,.12)" : "none" }}>
                            {lbl}
                          </button>
                        ))}
                      </div>
                      {fFlow === "plan" && (
                        <select value={fPlanMonth} onChange={(e) => setFPlanMonth(e.target.value)}
                          style={{ border: `1px solid ${T.line}`, borderRadius: 10, padding: "9px 10px", fontSize: 13, width: "100%" }}>
                          {monthKeys.filter((k) => isFuture(k)).map((k) => <option key={k} value={k}>{monthLabel(k)}</option>)}
                        </select>
                      )}
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
                        style={{ opacity: Number(fAmount) ? 1 : 0.45, background: fFlow === "plan" ? "#3E7CB1" : T.green }}>
                        {fFlow === "plan" ? "Plan" : fFlow === "in" ? "Add" : "Log"} {Number(fAmount) ? money(Number(fAmount)) : ""}
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
              <div style={{ fontSize: 13, color: T.muted, marginTop: 10 }}>
                {viewingFuture ? "Nothing spent yet — this month hasn't arrived." : "Log your first spend and the picture starts here."}
              </div>
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
              <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase" }}>
                {viewingFuture ? "Upcoming" : "Passbook"}
              </span>
            </div>
            {recent.length === 0 ? (
              <div style={{ fontSize: 13, color: T.muted, marginTop: 10 }}>
                {viewingFuture ? "Nothing planned for " + monthLabel(view) + " yet — flip a card and choose Plan ahead." : "Nothing logged yet — tap any envelope above."}
              </div>
            ) : (
              <div>
                {recent.map((s, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: i < recent.length - 1 ? `1px solid ${T.line}` : "none" }}>
                    <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999, background: colorOf(s.bucket), flexShrink: 0 }} />
                    <span className="num" style={{ fontSize: 11, color: T.muted, width: 52, flexShrink: 0 }}>
                      {viewingFuture ? monthLabel(s.month).split(" ")[0] : niceDate(s.date)}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 14, fontWeight: 600 }}>{s.description || s.bucket}</span>
                      <span style={{ fontSize: 11, color: T.muted, marginLeft: 7 }}>{s.bucket}</span>
                    </span>
                    <span className="serif num" style={{ fontSize: 17, color: s.amount < 0 ? T.green : T.ink }}>
                      {s.amount < 0 ? "+" + money(-s.amount) : money(s.amount)}
                    </span>
                    <button className="ghost" style={{ padding: 4 }}
                      onClick={() => viewingFuture ? deletePlanned(s) : deleteSpend(s)}
                      aria-label={"Delete " + s.description}>
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
        </>) : page === "position" ? (
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
        ) : (
        /* ── Planning page: everything upcoming, in one place ── */
        <>
          <div style={{ display: "flex", background: "#EFEBE0", borderRadius: 999, padding: 3, marginBottom: 16, maxWidth: 320 }}>
            {[["buckets", "By bucket"], ["monthly", "Monthly ledger"]].map(([k, lbl]) => (
              <button key={k} onClick={() => setPlanView(k)}
                style={{ flex: 1, border: "none", cursor: "pointer", borderRadius: 999, padding: "7px 0", fontSize: 12, fontWeight: 700, fontFamily: "inherit",
                  background: planView === k ? T.card : "transparent", color: planView === k ? "#3E7CB1" : T.muted,
                  boxShadow: planView === k ? "0 1px 4px rgba(24,36,32,.12)" : "none" }}>
                {lbl}
              </button>
            ))}
          </div>

          {planView === "buckets" ? (<>
          <div className="panel" style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#3E7CB1", marginBottom: 12 }}>
              Plan a future expense
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <select value={npBucket} onChange={(e) => setNpBucket(e.target.value)}
                style={{ border: `1px solid ${T.line}`, borderRadius: 10, padding: "9px 10px", fontSize: 13, minWidth: 150 }}>
                <option value="">Which bucket…</option>
                {buckets.map((b, i) => <option key={i} value={b.bucket}>{b.bucket}</option>)}
              </select>
              <select value={npMonth} onChange={(e) => setNpMonth(e.target.value)}
                style={{ border: `1px solid ${T.line}`, borderRadius: 10, padding: "9px 10px", fontSize: 13, minWidth: 120 }}>
                {monthKeys.filter((k) => isFuture(k)).map((k) => <option key={k} value={k}>{monthLabel(k)}</option>)}
              </select>
              <input value={npDesc} onChange={(e) => setNpDesc(e.target.value)} placeholder="What's it for?"
                style={{ border: `1px solid ${T.line}`, borderRadius: 10, padding: "9px 10px", fontSize: 13, flex: 1, minWidth: 140 }} />
              <input value={npAmount} onChange={(e) => setNpAmount(e.target.value.replace(/[^0-9]/g, ""))}
                onKeyDown={(e) => e.key === "Enter" && addPlannedFromPage()}
                placeholder="₹ amount" inputMode="numeric"
                style={{ border: `1px solid ${T.line}`, borderRadius: 10, padding: "9px 10px", fontSize: 13, width: 110 }} />
              <button className="primary" style={{ background: "#3E7CB1" }} onClick={addPlannedFromPage} disabled={!npBucket || !Number(npAmount)}>
                Plan it
              </button>
            </div>
          </div>

          {plannedGroups.length === 0 ? (
            <div className="panel" style={{ fontSize: 13, color: T.muted }}>
              Nothing planned yet. Use the form above, or flip any bucket card on a future month and choose <b>Plan ahead</b>.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {plannedGroups.map((g) => (
                <div key={g.month} className="panel">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                    <span className="serif" style={{ fontSize: 19, color: "#3E7CB1" }}>{monthLabel(g.month)}</span>
                    <span className="num" style={{ fontSize: 13, fontWeight: 700, color: T.muted }}>{money(g.total)} planned</span>
                  </div>
                  {g.items.map((p, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderTop: `1px solid ${T.line}` }}>
                      <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999, background: colorOf(p.bucket), flexShrink: 0 }} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: 14, fontWeight: 600 }}>{p.description || p.bucket}</span>
                        <span style={{ fontSize: 11, color: T.muted, marginLeft: 7 }}>{p.bucket}</span>
                      </span>
                      <span className="serif num" style={{ fontSize: 16 }}>{money(p.amount)}</span>
                      <button className="ghost" style={{ padding: 4 }} onClick={() => deletePlanned(p)} aria-label={"Delete " + p.description}>
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
          </>) : (
          /* ── Monthly ledger: Fixed / Saved / Misc, per month ── */
          <>
            <div className="panel" style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#3E7CB1", marginBottom: 12 }}>
                Add a monthly line
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <select value={mMonth} onChange={(e) => setMMonth(e.target.value)}
                  style={{ border: `1px solid ${T.line}`, borderRadius: 10, padding: "9px 10px", fontSize: 13, minWidth: 120 }}>
                  {ledgerMonths.map((k) => <option key={k} value={k}>{monthLabel(k)}</option>)}
                </select>
                <select value={mType} onChange={(e) => setMType(e.target.value)}
                  style={{ border: `1px solid ${T.line}`, borderRadius: 10, padding: "9px 10px", fontSize: 13, minWidth: 110 }}>
                  <option value="Fixed">Fixed</option>
                  <option value="Saved">Saved</option>
                  <option value="Misc">Misc</option>
                  <option value="Income">Income</option>
                </select>
                {(mType === "Saved" || mType === "Income") && (
                  <select value={mAccount} onChange={(e) => setMAccount(e.target.value)}
                    style={{ border: `1px solid ${T.line}`, borderRadius: 10, padding: "9px 10px", fontSize: 13, minWidth: 130 }}>
                    <option value="">Which account…</option>
                    {accounts.map((a, i) => <option key={i} value={a.account}>{a.account}</option>)}
                  </select>
                )}
                <input value={mDesc} onChange={(e) => setMDesc(e.target.value)} placeholder="What's it for?"
                  style={{ border: `1px solid ${T.line}`, borderRadius: 10, padding: "9px 10px", fontSize: 13, flex: 1, minWidth: 140 }} />
                <input value={mAmount} onChange={(e) => setMAmount(e.target.value.replace(/[^0-9]/g, ""))}
                  onKeyDown={(e) => e.key === "Enter" && addMonthlyEntry()}
                  placeholder="₹ amount" inputMode="numeric"
                  style={{ border: `1px solid ${T.line}`, borderRadius: 10, padding: "9px 10px", fontSize: 13, width: 110 }} />
                <button className="primary" style={{ background: "#3E7CB1" }} onClick={addMonthlyEntry} disabled={!mMonth || !Number(mAmount)}>
                  Add
                </button>
              </div>
            </div>

            {/* positioning strip: total money, and this month's commitments vs what's free */}
            <div className="panel" style={{ marginBottom: 16, background: "#EFF5FA", borderColor: "#CBDFEE" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#3E7CB1" }}>Total money you have</div>
                  <div className="serif num" style={{ fontSize: 32, marginTop: 2 }}>{money(posSummary.projectedTotal)}</div>
                  {posSummary.monthsAhead > 0 && (
                    <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
                      real balance + {money(MONTHLY_INCOME)} × {posSummary.monthsAhead} month{posSummary.monthsAhead === 1 ? "" : "s"}
                      {posSummary.projectedTotal - positionTotal - MONTHLY_INCOME * posSummary.monthsAhead > 0
                        ? " + " + money(posSummary.projectedTotal - positionTotal - MONTHLY_INCOME * posSummary.monthsAhead) + " added"
                        : ""}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <button className="ghost" onClick={() => { setShowAddMoney((s) => !s); setAmMonth(posMonth); }}
                    style={{ borderColor: T.green, color: T.green }}>
                    <Plus size={14} /> Add money
                  </button>
                  <div style={{ display: "flex", alignItems: "center", gap: 4, background: T.card, borderRadius: 999, padding: 3, border: `1px solid ${T.line}` }}>
                    <button aria-label="Previous month" onClick={() => stepPosMonth(-1)}
                      disabled={ledgerMonths.indexOf(posMonth) === 0}
                      style={{ border: "none", background: "transparent", cursor: "pointer", padding: "4px 8px", color: T.muted,
                        opacity: ledgerMonths.indexOf(posMonth) === 0 ? 0.3 : 1 }}>‹</button>
                    <span className="serif" style={{ fontSize: 14, minWidth: 84, textAlign: "center", color: isFuture(posMonth) ? "#3E7CB1" : T.ink }}>
                      {monthLabel(posMonth)}
                    </span>
                    <button aria-label="Next month" onClick={() => stepPosMonth(1)}
                      disabled={ledgerMonths.indexOf(posMonth) === ledgerMonths.length - 1}
                      style={{ border: "none", background: "transparent", cursor: "pointer", padding: "4px 8px", color: T.muted,
                        opacity: ledgerMonths.indexOf(posMonth) === ledgerMonths.length - 1 ? 0.3 : 1 }}>›</button>
                  </div>
                </div>
              </div>

              {showAddMoney && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14, background: "#fff", border: "1px solid #CBDFEE", borderRadius: 10, padding: 10 }}>
                  <select value={amMonth} onChange={(e) => setAmMonth(e.target.value)}
                    style={{ border: `1px solid ${T.line}`, borderRadius: 8, padding: "8px 10px", fontSize: 13, minWidth: 120 }}>
                    {ledgerMonths.map((k) => <option key={k} value={k}>{monthLabel(k)}</option>)}
                  </select>
                  <input value={amDesc} onChange={(e) => setAmDesc(e.target.value)} placeholder="What's it for? (bonus, refund…)"
                    style={{ border: `1px solid ${T.line}`, borderRadius: 8, padding: "8px 10px", fontSize: 13, flex: 1, minWidth: 140 }} />
                  <input value={amAmount} onChange={(e) => setAmAmount(e.target.value.replace(/[^0-9]/g, ""))}
                    onKeyDown={(e) => e.key === "Enter" && addMoney()}
                    placeholder="₹ amount" inputMode="numeric"
                    style={{ border: `1px solid ${T.line}`, borderRadius: 8, padding: "8px 10px", fontSize: 13, width: 110 }} />
                  <button className="primary" onClick={addMoney} disabled={!Number(amAmount)}>Add</button>
                </div>
              )}
              <div className="grid4">
                <PosStat label="Unplanned" sub={monthLabel(posMonth)} value={posSummary.unplannedTotal} color={T.gold} />
                <PosStat label="Fixed expenses" sub={monthLabel(posMonth)} value={posSummary.fixedTotal} color="#B5651D" />
                <PosStat label="Trip savings" sub={posSummary.hasTripBucket ? "accrued by " + monthLabel(posMonth) : "no Trip savings bucket found"} value={posSummary.tripSavings} color="#8A5A83" />
                <PosStat label="Spendable money" sub="after all three, right now" value={posSummary.spendable}
                  color={posSummary.spendable < 0 ? T.red : T.green} emphasize />
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {ledgerByMonth.map((g) => {
                const net = g.savedTotal - g.fixedTotal - g.miscTotal;
                return (
                  <div key={g.month} className="panel">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
                      <span className="serif" style={{ fontSize: 19, color: isFuture(g.month) ? "#3E7CB1" : T.ink }}>{monthLabel(g.month)}</span>
                      <span className="num" style={{ fontSize: 12, color: T.muted }}>
                        {g.fixed.length + g.saved.length + g.misc.length === 0 ? "nothing logged" :
                          <>{money(g.fixedTotal)} fixed · {money(g.savedTotal)} saved · {money(g.miscTotal)} misc</>}
                      </span>
                    </div>

                    {g.fixed.length + g.saved.length + g.misc.length === 0 ? (
                      <div style={{ fontSize: 13, color: T.muted }}>Nothing recorded for {monthLabel(g.month)} yet.</div>
                    ) : (
                      <div className="grid3">
                        <LedgerColumn label="Fixed" color="#B5651D" items={g.fixed} total={g.fixedTotal} onDelete={deleteMonthlyEntry} />
                        <LedgerColumn label="Saved" color={T.green} items={g.saved} total={g.savedTotal} onDelete={deleteMonthlyEntry} showAccount />
                        <LedgerColumn label="Misc" color={T.gold} items={g.misc} total={g.miscTotal} onDelete={deleteMonthlyEntry} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
          )}
        </>
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

function PosStat({ label, sub, value, color, emphasize }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color }}>{label}</div>
      <div className="serif num" style={{ fontSize: emphasize ? 26 : 22, marginTop: 2, color: emphasize ? color : "#182420" }}>
        ₹{Number(value || 0).toLocaleString("en-IN")}
      </div>
      <div style={{ fontSize: 11, color: "#8A8578", marginTop: 1 }}>{sub}</div>
    </div>
  );
}

function LedgerColumn({ label, color, items, total, onDelete, showAccount }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color }}>{label}</span>
        <span className="num" style={{ fontSize: 12, fontWeight: 700, color }}>{total ? "₹" + total.toLocaleString("en-IN") : "—"}</span>
      </div>
      {items.length === 0 ? (
        <div style={{ fontSize: 12, color: "#8A8578" }}>—</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {items.map((it, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, background: "#FAF8F3", border: "1px solid #E7E2D6", borderRadius: 8, padding: "6px 8px" }}>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {it.description || label}
                {showAccount && it.account && <span style={{ color: "#8A8578", marginLeft: 5 }}>· {it.account}</span>}
              </span>
              <span style={{ fontWeight: 600, whiteSpace: "nowrap" }}>₹{it.amount.toLocaleString("en-IN")}</span>
              <X size={11} color="#c4ccd6" style={{ cursor: "pointer", flexShrink: 0 }} onClick={() => onDelete(it)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

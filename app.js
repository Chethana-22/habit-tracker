// 100 Days of Code(Me) — habit tracker
// Storage layers: Supabase (cloud, per-user) → localStorage cache → JSON backup file.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const COLORS = ["#8839ef","#1e66f5","#179299","#40a02b","#df8e1d","#fe640b","#d20f39","#ea76cb","#7287fd","#209fb5"];
const ALPHA = [0, .28, .52, .76, 1];
const LBL = ["empty", "showed up", "solid", "strong", "shipped it"];
const LS_PREFIX = "habit100-v2";
const CLOUD = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

const $ = (id) => document.getElementById(id);
const todayISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const clamp = (v) => Math.max(0, Math.min(4, parseInt(v, 10) || 0));

let sb = null, user = null, state = null;
let pending = false, saveTimer = null, retryTimer = null;

/* ---------------- state ---------------- */
function blankRun(start, title, names) {
  return { id: uid(), title: title || "Run 1", start: start || todayISO(),
    habits: Array.from({ length: 10 }, (_, i) => ({ name: (names && names[i]) || "", d: Array(100).fill(0) })) };
}
function blankState() { const r = blankRun(); return { v: 2, dev: "", dark: false, active: r.id, runs: [r], updated: 0 }; }

function normalize(s) {
  if (!s || typeof s !== "object") return blankState();
  // migrate v1 (single-run file from the earlier HTML tracker)
  if (!Array.isArray(s.runs) && Array.isArray(s.habits)) {
    const r = blankRun(s.start, "Run 1");
    r.habits.forEach((h, i) => { const o = s.habits[i] || {}; h.name = String(o.name || ""); h.d = Array.from({ length: 100 }, (_, k) => clamp((o.d || [])[k])); });
    s = { v: 2, dev: s.dev || "", dark: !!s.dark, active: r.id, runs: [r], updated: s.updated || 0 };
  }
  const out = { v: 2, dev: String(s.dev || "").slice(0, 40), dark: !!s.dark, updated: Number(s.updated) || 0, runs: [] };
  (Array.isArray(s.runs) ? s.runs : []).forEach((r, ri) => {
    if (!r || typeof r !== "object") return;
    out.runs.push({
      id: String(r.id || uid()), title: String(r.title || `Run ${ri + 1}`).slice(0, 40),
      start: /^\d{4}-\d{2}-\d{2}$/.test(r.start) ? r.start : todayISO(),
      habits: Array.from({ length: 10 }, (_, i) => { const h = (r.habits || [])[i] || {};
        return { name: String(h.name || "").slice(0, 60), d: Array.from({ length: 100 }, (_, k) => clamp((h.d || [])[k])) }; }),
    });
  });
  if (!out.runs.length) out.runs.push(blankRun());
  out.active = out.runs.some((r) => r.id === s.active) ? s.active : out.runs[out.runs.length - 1].id;
  return out;
}
const run = () => state.runs.find((r) => r.id === state.active) || state.runs[0];
const lsKey = () => `${LS_PREFIX}:${user ? user.id : "local"}`;
function readLocal() { try { const raw = localStorage.getItem(lsKey()); return raw ? JSON.parse(raw) : null; } catch { return null; } }
function writeLocal() { try { localStorage.setItem(lsKey(), JSON.stringify({ ...state, _pending: pending })); } catch {} }

/* ---------------- sync ---------------- */
function setSync(kind, text) { const el = $("sync"); el.className = "sync " + kind; el.textContent = text; }

function changed() {
  state.updated = Date.now();
  pending = CLOUD && !!user;
  writeLocal();
  if (!CLOUD || !user) { setSync("local", "saved locally"); return; }
  setSync("busy", "saving…");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(push, 1000);
}

async function push() {
  if (!sb || !user) return;
  clearTimeout(retryTimer);
  const snapshot = JSON.parse(JSON.stringify(state));
  const { error } = await sb.from("trackers").upsert({ user_id: user.id, data: snapshot, updated_at: new Date().toISOString() });
  if (error) {
    setSync("err", navigator.onLine ? "sync failed · retrying" : "offline · saved locally");
    retryTimer = setTimeout(push, 20000);
    return;
  }
  if (state.updated === snapshot.updated) { pending = false; writeLocal(); }
  setSync("ok", "synced");
}

async function pull() {
  const { data, error } = await sb.from("trackers").select("data, updated_at").eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  return data ? normalize(data.data) : null;
}

async function loadForUser() {
  setSync("busy", "loading…");
  const local = readLocal();
  const localPending = !!(local && local._pending);
  let remote = null;
  try { remote = await pull(); }
  catch {
    state = normalize(local || blankState()); pending = localPending; render(true);
    setSync("err", "offline · saved locally"); retryTimer = setTimeout(push, 20000); return;
  }
  // also offer to migrate anonymous local data on first sign-in
  const anon = (() => { try { return JSON.parse(localStorage.getItem(`${LS_PREFIX}:local`) || localStorage.getItem("habit100-code-v1") || "null"); } catch { return null; } })();
  if (!remote) {
    state = normalize(local || anon || blankState());
    render(true); await push(); return;
  }
  if (local && localPending && (local.updated || 0) > (remote.updated || 0)) {
    state = normalize(local); render(true); await push();
  } else {
    state = remote; pending = false; writeLocal(); render(true); setSync("ok", "synced");
  }
}

async function refreshIfNewer() {
  if (!sb || !user || pending) return;
  try { const remote = await pull(); if (remote && (remote.updated || 0) > (state.updated || 0)) { state = remote; writeLocal(); render(true); setSync("ok", "synced"); } } catch {}
}

/* ---------------- auth ---------------- */
function showAuth(msg, good) { $("authModal").hidden = false; $("authMsg").textContent = msg || ""; $("authMsg").classList.toggle("good", !!good); setTimeout(() => $("email").focus(), 50); }
function hideAuth() { $("authModal").hidden = true; }

async function initCloud() {
  const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
  sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  $("outBtn").hidden = false; $("histBtn").hidden = false;

  const { data } = await sb.auth.getSession();
  sb.auth.onAuthStateChange((evt, session) => {
    const next = session ? session.user : null;
    if (evt === "PASSWORD_RECOVERY") { const p = prompt("Enter a new password (min 6 characters):"); if (p && p.length >= 6) sb.auth.updateUser({ password: p }); }
    if ((next && next.id) !== (user && user.id)) { user = next; if (user) { hideAuth(); loadForUser(); } else { state = blankState(); render(true); showAuth(); setSync("local", "signed out"); } }
  });
  user = data.session ? data.session.user : null;
  if (user) { hideAuth(); await loadForUser(); } else { state = blankState(); render(true); showAuth(); }

  const creds = () => ({ email: $("email").value.trim(), password: $("pass").value });
  const valid = ({ email, password }) => {
    if (!/^\S+@\S+\.\S+$/.test(email)) { $("authMsg").textContent = "Enter a valid email."; return false; }
    if (password.length < 6) { $("authMsg").textContent = "Password needs at least 6 characters."; return false; }
    return true;
  };
  $("authForm").addEventListener("submit", async (e) => {
    e.preventDefault(); const c = creds(); if (!valid(c)) return;
    $("authMsg").classList.remove("good"); $("authMsg").textContent = "Signing in…";
    const { error } = await sb.auth.signInWithPassword(c);
    if (error) $("authMsg").textContent = error.message;
  });
  $("signUpBtn").addEventListener("click", async () => {
    const c = creds(); if (!valid(c)) return;
    $("authMsg").textContent = "Creating account…";
    const { data: d, error } = await sb.auth.signUp({ ...c, options: { emailRedirectTo: location.origin + location.pathname } });
    if (error) { $("authMsg").textContent = error.message; return; }
    if (!d.session) showAuth("Check your inbox to confirm your email, then sign in.", true);
  });
  $("resetBtn").addEventListener("click", async () => {
    const email = $("email").value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) { $("authMsg").textContent = "Type your email above first."; return; }
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    showAuth(error ? error.message : "Password reset link sent — check your inbox.", !error);
  });
  $("outBtn").addEventListener("click", async () => { if (pending) await push(); await sb.auth.signOut(); });

  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refreshIfNewer(); else if (pending) push(); });
  window.addEventListener("online", () => { if (pending) push(); });
  window.addEventListener("beforeunload", (e) => { if (pending) { push(); e.preventDefault(); e.returnValue = ""; } });
}

/* ---------------- render ---------------- */
function mix(hex, a) {
  const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const [br, bg, bb] = state.dark ? [36, 39, 58] : [255, 255, 255];
  return `rgb(${Math.round(br + (r - br) * a)},${Math.round(bg + (g - bg) * a)},${Math.round(bb + (b - bb) * a)})`;
}
function dayIndex(r) {
  const s = new Date(r.start + "T00:00:00"), t = new Date(todayISO() + "T00:00:00");
  const diff = Math.round((t - s) / 864e5) + 1;
  return diff < 1 ? 0 : Math.min(100, diff);
}
function dateOf(r, i) { const d = new Date(r.start + "T00:00:00"); d.setDate(d.getDate() + i); return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" }); }
const runDone = (r) => r.habits.reduce((a, h) => a + h.d.filter((v) => v > 0).length, 0);

const grid = $("grid"), tip = $("tip");
let cards = [];

function buildCards() {
  grid.innerHTML = ""; cards = [];
  run().habits.forEach((h, hi) => {
    const ac = COLORS[hi];
    const card = document.createElement("div"); card.className = "card";
    card.innerHTML = `<div class="top mono"><span class="tag">habit_${String(hi + 1).padStart(2, "0")}</span>
      <span class="str">=</span><input aria-label="Habit ${hi + 1} name" placeholder="write your habit…" maxlength="60">
      <span class="ret"><span class="kw">return</span> <b class="done">0</b> / <span class="num">100</span></span></div>
      <div class="body"><div class="heat" role="group" aria-label="Habit ${hi + 1} days"></div>
      <div class="stats mono"><div><span class="com">streak</span><b class="stk">0</b></div>
      <div><span class="com">best</span><b class="best">0</b></div>
      <div><span class="com">rate</span><b class="rate">0%</b></div>
      <div><span class="com">avg</span><b class="avg">0.0</b></div></div></div>`;
    const inp = card.querySelector("input"); inp.value = h.name;
    inp.addEventListener("input", () => { run().habits[hi].name = inp.value.slice(0, 60); changed(); renderStats(); });
    const heat = card.querySelector(".heat");
    for (let i = 0; i < 100; i++) { const b = document.createElement("button"); b.type = "button"; b.className = "cell"; b.dataset.i = i; heat.appendChild(b); }
    const setVal = (i, v) => { run().habits[hi].d[i] = v; changed(); paint(); };
    let lp = null, longPressed = false;
    heat.addEventListener("click", (e) => { const b = e.target.closest(".cell"); if (!b) return; if (longPressed) { longPressed = false; return; } const i = +b.dataset.i; setVal(i, (run().habits[hi].d[i] + 1) % 5); showTip(b, hi, i); });
    heat.addEventListener("contextmenu", (e) => { const b = e.target.closest(".cell"); if (!b) return; e.preventDefault(); setVal(+b.dataset.i, 0); });
    heat.addEventListener("touchstart", (e) => { const b = e.target.closest(".cell"); if (!b) return; longPressed = false; lp = setTimeout(() => { longPressed = true; setVal(+b.dataset.i, 0); }, 550); }, { passive: true });
    ["touchend", "touchmove", "touchcancel"].forEach((ev) => heat.addEventListener(ev, () => clearTimeout(lp), { passive: true }));
    heat.addEventListener("mouseover", (e) => { const b = e.target.closest(".cell"); if (b) showTip(b, hi, +b.dataset.i); });
    heat.addEventListener("mouseleave", () => (tip.style.opacity = 0));
    cards.push({ card, ac, heat, inp, tag: card.querySelector(".tag"), done: card.querySelector(".done"), stk: card.querySelector(".stk"), best: card.querySelector(".best"), rate: card.querySelector(".rate"), avg: card.querySelector(".avg") });
    grid.appendChild(card);
  });
}

function showTip(b, hi, i) {
  const r = b.getBoundingClientRect(), v = run().habits[hi].d[i];
  tip.textContent = `Day ${i + 1} · ${dateOf(run(), i)} · ${LBL[v]}`;
  tip.style.left = Math.min(window.innerWidth - 220, Math.max(4, r.left - 50)) + "px";
  tip.style.top = Math.max(4, r.top - 28) + "px"; tip.style.opacity = 1;
}

function paint() {
  const r = run(), today = dayIndex(r);
  cards.forEach((c, hi) => {
    const d = r.habits[hi].d, cells = c.heat.children;
    c.tag.style.background = mix(c.ac, .15); c.tag.style.color = c.ac;
    for (let i = 0; i < 100; i++) {
      const v = d[i], el = cells[i], ms = (i + 1) % 25 === 0;
      el.style.background = v ? mix(c.ac, ALPHA[v]) : mix(c.ac, .06);
      el.style.borderColor = ms ? c.ac : (v ? "transparent" : mix(c.ac, .2));
      el.style.borderWidth = ms ? "1.6px" : "1px";
      el.classList.toggle("today", today > 0 && i === today - 1);
      el.classList.toggle("future", today > 0 && i >= today && !v);
      el.setAttribute("aria-label", `Day ${i + 1}: ${LBL[v]}`);
    }
  });
  renderStats();
}

function renderStats() {
  const r = run(), today = dayIndex(r);
  let tot = 0;
  cards.forEach((c, hi) => {
    const d = r.habits[hi].d;
    const done = d.filter((v) => v > 0).length; tot += done;
    let best = 0, cur = 0; d.forEach((v) => { cur = v ? cur + 1 : 0; best = Math.max(best, cur); });
    let stk = 0, k = (today || 100) - 1; if (k >= 0 && !d[k]) k--; while (k >= 0 && d[k]) { stk++; k--; }
    const sum = d.reduce((a, b) => a + b, 0);
    c.done.textContent = done; c.done.style.color = c.ac; c.stk.textContent = stk; c.stk.style.color = c.ac;
    c.best.textContent = best; c.rate.textContent = (today ? Math.round(Math.min(100, (done / today) * 100)) : 0) + "%";
    c.avg.textContent = done ? (sum / done).toFixed(1) : "0.0";
  });
  let perf = 0;
  const named = r.habits.filter((h) => h.name.trim());
  const pool = named.length ? named : r.habits;
  for (let i = 0; i < 100; i++) if (pool.every((h) => h.d[i] > 0)) perf++;
  $("tot").textContent = tot; $("perf").textContent = perf;
  $("allTime").textContent = state.runs.reduce((a, x) => a + runDone(x), 0);
  $("dayNo").textContent = today || "–"; $("left").textContent = Math.max(0, 100 - today);
  // refresh run labels with live progress
  [...$("runSel").options].forEach((o) => { const x = state.runs.find((y) => y.id === o.value); if (x) o.textContent = runLabel(x); });
}
const runLabel = (x) => `${x.title} · ${x.start} · ${Math.round((runDone(x) / 1000) * 100)}%`;

function render(rebuild) {
  document.body.classList.toggle("dark", !!state.dark);
  $("devIn").value = state.dev; $("startIn").value = run().start; $("runTitle").value = run().title;
  const sel = $("runSel"); sel.innerHTML = "";
  state.runs.forEach((x) => { const o = document.createElement("option"); o.value = x.id; o.textContent = runLabel(x); sel.appendChild(o); });
  sel.value = state.active;
  $("delRunBtn").disabled = state.runs.length < 2;
  ["l0", "l1", "l2", "l3", "l4"].forEach((id, k) => ($(id).style.background = k ? mix("#8839ef", ALPHA[k]) : "var(--card)"));
  if (rebuild || cards.length !== 10) buildCards();
  else cards.forEach((c, i) => (c.inp.value = run().habits[i].name));
  paint();
}

/* ---------------- controls ---------------- */
$("devIn").addEventListener("input", (e) => { state.dev = e.target.value.slice(0, 40); changed(); });
$("startIn").addEventListener("change", (e) => { if (!e.target.value) { e.target.value = run().start; return; } run().start = e.target.value; changed(); render(); });
$("runTitle").addEventListener("input", (e) => { run().title = e.target.value.slice(0, 40) || "Untitled"; changed(); renderStats(); });
$("runSel").addEventListener("change", (e) => { state.active = e.target.value; changed(); render(true); });
$("newRunBtn").addEventListener("click", () => {
  const keep = confirm("Start a new 100-day run from today.\n\nOK = keep the same 10 habit names\nCancel = start with empty habits");
  const r = blankRun(todayISO(), `Run ${state.runs.length + 1}`, keep ? run().habits.map((h) => h.name) : null);
  state.runs.push(r); state.active = r.id; changed(); render(true);
});
$("delRunBtn").addEventListener("click", () => {
  if (state.runs.length < 2) return;
  if (!confirm(`Delete "${run().title}"? Download a Backup first if you might need it.`)) return;
  state.runs = state.runs.filter((x) => x.id !== state.active); state.active = state.runs[state.runs.length - 1].id; changed(); render(true);
});
$("themeBtn").addEventListener("click", () => { state.dark = !state.dark; changed(); render(); });
$("prnBtn").addEventListener("click", () => window.print());
$("expBtn").addEventListener("click", () => {
  const { _pending, ...clean } = state;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(clean, null, 1)], { type: "application/json" }));
  a.download = `habit-tracker-backup-${todayISO()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$("impBtn").addEventListener("click", () => $("fileIn").click());
$("fileIn").addEventListener("change", (e) => {
  const f = e.target.files[0]; if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const d = JSON.parse(rd.result); if (!d || (!Array.isArray(d.runs) && !Array.isArray(d.habits))) throw 0;
      if (!confirm("Replace everything currently shown with this backup?")) return;
      state = normalize(d); changed(); render(true);
    } catch { alert("That file isn't a valid tracker backup."); }
  };
  rd.readAsText(f); e.target.value = "";
});
$("histBtn").addEventListener("click", async () => {
  const list = $("histList"); list.textContent = "loading…"; $("histModal").hidden = false;
  const { data, error } = await sb.from("tracker_history").select("id, saved_at, data").order("saved_at", { ascending: false }).limit(60);
  list.innerHTML = "";
  if (error || !data.length) { list.textContent = error ? error.message : "No snapshots yet — they appear automatically as you use the tracker."; return; }
  data.forEach((row) => {
    const s = normalize(row.data), div = document.createElement("div"); div.className = "item";
    div.innerHTML = `<span>${new Date(row.saved_at).toLocaleString()}<br><span class="com">${s.runs.length} run(s) · ${s.runs.reduce((a, x) => a + runDone(x), 0)} commits</span></span>`;
    const b = document.createElement("button"); b.type = "button"; b.className = "btn sm"; b.textContent = "Restore";
    b.addEventListener("click", () => { if (!confirm("Restore this version? (Your current version is snapshotted first.)")) return; state = s; changed(); render(true); $("histModal").hidden = true; });
    div.appendChild(b); list.appendChild(div);
  });
});
$("histClose").addEventListener("click", () => ($("histModal").hidden = true));
window.addEventListener("scroll", () => (tip.style.opacity = 0), { passive: true });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("histModal").hidden = true; });

// re-paint at midnight so the "today" square moves without a reload
setInterval(() => { if (state) paint(); }, 60000);

/* ---------------- boot ---------------- */
(async () => {
  if (CLOUD) {
    try { await initCloud(); }
    catch { state = normalize(readLocal() || blankState()); render(true); setSync("err", "cloud unavailable · saved locally"); }
  } else {
    state = normalize(readLocal() || (() => { try { return JSON.parse(localStorage.getItem("habit100-code-v1")); } catch { return null; } })() || blankState());
    render(true); setSync("local", "local mode · add Supabase keys in config.js to sync");
  }
})();

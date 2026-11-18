// Token Radar dashboard. Everything on this page is rendered from
// ../data.js, which main.ts writes from the same board it saves to
// board.json — so what the screenshots show is what the code computed.
// The detail view re-multiplies each protocol's valuation from its model
// factors and checks the product against the board's figure.

const DATA = window.RADAR_DATA;
const rows = DATA.rows;
const live = DATA.live;
const model = DATA.model;

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));

function money(n) {
  if (n == null) return "—";
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
  return "$" + Math.round(n);
}

function moneyFull(n) {
  return "$" + Math.round(n).toLocaleString("en-US");
}

function pct(n) {
  if (n == null) return "—";
  const cls = n > 0 ? "pos" : n < 0 ? "neg" : "";
  return `<span class="${cls}">${n > 0 ? "+" : ""}${n.toFixed(1)}%</span>`;
}

function ageText(days) {
  if (days == null) return "unknown";
  if (days >= 365) return (days / 365).toFixed(1) + " yrs";
  return days + " days";
}

// ---- masthead ----

const watchCount = rows.filter((r) => r.watchlist).length;
const totalTvl = rows.reduce((s, r) => s + r.tvl_usd, 0);
$("model-chip").textContent = `model ${model.id} · snapshot ${model.as_of}`;
$("stats").innerHTML = [
  [model.protocols_scanned, "protocols scanned", ""],
  [rows.length, "pre-token protocols ranked", "hot"],
  [`${watchCount}/${model.watchlist_total}`, "watchlist covered", "watch"],
  [model.global.n, "trading comparables", ""],
  [model.global.median.toFixed(2) + "×", "median cap / TVL, all categories", ""],
  [money(totalTvl), "TVL under watch", ""],
]
  .map(([v, label, cls]) => `<div class="stat ${cls}"><b>${v}</b><span>${label}</span></div>`)
  .join("");

$("method").textContent =
  `Method: ${model.formula}. Category multiples come from the ${model.global.n} protocols in the same snapshot whose token already trades; ` +
  `medians from thin categories are shrunk toward the global median, and capped at twice it when fewer than three protocols in the category trade. ` +
  `Farm plans are generated per protocol from its category, chains, TVL and age, with gas priced per chain. Source: ${model.source}, as of ${model.as_of}.`;

// ---- controls ----

const categories = [...new Set(rows.map((r) => r.category ?? "Unclassified"))].sort();
$("category").innerHTML =
  `<option value="">All categories</option>` +
  categories.map((c) => `<option>${esc(c)}</option>`).join("");

const chains = [...new Set(rows.flatMap((r) => r.chains))].sort();
$("chain").innerHTML =
  `<option value="">All chains</option>` + chains.map((c) => `<option>${esc(c)}</option>`).join("");

const state = { q: "", category: "", chain: "", mintvl: 0, watchonly: false, key: "rank", dir: 1, slug: null };

function filtered() {
  const q = state.q.trim().toLowerCase();
  return rows.filter((r) => {
    if (q && !r.name.toLowerCase().includes(q) && !r.slug.toLowerCase().includes(q)) return false;
    if (state.category && (r.category ?? "Unclassified") !== state.category) return false;
    if (state.chain && !r.chains.includes(state.chain)) return false;
    if (state.mintvl && r.tvl_usd < state.mintvl) return false;
    if (state.watchonly && !r.watchlist) return false;
    return true;
  });
}

const keyOf = {
  rank: (r) => r.rank,
  name: (r) => r.name.toLowerCase(),
  tvl_usd: (r) => r.tvl_usd,
  change_7d: (r) => (r.change_7d == null ? -Infinity : r.change_7d),
  age_days: (r) => (r.age_days == null ? -1 : r.age_days),
  multiple: (r) => r.model.multiple,
  implied_value_usd: (r) => r.implied_value_usd,
};

const maxImplied = Math.max(...rows.map((r) => r.implied_value_usd));

function render() {
  const list = filtered().sort((a, b) => {
    const ka = keyOf[state.key](a);
    const kb = keyOf[state.key](b);
    if (ka < kb) return -state.dir;
    if (ka > kb) return state.dir;
    return a.rank - b.rank;
  });
  $("count").textContent = `${list.length} of ${rows.length} protocols`;
  $("rows").innerHTML = list
    .map((r) => {
      const w = Math.max(2, Math.round((r.implied_value_usd / maxImplied) * 74));
      return `<tr data-slug="${esc(r.slug)}"${state.slug === r.slug ? ' class="selected"' : ""}>
        <td class="num">${r.rank}</td>
        <td><span class="pname">${esc(r.name)}</span>${r.watchlist ? ' <span class="star" title="Watchlist">★</span>' : ""}<br>
            <span class="pmeta">${esc(r.category ?? "Unclassified")} · ${esc(r.chains.slice(0, 3).join(", "))}${r.chains.length > 3 ? ` +${r.chains.length - 3}` : ""}</span></td>
        <td class="num">${money(r.tvl_usd)}</td>
        <td class="num">${pct(r.change_7d)}</td>
        <td class="num">${ageText(r.age_days)}</td>
        <td class="num">${r.model.multiple.toFixed(2)}×</td>
        <td class="num"><span class="bar" style="width:${w}px"></span>${money(r.implied_value_usd)}</td>
      </tr>`;
    })
    .join("");
  document.querySelectorAll("#board thead th").forEach((th) => {
    th.classList.toggle("sorted", th.dataset.key === state.key);
    if (th.dataset.key === state.key) th.textContent = th.textContent.replace(/ [▲▼]$/, "") + (state.dir === 1 ? " ▲" : " ▼");
    else th.textContent = th.textContent.replace(/ [▲▼]$/, "");
  });
}

// ---- detail ----

function openDetail(slug) {
  const r = rows.find((x) => x.slug === slug);
  if (!r) return;
  state.slug = slug;
  const ex = r.model_exact;
  const product = Math.round(r.tvl_usd * ex.multiple * ex.growth_factor * ex.maturity_factor);
  const agrees = product === r.implied_value_usd;
  const cat = model.categories[r.category ?? "Unclassified"];
  const t = r.plan_totals;
  $("detail").innerHTML = `
    <button type="button" class="close" id="close-detail" aria-label="Close">×</button>
    <h2>${esc(r.name)}</h2>
    <p class="sub">${esc(r.category ?? "Unclassified")} · ${esc(r.chains.join(", "))}</p>
    <span class="badge rank">Rank ${r.rank} of ${rows.length}</span>
    ${r.watchlist ? '<span class="badge watch">★ Watchlist</span>' : ""}
    <div class="facts">
      <div class="fact"><span>TVL</span><b>${moneyFull(r.tvl_usd)}</b></div>
      <div class="fact"><span>Implied value</span><b>${moneyFull(r.implied_value_usd)}</b></div>
      <div class="fact"><span>7d TVL change</span><b>${r.change_7d == null ? "—" : (r.change_7d > 0 ? "+" : "") + r.change_7d.toFixed(1) + "%"}</b></div>
      <div class="fact"><span>Running since</span><b>${r.listed_at ?? "unknown"} (${ageText(r.age_days)})</b></div>
    </div>
    <h3>How the value is built</h3>
    <div class="arith">
      <div class="row"><span>TVL</span><b>${moneyFull(r.tvl_usd)}</b></div>
      <div class="row"><span>× ${r.model.source === "global" ? `global multiple (no trading protocols in ${esc(r.category ?? "Unclassified")}; median of all ${model.global.n} comparables)` : `category multiple (${esc(r.category ?? "Unclassified")}, ${r.model.comps} trading comps)`}</span><b>${ex.multiple.toFixed(4)}×</b></div>
      <div class="row"><span>× growth factor (7d ${r.change_7d == null ? "n/a" : r.change_7d.toFixed(1) + "%"})</span><b>${ex.growth_factor.toFixed(4)}×</b></div>
      <div class="row"><span>× maturity factor (${ageText(r.age_days)} with no token)</span><b>${ex.maturity_factor.toFixed(4)}×</b></div>
      <div class="row total"><span>Implied launch value</span><b>${moneyFull(r.implied_value_usd)}</b></div>
      <div class="check">${agrees ? "This page re-multiplied the factors and got the board's figure exactly." : "This page re-multiplied the factors and did not land on the board's figure; board.json is authoritative."}</div>
    </div>
    ${cat ? (cat.fallback
      ? `<p class="range">No protocol in this category trades yet, so there is no category evidence to price from: the board values it at the global median multiple (${cat.multiple.toFixed(2)}×), and the range collapses to the headline figure.</p>`
      : r.range_low_usd !== r.range_high_usd
        ? `<p class="range">Category range: at the category's shrunk lower-quartile multiple (${cat.multiple_q1.toFixed(2)}×) the value would be <b>${money(r.range_low_usd)}</b>; at the upper quartile (${cat.multiple_q3.toFixed(2)}×), <b>${money(r.range_high_usd)}</b>. Raw category median ${cat.median.toFixed(2)}× from ${cat.n} trading protocols, shrunk toward the global median before use.</p>`
        : cat.n < 3
          ? `<p class="range">Thin evidence: only ${cat.n} trading protocol(s) in this category (raw median ${cat.median.toFixed(2)}×), so there is no honest spread — the board shrinks the multiple toward the global median and caps it at twice it, and the range collapses to the headline figure.</p>`
          : `<p class="range">This category's quartile multiples coincide after shrinkage, so the range collapses to the headline figure.</p>`) : ""}
    <h3>Farm plan</h3>
    <div class="plan-total">
      <span>Gas ≈ <b>${moneyFull(t.gas_usd)}</b></span>
      <span>Capital <b>${moneyFull(t.capital_usd)}</b> (stays yours)</span>
      <span>Horizon <b>${t.weeks} weeks</b></span>
    </div>
    <ol class="steps">${r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>`;
  $("detail").hidden = false;
  $("close-detail").addEventListener("click", () => {
    $("detail").hidden = true;
    state.slug = null;
    history.replaceState(null, "", location.pathname);
    render();
  });
  render();
}

// ---- live tab ----

$("live-note").textContent =
  `These protocols already have a token. They are not ranked; they are the evidence. Each category's multiple on the radar is the median market cap / TVL of its trading protocols, computed from all ${model.global.n} protocols in the snapshot with a recorded positive market cap (shrunk toward the global median of ${model.global.median.toFixed(2)}× when a category has few); the 40 largest by market cap are listed below.`;
$("liverows").innerHTML = live
  .map(
    (r) => `<tr>
      <td><span class="pname">${esc(r.name)}</span><br><span class="pmeta">${esc(r.chains.slice(0, 3).join(", "))}</span></td>
      <td>${esc(r.category ?? "Unclassified")}</td>
      <td class="num">${money(r.mcap_usd)}</td>
      <td class="num">${money(r.tvl_usd)}</td>
      <td class="num">${r.ratio.toFixed(2)}×</td>
    </tr>`,
  )
  .join("");

// ---- events and hash routing ----

$("q").addEventListener("input", (e) => { state.q = e.target.value; render(); });
$("category").addEventListener("change", (e) => { state.category = e.target.value; render(); });
$("chain").addEventListener("change", (e) => { state.chain = e.target.value; render(); });
$("mintvl").addEventListener("change", (e) => { state.mintvl = Number(e.target.value); render(); });
$("watchonly").addEventListener("change", (e) => { state.watchonly = e.target.checked; render(); });

document.querySelectorAll("#board thead th").forEach((th) => {
  th.addEventListener("click", () => {
    const key = th.dataset.key;
    if (state.key === key) state.dir = -state.dir;
    else { state.key = key; state.dir = key === "name" || key === "rank" ? 1 : -1; }
    render();
  });
});

$("rows").addEventListener("click", (e) => {
  const tr = e.target.closest("tr[data-slug]");
  if (tr) {
    location.hash = "p=" + encodeURIComponent(tr.dataset.slug);
    openDetail(tr.dataset.slug);
  }
});

function showTab(liveTab) {
  $("view-pre").hidden = liveTab;
  $("view-live").hidden = !liveTab;
  $("tab-pre").classList.toggle("active", !liveTab);
  $("tab-live").classList.toggle("active", liveTab);
}
$("tab-pre").addEventListener("click", () => showTab(false));
$("tab-live").addEventListener("click", () => showTab(true));

function applyHash() {
  const h = new URLSearchParams(location.hash.replace(/^#/, ""));
  if (h.get("tab") === "live") showTab(true);
  if (h.get("category")) { state.category = h.get("category"); $("category").value = state.category; }
  if (h.get("q")) { state.q = h.get("q"); $("q").value = state.q; }
  if (h.get("watch") === "1") { state.watchonly = true; $("watchonly").checked = true; }
  render();
  if (h.get("p")) openDetail(h.get("p"));
}
window.addEventListener("hashchange", applyHash);
applyHash();

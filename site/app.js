const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

// Items newer than the previous visit get a "New" badge.
const lastVisit = Number(store.get("lastVisit")) || Date.now();
store.set("lastVisit", String(Date.now()));

const state = { game: store.get("game") || "All", query: "", type: store.get("type") || "" };
let items = [];
let gameNames = [];

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
function ago(ms) {
  const s = (ms - Date.now()) / 1000;
  const units = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];
  for (const [u, n] of units) if (Math.abs(s) >= n) return rtf.format(Math.round(s / n), u);
  return "just now";
}

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  e.append(...kids.filter((k) => k != null && k !== false));
  return e;
}

function renderChips() {
  const counts = { All: items.length };
  const fresh = {};
  for (const i of items) {
    counts[i.game] = (counts[i.game] || 0) + 1;
    if (i.date > lastVisit) fresh[i.game] = fresh.All = true;
  }
  $("chips").replaceChildren(
    ...["All", ...gameNames].map((name) =>
      el("button", {
        class: "chip", type: "button", "aria-pressed": String(state.game === name),
        onclick: () => { state.game = name; store.set("game", name); renderChips(); renderFeed(); },
      },
        fresh[name] && el("span", { class: "dot", title: "New since your last visit" }),
        name, el("span", { class: "count" }, String(counts[name] || 0)))
    )
  );
}

function renderFeed() {
  const q = state.query.toLowerCase();
  const shown = items.filter((i) =>
    (state.game === "All" || i.game === state.game) &&
    (!state.type || i.tags.includes(state.type)) &&
    (!q || (i.title + " " + i.summary + " " + i.game).toLowerCase().includes(q))
  );
  $("status").textContent = shown.length ? "" : "No news matches.";
  $("feed").replaceChildren(
    ...shown.slice(0, 150).map((i) =>
      el("li", {},
        el("a", { class: "card", href: i.url, target: "_blank", rel: "noopener" },
          el("img", {
            class: "thumb", src: i.image || i.gameImage || "", alt: "", loading: "lazy",
            onerror: (e) => { if (i.gameImage && e.target.src !== i.gameImage) e.target.src = i.gameImage; },
          }),
          el("div", {},
            el("div", { class: "meta" },
              el("span", { class: "game" }, i.game),
              el("time", { datetime: new Date(i.date).toISOString(), title: new Date(i.date).toLocaleString() }, ago(i.date)),
              i.date > Date.now() ? el("span", { class: "badge soon" }, "Upcoming")
                : i.date > lastVisit && el("span", { class: "badge new" }, "New"),
              ...i.tags.map((t) => el("span", { class: t === "Sunny Sunday" ? "badge sunny" : "badge" }, t))
            ),
            el("h2", {}, i.title),
            i.summary && el("p", {}, i.summary)
          )
        )
      )
    )
  );
}

async function load() {
  try {
    const res = await fetch("data/news.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    gameNames = data.games.map((g) => g.name);
    items = data.games
      .flatMap((g) => g.items.map((i) => ({ ...i, game: g.name, gameImage: g.image })))
      .sort((a, b) => b.date - a.date);
    if (!gameNames.includes(state.game)) state.game = "All";
    const types = [...new Set(items.flatMap((i) => i.tags))].sort();
    if (!types.includes(state.type)) state.type = "";
    $("type").append(...types.map((t) => el("option", { value: t }, t)));
    $("type").value = state.type;
    const upd = $("updated");
    upd.textContent = `Updated ${ago(data.updated)}`;
    upd.title = new Date(data.updated).toLocaleString();
    renderChips();
    renderFeed();
  } catch (e) {
    $("status").textContent = "Couldn't load news yet. If this is a fresh deploy, wait for the first workflow run.";
  }
}

$("search").addEventListener("input", (e) => { state.query = e.target.value.trim(); renderFeed(); });
$("type").addEventListener("change", (e) => { state.type = e.target.value; store.set("type", state.type); renderFeed(); });
load();

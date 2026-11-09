const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

// ---- light/dark toggle (shares the "theme" key with karan-tlr.github.io) ----
(() => {
  const root = document.documentElement;
  const button = $("themeToggle");
  const media = matchMedia("(prefers-color-scheme: dark)");
  const effective = () => root.dataset.theme || (media.matches ? "dark" : "light");
  const reflect = () => {
    const dark = effective() === "dark";
    button.setAttribute("aria-pressed", String(dark));
    button.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
  };
  button.addEventListener("click", () => {
    root.dataset.theme = effective() === "dark" ? "light" : "dark";
    store.set("theme", root.dataset.theme);
    reflect();
  });
  media.addEventListener("change", () => { if (!root.dataset.theme) reflect(); });
  reflect();
})();

// Items newer than the previous visit are marked "new!".
const lastVisit = Number(store.get("lastVisit")) || Date.now();
store.set("lastVisit", String(Date.now()));

const state = { game: store.get("game"), type: store.get("type") || "all", query: "" };
let items = [];
let gameNames = [];
let typeNames = [];
const TYPED_GAME = "MapleStory";

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
function ago(ms) {
  const s = (ms - Date.now()) / 1000;
  const units = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];
  for (const [u, n] of units) if (Math.abs(s) >= n) return rtf.format(Math.round(s / n), u);
  return "just now";
}
// Sunny Sunday dates are whole UTC days; show them as-is rather than shifting into the local zone.
const shortDate = (ms, utc) =>
  new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: utc ? "UTC" : undefined });

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

// A row of text links separated by " · ", like an old homepage nav.
function linkRow(target, names, key, counts, fresh) {
  const parts = [];
  names.forEach((name, i) => {
    if (i) parts.push(el("span", { class: "sep", "aria-hidden": "true" }, " · "));
    parts.push(
      el("button", {
        class: "filter", type: "button", "aria-pressed": String(state[key] === name),
        onclick: () => { state[key] = name; store.set(key, name); render(); },
      }, name.toLowerCase()),
      counts && el("span", { class: "count" }, ` ${counts[name] || 0}`),
      fresh?.[name] && el("span", { class: "fresh", title: "new since your last visit" }, "*")
    );
  });
  $(target).replaceChildren(...parts.filter(Boolean));
}

function render() {
  const counts = {};
  const fresh = {};
  for (const i of items) {
    counts[i.game] = (counts[i.game] || 0) + 1;
    if (i.date > lastVisit && i.date <= Date.now()) fresh[i.game] = true;
  }
  linkRow("games", gameNames, "game", counts, fresh);
  // Only MapleStory's news comes with real categories, so "type" only appears there.
  const typed = state.game === TYPED_GAME;
  $("typeRow").hidden = !typed;
  if (typed) linkRow("types", ["all", ...typeNames], "type");

  const q = state.query.toLowerCase();
  const shown = items.filter((i) =>
    i.game === state.game &&
    (!typed || state.type === "all" || i.tags.includes(state.type)) &&
    (!q || (i.title + " " + i.summary + " " + i.game).toLowerCase().includes(q))
  );
  $("status").textContent = shown.length ? "" : "Nothing here yet.";
  $("feed").replaceChildren(
    ...shown.slice(0, 150).map((i) => {
      const future = i.date > Date.now();
      // Posts without their own picture simply get no thumbnail column.
      const thumb = i.image && el("a", { class: "entry-thumb", href: i.url, target: "_blank", rel: "noopener", tabindex: "-1", "aria-hidden": "true" },
        el("img", {
          src: i.image, alt: "", loading: "lazy", decoding: "async",
          onerror: (e) => { const li = e.target.closest(".entry"); e.target.parentElement.remove(); li?.classList.remove("has-thumb"); },
        }));
      return el("li", { class: thumb ? "entry has-thumb" : "entry" },
        thumb,
        el("div", { class: "entry-body" },
          el("div", { class: "entry-meta" },
            el("span", { class: "game" }, i.game), " · ",
            el("time", { datetime: new Date(i.date).toISOString(), title: ago(i.date) }, shortDate(i.date, i.tags.includes("Sunny Sunday"))),
            future ? el("span", { class: "soon" }, " · upcoming")
              : i.date > lastVisit && el("span", { class: "new" }, " · new!")
          ),
          el("h2", { class: "entry-title" }, el("a", { href: i.url, target: "_blank", rel: "noopener" }, i.title)),
          i.summary && el("p", {}, i.summary),
          i.game === TYPED_GAME && i.tags.length > 0 && el("div", { class: "entry-tags" },
            ...i.tags.map((t) => el("span", { class: t === "Sunny Sunday" ? "tag sunny" : "tag" }, t.toLowerCase())))
        )
      );
    })
  );
}

async function load() {
  try {
    const res = await fetch("data/news.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    gameNames = data.games.map((g) => g.name);
    items = data.games
      .flatMap((g) => g.items.map((i) => ({ ...i, game: g.name })))
      .sort((a, b) => b.date - a.date);
    typeNames = [...new Set(items.filter((i) => i.game === TYPED_GAME).flatMap((i) => i.tags))].sort();
    if (!gameNames.includes(state.game)) state.game = gameNames[0];
    if (!typeNames.includes(state.type)) state.type = "all";
    $("updated").textContent = `last stitched ${ago(data.updated)}`;
    $("updated").title = new Date(data.updated).toLocaleString();
    render();
  } catch {
    $("status").textContent = "Couldn't load news yet. If this is a fresh deploy, wait for the first workflow run.";
  }
}

$("search").addEventListener("input", (e) => { state.query = e.target.value.trim(); render(); });
load();

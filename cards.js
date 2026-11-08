/* =========================================================
   BLUE DEMON CARDS — FIFA-style player cards.
   All rating maths lives in RATING so it's easy to tune.
   ========================================================= */
const RATING = (() => {
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const scale = (v, lo, hi) => 35 + 64 * clamp((v - lo) / (hi - lo)); // lo -> 35, hi -> 99
  const n = v => (Number.isFinite(+v) ? +v : 0);
  const TIERS = [[85, "demon", "Demon"], [75, "gold", "Gold"], [60, "silver", "Silver"], [0, "bronze", "Bronze"]];
  const KEYS = ["innings", "notOuts", "runs", "balls", "fours", "sixes", "catches", "bowlBalls", "conceded", "wickets"];

  function rate(raw, roleChoice = "auto") {
    const s = {};
    KEYS.forEach(k => { s[k] = Math.max(0, n(raw[k])); });
    const outs = Math.max(0, s.innings - s.notOuts);
    const avg = outs ? s.runs / outs : s.runs;
    const sr = s.balls ? (s.runs / s.balls) * 100 : 0;
    const eco = s.bowlBalls ? s.conceded / (s.bowlBalls / 6) : 0;
    const bowlAvg = s.wickets ? s.conceded / s.wickets : 0;
    const bpb = s.balls ? (s.fours + 2 * s.sixes) / s.balls : 0;
    // Small samples are pulled toward a low baseline so one lucky innings can't make a 95.
    const batW = clamp(s.balls / 40), bowlW = clamp(s.bowlBalls / 36);
    const settle = (v, w, base = 42) => Math.round(base + (v - base) * w);

    const attrs = {
      BAT: settle(0.7 * scale(avg, 8, 45) + 0.3 * scale(s.runs, 0, 250), batW),
      PWR: settle(scale(bpb, 0.04, 0.4), batW),
      SR: settle(scale(sr, 55, 160), batW),
      BWL: settle(s.wickets ? 0.6 * scale(s.wickets, 0, 14) + 0.4 * scale(35 - bowlAvg, 0, 27) : 35, bowlW),
      ECO: settle(s.bowlBalls ? scale(9 - eco, 0, 5) : 35, bowlW),
      FLD: Math.round(scale(s.catches, 0, 8))
    };
    const batScore = 0.5 * attrs.BAT + 0.2 * attrs.PWR + 0.3 * attrs.SR;
    const bowlScore = 0.55 * attrs.BWL + 0.45 * attrs.ECO;

    let role = roleChoice;
    if (role === "auto") {
      const bats = s.balls >= 10, bowls = s.bowlBalls >= 12;
      role = bats && bowls && Math.min(batScore, bowlScore) >= 58 ? "ALL"
        : bowls && (!bats || bowlScore > batScore + 8) ? "BWL" : "BAT";
    }
    const hi = Math.max(batScore, bowlScore), lo = Math.min(batScore, bowlScore);
    const base = role === "BWL" ? bowlScore
      : role === "ALL" ? 0.6 * hi + 0.4 * lo + 2
      : role === "WK" ? 0.8 * batScore + 0.2 * attrs.FLD
      : batScore;
    const ovr = Math.round(Math.min(99, Math.max(40, base + (attrs.FLD - 50) * 0.06)));
    const t = TIERS.find(x => ovr >= x[0]);
    return { attrs, role, ovr, tier: { key: t[1], label: t[2] } };
  }
  return { rate, KEYS };
})();
if (typeof globalThis !== "undefined") globalThis.RATING = RATING;

(() => {
  if (typeof document === "undefined" || !document.getElementById("cardStage")) return;

  const S = { mode: "roster", pick: null, custom: { name: "", role: "auto", stats: {} } };
  const FIELDS = [["innings", "Innings"], ["notOuts", "Not outs"], ["runs", "Runs"], ["balls", "Balls faced"], ["fours", "4s"], ["sixes", "6s"], ["catches", "Catches"], ["bowlBalls", "Balls bowled"], ["conceded", "Runs conceded"], ["wickets", "Wickets"]];
  const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const stage = el("cardStage");

  const fromPlayer = p => {
    const b = p.batting || {}, w = p.bowling || {};
    return {
      name: p.name, photo: p.photo, innings: num(b.Innings), notOuts: num(b.NO), runs: num(b.Runs), balls: num(b.Balls),
      fours: num(b["4s"]), sixes: num(b["6s"]), catches: num(b.Catches),
      bowlBalls: num(w.Balls), conceded: num(w.Runs), wickets: num(w.Wickets)
    };
  };

  function build() {
    if (S.mode === "custom") {
      const src = { name: S.custom.name.trim() || "Your name", photo: "", ...S.custom.stats };
      return { ...src, ...RATING.rate(src, S.custom.role) };
    }
    const p = APP.players.get(S.pick);
    if (!p) return null;
    const src = fromPlayer(p);
    return { ...src, ...RATING.rate(src) };
  }

  function cardHtml(c) {
    const li = k => `<li><b data-to="${c.attrs[k]}">${c.attrs[k]}</b><span>${k}</span></li>`;
    return `
      <div class="fcard-wrap">
        <article class="fcard${c.deal ? " is-dealt" : ""}" data-tier="${c.tier.key}" aria-label="${escapeHtml(c.name)}, overall ${c.ovr}, ${c.tier.label} card">
          <img class="fcard-mark" src="icons/logo-160.png" alt="" width="160" height="160">
          <div class="fcard-ovr"><b data-to="${c.ovr}">${c.ovr}</b><span>${c.role}</span></div>
          <div class="fcard-photo">${avatarHtml(c.name, c.photo, "fcard-avatar")}</div>
          <h3 class="fcard-name">${escapeHtml(c.name)}</h3>
          <div class="fcard-attrs"><ul>${["BAT", "PWR", "SR"].map(li).join("")}</ul><ul>${["BWL", "ECO", "FLD"].map(li).join("")}</ul></div>
          <p class="fcard-foot">Maine East · ${seasonLabel(APP.season)}</p>
        </article>
      </div>`;
  }

  function countUp() {
    stage.querySelectorAll("[data-to]").forEach((node, i) => {
      const to = +node.dataset.to, t0 = performance.now() + 250 + i * 40, dur = 700;
      node.textContent = "0";
      const tick = now => {
        const k = Math.min(1, Math.max(0, (now - t0) / dur));
        node.textContent = Math.round(to * (1 - Math.pow(1 - k, 3)));
        if (k < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  function draw(deal = false) {
    const c = build();
    if (!c) { stage.innerHTML = `<p class="empty">Cards appear once player stats load.</p>`; return; }
    stage.innerHTML = cardHtml({ ...c, deal: deal && !REDUCED });
    if (deal && !REDUCED) countUp();
  }

  function renderCards(deal = false) {
    const names = [...APP.players.keys()].sort((a, b) => a.localeCompare(b));
    el("cardPlayer").innerHTML = names.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("");
    if (!S.pick || !APP.players.has(S.pick)) {
      S.pick = names.map(n => [n, RATING.rate(fromPlayer(APP.players.get(n))).ovr]).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    }
    if (S.pick) el("cardPlayer").value = S.pick;
    draw(deal);
  }

  function setMode(mode) {
    S.mode = mode;
    el("cardMode").querySelectorAll(".chip").forEach(c => c.classList.toggle("is-active", c.dataset.mode === mode));
    el("cardRoster").hidden = mode !== "roster";
    el("cardCustom").hidden = mode !== "custom";
    draw(true);
  }

  window.renderCards = renderCards;
  window.selectCard = name => {
    if (!APP.players.has(name)) return;
    S.pick = name;
    S.mode = "roster";
    el("cardMode").querySelectorAll(".chip").forEach(c => c.classList.toggle("is-active", c.dataset.mode === "roster"));
    el("cardRoster").hidden = false;
    el("cardCustom").hidden = true;
    renderCards(true);
  };

  // Custom form
  el("cardFields").innerHTML = FIELDS.map(([k, label]) =>
    `<label class="card-field"><span>${label}</span><input type="number" min="0" step="1" inputmode="numeric" data-stat="${k}" placeholder="0"></label>`).join("");

  // Events
  el("cardMode").addEventListener("click", e => { const b = e.target.closest("[data-mode]"); if (b) setMode(b.dataset.mode); });
  el("cardPlayer").addEventListener("change", e => {
    S.pick = e.target.value;
    draw(true);
    history.replaceState(null, "", hashFor("cards", S.pick));
  });
  el("cardCustom").addEventListener("input", e => {
    const t = e.target;
    if (t.dataset.stat) S.custom.stats[t.dataset.stat] = t.value;
    else if (t.id === "cardName") S.custom.name = t.value;
    else if (t.id === "cardRole") S.custom.role = t.value;
    draw(false);
  });
  el("cardShare").addEventListener("click", () => {
    const c = build();
    if (!c) return;
    share({
      title: `${c.name} · Blue Demon card`,
      text: `🏏 ${c.name} — ${c.ovr} ${c.role} (${c.tier.label} card) · BAT ${c.attrs.BAT} · BWL ${c.attrs.BWL}`,
      url: S.mode === "roster" ? linkTo("cards", c.name, APP.season) : linkTo("cards")
    });
  });

  // 3D tilt + light sheen that follow the pointer
  const tilt = (x, y) => {
    stage.style.setProperty("--ry", `${(x - 0.5) * 24}deg`);
    stage.style.setProperty("--rx", `${(0.5 - y) * 20}deg`);
    stage.style.setProperty("--mx", `${x * 100}%`);
    stage.style.setProperty("--my", `${y * 100}%`);
  };
  if (!REDUCED) {
    stage.addEventListener("pointermove", e => {
      const r = stage.getBoundingClientRect();
      stage.classList.add("is-tilting");
      tilt((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    });
    const rest = () => { stage.classList.remove("is-tilting"); tilt(0.5, 0.5); };
    stage.addEventListener("pointerleave", rest);
    stage.addEventListener("pointercancel", rest);
  }

  const { view, args = [] } = parseHash();
  if (view === "cards" && args[0]) S.pick = args[0];
  if (APP.players.size) renderCards();
})();

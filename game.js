/* Ember Battle — prototype engine + UI. Card data lives in cards.js. */
(function () {
  'use strict';
  const { CARDS, MAIN_DECK, HERO_DECK, VILLAIN_MOVE_DECKS, RULES } = window.EMBER;
  const SYM = { '+': '+', '-': '−', '.': '•', '±': '±' };
  const PNAME = { '+': 'Attack', '-': 'Defend', '.': 'Focus' };
  const POSTURES = ['+', '-', '.'];
  const SAVE_KEY = 'ember-battle-save-v1';

  let S = null;          // whole game state — plain JSON
  let busy = false;      // true while a step is resolving (async choices)

  // ================================================================ utils
  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function expand(counts) { const out = []; for (const [id, n] of Object.entries(counts)) for (let k = 0; k < n; k++) out.push(id); return out; }
  const card = (id) => CARDS[id];
  const unit = (u) => (typeof u === 'string' ? S.units[u] : u);
  const nameOf = (u) => card(unit(u).id).name;
  const sym = (p) => SYM[p] || p;
  function log(msg, cls = '') { S.log.push({ msg, cls }); if (S.log.length > 400) S.log.splice(0, S.log.length - 400); }

  // ================================================================ decks
  function drawStep() {
    if (!S.steps.length) S.steps = shuffle(expand(RULES.stepDeck));
    return S.steps.pop();
  }
  // Villains can use their own step deck (RULES.villainStepDeck); otherwise they share the heroes' deck.
  function drawVStep() {
    if (!RULES.villainStepDeck) return drawStep();
    if (!S.vsteps || !S.vsteps.length) S.vsteps = shuffle(expand(RULES.villainStepDeck));
    return S.vsteps.pop();
  }
  function peekSteps(n) {
    while (S.steps.length < n) S.steps = shuffle(expand(RULES.stepDeck)).concat(S.steps);
    return S.steps.slice(-n).reverse();          // [top, 2nd, 3rd]
  }
  function drawMain() {
    if (!S.main.length) {
      if (!S.mainDiscard.length) return null;
      S.main = shuffle(S.mainDiscard); S.mainDiscard = [];
      log('The main deck runs out. The discard pile is shuffled into a new deck.', 'sys');
    }
    return S.main.pop();
  }
  function drawFor(p, n) {
    const pl = S.players[p]; let got = 0;
    for (let k = 0; k < n; k++) { const c = drawMain(); if (c) { pl.hand.push(c); got++; } }
    return got;
  }
  function drawVMove(post) {
    if (!S.vdecks[post].length) { S.vdecks[post] = shuffle(S.vdiscard[post]); S.vdiscard[post] = []; }
    return S.vdecks[post].pop();
  }

  // ================================================================ units
  function makeHero(id, owner) {
    const uid = 'u' + S.nextUid++;
    S.units[uid] = { uid, kind: 'hero', id, owner, dmg: 0, slots: { '+': [], '-': [], '.': [] }, lessons: [], flags: {}, battleFlags: {} };
    return uid;
  }
  function spawnVillain(id, lanes) {
    const def = card(id);
    if (def.act === 2 && !S.act2) {
      S.act2 = true;
      for (const [vid, n] of Object.entries(VILLAIN_MOVE_DECKS[2])) for (let k = 0; k < n; k++) S.vdecks[card(vid).posture].push(vid);
      POSTURES.forEach((p) => shuffle(S.vdecks[p]));
      log('Act II begins. Harder villain moves are shuffled into the villain move decks.', 'act');
    }
    const uid = 'u' + S.nextUid++;
    const slots = { '+': [], '-': [], '.': [] };
    const per = def.movesPerSlot || 1;
    POSTURES.forEach((p) => { for (let k = 0; k < per; k++) slots[p].push(drawVMove(p)); });
    const perLane = !S.solo && RULES.multiplayer && RULES.multiplayer.bossHpPerLane || def.hp;
    const maxHp = def.hpPerLane ? perLane * S.lanes.length : def.hp;
    S.units[uid] = { uid, kind: 'villain', id, dmg: 0, maxHp, slots };
    lanes.forEach((l) => (l.villain = uid));
    const mv = POSTURES.map((p) => slots[p].map((m) => `${sym(p)} ${card(m).name}`).join(' / ')).join(', ');
    log(`${def.name} appears${def.act === 'boss' ? ' to fight every lane' : ` in lane ${S.lanes.indexOf(lanes[0]) + 1}`}. Moves: ${mv}.`, 'villain');
    return uid;
  }
  function maxHp(u) {
    u = unit(u);
    if (u.kind === 'villain') return u.maxHp;
    return card(u.id).hp + u.lessons.reduce((s, l) => s + (card(l).hpBonus || 0), 0);
  }
  function heroMove(u, step) {
    const st = u.slots[step];
    if (st && st.length) return card(st[st.length - 1]);
    return card(u.id).slots[step] || null;
  }
  function villainMove(u, step) {
    const ids = u.slots[step] || [];
    if (!ids.length) return null;
    const rank = (m) => (m.rank != null ? m.rank : (m.atk || 0) + (m.def || 0));
    return ids.map(card).reduce((best, m) => (rank(m) > rank(best) ? m : best));
  }
  const trainingCount = (u) => POSTURES.reduce((s, p) => s + unit(u).slots[p].length, 0);
  const activeHeroes = () => S.lanes.filter((l) => l.hero).map((l) => unit(l.hero));
  const allHeroes = () => activeHeroes().concat(S.players.filter((p) => p.reserve).map((p) => unit(p.reserve)));
  const hasAlly = (p, id) => S.players[p].allies.includes(id);
  const anyAlly = (id) => S.players.some((pl) => pl.allies.includes(id));
  function heal(u, n, why) {
    u = unit(u); const before = u.dmg; u.dmg = Math.max(0, u.dmg - n);
    if (before !== u.dmg) log(`${nameOf(u)} heals ${before - u.dmg}${why ? ` (${why})` : ''}.`, 'heal');
  }

  // ================================================================ new game
  function newGame({ players, names, difficulty }) {
    S = {
      v: 1, nextUid: 1, round: 0, clock: 0, difficulty, track: RULES.clocks[difficulty].slice(),
      solo: players === 1, players: [], lanes: [], units: {},
      heroDeck: shuffle(HERO_DECK.slice()), main: shuffle(expand(MAIN_DECK)), mainDiscard: [],
      steps: shuffle(expand(RULES.stepDeck)), villainDeck: [], vdecks: { '+': [], '-': [], '.': [] }, vdiscard: { '+': [], '-': [], '.': [] },
      act2: false, phase: 'pick', pick: null, turnOrder: [], turn: 0, firstPlayer: 0, log: [], battle: null, result: null,
    };
    for (let i = 0; i < players; i++) {
      S.players.push({ name: names[i] || `Player ${i + 1}`, hand: [], reserve: null, courage: 0, readied: [], allies: [], actions: 0, fastStudy: {}, out: false });
    }
    const laneCount = players === 1 ? 2 : players;
    for (let i = 0; i < laneCount; i++) S.lanes.push({ owner: players === 1 ? 0 : i, hero: null, villain: null, scout: null, ambush: false, decision: null });

    // villain deck: top of deck = end of array
    const pool1 = shuffle(Object.values(CARDS).filter((c) => c.kind === 'villain' && c.act === 1).map((c) => c.id));
    const pool2 = shuffle(Object.values(CARDS).filter((c) => c.kind === 'villain' && c.act === 2).map((c) => c.id));
    const a1 = pool1.slice(0, RULES.villainsPerLane.act1 * laneCount);
    const multi = players > 1 ? RULES.multiplayer || {} : {};
    const a2 = pool2.slice(0, RULES.villainsPerLane.act2 * laneCount + (multi.extraAct2 || 0));
    S.villainDeck = ['warlord', ...shuffle(a2), ...shuffle(a1)];
    for (const [vid, n] of Object.entries(VILLAIN_MOVE_DECKS[1])) for (let k = 0; k < n; k++) S.vdecks[card(vid).posture].push(vid);
    POSTURES.forEach((p) => shuffle(S.vdecks[p]));

    S.players.forEach((_, i) => drawFor(i, RULES.handStart));
    log(`New game: ${players === 1 ? 'solo, two lanes' : `${players} players`}, ${difficulty} (${S.track.length}-round clock).`, 'sys');
    log(`Villain deck: ${a1.length} Act I, ${a2.length} Act II, then the Warlord.`, 'sys');
    S.pickQueue = S.players.map((_, i) => i);
    nextPick();
  }
  function nextPick() {
    if (!S.pickQueue.length) { fillLanes(); startRound(); return; }
    const p = S.pickQueue.shift();
    const need = S.solo ? 2 : 1;
    const options = [];
    for (let k = 0; k < need + 2 && S.heroDeck.length; k++) options.push(S.heroDeck.pop());
    S.pick = { player: p, options, need, chosen: [] };
    S.phase = 'pick';
  }
  function choosePick(k) {
    const pk = S.pick; const id = pk.options[k];
    if (!id || pk.chosen.includes(id)) return;
    pk.chosen.push(id);
    if (pk.chosen.length < pk.need) return;
    const myLanes = S.lanes.filter((l) => l.owner === pk.player);
    pk.chosen.forEach((hid, n) => { myLanes[n].hero = makeHero(hid, pk.player); log(`${S.players[pk.player].name} leads with ${card(hid).name}.`, 'hero'); });
    pk.options.filter((o) => !pk.chosen.includes(o)).forEach((o) => S.heroDeck.unshift(o));
    S.pick = null;
    nextPick();
  }

  // ================================================================ rounds
  function startRound() {
    S.round += 1;
    S.phase = 'prepare';
    const n = S.solo ? RULES.draw.solo : RULES.draw.multi;
    S.players.forEach((pl, i) => { drawFor(i, n); pl.actions = S.solo ? RULES.actions.solo : RULES.actions.multi; pl.fastStudy = {}; });
    S.turnOrder = S.players.map((_, i) => (S.firstPlayer + i) % S.players.length);
    S.turn = S.turnOrder.shift();
    log(`Round ${S.round}. Battles this round are ${battleLen()} steps long.`, 'round');
  }
  const battleLen = () => S.track[Math.min(S.clock, S.track.length - 1)];

  async function endTurn() {
    const pl = S.players[S.turn];
    if (pl.hand.length > RULES.handLimit) {
      const n = pl.hand.length - RULES.handLimit;
      const picks = await chooseMany(`${pl.name}: discard ${n} card${n > 1 ? 's' : ''}`,
        `Your hand limit is ${RULES.handLimit}. Pick ${n} to discard.`,
        pl.hand.map((id) => ({ label: card(id).name, sub: kindLabel(card(id)) })), n);
      picks.sort((a, b) => b - a).forEach((k) => S.mainDiscard.push(pl.hand.splice(k, 1)[0]));
    }
    if (S.turnOrder.length) { S.turn = S.turnOrder.shift(); log(`${S.players[S.turn].name} prepares.`, 'sys'); }
    else scoutPhase();
    render();
  }

  // ---------------------------------------------------------------- prepare actions
  function spend(p, freeKey) {
    const pl = S.players[p];
    if (freeKey && !pl.fastStudy[freeKey]) { pl.fastStudy[freeKey] = true; return true; }
    if (pl.actions <= 0) return false;
    pl.actions -= 1; return true;
  }
  function trainTargets(p) {
    const teacher = S.lanes.some((l) => l.owner === p && l.hero && card(unit(l.hero).id).teacher);
    return S.lanes.filter((l) => l.hero && (teacher || l.owner === p)).map((l) => unit(l.hero));
  }
  function canFastStudy(p, h) { return card(h.id).id === 'quick-learner' && !S.players[p].fastStudy[h.uid]; }

  async function playFromHand(k) {
    const p = S.turn, pl = S.players[p], id = pl.hand[k], c = card(id);
    const opts = [];
    const noAct = pl.actions <= 0;
    if (c.kind === 'move') {
      for (const h of trainTargets(p)) {
        const free = canFastStudy(p, h);
        const slots = c.posture === '±' ? ['+', '-'] : [c.posture];
        for (const s of slots) {
          opts.push({ label: `Train ${card(h.id).name}`, sub: `${sym(s)} slot${free ? ' (free: Fast Study)' : ''}`,
            value: { a: 'train', h: h.uid, s }, disabled: noAct && !free });
        }
      }
    } else if (c.kind === 'tactic') {
      opts.push({ label: 'Ready it', sub: `${pl.readied.length}/${RULES.maxReady} readied`, value: { a: 'ready' }, disabled: noAct || pl.readied.length >= RULES.maxReady });
    } else if (c.kind === 'lesson') {
      for (const h of trainTargets(p)) opts.push({ label: `Teach ${card(h.id).name}`, sub: `${h.lessons.length}/${RULES.maxLessons} lessons`, value: { a: 'teach', h: h.uid }, disabled: noAct || h.lessons.length >= RULES.maxLessons });
    } else if (c.kind === 'ally') {
      opts.push({ label: 'Call this Ally', sub: pl.allies.length ? 'You already have an Ally' : '', value: { a: 'call' }, disabled: noAct || pl.allies.length >= 1 });
    }
    if (!S.solo) S.players.forEach((o, i) => { if (i !== p) opts.push({ label: `Share with ${o.name}`, sub: 'Give this card', value: { a: 'share', to: i }, disabled: noAct }); });
    const pick = await choose(c.name, cardHTML(id), opts, true);
    if (!pick) return;
    if (pick.a === 'train') {
      const h = unit(pick.h);
      if (!spend(p, canFastStudy(p, h) ? h.uid : null)) return;
      pl.hand.splice(k, 1); h.slots[pick.s].push(id);
      log(`${pl.name} trains ${card(h.id).name}: ${c.name} in the ${sym(pick.s)} slot.`, 'hero');
      if (pick.s === '+' && hasAlly(p, 'smith')) { drawFor(p, 1); log('Smith: draw a card.', 'sys'); }
    } else if (pick.a === 'ready') {
      if (!spend(p)) return; pl.hand.splice(k, 1); pl.readied.push(id); log(`${pl.name} readies ${c.name}.`, 'hero');
    } else if (pick.a === 'teach') {
      if (!spend(p)) return; const h = unit(pick.h); pl.hand.splice(k, 1); h.lessons.push(id);
      log(`${card(h.id).name} learns ${c.name}.`, 'hero');
    } else if (pick.a === 'call') {
      if (!spend(p)) return; pl.hand.splice(k, 1); pl.allies.push(id); log(`${pl.name} calls an Ally: ${c.name}.`, 'hero');
    } else if (pick.a === 'share') {
      if (!spend(p)) return; pl.hand.splice(k, 1); S.players[pick.to].hand.push(id); log(`${pl.name} gives ${S.players[pick.to].name} a card.`, 'sys');
    }
    render();
  }
  function actScavenge() { const p = S.turn; if (!spend(p)) return; drawFor(p, 1); log(`${S.players[p].name} scavenges a card.`, 'sys'); render(); }
  function actRecruit() {
    const p = S.turn, pl = S.players[p];
    if (pl.reserve || !S.heroDeck.length || !spend(p)) return;
    pl.reserve = makeHero(S.heroDeck.pop(), p);
    log(`${pl.name} recruits ${nameOf(pl.reserve)} into reserve.`, 'hero'); render();
  }
  function actSwap(li) {
    const p = S.turn, pl = S.players[p], lane = S.lanes[li];
    if (!pl.reserve || !lane.hero || !spend(p)) return;
    [lane.hero, pl.reserve] = [pl.reserve, lane.hero];
    log(`${pl.name} swaps in ${nameOf(lane.hero)}; ${nameOf(pl.reserve)} rests in reserve.`, 'hero'); render();
  }

  // ================================================================ scout / decide
  function scoutPhase() {
    S.phase = 'scout';
    for (const lane of S.lanes) {
      lane.scout = null; lane.ambush = false; lane.decision = null;
      const v = lane.villain && unit(lane.villain);
      if (lane.hero && v) {
        lane.scout = drawVStep();
        const boss = card(v.id).act === 'boss';
        lane.ambush = boss || (lane.scout === '+' && !hasAlly(lane.owner, 'lookout'));
        if (lane.ambush) lane.decision = 'fight';
        log(`Lane ${S.lanes.indexOf(lane) + 1} scout: the villain opens with ${sym(lane.scout)} (${PNAME[lane.scout]}).${boss ? ' The Warlord attacks!' : lane.ambush ? ' Ambush! This lane must fight.' : lane.scout === '+' ? ' Lookout spots it: no ambush.' : ''}`, lane.ambush ? 'danger' : 'sys');
      } else if (lane.hero && !v) {
        lane.decision = joinTargets(lane).length ? null : 'rest';
      } else if (!lane.hero && v) {
        lane.decision = 'unopposed';
      } else lane.decision = 'none';
    }
  }
  const joinTargets = (lane) => S.lanes.filter((l) => l !== lane && l.villain && l.hero);
  function decide(li, d) {
    S.lanes[li].decision = d; render();
  }
  const allDecided = () => S.lanes.every((l) => l.decision);

  // ================================================================ battle
  const newBuffs = () => ({ plusNext: 0, atkNext: 0, defNext: 0, double: false, stealth: false, plusAll: 0, minusAll: 0 });
  const newReact = () => ({ atk: 0, def: 0, preventN: 0, preventAll: false });

  function startBattle() {
    const len = battleLen();
    const engs = [];
    S.lanes.forEach((lane, li) => {
      const d = lane.decision;
      if (d === 'hold' || d === 'rest') {
        heal(lane.hero, 1, 'holding'); drawFor(lane.owner, 1);
        log(`Lane ${li + 1} holds back: the hero recovers 1 and ${S.players[lane.owner].name} draws a card.`, 'sys');
      }
      let villain = null, first = null;
      if (d === 'fight') { villain = lane.villain; first = lane.scout; }
      else if (d && d.startsWith('join:')) { villain = S.lanes[+d.slice(5)].villain; first = drawVStep(); log(`${nameOf(lane.hero)} joins the fight in lane ${+d.slice(5) + 1}.`, 'hero'); }
      if (!villain) return;
      unit(lane.hero).battleFlags = {};
      const hs = []; for (let k = 0; k < len; k++) hs.push(drawStep());
      const vs = [first]; for (let k = 1; k < len; k++) vs.push(drawVStep());
      engs.push({ id: engs.length, lane: li, hero: lane.hero, villain, owner: lane.owner, len, over: false, fled: false,
        h: { steps: hs, buffs: newBuffs(), react: newReact(), stagger: {}, known: {}, dmgTaken: 0 },
        v: { steps: vs, buffs: newBuffs(), react: newReact(), known: { 0: true }, focusSeen: false, minusCount: 0, dmgTaken: 0 },
        rec: [], preview: null });
    });
    if (!engs.length) { S.battle = null; aftermath(); return; }
    S.battle = { len, i: 0, stage: 'ready', engs };
    S.phase = 'battle';
    log(`Battle! ${engs.length} fight${engs.length > 1 ? 's' : ''}, ${len} steps.`, 'round');
  }
  const liveEngs = () => (S.battle ? S.battle.engs.filter((e) => !e.over) : []);

  function sideBase(eng, i, isHero) {
    const st = isHero ? eng.h : eng.v;
    const u = unit(isHero ? eng.hero : eng.villain);
    const step = st.steps[i];
    let move = null;
    if (isHero) { if (!st.stagger[i]) move = heroMove(u, step); } else move = villainMove(u, step);
    return { unit: u, isHero, step, prev: i > 0 ? st.steps[i - 1] : null, move, atk: (move && move.atk) || 0, def: (move && move.def) || 0,
      pierce: 0, buffs: st.buffs, side: st, bracing: false, staggered: isHero && !!st.stagger[i] };
  }
  function applyBuffs(me) {
    const b = me.buffs;
    if (me.step === '+') me.atk += b.plusNext + b.plusAll;
    if (me.step === '-') me.def += b.minusAll;
    me.atk += b.atkNext; me.def += b.defNext;
  }
  function compute(eng, i) {
    const c = { i, len: eng.len, eng, g: API };
    const h = sideBase(eng, i, true), v = sideBase(eng, i, false);
    const vdef = card(v.unit.id), hdef = card(h.unit.id);
    if (h.move && h.move.mod) h.move.mod(h, v, c);
    if (v.move && v.move.mod) v.move.mod(v, h, c);
    applyBuffs(h); applyBuffs(v);
    h.unit.lessons.forEach((l) => card(l).mod && card(l).mod(h, v, c));
    if (hdef.mod) hdef.mod(h, v, c);
    if (i === 0 && activeHeroes().some((x) => card(x.id).rally)) h.atk += 1;
    if (vdef.mod) vdef.mod(v, h, c);
    h.atk += eng.h.react.atk; h.def += eng.h.react.def;
    if (eng.tension) { if (h.step === '+') h.atk += eng.tension; if (v.step === '+') v.atk += eng.tension; }
    if (h.move && h.move.final) h.move.final(h, v, c);
    if (vdef.final) vdef.final(v, h, c);
    for (const s of [h, v]) if (s.buffs.double) { s.atk *= 2; s.def *= 2; }
    if (vdef.foeMod) vdef.foeMod(h, v, c);
    h.atk = Math.max(0, h.atk); h.def = Math.max(0, h.def); v.atk = Math.max(0, v.atk); v.def = Math.max(0, v.def);
    let toV = Math.max(0, h.atk - Math.max(0, v.def - h.pierce));
    let toH = Math.max(0, v.atk - Math.max(0, h.def - v.pierce));
    const notes = [];
    if (v.bracing && h.atk >= 1 && h.atk <= 2 && toV < 1) { toV = 1; notes.push('Bracing Armor strains'); }
    if (vdef.immune && vdef.immune(v, h, c) && toV) { toV = 0; notes.push(`${vdef.name} avoids the damage`); }
    if ((h.buffs.stealth || eng.h.react.preventAll) && toH) { toH = 0; notes.push('all damage to the hero prevented'); }
    if (eng.h.react.preventN && toH) { const was = toH; toH = Math.max(0, toH - eng.h.react.preventN); notes.push(`Brace stops ${was - toH}`); }
    return { h, v, toH, toV, c, notes };
  }

  function revealStep() {
    const b = S.battle; const i = b.i;
    for (const e of liveEngs()) {
      e.h.react = newReact(); e.v.react = newReact();
      e.h.known[i] = true; e.v.known[i] = true;
      const pre = compute(e, i);
      if (pre.v.move && pre.v.move.onReveal) pre.v.move.onReveal(pre.v, pre.h, pre.c);
    }
    b.stage = 'revealed';
    render();
  }

  async function resolveStep() {
    if (busy) return; busy = true;
    try {
      const b = S.battle; const i = b.i;
      const results = [];
      for (const e of liveEngs()) {
        const r = compute(e, i);
        if (r.h.move && r.h.move.preDamage) {
          render();
          const fled = await r.h.move.preDamage(r.h, r.v, r.c);
          if (fled) { e.over = true; e.fled = true; e.rec[i] = recordOf(r, 0, 0, ['fled']); log(`${nameOf(e.hero)} flees the battle.`, 'hero'); continue; }
        }
        results.push([e, r]);
      }
      // simultaneous damage
      for (const [e, r] of results) {
        r.h.unit.dmg += r.toH; r.v.unit.dmg += r.toV;
        e.h.dmgTaken += r.toH; e.v.dmgTaken += r.toV;
        e.rec[i] = recordOf(r, r.toH, r.toV, r.notes);
        if (RULES.tensionMax) {
          const was = e.tension || 0;
          if (r.h.step === '+' || r.v.step === '+') e.tension = 0;
          else if (!r.toH && !r.toV) e.tension = Math.min(RULES.tensionMax, was + 1);
          e.rec[i].tension = e.tension;
        }
        log(`Lane ${e.lane + 1}, step ${i + 1}: ${nameOf(e.hero)} ${sym(r.h.step)}${r.h.staggered ? ' (staggered)' : ''} ${r.h.atk}+/${r.h.def}− vs ${nameOf(e.villain)} ${sym(r.v.step)} ${r.v.atk}+/${r.v.def}−. Hero takes ${r.toH}, villain takes ${r.toV}.${r.notes.length ? ' ' + r.notes.join('; ') + '.' : ''}`, 'step');
      }
      // consume one-step buffs, then after-effects
      for (const [e, r] of results) {
        for (const s of [r.h, r.v]) {
          const bf = s.buffs; if (s.step === '+') bf.plusNext = 0;
          bf.atkNext = 0; bf.defNext = 0; bf.double = false; bf.stealth = false;
        }
        if (r.v.step === '-') e.v.minusCount += 1;
      }
      for (const [e, r] of results) {
        render();
        if (r.h.move && r.h.move.after) await r.h.move.after(r.h, r.v, r.c, { toMe: r.toH, toFoe: r.toV });
        if (r.v.move && r.v.move.after) await r.v.move.after(r.v, r.h, r.c, { toMe: r.toV, toFoe: r.toH });
        const vdef = card(r.v.unit.id);
        if (vdef.after) await vdef.after(r.v, r.h, r.c, { toMe: r.toV, toFoe: r.toH });
        if (r.v.step === '.') e.v.focusSeen = true;
      }
      // defeat checks
      for (const e of liveEngs()) {
        const h = unit(e.hero), v = unit(e.villain);
        if (h.dmg >= maxHp(h) && card(h.id).bigHeart && !h.flags.bigHeartUsed) {
          h.flags.bigHeartUsed = true; h.dmg = maxHp(h) - 1; log(`${nameOf(h)}'s Big Heart: still standing at 1 health!`, 'heal');
        }
        if (h.dmg >= maxHp(h)) { e.over = true; e.heroDown = true; log(`${nameOf(h)} is defeated!`, 'danger'); }
      }
      const downV = new Set();
      for (const e of S.battle.engs) if (!e.villainDown && unit(e.villain).dmg >= maxHp(e.villain)) downV.add(e.villain);
      for (const vu of downV) {
        for (const e of S.battle.engs) if (e.villain === vu) { e.villainDown = true; e.over = true; }
        log(`${nameOf(vu)} is defeated!`, 'win');
      }
      b.i += 1;
      b.stage = b.i >= b.len || !liveEngs().length ? 'done' : 'ready';
      if (b.stage === 'done') { for (const e of b.engs) for (let k = 0; k < e.len; k++) { e.h.known[k] = true; e.v.known[k] = true; } }
    } finally { busy = false; render(); }
  }
  function recordOf(r, toH, toV, notes) {
    return { hStep: r.h.step, vStep: r.v.step, hMove: r.h.move ? r.h.move.name : '—', vMove: r.v.move ? r.v.move.name : '—',
      hAtk: r.h.atk, hDef: r.h.def, vAtk: r.v.atk, vDef: r.v.def, toH, toV, staggered: r.h.staggered, notes };
  }

  // ---------------------------------------------------------------- reactions (tactics, courage, abilities)
  function reactOptions() {
    const b = S.battle; if (!b || b.stage !== 'revealed') return [];
    const i = b.i, out = [];
    const live = liveEngs();
    S.players.forEach((pl, p) => {
      const own = live.filter((e) => e.owner === p);
      pl.readied.forEach((tid, k) => {
        const r = card(tid).react;
        const targets = r.target === 'none' ? (live.length ? [null] : [])
          : r.target === 'other' ? live.filter((e) => !(own.length === 1 && e === own[0]))
            : own;
        const ok = targets.filter((e) => !r.when || r.when({ eng: e, i, g: API }));
        out.push({ kind: 'tactic', p, k, label: card(tid).name, text: card(tid).text, targets: ok, owner: pl.name });
      });
      if (pl.courage > 0) out.push({ kind: 'courage', p, label: `Courage (${pl.courage})`, text: 'Redraw your step.', targets: own, owner: pl.name });
    });
    for (const e of live) {
      const h = unit(e.hero);
      const srcs = [{ src: 'hero', def: card(h.id) }, ...h.lessons.map((l) => ({ src: l, def: card(l) }))];
      for (const { src, def } of srcs) {
        const ar = def.abilityReact; if (!ar || h.battleFlags[ar.once]) continue;
        const targets = ar.target === 'other' ? live.filter((x) => x !== e) : [e];
        const ok = targets.filter((x) => !ar.when || ar.when({ eng: x, i, g: API }));
        out.push({ kind: 'ability', eng: e.id, src, label: ar.label, text: def.name, targets: ok, owner: nameOf(h) });
      }
    }
    return out;
  }
  async function useReact(opt) {
    if (!opt.targets.length) return;
    let target = opt.targets[0];
    if (opt.targets.length > 1) {
      target = await choose(opt.label, 'Which fight?', opt.targets.map((e) => ({ label: `Lane ${e.lane + 1}: ${nameOf(e.hero)}`, sub: `vs ${nameOf(e.villain)}`, value: e })), true);
      if (!target) return;
    }
    const i = S.battle.i, t = { eng: target, i, g: API };
    if (opt.kind === 'tactic') {
      const pl = S.players[opt.p]; const tid = pl.readied[opt.k];
      card(tid).react.apply(t); pl.readied.splice(opt.k, 1); S.mainDiscard.push(tid);
      log(`${pl.name} uses ${card(tid).name}${target ? ` for ${nameOf(target.hero)}` : ''}.`, 'hero');
    } else if (opt.kind === 'courage') {
      const pl = S.players[opt.p]; pl.courage -= 1;
      const old = target.h.steps[i]; target.h.steps[i] = drawStep();
      log(`${pl.name} spends Courage: ${nameOf(target.hero)}'s ${sym(old)} becomes ${sym(target.h.steps[i])}.`, 'hero');
    } else {
      const e = S.battle.engs[opt.eng]; const h = unit(e.hero);
      const def = opt.src === 'hero' ? card(h.id) : card(opt.src);
      def.abilityReact.apply(t); h.battleFlags[def.abilityReact.once] = true;
      log(`${nameOf(h)}: ${def.abilityReact.label}.`, 'hero');
    }
    render();
  }

  // ================================================================ aftermath
  async function aftermath() {
    if (busy) return; busy = true;
    try {
      const b = S.battle;
      const engs = b ? b.engs : [];
      // villains defeated -> spoils
      const downV = [...new Set(engs.filter((e) => e.villainDown).map((e) => e.villain))];
      for (const vu of downV) {
        const v = unit(vu);
        if (card(v.id).act === 'boss') { S.phase = 'over'; S.result = 'win'; log('The Warlord falls. The heroes win!', 'win'); return; }
        POSTURES.forEach((p) => v.slots[p].forEach((m) => S.vdiscard[p].push(m)));
        S.lanes.forEach((l) => { if (l.villain === vu) l.villain = null; });
        const winners = [...new Set(engs.filter((e) => e.villain === vu && !e.fled).map((e) => e.owner))];
        for (const p of winners) await spoils(p, nameOf(vu));
      }
      // cowards run
      for (const e of engs) {
        const v = unit(e.villain); const def = card(v.id);
        if (def.runsAt && v.dmg >= def.runsAt && v.dmg < maxHp(v) && S.lanes.some((l) => l.villain === v.uid)) {
          S.lanes.forEach((l) => { if (l.villain === v.uid) l.villain = null; });
          POSTURES.forEach((p) => v.slots[p].forEach((m) => S.vdiscard[p].push(m)));
          S.villainDeck.splice(1 + Math.floor(Math.random() * S.villainDeck.length), 0, v.id);
          log(`${def.name} runs away! It is shuffled back into the villain deck.`, 'villain');
        }
      }
      // heroes defeated
      for (const e of engs.filter((x) => x.heroDown)) {
        const h = unit(e.hero), lane = S.lanes[e.lane], pl = S.players[h.owner];
        POSTURES.forEach((p) => S.mainDiscard.push(...h.slots[p])); S.mainDiscard.push(...h.lessons);
        if (lane.hero === h.uid) {
          if (pl.reserve) { lane.hero = pl.reserve; pl.reserve = null; log(`${nameOf(lane.hero)} steps in from reserve.`, 'hero'); }
          else if (S.heroDeck.length) { lane.hero = makeHero(S.heroDeck.pop(), h.owner); log(`${nameOf(lane.hero)} answers the call.`, 'hero'); }
          else { lane.hero = null; log(`No heroes left to fill lane ${e.lane + 1}.`, 'danger'); }
        }
      }
      // after-battle healing
      if (b) {
        if (anyAlly('medic')) API.healMostHurt(1, 'Medic');
        activeHeroes().filter((h) => card(h.id).afterBattleHeal).forEach(() => API.healMostHurt(1, 'Field Medic'));
      }
      S.players.forEach((pl) => pl.reserve && heal(pl.reserve, 1, 'resting in reserve'));
      fillLanes();
      // clock
      const unopposed = S.lanes.filter((l) => l.villain && !l.hero).length;
      S.clock += 1 + unopposed;
      if (unopposed) log(`An unopposed villain pushes the clock forward ${unopposed} extra.`, 'danger');
      if (!activeHeroes().length && !S.players.some((p) => p.reserve)) { S.phase = 'over'; S.result = 'lose'; log('Every hero has fallen.', 'danger'); return; }
      if (S.clock >= S.track.length) { S.phase = 'over'; S.result = 'lose'; log('The clock runs out. The darkness wins.', 'danger'); return; }
      S.firstPlayer = (S.firstPlayer + 1) % S.players.length;
      startRound();
    } finally { busy = false; render(); }
  }
  async function spoils(p, vname) {
    const pl = S.players[p];
    const hurt = S.lanes.filter((l) => l.owner === p && l.hero).map((l) => unit(l.hero));
    const pick = await choose(`${pl.name} defeated ${vname}!`, 'Choose your spoils.', [
      { label: 'Heal 2', sub: hurt.map((h) => `${card(h.id).name} ${maxHp(h) - h.dmg}/${maxHp(h)}`).join(', '), value: 'heal' },
      { label: 'Draw 2 cards', value: 'draw' },
      { label: 'Gain 1 Courage', sub: `Redraw one of your steps in battle (you have ${pl.courage}/${RULES.maxCourage})`, value: 'courage', disabled: pl.courage >= RULES.maxCourage },
    ]);
    if (pick === 'heal') {
      let h = hurt[0];
      if (hurt.length > 1) h = await choose('Heal which hero?', '', hurt.map((x) => ({ label: card(x.id).name, sub: `${maxHp(x) - x.dmg}/${maxHp(x)}`, value: x }))) || hurt[0];
      if (h) heal(h, 2, 'spoils');
    } else if (pick === 'draw') { drawFor(p, 2); log(`${pl.name} draws 2 (spoils).`, 'sys'); }
    else if (pick === 'courage') { pl.courage += 1; log(`${pl.name} gains Courage.`, 'sys'); }
  }
  function fillLanes() {
    for (const lane of S.lanes) {
      if (lane.villain || !lane.hero) continue;
      const top = S.villainDeck[S.villainDeck.length - 1];
      if (!top || card(top).act === 'boss') continue;
      spawnVillain(S.villainDeck.pop(), [lane]);
    }
    const top = S.villainDeck[S.villainDeck.length - 1];
    if (top && card(top).act === 'boss' && S.lanes.every((l) => !l.villain)) {
      spawnVillain(S.villainDeck.pop(), S.lanes.filter((l) => l.hero));
    }
  }

  // ================================================================ API for card hooks
  const API = {
    unit, nameOf, log, trainingCount,
    heal: (u, n) => heal(u, n),
    liveEngagements: liveEngs,
    ownerOf: (u) => unit(u).owner,
    drawFor: (p, n) => { drawFor(p, n); log(`${S.players[p].name} draws ${n}.`, 'sys'); },
    healMostHurt(n, why) {
      const hs = activeHeroes().filter((h) => h.dmg > 0).sort((a, b) => b.dmg - a.dmg);
      if (hs[0]) heal(hs[0], n, why);
    },
    stagger(eng, idx) { if (idx < eng.len) { eng.h.stagger[idx] = true; log(`${nameOf(eng.hero)} is Staggered: their next step does nothing.`, 'danger'); } },
    selfDamage(u, n, why) { u = unit(u); u.dmg += n; log(`${nameOf(u)} takes ${n} (${why}).`, 'step'); },
    discardTop(u, slot, why) { u = unit(u); const id = u.slots[slot].pop(); if (id) { S.mainDiscard.push(id); log(`${why} is discarded from ${nameOf(u)}.`, 'sys'); } },
    discardVillainMove(u, slot, id) { u = unit(u); const k = u.slots[slot].indexOf(id); if (k >= 0) { u.slots[slot].splice(k, 1); S.vdiscard[slot].push(id); log(`${nameOf(u)}'s ${card(id).name} breaks.`, 'win'); } },
    async planSwap(eng) {
      const i = S.battle.i;
      const later = []; for (let k = i + 1; k < eng.len; k++) later.push(k);
      if (!later.length) return;
      const top = peekSteps(3);
      const pickIdx = await choose('Plan: the top 3 step cards', 'Swap one of these into one of your face-down steps, or keep your steps.',
        top.map((s, n) => ({ label: `${sym(s)} ${PNAME[s]}`, value: n + 1 })).concat([{ label: 'Keep my steps', value: -1 }]));
      if (!pickIdx || pickIdx < 0) return;
      const slot = later.length === 1 ? later[0] : await choose('Plan: replace which step?', 'Your upcoming steps are face down.',
        later.map((k) => ({ label: `Step ${k + 1}`, sub: eng.h.known[k] ? `${sym(eng.h.steps[k])} (known)` : 'face down', value: k })));
      if (slot == null) return;
      const deckPos = S.steps.length - pickIdx;
      [S.steps[deckPos], eng.h.steps[slot]] = [eng.h.steps[slot], S.steps[deckPos]];
      eng.h.known[slot] = true;
      log(`Plan: ${nameOf(eng.hero)}'s step ${slot + 1} is now ${sym(eng.h.steps[slot])}.`, 'hero');
    },
    async fleeCheck(eng, i) {
      if (i + 1 >= eng.len) { log('Flee: there is no next step to peek at.', 'sys'); return false; }
      const nxt = eng.h.steps[i + 1]; eng.h.known[i + 1] = true;
      if (nxt !== '.') { log(`Flee: the next step is ${sym(nxt)}, so ${nameOf(eng.hero)} cannot slip away.`, 'sys'); render(); return false; }
      return !!(await choose('Flee?', `${nameOf(eng.hero)}'s next step is •. End this battle now, before damage? (No spoils.)`,
        [{ label: 'Flee now', value: true }, { label: 'Keep fighting', value: false }]));
    },
    async aerialPeek(eng, i) {
      if (i + 1 >= eng.len) return;
      eng.h.known[i + 1] = true; eng.v.known[i + 1] = true; render();
      const a = eng.h.steps[i + 1], v = eng.v.steps[i + 1];
      const yes = await choose('High Ground', `Next step: ${nameOf(eng.hero)} ${sym(a)}, ${nameOf(eng.villain)} ${sym(v)}. Swap them?`,
        [{ label: `Swap (hero ${sym(v)}, villain ${sym(a)})`, value: true }, { label: 'Leave them', value: false }]);
      if (yes) { eng.h.steps[i + 1] = v; eng.v.steps[i + 1] = a; log('High Ground: next steps swapped.', 'hero'); }
    },
    async quickStudy(u) {
      u = unit(u); const id = drawMain(); if (!id) return;
      const c = card(id);
      if (c.kind === 'move') {
        let slot = c.posture;
        if (slot === '±') slot = await choose(`Study: ${c.name}`, 'Put it in which slot?', [{ label: '+ slot', value: '+' }, { label: '− slot', value: '-' }]) || '+';
        u.slots[slot].push(id); log(`Study: ${nameOf(u)} learns ${c.name} mid-battle.`, 'hero');
      } else { S.players[u.owner].hand.push(id); log(`Study: ${c.name} goes to ${S.players[u.owner].name}'s hand.`, 'sys'); }
    },
  };

  // ================================================================ modal
  let modalResolve = null;
  function choose(title, bodyHTML, options, cancellable = false) {
    return new Promise((resolve) => {
      modalResolve = resolve;
      const root = $('#modal');
      root.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="mtitle">
        <h2 id="mtitle">${esc(title)}</h2>
        ${bodyHTML ? `<div class="mbody">${bodyHTML.startsWith('<') ? bodyHTML : `<p>${esc(bodyHTML)}</p>`}</div>` : ''}
        <div class="mopts">${options.map((o, k) => `<button class="opt" data-k="${k}" ${o.disabled ? 'disabled' : ''}>
          <span>${esc(o.label)}</span>${o.sub ? `<small>${esc(o.sub)}</small>` : ''}</button>`).join('')}</div>
        ${cancellable ? '<button class="ghost mcancel" data-k="-1">Cancel</button>' : ''}</div>`;
      root.hidden = false;
      const first = root.querySelector('.opt:not([disabled])'); if (first) first.focus();
      root.onclick = (ev) => {
        const btn = ev.target.closest('button[data-k]'); if (!btn || btn.disabled) return;
        const k = +btn.dataset.k; root.hidden = true; root.innerHTML = ''; root.onclick = null;
        const r = modalResolve; modalResolve = null; r(k < 0 ? null : options[k].value);
      };
    });
  }

  // pick exactly `count` items; resolves to their indices
  function chooseMany(title, body, items, count) {
    return new Promise((resolve) => {
      const root = $('#modal'); const sel = new Set();
      const draw = () => {
        root.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="mtitle">
          <h2 id="mtitle">${esc(title)}</h2><div class="mbody"><p>${esc(body)}</p></div>
          <div class="mopts many">${items.map((o, k) => `<button class="opt ${sel.has(k) ? 'on' : ''}" data-k="${k}" aria-pressed="${sel.has(k)}">
            <span>${esc(o.label)}</span>${o.sub ? `<small>${esc(o.sub)}</small>` : ''}</button>`).join('')}</div>
          <button class="primary" data-done="1" ${sel.size === count ? '' : 'disabled'}>Discard ${sel.size}/${count}</button></div>`;
      };
      draw(); root.hidden = false;
      root.onclick = (ev) => {
        const done = ev.target.closest('button[data-done]');
        if (done && !done.disabled) { root.hidden = true; root.innerHTML = ''; root.onclick = null; resolve([...sel]); return; }
        const b = ev.target.closest('button[data-k]'); if (!b) return;
        const k = +b.dataset.k;
        if (sel.has(k)) sel.delete(k); else if (sel.size < count) sel.add(k);
        draw();
      };
    });
  }

  // ================================================================ rendering
  function kindLabel(c) {
    if (c.kind === 'move') return c.posture === '±' ? '± Move' : `${sym(c.posture)} Move`;
    return { tactic: 'Tactic', lesson: 'Lesson', ally: 'Ally', hero: 'Hero', villain: 'Villain' }[c.kind] || c.kind;
  }
  function powerOf(m) {
    if (!m) return '';
    if (m.power) return m.power;
    const parts = []; if (m.atk) parts.push(`${m.atk}+`); if (m.def) parts.push(`${m.def}−`);
    return parts.join(' ');
  }
  function postClass(p) { return { '+': 'atk', '-': 'def', '.': 'foc', '±': 'flex' }[p] || ''; }
  function cardHTML(id) {
    const c = card(id);
    return `<div class="mini ${postClass(c.posture)}"><div class="mini-k">${esc(kindLabel(c))}</div>
      <div class="mini-n">${esc(c.name)}</div>${powerOf(c) ? `<div class="mini-p">${esc(powerOf(c))}</div>` : ''}
      <p>${esc(c.text || '')}</p></div>`;
  }
  function slotRow(p, m, stackN, extra = '') {
    return `<li class="slot ${postClass(p)}"><span class="sym">${sym(p)}</span>
      <span class="mv">${!m ? '<em>empty</em>' : m.name === powerOf(m) ? '<em>printed</em>' : esc(m.name)}${stackN > 1 ? ` <b class="stack" title="Training stack">×${stackN}</b>` : ''}</span>
      <span class="pw">${m ? esc(powerOf(m)) : ''}</span>
      ${m && m.text ? `<span class="tx">${esc(m.text)}</span>` : ''}${extra}</li>`;
  }
  function heroCard(u, opts = {}) {
    u = unit(u); const def = card(u.id); const hp = maxHp(u); const left = Math.max(0, hp - u.dmg);
    return `<article class="ucard hero ${opts.small ? 'small' : ''}">
      <header><h3>${esc(def.name)}</h3><span class="hp" title="Health">${left}<small>/${hp}</small> ♥</span></header>
      <div class="hpbar"><i style="width:${(left / hp) * 100}%"></i></div>
      ${opts.small ? '' : `<ul class="slots">${POSTURES.map((p) => slotRow(p, heroMove(u, p), u.slots[p].length)).join('')}</ul>
      ${def.ability ? `<p class="ability">${esc(def.ability)}</p>` : ''}
      ${u.lessons.length ? `<div class="chips">${u.lessons.map((l) => `<span class="chip" title="${esc(card(l).text)}">${esc(card(l).name)}</span>`).join('')}</div>` : ''}
      <footer>${S.players[u.owner].name} · training ${trainingCount(u)}${def.bigHeart && u.flags.bigHeartUsed ? ' · Big Heart used' : ''}</footer>`}
    </article>`;
  }
  function villainCard(u) {
    u = unit(u); const def = card(u.id); const hp = maxHp(u); const left = Math.max(0, hp - u.dmg);
    const rows = POSTURES.map((p) => {
      const ms = u.slots[p].map(card);
      if (ms.length > 1) return `<li class="slot ${postClass(p)}"><span class="sym">${sym(p)}</span><span class="mv">${ms.map((m) => esc(m.name)).join(' / ')}</span><span class="pw">${ms.map(powerOf).filter(Boolean).join(' / ')}</span><span class="tx">Uses the stronger.</span></li>`;
      return slotRow(p, ms[0] || null, 0);
    }).join('');
    return `<article class="ucard villain">
      <header><span class="act">${def.act === 'boss' ? 'Boss' : `Act ${def.act === 1 ? 'I' : 'II'}`}</span><h3>${esc(def.name)}</h3><span class="hp">${left}<small>/${hp}</small> ♥</span></header>
      <div class="hpbar"><i style="width:${(left / hp) * 100}%"></i></div>
      <ul class="slots">${rows}</ul>${def.ability ? `<p class="ability">${esc(def.ability)}</p>` : ''}</article>`;
  }
  function stepTile(p, shown, extra = '') {
    if (!shown) return `<span class="tile back" title="Face down"></span>`;
    return `<span class="tile ${postClass(p)} ${extra}" title="${PNAME[p]}">${sym(p)}</span>`;
  }
  function strip(lane, li) {
    const b = S.battle;
    if (S.phase === 'scout' && lane.scout) {
      return `<div class="strip scout"><div class="srow">${stepTile(lane.scout, true)}<span class="slabel">Villain opens with ${PNAME[lane.scout]}${lane.ambush ? ' · <b class="amb">Ambush!</b>' : ''}</span></div></div>`;
    }
    if (!b) return '';
    const es = b.engs.filter((e) => e.lane === li);
    if (!es.length) return '';
    return es.map((e) => {
      const cols = [];
      for (let k = 0; k < e.len; k++) {
        const rec = e.rec[k];
        const cur = b.stage === 'revealed' && k === b.i && !e.over;
        const pv = cur ? compute(e, k) : null;
        const hShown = e.h.known[k] || k < b.i || cur;
        const vShown = e.v.known[k] || k < b.i || cur;
        let mid = '';
        if (rec) mid = `<span class="dm ${rec.toV ? 'hit' : ''}">−${rec.toV}</span><span class="dm ${rec.toH ? 'hurt' : ''}">−${rec.toH}</span>`;
        else if (pv) mid = `<span class="dm pv ${pv.toV ? 'hit' : ''}" title="Villain would take">−${pv.toV}?</span><span class="dm pv ${pv.toH ? 'hurt' : ''}" title="Hero would take">−${pv.toH}?</span>`;
        cols.push(`<div class="col ${cur ? 'cur' : ''} ${k === b.i && b.stage === 'ready' && !e.over ? 'next' : ''}">
          ${stepTile(e.v.steps[k], vShown)}<div class="mid">${mid}</div>${stepTile(e.h.steps[k], hShown, e.h.stagger[k] ? 'stag' : '')}<span class="sn">${k + 1}</span></div>`);
      }
      const cur = b.stage === 'revealed' && !e.over ? compute(e, b.i) : null;
      const status = e.fled ? 'Fled' : e.heroDown ? 'Hero defeated' : e.villainDown ? 'Villain defeated' : '';
      return `<div class="strip">${RULES.tensionMax ? `<div class="tension" title="Each step where nobody is hurt adds 1 (max ${RULES.tensionMax}). The next + step by either side adds it to its attack.">Tension <b>${e.tension || 0}</b>/${RULES.tensionMax}</div>` : ''}
        <div class="field"><div class="who"><span class="wv">${esc(nameOf(e.villain))}</span><span class="wm">damage</span><span class="wh">${esc(nameOf(e.hero))}</span></div>
        <div class="cols">${cols.join('')}</div></div>
        ${cur ? `<p class="preview">Step ${b.i + 1}: <b>${esc(nameOf(e.hero))}</b> uses ${esc(cur.h.move ? cur.h.move.name : cur.h.staggered ? 'nothing (staggered)' : 'nothing')} · <b>${esc(nameOf(e.villain))}</b> uses ${esc(cur.v.move ? cur.v.move.name : 'nothing')}.
          Hero takes <b class="hurt">${cur.toH}</b>, villain takes <b class="hit">${cur.toV}</b>.${cur.notes.length ? ` <span class="note">${esc(cur.notes.join('; '))}</span>` : ''}</p>` : ''}
        ${status ? `<p class="status">${status}</p>` : ''}</div>`;
    }).join('');
  }
  function laneHTML(lane, li) {
    const owner = S.players[lane.owner];
    const joinedHere = S.battle ? S.battle.engs.filter((e) => e.lane !== li && S.lanes[li].villain && e.villain === S.lanes[li].villain) : [];
    return `<section class="lane ${S.phase === 'prepare' && lane.owner === S.turn ? 'mine' : ''}">
      <div class="lane-h"><span>Lane ${li + 1}</span><span>${esc(owner.name)}</span></div>
      ${lane.villain ? villainCard(lane.villain) : `<div class="empty">${S.villainDeck.length ? 'Lane clear. The next villain waits.' : 'Lane clear.'}</div>`}
      ${strip(lane, li)}
      ${joinedHere.length ? `<p class="joined">Also fighting here: ${joinedHere.map((e) => esc(nameOf(e.hero))).join(', ')} (see lane ${joinedHere.map((e) => e.lane + 1).join(', ')})</p>` : ''}
      ${lane.hero ? heroCard(lane.hero) : '<div class="empty">No hero in this lane.</div>'}
    </section>`;
  }
  function phasePanel() {
    const pl = S.players[S.turn];
    if (S.phase === 'prepare') {
      const lanesMine = S.lanes.map((l, i) => [l, i]).filter(([l]) => l.owner === S.turn && l.hero);
      return `<h2>${esc(pl.name)}: prepare</h2>
        <p class="lead"><b class="big">${pl.actions}</b> action${pl.actions === 1 ? '' : 's'} left. Click a card in your hand to Train, Teach, Ready, Call or Share it.</p>
        <div class="btns">
          <button data-act="scavenge" ${pl.actions ? '' : 'disabled'}>Scavenge <small>draw 1</small></button>
          <button data-act="recruit" ${pl.actions && !pl.reserve && S.heroDeck.length ? '' : 'disabled'}>Recruit <small>${pl.reserve ? 'reserve full' : `${S.heroDeck.length} in hero deck`}</small></button>
          ${lanesMine.map(([l, i]) => `<button data-act="swap" data-lane="${i}" ${pl.actions && pl.reserve ? '' : 'disabled'}>Swap <small>lane ${i + 1} ↔ reserve</small></button>`).join('')}
        </div>
        <button class="primary" data-act="endturn">End ${esc(pl.name)}'s turn</button>`;
    }
    if (S.phase === 'scout') {
      const rows = S.lanes.map((l, i) => {
        if (l.decision === 'none') return '';
        const owner = esc(S.players[l.owner].name);
        let ctl = '';
        if (l.ambush) ctl = '<span class="tag danger">Must fight</span>';
        else if (l.decision === 'unopposed') ctl = '<span class="tag danger">Unopposed</span>';
        else if (l.hero && l.villain) ctl = `<button data-act="decide" data-lane="${i}" data-d="fight" class="${l.decision === 'fight' ? 'on' : ''}">Fight</button>
            <button data-act="decide" data-lane="${i}" data-d="hold" class="${l.decision === 'hold' ? 'on' : ''}">Hold <small>heal 1, draw 1</small></button>`;
        else if (l.hero && !l.villain) ctl = joinTargets(l).map((t) => { const ti = S.lanes.indexOf(t); return `<button data-act="decide" data-lane="${i}" data-d="join:${ti}" class="${l.decision === 'join:' + ti ? 'on' : ''}">Join lane ${ti + 1}</button>`; }).join('')
            + `<button data-act="decide" data-lane="${i}" data-d="rest" class="${l.decision === 'rest' ? 'on' : ''}">Rest <small>heal 1, draw 1</small></button>`;
        return `<div class="dec"><span>Lane ${i + 1} · ${owner}</span><div class="btns">${ctl}</div></div>`;
      }).join('');
      return `<h2>Scout: fight or hold?</h2><p class="lead">Each villain's first step is face up. A + means ambush.</p>${rows}
        <button class="primary" data-act="startbattle" ${allDecided() ? '' : 'disabled'}>Start the battle</button>`;
    }
    if (S.phase === 'battle') {
      const b = S.battle;
      if (b.stage === 'ready') return `<h2>Battle: step ${b.i + 1} of ${b.len}</h2><p class="lead">Both sides flip their next step at the same time.</p><button class="primary" data-act="reveal" autofocus>Reveal step ${b.i + 1}</button>`;
      if (b.stage === 'revealed') {
        const ro = reactOptions();
        return `<h2>Step ${b.i + 1}: react</h2><p class="lead">Check the preview in each lane. Spend a Tactic, Courage or ability now, or resolve.</p>
          ${ro.length ? `<div class="reacts">${ro.map((o, k) => `<button data-act="react" data-k="${k}" ${o.targets.length ? '' : 'disabled'}><span>${esc(o.label)}</span><small>${esc(o.owner)} · ${esc(o.text)}</small></button>`).join('')}</div>` : '<p class="muted">No tactics or abilities ready.</p>'}
          <button class="primary" data-act="resolve" ${busy ? 'disabled' : ''}>Resolve step ${b.i + 1}</button>`;
      }
      return `<h2>Battle over</h2><p class="lead">Spoils, defeated heroes and new villains are handled next.</p><button class="primary" data-act="finish" ${busy ? 'disabled' : ''}>Continue to the next round</button>`;
    }
    if (S.phase === 'over') return `<h2>${S.result === 'win' ? 'Victory!' : 'Defeat'}</h2><p class="lead">${S.result === 'win' ? `The Warlord fell in round ${S.round}.` : 'Try again, or lower the difficulty.'}</p><button class="primary" data-act="newgame">New game</button>`;
    return '';
  }
  function trayHTML() {
    if (!['prepare', 'scout', 'battle'].includes(S.phase)) return '';
    const p = S.phase === 'prepare' ? S.turn : null;
    return S.players.map((pl, i) => {
      const mine = i === p;
      return `<section class="tray ${mine ? 'active' : ''}">
        <div class="tray-h"><h2>${esc(pl.name)}</h2>
          <span class="stat" title="Courage tokens">Courage ${pl.courage}</span>
          ${pl.allies.map((a) => `<span class="chip ally" title="${esc(card(a).text)}">Ally: ${esc(card(a).name)}</span>`).join('')}
          ${pl.readied.map((t) => `<span class="chip tac" title="${esc(card(t).text)}">Ready: ${esc(card(t).name)}</span>`).join('')}
          ${pl.reserve ? `<span class="chip res">Reserve: ${esc(nameOf(pl.reserve))} ${maxHp(pl.reserve) - unit(pl.reserve).dmg}/${maxHp(pl.reserve)}</span>` : ''}
          <span class="stat">${pl.hand.length} cards</span></div>
        ${mine ? `<div class="hand">${pl.hand.map((id, k) => `<button class="hcard ${postClass(card(id).posture)} k-${card(id).kind}" data-act="hand" data-k="${k}">
          <span class="hk">${esc(kindLabel(card(id)))}</span><span class="hn">${esc(card(id).name)}</span>
          ${powerOf(card(id)) ? `<span class="hp2">${esc(powerOf(card(id)))}</span>` : ''}<span class="ht">${esc(card(id).text || '')}</span></button>`).join('')}</div>` : ''}
      </section>`;
    }).join('');
  }
  function clockHTML() {
    return `<ol class="clock" aria-label="Clock track">${S.track.map((n, k) => `<li class="${k < S.clock ? 'past' : k === S.clock ? 'now' : ''}" title="Round ${k + 1}: ${n}-step battles"><span>${n}</span></li>`).join('')}</ol>`;
  }
  function pickHTML() {
    const pk = S.pick; const pl = S.players[pk.player];
    return `<div class="pick"><h2>${esc(pl.name)}: choose ${pk.need === 1 ? 'your hero' : `${pk.need} heroes (one per lane)`}</h2>
      <p class="lead">${pk.chosen.length}/${pk.need} chosen. The rest go to the bottom of the hero deck.</p>
      <div class="pickrow">${pk.options.map((id, k) => {
        const tmp = { uid: 'tmp', kind: 'hero', id, owner: pk.player, dmg: 0, slots: { '+': [], '-': [], '.': [] }, lessons: [], flags: {}, battleFlags: {} };
        S.units.tmp = tmp; const html = heroCard('tmp'); delete S.units.tmp;
        return `<div class="pickopt ${pk.chosen.includes(id) ? 'chosen' : ''}">${html}<button class="primary" data-act="pick" data-k="${k}" ${pk.chosen.includes(id) ? 'disabled' : ''}>${pk.chosen.includes(id) ? 'Chosen' : 'Choose'}</button></div>`;
      }).join('')}</div></div>`;
  }

  function render() {
    if (!S) { renderSetup(); return; }
    $('#setup').hidden = true;
    const vleft = S.villainDeck.length;
    $('#top').innerHTML = `<div class="brand"><span class="ember" aria-hidden="true"></span>Ember Battle</div>
      <div class="meta"><span>${S.round ? `Round ${S.round}` : 'Setup'}</span>${clockHTML()}<span title="Villains still in the villain deck">${vleft} villain${vleft === 1 ? '' : 's'} left${vleft === 1 ? ' (the Warlord)' : ''}</span><span>${S.act2 ? 'Act II' : 'Act I'}</span></div>
      <div class="menu"><button class="ghost" data-act="rules">Rules</button><button class="ghost" data-act="newgame">New game</button></div>`;
    if (S.phase === 'pick') {
      $('#board').innerHTML = pickHTML(); $('#side').innerHTML = logHTML(); $('#trays').innerHTML = '';
    } else {
      $('#board').innerHTML = `<div class="lanes n${S.lanes.length}">${S.lanes.map(laneHTML).join('')}</div>`;
      $('#side').innerHTML = `<div class="phase">${phasePanel()}</div>${logHTML()}`;
      $('#trays').innerHTML = trayHTML();
    }
    const lg = $('#log'); if (lg) lg.scrollTop = lg.scrollHeight;
    save();
  }
  function logHTML() {
    return `<div class="logwrap"><h3>Log</h3><ol id="log">${S.log.slice(-160).map((l) => `<li class="${l.cls}">${esc(l.msg)}</li>`).join('')}</ol></div>`;
  }

  // ---------------------------------------------------------------- setup screen
  function renderSetup(hasSave) {
    $('#setup').hidden = false;
    $('#top').innerHTML = '<div class="brand"><span class="ember" aria-hidden="true"></span>Ember Battle</div><div class="menu"><button class="ghost" data-act="rules">Rules</button></div>';
    $('#board').innerHTML = ''; $('#side').innerHTML = ''; $('#trays').innerHTML = '';
    $('#resume').hidden = !hasSave;
  }

  // ---------------------------------------------------------------- persistence
  function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) { /* storage unavailable */ } }
  function loadSaved() { try { const t = localStorage.getItem(SAVE_KEY); return t ? JSON.parse(t) : null; } catch (e) { return null; } }

  // ================================================================ events
  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act]'); if (!el || el.disabled) return;
    if (busy && !['rules', 'closerules'].includes(el.dataset.act)) return;
    const d = el.dataset;
    switch (d.act) {
      case 'pick': choosePick(+d.k); render(); break;
      case 'hand': playFromHand(+d.k); break;
      case 'scavenge': actScavenge(); break;
      case 'recruit': actRecruit(); break;
      case 'swap': actSwap(+d.lane); break;
      case 'endturn': endTurn(); break;
      case 'decide': decide(+d.lane, d.d); break;
      case 'startbattle': startBattle(); render(); break;
      case 'reveal': revealStep(); break;
      case 'react': useReact(reactOptions()[+d.k]); break;
      case 'resolve': resolveStep(); break;
      case 'finish': aftermath(); break;
      case 'rules': $('#rules').hidden = false; break;
      case 'closerules': $('#rules').hidden = true; break;
      case 'newgame': {
        const m = $('#modal'); if (!m.hidden) { m.hidden = true; m.innerHTML = ''; m.onclick = null; modalResolve = null; }
        S = null; renderSetup(false); break;
      }
      case 'resume': { const s = loadSaved(); if (s) { S = s; render(); } break; }
    }
  });
  $('#setupForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = ev.target;
    const players = +f.players.value;
    newGame({ players, names: [f.p1.value.trim(), f.p2.value.trim()], difficulty: f.difficulty.value });
    render();
  });
  $('#setupForm').addEventListener('change', (ev) => {
    if (ev.target.name === 'players') $('#p2wrap').hidden = ev.target.value !== '2';
  });

  // hot-reload support inside the artifact viewer + boot
  if (window.claude && window.claude.hot && window.claude.hot.snapshot) window.claude.hot.snapshot(() => ({ S }));
  function start(data) {
    if (data && data.S) { S = data.S; render(); return; }
    renderSetup(!!loadSaved());
  }
  if (window.claude && window.claude.hot && window.claude.hot.ready) window.claude.hot.ready(start);
  else start(window.claude && window.claude.hot && window.claude.hot.data || {});
  window.EMBER_DEBUG = { get S() { return S; }, compute, render };
})();

/*
 * Ember Battle — card data for the fixed set (v0.1).
 *
 * Edit numbers, text and deck counts here; game.js reads everything from this file.
 *
 * Postures:  '+' attack   '-' defend   '.' focus (shown as •)
 *
 * Hooks a card can define (all optional):
 *   mod(me, foe, c)      while working out this step's numbers. Set/adjust me.atk, me.def, me.pierce.
 *   final(me, foe, c)    after all bonuses (used for "double" style effects).
 *   foeMod(foe, me, c)   (villain abilities) adjust the hero's numbers.
 *   immune(me, foe, c)   return true if this unit takes no damage this step.
 *   after(me, foe, c, r) after damage. r = { toMe, toFoe }. May be async (for choices).
 *   preDamage(me, foe, c) async, before damage (Flee).
 *   onReveal(me, foe, c) right after the step is revealed (Switch Strike).
 *
 * Villain moves may set `rank`: how strong the card is, used when a Boss with two moves
 * per slot picks one. Without it, rank = atk + def.
 *
 *   me / foe = { unit, isHero, step, prev, move, atk, def, pierce, buffs, side }
 *   c = { i, len, eng, g }  — g is the game API (heal, draw, stagger, choose, log...)
 */
(function () {
  const C = {};
  const add = (c) => (C[c.id] = c);

  // ------------------------------------------------------------------ hero moves (+)
  add({ id: 'basic-strike', kind: 'move', posture: '+', name: 'Basic Strike', atk: 1, text: '' });
  add({ id: 'heavy-strike', kind: 'move', posture: '+', name: 'Heavy Strike', atk: 2, text: '' });
  add({ id: 'double-jab', kind: 'move', posture: '+', name: 'Double Jab', atk: 2, text: 'Pierce 2 (ignore 2 of the enemy’s −).',
    mod(me) { me.pierce += 2; } });
  add({ id: 'cheap-shot', kind: 'move', posture: '+', name: 'Cheap Shot', atk: 3, text: 'Does no damage against −, bonuses included.',
    final(me, foe) { if (foe.step === '-') { me.atk = 0; me.pierce = 0; } } });
  add({ id: 'weapon-throw', kind: 'move', posture: '+', name: 'Weapon Throw', atk: 3, text: 'If the enemy’s step is +, discard this after the step.',
    after(me, foe, c) { if (foe.step === '+') c.g.discardTop(me.unit, '+', 'Weapon Throw'); } });
  add({ id: 'deadly-revenge', kind: 'move', posture: '+', name: 'Deadly Revenge', atk: 0, def: 1, power: '?+ 1−', text: 'Grudge: 1+ for each damage on this hero. Also blocks 1.',
    mod(me) { me.atk = me.unit.dmg; } });
  add({ id: 'experienced-attack', kind: 'move', posture: '+', name: 'Experienced Attack', atk: 0, power: '?+', text: 'Experience: 1+ for each move in this hero’s training stack (max 4+).',
    mod(me, foe, c) { me.atk = Math.min(4, c.g.trainingCount(me.unit)); } });
  add({ id: 'counter-cut', kind: 'move', posture: '+', name: 'Counter Cut', atk: 1, text: 'Combo(−): 2+ more if your previous step was −.',
    mod(me) { if (me.prev === '-') me.atk += 2; } });
  add({ id: 'lunge', kind: 'move', posture: '+', name: 'Lunge', atk: 2, text: 'Opener: 1+ more on step 1.',
    mod(me, foe, c) { if (c.i === 0) me.atk += 1; } });
  add({ id: 'finishing-blow', kind: 'move', posture: '+', name: 'Finishing Blow', atk: 1, text: 'Finisher: 2+ more on the last step.',
    mod(me, foe, c) { if (c.i === c.len - 1) me.atk += 2; } });
  add({ id: 'warrior-instinct', kind: 'move', posture: '±', name: 'Warrior Instinct', atk: 0, power: '±', text: 'Goes in your + or − slot. 3+ if the enemy’s step is −; 2− if it is +.',
    mod(me, foe) { me.atk = 0; me.def = 0; if (foe.step === '-') me.atk = 3; if (foe.step === '+') me.def = 2; } });

  // ------------------------------------------------------------------ hero moves (−)
  add({ id: 'block', kind: 'move', posture: '-', name: 'Block', def: 1, text: '' });
  add({ id: 'big-block', kind: 'move', posture: '-', name: 'Big Block', def: 2, text: '' });
  add({ id: 'forceful-block', kind: 'move', posture: '-', name: 'Forceful Block', def: 2, text: 'Counter: also 1+ if the enemy’s step is +.',
    mod(me, foe) { if (foe.step === '+') me.atk += 1; } });
  add({ id: 'daring-dodge', kind: 'move', posture: '-', name: 'Daring Dodge', def: 3, text: 'If it blocks all damage from a + step, discard it after the step.',
    after(me, foe, c, r) { if (foe.step === '+' && foe.atk > 0 && r.toMe === 0) c.g.discardTop(me.unit, '-', 'Daring Dodge'); } });
  add({ id: 'shield-bash', kind: 'move', posture: '-', name: 'Shield Bash', atk: 1, def: 1, text: '' });
  add({ id: 'parry', kind: 'move', posture: '-', name: 'Parry', def: 1, text: 'If you take no damage this step, your next + step gets 2+.',
    after(me, foe, c, r) { if (r.toMe === 0) me.buffs.plusNext += 2; } });

  // ------------------------------------------------------------------ hero moves (•)
  add({ id: 'catch-breath', kind: 'move', posture: '.', name: 'Catch Breath', text: 'Heal 1 after this step.',
    after(me, foe, c) { c.g.heal(me.unit, 1); } });
  add({ id: 'steady-focus', kind: 'move', posture: '.', name: 'Steady Focus', text: 'Your next + step gets 1+.',
    after(me) { me.buffs.plusNext += 1; } });
  add({ id: 'take-flight', kind: 'move', posture: '.', name: 'Take Flight', text: 'Double all numbers on your next step.',
    after(me) { me.buffs.double = true; } });
  add({ id: 'stealth', kind: 'move', posture: '.', name: 'Stealth', text: 'Prevent all damage to this hero next step.',
    after(me) { me.buffs.stealth = true; } });
  add({ id: 'plan', kind: 'move', posture: '.', name: 'Plan', text: 'Your next step gets 1+. Look at the top 3 step cards; you may swap one with one of your face-down steps.',
    async after(me, foe, c) { me.buffs.atkNext += 1; await c.g.planSwap(c.eng); } });
  add({ id: 'flee', kind: 'move', posture: '.', name: 'Flee', text: 'Peek at your next step. If it’s •, you may end this battle now, before damage. No spoils.',
    async preDamage(me, foe, c) { return c.g.fleeCheck(c.eng, c.i); } });
  add({ id: 'not-left-handed', kind: 'move', posture: '.', name: 'I Am Not Left-Handed', text: 'For the rest of this battle, your + steps get 2+ and your − steps get 2−. Only once per battle.',
    after(me) { if (me.buffs.leftHanded) return; me.buffs.leftHanded = true; me.buffs.plusAll += 2; me.buffs.minusAll += 2; } });

  // ------------------------------------------------------------------ tactics
  // react: { when(ctx) -> bool usable now, target: 'own'|'other'|'none', apply(ctx) }
  add({ id: 'brace', kind: 'tactic', name: 'Brace', text: 'Prevent 2 damage to your hero this step.',
    react: { target: 'own', apply(t) { t.eng.h.react.preventN += 2; } } });
  add({ id: 'see-an-opening', kind: 'tactic', name: 'See An Opening', text: 'The enemy’s − step this step becomes •.',
    react: { target: 'own', when(t) { return t.eng.v.steps[t.i] === '-'; }, apply(t) { t.eng.v.steps[t.i] = '.'; } } });
  add({ id: 'second-wind', kind: 'tactic', name: 'Second Wind', text: 'Heal your hero 2.',
    react: { target: 'own', apply(t) { t.g.heal(t.g.unit(t.eng.hero), 2); } } });
  add({ id: 'feint', kind: 'tactic', name: 'Feint', text: 'Swap your current step with your next face-down step.',
    react: { target: 'own', when(t) { return t.i + 1 < t.eng.len; },
      apply(t) { const s = t.eng.h.steps; [s[t.i], s[t.i + 1]] = [s[t.i + 1], s[t.i]]; } } });
  add({ id: 'hold-the-line', kind: 'tactic', name: 'Hold the Line', text: 'Another hero gets 2− this step.',
    react: { target: 'other', apply(t) { t.eng.h.react.def += 2; } } });
  add({ id: 'rally-cry', kind: 'tactic', name: 'Rally Cry', text: 'Every hero’s step gets 1+ this step.',
    react: { target: 'none', apply(t) { t.g.liveEngagements().forEach((e) => (e.h.react.atk += 1)); } } });

  // ------------------------------------------------------------------ lessons
  add({ id: 'everythings-a-weapon', kind: 'lesson', name: 'Everything’s A Weapon', text: 'Your − and • steps get 1+.',
    mod(me) { if (me.step === '-' || me.step === '.') me.atk += 1; } });
  add({ id: 'battle-hardened', kind: 'lesson', name: 'Battle-Hardened', text: '+2 health.', hpBonus: 2 });
  add({ id: 'patient-fighter', kind: 'lesson', name: 'Patient Fighter', text: 'Your • steps get 1−.',
    mod(me) { if (me.step === '.') me.def += 1; } });
  add({ id: 'light-on-your-feet', kind: 'lesson', name: 'Light on Your Feet', text: 'Once per battle, after a reveal, treat your step as −.',
    abilityReact: { label: 'Light on Your Feet: make my step −', once: 'lightFeet',
      when(t) { return t.eng.h.steps[t.i] !== '-'; }, apply(t) { t.eng.h.steps[t.i] = '-'; } } });

  // ------------------------------------------------------------------ allies
  add({ id: 'medic', kind: 'ally', name: 'Medic', unique: true, text: 'After each battle, heal the most hurt hero 1.' });
  add({ id: 'lookout', kind: 'ally', name: 'Lookout', text: 'Your lanes are never Ambushed.' });
  add({ id: 'smith', kind: 'ally', name: 'Smith', text: 'When you Train a + move, draw a card.' });

  // ------------------------------------------------------------------ heroes
  const pm = (name, o) => Object.assign({ name, atk: 0, def: 0, text: '' }, o); // printed move
  add({ id: 'steady-soldier', kind: 'hero', name: 'Steady Soldier', hp: 5,
    slots: { '+': pm('1+', { atk: 1 }), '-': pm('1−', { def: 1 }), '.': null }, ability: '' });
  add({ id: 'strong-attacker', kind: 'hero', name: 'Strong Attacker', hp: 4,
    slots: { '+': pm('2+', { atk: 2 }), '-': null, '.': null },
    ability: 'Momentum: if your previous step was +, your + steps get 1+.',
    mod(me) { if (me.step === '+' && me.prev === '+') me.atk += 1; } });
  add({ id: 'valiant-warrior', kind: 'hero', name: 'Valiant Warrior', hp: 6,
    slots: { '+': pm('2+', { atk: 2 }), '-': null, '.': null },
    ability: 'Valiant: when the enemy’s step is +, your step gets 1+.',
    mod(me, foe) { if (foe.step === '+') me.atk += 1; } });
  add({ id: 'stalwart-defender', kind: 'hero', name: 'Stalwart Defender', hp: 6,
    slots: { '+': null, '-': pm('2−', { def: 2 }), '.': null },
    ability: 'Shield Wall: once per battle, give another hero 2− this step.',
    abilityReact: { label: 'Shield Wall: another hero gets 2−', once: 'shieldWall', target: 'other',
      apply(t) { t.eng.h.react.def += 2; } } });
  add({ id: 'quick-learner', kind: 'hero', name: 'Quick Learner', hp: 4,
    slots: { '+': null, '-': null, '.': pm('Study', { text: 'Reveal the top main card. A move is attached now; anything else goes to your hand.',
      async after(me, foe, c) { await c.g.quickStudy(me.unit); } }) },
    ability: 'Fast Study: once per round, Training this hero costs no action.' });
  add({ id: 'daring-archer', kind: 'hero', name: 'Daring Archer', hp: 5,
    slots: { '+': pm('1+', { atk: 1 }), '-': null, '.': pm('Scout Ahead', { text: 'Draw a card.',
      after(me, foe, c) { c.g.drawFor(c.g.ownerOf(me.unit), 1); } }) },
    ability: 'Once per battle, ignore all damage from one enemy + step.',
    abilityReact: { label: 'Dodge: ignore this + step', once: 'archerDodge',
      when(t) { return t.eng.v.steps[t.i] === '+'; }, apply(t) { t.eng.h.react.preventAll = true; } } });
  add({ id: 'aerial-strategist', kind: 'hero', name: 'Aerial Strategist', hp: 4,
    slots: { '+': pm('1+', { atk: 1 }), '-': pm('1−', { def: 1 }), '.': pm('High Ground', { text: 'Peek at your next step and the enemy’s next step; you may swap them.',
      async after(me, foe, c) { await c.g.aerialPeek(c.eng, c.i); } }) },
    ability: '' });
  add({ id: 'field-medic', kind: 'hero', name: 'Field Medic', hp: 5,
    slots: { '+': null, '-': pm('1−', { def: 1 }), '.': pm('Tend', { text: 'Heal 1 to the most hurt hero.',
      after(me, foe, c) { c.g.healMostHurt(1); } }) },
    ability: 'After each battle, heal 1 to the most hurt hero.', afterBattleHeal: 1 });
  add({ id: 'wise-mentor', kind: 'hero', name: 'Wise Mentor', hp: 4,
    slots: { '+': null, '-': pm('1−', { def: 1 }), '.': null },
    ability: 'Teacher: your Train and Teach actions may target any player’s hero.', teacher: true });
  add({ id: 'scrappy-youngster', kind: 'hero', name: 'Scrappy Youngster', hp: 3,
    slots: { '+': pm('1+', { atk: 1 }), '-': null, '.': null },
    ability: 'Big Heart: once per game, when this hero would be defeated, it stays at 1 health.', bigHeart: true });
  add({ id: 'seasoned-captain', kind: 'hero', name: 'Seasoned Captain', hp: 6,
    slots: { '+': pm('2+', { atk: 2 }), '-': pm('1−', { def: 1 }), '.': null },
    ability: 'Rally: on step 1 of each battle, every hero’s step gets 1+.', rally: true });

  // ------------------------------------------------------------------ villains
  add({ id: 'simple-raider', kind: 'villain', act: 1, name: 'Simple Raider', hp: 6, ability: '' });
  add({ id: 'evasive-raider', kind: 'villain', act: 1, name: 'Evasive Raider', hp: 6,
    ability: 'The hero’s + steps get −1, but never below 1.',
    foeMod(hero) { if (hero.step === '+' && hero.atk > 1) hero.atk -= 1; } });
  add({ id: 'intimidating-raider', kind: 'villain', act: 1, name: 'Intimidating Raider', hp: 6,
    ability: 'Takes no damage on step 1.', immune(me, foe, c) { return c.i === 0; } });
  add({ id: 'wounding-raider', kind: 'villain', act: 1, name: 'Wounding Raider', hp: 6,
    ability: 'Stagger: if it damages the hero, the hero’s next step does nothing.',
    after(me, foe, c, r) { if (r.toFoe > 0) c.g.stagger(c.eng, c.i + 1); } });
  add({ id: 'quick-exit-raider', kind: 'villain', act: 1, name: 'Quick-Exit Raider', hp: 8,
    ability: 'Takes no damage on the last step.', immune(me, foe, c) { return c.i === c.len - 1; } });
  add({ id: 'cowardly-sneak', kind: 'villain', act: 1, name: 'Cowardly Sneak', hp: 5,
    ability: 'If it has 4+ damage after a battle, it runs: shuffle it back into the villain deck, healed.', runsAt: 4 });
  add({ id: 'strong-brute', kind: 'villain', act: 2, name: 'Strong Brute', hp: 9,
    ability: 'Its + steps get 1+.', mod(me) { if (me.step === '+') me.atk += 1; } });
  add({ id: 'dodging-skirmisher', kind: 'villain', act: 2, name: 'Dodging Skirmisher', hp: 9,
    ability: 'Takes no damage on its first • step of each battle.',
    immune(me, foe, c) { return me.step === '.' && !c.eng.v.focusSeen; } });
  add({ id: 'double-damage-brute', kind: 'villain', act: 2, name: 'Double-Damage Brute', hp: 8,
    ability: 'Combo(+): if its previous step was +, its + step does double.',
    final(me) { if (me.step === '+' && me.prev === '+') me.atk *= 2; } });
  add({ id: 'healing-shaman', kind: 'villain', act: 2, name: 'Healing Shaman', hp: 5,
    ability: 'After step 1, if it has taken no damage this battle, remove all its damage.',
    after(me, foe, c) { if (c.i === 0 && c.eng.v.dmgTaken === 0 && me.unit.dmg > 0) { me.unit.dmg = 0; c.g.log(`${c.g.nameOf(me.unit)} heals fully!`); } } });
  add({ id: 'huge-brute', kind: 'villain', act: 2, name: 'Huge Brute', hp: 13, ability: '' });
  add({ id: 'warlord', kind: 'villain', act: 'boss', name: 'Warlord', hp: 8, hpPerLane: true, movesPerSlot: 2,
    ability: 'Boss. 8 health per lane. Fights every lane at once. Has two moves per slot and uses the stronger.' });

  // ------------------------------------------------------------------ villain moves
  const vm = (o) => add(Object.assign({ kind: 'vmove', atk: 0, def: 0, text: '' }, o));
  vm({ id: 'v-strike', posture: '+', act: 1, name: 'Strike', atk: 1 });
  vm({ id: 'v-hard-strike', posture: '+', act: 1, name: 'Hard Strike', atk: 2 });
  vm({ id: 'v-reckless-attack', rank: 2.5, posture: '+', act: 1, name: 'Reckless Attack', atk: 3, text: 'Reckless 1: takes 1 damage after the step.',
    after(me, foe, c) { c.g.selfDamage(me.unit, 1, 'Reckless Attack'); } });
  vm({ id: 'v-tough-strike', rank: 3, posture: '+', act: 2, name: 'Tough Strike', atk: 2, def: 1 });
  vm({ id: 'v-jagged-blade', rank: 3.2, posture: '+', act: 2, name: 'Jagged Blade', atk: 3, text: 'Its next step gets −1 to its block.',
    after(me) { me.buffs.defNext -= 1; } });
  vm({ id: 'v-switch-strike', rank: 2.2, posture: '+', act: 2, name: 'Switch Strike', atk: 2, text: 'If the hero’s step is +, swap this with its next face-down step.',
    onReveal(me, foe, c) {
      const s = c.eng.v.steps;
      if (foe.step === '+' && c.i + 1 < c.len) { [s[c.i], s[c.i + 1]] = [s[c.i + 1], s[c.i]]; c.g.log('Switch Strike sidesteps to the next step!'); }
    } });
  vm({ id: 'v-block', posture: '-', act: 1, name: 'Block', def: 1 });
  vm({ id: 'v-big-block', posture: '-', act: 1, name: 'Big Block', def: 2 });
  vm({ id: 'v-bracing-armor', rank: 2.2, posture: '-', act: 1, name: 'Bracing Armor', def: 2, text: 'If the hero attacks for 1 or 2, it still takes 1.',
    mod(me) { me.bracing = true; } });
  vm({ id: 'v-weakening-block', rank: 2.5, posture: '-', act: 2, name: 'Weakening Block', def: 0, power: '3/2/0−', text: '3− on its 1st − step of a battle, 2− on its 2nd, 0 after.',
    mod(me, foe, c) { me.def = [3, 2][c.eng.v.minusCount] || 0; } });
  vm({ id: 'v-cheap-armor', rank: 3, posture: '-', act: 2, name: 'Cheap Armor', def: 3, text: 'Discard once it has 3+ damage.',
    after(me, foe, c) { if (me.unit.dmg >= 3) c.g.discardVillainMove(me.unit, '-', 'v-cheap-armor'); } });
  vm({ id: 'v-hesitate', rank: 0, posture: '.', act: 1, name: 'Hesitate', text: 'Does nothing.' });
  vm({ id: 'v-reposition', rank: 1, posture: '.', act: 1, name: 'Reposition', text: 'Its next + step gets 1+.',
    after(me) { me.buffs.plusNext += 1; } });
  vm({ id: 'v-wait', rank: 0.5, posture: '.', act: 1, name: 'Wait', text: 'If this is step 1, heal 1.',
    after(me, foe, c) { if (c.i === 0) c.g.heal(me.unit, 1); } });
  vm({ id: 'v-rest', rank: 0.5, posture: '.', act: 1, name: 'Rest', text: 'If past the halfway point, heal 1.',
    after(me, foe, c) { if (c.i >= c.len / 2) c.g.heal(me.unit, 1); } });
  vm({ id: 'v-power-up', rank: 2, posture: '.', act: 2, name: 'Power Up', text: 'Its next + step gets 2+.',
    after(me) { me.buffs.plusNext += 2; } });
  vm({ id: 'v-quick-dodge', rank: 1, posture: '.', act: 2, name: 'Quick Dodge', text: 'If this is step 1, this step and the next get 1−.',
    mod(me, foe, c) { if (c.i === 0) me.def += 1; }, after(me, foe, c) { if (c.i === 0) me.buffs.defNext += 1; } });

  // ------------------------------------------------------------------ deck lists
  const MAIN_DECK = {
    'basic-strike': 3, 'heavy-strike': 3, 'counter-cut': 2, 'lunge': 2, 'cheap-shot': 2, 'double-jab': 1,
    'weapon-throw': 1, 'deadly-revenge': 1, 'experienced-attack': 1, 'finishing-blow': 1, 'warrior-instinct': 1,
    'block': 3, 'big-block': 2, 'forceful-block': 2, 'shield-bash': 2, 'daring-dodge': 1, 'parry': 1,
    'catch-breath': 2, 'steady-focus': 2, 'take-flight': 1, 'stealth': 1, 'plan': 1, 'flee': 1, 'not-left-handed': 1,
    'brace': 3, 'see-an-opening': 2, 'second-wind': 2, 'feint': 1, 'hold-the-line': 1, 'rally-cry': 1,
    'battle-hardened': 2, 'everythings-a-weapon': 1, 'patient-fighter': 1, 'light-on-your-feet': 1,
    'medic': 1, 'lookout': 1, 'smith': 1,
  };
  const HERO_DECK = ['steady-soldier', 'strong-attacker', 'valiant-warrior', 'stalwart-defender', 'quick-learner',
    'daring-archer', 'aerial-strategist', 'field-medic', 'wise-mentor', 'scrappy-youngster', 'seasoned-captain'];
  const VILLAIN_MOVE_DECKS = {
    1: { 'v-strike': 2, 'v-hard-strike': 4, 'v-reckless-attack': 2, 'v-block': 3, 'v-big-block': 2, 'v-bracing-armor': 1,
         'v-hesitate': 3, 'v-reposition': 1, 'v-wait': 1, 'v-rest': 1 },
    2: { 'v-hard-strike': 2, 'v-tough-strike': 1, 'v-jagged-blade': 1, 'v-switch-strike': 1, 'v-big-block': 1,
         'v-weakening-block': 1, 'v-cheap-armor': 1, 'v-power-up': 1, 'v-quick-dodge': 1 },
  };
  const RULES = {
    villainsPerLane: { act1: 2, act2: 1 },
    // Extra difficulty for 2+ players (each player has a full hand and actions for one lane).
    // Tuned 2026-11-23 with the strategy bot: 2 players went from 100% wins to ~78%, matching solo.
    multiplayer: { extraAct2: 1, bossHpPerLane: 10 },
    handStart: 5, handLimit: 7, maxReady: 2, maxLessons: 2, maxCourage: 3,
    draw: { solo: 2, multi: 2 }, actions: { solo: 3, multi: 2 },
    clocks: {
      easy:   [2, 3, 3, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5],
      normal: [2, 3, 3, 4, 4, 4, 5, 5, 5, 5, 5, 5],
      hard:   [2, 3, 3, 4, 4, 4, 5, 5, 5, 5],
    },
    stepDeck: { '+': 10, '-': 10, '.': 10 },
    tensionMax: 0,   // optional Tension rule: quiet steps build up a bonus for the next + step (0 = off)
    // Villains draw from their own, more aggressive step deck (2026-11-24: fewer dead steps, more hero danger).
    villainStepDeck: { '+': 14, '-': 8, '.': 8 },
  };

  window.EMBER = { CARDS: C, MAIN_DECK, HERO_DECK, VILLAIN_MOVE_DECKS, RULES };
})();

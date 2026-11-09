/**
 * ASL Translator UI. Two directions:
 * - Speak → Sign: speech or text becomes ASL gloss order and the avatar signs it.
 * - Sign → Speak: the camera reads signs and shows (and speaks) English.
 * The public web build loads live camera tracking; the sprint demo (VITE_TARGET=play) has no network code,
 * so it shows the recognizer reading the avatar instead.
 */
import config from '../../app.config.json';
import { synthesize, toBody, type CamFrame } from '../asl/camera';
import { frameAt, timeline, type Frame, type Timeline } from '../asl/motion';
import { signParts } from '../asl/parts';
import { Recognizer, type Recognized } from '../asl/recognize';
import type { SignDef } from '../asl/sign';
import { ASL, SPOKEN, type Translation } from '../lang';
import { Avatar } from './avatar';
import { canListen, canSpeak, listen, speak, type Listener } from './speech';
import { render } from './ui';
import type { Tracker } from './vision';

// Only the public web build loads camera tracking: its runtime and models come from pinned CDN URLs, which the
// friends host's 'self'-only CSP (and the offline demo) can't load.
const LIVE_CAMERA = import.meta.env.VITE_TARGET === 'web';

/** UI settings. */
export const UI = {
  phrases: ['Hello, nice to meet you', 'What is your name?', 'Where is the bathroom?', "I don't understand", 'Thank you for your help', 'I love you'],
  selfTest: [['HELLO', 'NICE', 'MEET', 'YOU'], ['YOUR', 'NAME', 'WHAT'], ['ME', 'LEARN', 'SIGN'], ['TOMORROW', 'ME', 'GO', 'SCHOOL'], ['ME', 'WANT', 'WATER']],
  /** The slow-motion toggle next to Replay. */
  slow: { label: '0.5×', value: 0.5 },
  partialEveryMs: 600,
  publicUrl: (config as { publicUrl?: string }).publicUrl ?? '',
};

let lang = SPOKEN[0]!;
const signLang = ASL;

// ------------------------------------------------------------------ small DOM helpers (text only, never HTML)
type Attrs = Record<string, string | boolean | undefined>;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, kids: (Node | string)[] = []): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') n.className = String(v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return n;
}
const on = <T extends HTMLElement>(n: T, ev: string, fn: (e: Event) => void): T => { n.addEventListener(ev, fn); return n; };

// ------------------------------------------------------------------ playback (avatar)
interface Player { avatar: Avatar; tl: Timeline | null; t: number; speed: number; onSign?: (i: number) => void; lastActive: number; done?: () => void }

function idleFrame(): Frame { return frameAt(timeline([]), 0); }

function step(p: Player, dt: number): Frame {
  if (!p.tl) return idleFrame();
  p.t += dt * p.speed;
  const f = frameAt(p.tl, Math.min(p.t, p.tl.total));
  if (f.active !== p.lastActive) { p.lastActive = f.active; p.onSign?.(f.active); }
  if (p.t >= p.tl.total) { const d = p.done; p.tl = null; p.done = undefined; d?.(); }
  return f;
}

// ------------------------------------------------------------------ app
function app(): HTMLElement {
  const main = h('main', { class: 'app' });

  // Header and mode switch.
  const tabSpeak = h('button', { class: 'tab', role: 'tab', 'aria-selected': 'true', id: 'tab-speak', title: `${lang.label} → ${signLang.label}` }, ['Speak']);
  const tabRead = h('button', { class: 'tab', role: 'tab', 'aria-selected': 'false', id: 'tab-read', title: `${signLang.label} → ${lang.label}` }, ['Read']);
  const header = h('header', { class: 'top' }, [
    h('h1', { class: 'brand', title: 'ASL Translator · prototype' }, [signLang.label]),
    h('div', { class: 'tabs', role: 'tablist' }, [tabSpeak, tabRead]),
  ]);

  // ---------------- Speak → Sign
  const progress = h('div', { class: 'progress', 'aria-hidden': 'true' });
  const stageCanvas = h('canvas', { class: 'avatar', 'aria-label': 'Arms and hands signing' });
  const stage = h('div', { class: 'stage' }, [stageCanvas]);
  const nowWord = h('div', { class: 'now-word', 'aria-live': 'polite' });
  const slowBtn = h('button', { class: 'textbtn', 'aria-pressed': 'false', title: 'Slow motion' }, [UI.slow.label]);
  const replay = h('button', { class: 'textbtn' }, ['Replay']);
  const wordRow = h('div', { class: 'word-row' }, [nowWord, h('div', { class: 'ctrls' }, [slowBtn, h('span', { class: 'dot-sep', 'aria-hidden': 'true' }, ['·']), replay])]);
  const part = (k: string, dot = false) => {
    const v = h('b');
    return { v, el: h('span', { class: 'part' }, [...(dot ? [h('span', { class: 'where-dot', 'aria-hidden': 'true' })] : []), k + ' ', v]) };
  };
  const parts = { hand: part('Hand'), where: part('Where', true), move: part('Move'), palm: part('Palm') };
  const partsRow = h('div', { class: 'parts', 'aria-label': 'How this sign is made' }, Object.values(parts).map((x) => x.el));
  const chips = h('div', { class: 'chips', 'aria-label': 'Signs in ASL order' });
  const note = h('p', { class: 'note' });
  const input = h('input', { class: 'text', type: 'text', placeholder: 'Type or speak a sentence', 'aria-label': 'Sentence to sign', enterkeyhint: 'go', autocomplete: 'off' });
  const mic = h('button', { class: 'round mic', 'aria-label': 'Speak', title: canListen() ? 'Speak' : 'Speech input isn’t available in this browser' }, [h('span', { class: 'ico ico-mic', 'aria-hidden': 'true' })]);
  const go = h('button', { class: 'round go', 'aria-label': 'Sign it' }, [h('span', { class: 'ico ico-play', 'aria-hidden': 'true' })]);
  const phraseRow = h('div', { class: 'phrases' }, UI.phrases.map((p) => h('button', { class: 'phrase' }, [p])));
  const speakPanel = h('section', { class: 'panel', id: 'panel-speak', role: 'tabpanel', 'aria-labelledby': 'tab-speak' }, [
    progress, stage, wordRow, partsRow, note,
    h('div', { class: 'composer' }, [input, mic, go]),
    phraseRow, chips,
  ]);

  // ---------------- Sign → Speak
  const video = h('video', { class: 'cam', playsinline: true, muted: true, autoplay: true, 'aria-label': 'Your camera' });
  const overlay = h('canvas', { class: 'cam-overlay', 'aria-hidden': 'true' });
  const camStart = h('button', { class: 'primary' }, [LIVE_CAMERA ? 'Start camera' : 'Live camera is on the public page']);
  const camStatus = h('p', { class: 'cam-status', 'aria-live': 'polite' }, [LIVE_CAMERA ? 'Your video stays on this device.' : 'This copy has no live camera. Try the self-test below.']);
  const meter = h('div', { class: 'meter', 'aria-hidden': 'true' }, [h('span')]);
  const camBox = h('div', { class: 'camera' }, [video, overlay, h('div', { class: 'cam-cta' }, [camStart, camStatus]), meter]);
  const english = h('p', { class: 'english', 'aria-live': 'polite' }, ['Sign, then pause or lower your hands.']);
  const readChips = h('div', { class: 'chips' });
  const history = h('ol', { class: 'history' });
  const voiceBtn = h('button', { class: 'pill', 'aria-pressed': String(canSpeak()) }, ['Speak aloud']);
  const leftBtn = h('button', { class: 'pill', 'aria-pressed': 'false' }, ['Left-handed']);
  const clearBtn = h('button', { class: 'pill' }, ['Clear']);
  const stopBtn = h('button', { class: 'pill', hidden: true }, ['Stop camera']);
  const testCanvas = h('canvas', { class: 'avatar small', 'aria-label': 'Avatar signing for the self-test' });
  const testBtn = h('button', { class: 'pill' }, ['Run self-test']);
  const testOut = h('p', { class: 'test-out', 'aria-live': 'polite' });
  const readPanel = h('section', { class: 'panel', id: 'panel-read', role: 'tabpanel', 'aria-labelledby': 'tab-read', hidden: true }, [
    camBox,
    h('div', { class: 'readout' }, [english, readChips]),
    h('div', { class: 'row' }, [voiceBtn, leftBtn, clearBtn, stopBtn]),
    history,
    h('div', { class: 'card selftest' }, [
      h('div', { class: 'card-text' }, [
        h('h2', {}, ['Self-test']),
        h('p', {}, ['The avatar signs a sentence to a virtual camera; the recognizer reads it with the same code the live camera uses.']),
        testBtn, testOut,
      ]),
      testCanvas,
    ]),
  ]);

  // ---------------- dictionary + honesty footer
  const dict = h('div', { class: 'dict', hidden: true }, signLang.lexicon.map((s) => h('button', { class: 'dict-item', title: s.how }, [s.gloss])));
  const dictBtn = h('button', { class: 'linkish' }, [`All ${signLang.lexicon.length} signs`]);
  const footer = h('footer', { class: 'foot' }, [
    dictBtn, dict,
    h('p', {}, ['Prototype. Signs are written from dictionary descriptions and have not yet been reviewed by a Deaf signer. ' +
      'Recognition has been tested on synthetic camera data only. Grammar follows common textbook rules (topics, signing space, directional verbs), also unreviewed; names and words without a sign are fingerspelled.']),
  ]);

  for (const n of [header, speakPanel, readPanel, footer]) main.appendChild(n);

  // ------------------------------------------------------------------ behavior
  const avatar = new Avatar(stageCanvas);
  const testAvatar = new Avatar(testCanvas);
  const player: Player = { avatar, tl: null, t: 0, speed: 1, lastActive: -2 };
  const testPlayer: Player = { avatar: testAvatar, tl: null, t: 0, speed: 1, lastActive: -2 };
  let current: Translation | null = null;

  const setTab = (read: boolean) => {
    tabSpeak.setAttribute('aria-selected', String(!read));
    tabRead.setAttribute('aria-selected', String(read));
    if (!read) stopCamera();
    speakPanel.hidden = read;
    readPanel.hidden = !read;
    requestAnimationFrame(() => { avatar.resize(); testAvatar.resize(); });
  };
  on(tabSpeak, 'click', () => setTab(false));
  on(tabRead, 'click', () => setTab(true));

  const showChips = (t: Translation, active: number) => {
    const kids: Node[] = [];
    t.signs.forEach((s, i) => {
      if (s.spell) {
        // a spelled word is one chip (J-O-R-D-A-N), lit while any of its letters is made
        if (s.spell.i > 0) return;
        const n = s.spell.word.length;
        const on = active >= i && active < i + n;
        kids.push(h('span', { class: `chip spelled${on ? ' on' : ''}${t.negated.includes(i) ? ' neg' : ''}`, title: 'Fingerspelled' }, [s.spell.word.toUpperCase().split('').join('-')]));
        return;
      }
      kids.push(h('span', { class: `chip${i === active ? ' on' : ''}${t.negated.includes(i) ? ' neg' : ''}`, title: s.how }, [s.gloss]));
    });
    for (const m of t.missing) kids.push(h('span', { class: 'chip missing', title: 'No sign for this word yet' }, [m]));
    chips.replaceChildren(...kids);
  };

  /** One thin bar per sign; filled while it plays. */
  const bars = (n: number) => progress.replaceChildren(...Array.from({ length: n }, () => h('i', {}, [h('span')])));
  const showSign = (s: SignDef | undefined) => {
    if (s?.spell) {
      // the spelled word, its current letter lit
      const w = s.spell.word;
      nowWord.replaceChildren(...Array.from(w, (ch, i) => h('span', { class: i === s.spell!.i ? 'lt on' : 'lt' }, [ch])));
    } else nowWord.textContent = s ? s.en[0]! : '';
    const pp = s ? signParts(s) : null;
    for (const [k, x] of Object.entries(parts)) x.v.textContent = pp ? pp[k as keyof typeof pp] : '';
    partsRow.classList.toggle('empty', !pp);
    avatar.mark(s?.dom.loc ?? null);
  };
  const fillBars = () => {
    const tl = player.tl;
    Array.from(progress.children).forEach((b, i) => {
      const ts = tl?.signs[i];
      const k = !tl ? 1 : !ts ? 0 : Math.max(0, Math.min(1, (player.t - ts.start) / (ts.end - ts.start)));
      (b.firstElementChild as HTMLElement).style.transform = `scaleX(${k})`;
    });
  };

  const play = (text: string) => {
    const t = lang.toSigns(text, signLang);
    current = t;
    showChips(t, -1);
    const bits: string[] = [];
    if (t.face.brows > 0) bits.push('Raised brows: a yes/no question.');
    if (t.face.brows < 0) bits.push('Furrowed brows: a WH-question.');
    if (t.face.headshake) bits.push('Head shakes with the negation.');
    if (t.marks.some((m) => m.kind === 'topic')) bits.push('Raised brows: the topic comes first.');
    if (t.marks.some((m) => m.kind === 'cond')) bits.push('Raised brows: the condition comes first.');
    if (t.marks.some((m) => m.kind === 'rhet')) bits.push('Raised brows: a rhetorical question, then the answer.');
    if (t.spelled.length) bits.push(`Fingerspelled (no sign yet): ${t.spelled.join(', ')}.`);
    if (t.missing.length) bits.push(`No sign yet for: ${t.missing.join(', ')}.`);
    if (!t.signs.length) bits.unshift('None of those words are in the vocabulary yet.');
    note.textContent = bits.join(' ');
    player.tl = t.signs.length ? timeline(t.signs, t.face, t.negated, 0, t.marks) : null;
    player.t = 0;
    player.lastActive = -2;
    bars(t.signs.length);
    player.onSign = (i) => {
      const s = i >= 0 ? t.signs[i] : undefined;
      if (s) showSign(s); else avatar.mark(null);
      showChips(t, i);
    };
  };

  const playSign = (s: SignDef) => {
    const t: Translation = { tokens: [{ words: s.en[0]!, gloss: s.gloss }], signs: [s], face: { brows: 0, headshake: false }, negated: [], marks: [], missing: [], spelled: [] };
    current = t;
    showChips(t, -1);
    note.textContent = s.en.join(', ');
    player.tl = timeline([s]);
    player.t = 0;
    player.lastActive = -2;
    bars(1);
    showSign(s);
    player.onSign = (i) => { if (i >= 0) showSign(s); else avatar.mark(null); showChips(t, i); };
  };

  on(go, 'click', () => { if (input.value.trim()) play(input.value); });
  on(input, 'keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter' && input.value.trim()) play(input.value); });
  for (const b of Array.from(phraseRow.children)) on(b as HTMLElement, 'click', () => { input.value = b.textContent ?? ''; play(input.value); });
  on(replay, 'click', () => { if (current?.signs.length) { player.tl = timeline(current.signs, current.face, current.negated, 0, current.marks); player.t = 0; player.lastActive = -2; } });
  on(slowBtn, 'click', () => {
    const slow = player.speed === 1;
    player.speed = slow ? UI.slow.value : 1;
    slowBtn.setAttribute('aria-pressed', String(slow));
  });
  for (const b of Array.from(dict.children)) on(b as HTMLElement, 'click', () => {
    const s = signLang.bySign(b.textContent ?? '');
    if (s) { setTab(false); playSign(s); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  });
  on(dictBtn, 'click', () => { dict.hidden = !dict.hidden; });

  // Mic.
  let listening: Listener | null = null;
  if (!canListen()) mic.classList.add('off');
  on(mic, 'click', () => {
    if (listening) { listening.stop(); return; }
    if (!canListen()) { note.textContent = 'Speech input isn’t available in this browser. Type instead.'; return; }
    mic.classList.add('live');
    listening = listen(lang.speechLang, {
      onText: (t) => { input.value = t; },
      onFinal: (t) => { input.value = t; play(t); },
      onError: (m) => { note.textContent = m; },
      onEnd: () => { listening = null; mic.classList.remove('live'); },
    });
    if (!listening) { mic.classList.remove('live'); note.textContent = 'Couldn’t start the microphone. Type instead.'; }
  });

  // ---------------- reading signs
  let voice = canSpeak();
  let leftHanded = false;
  const phrases: string[] = [];
  const showRead = (rs: Recognized[], tentative: boolean) => {
    const glosses = rs.filter((r) => r.best).map((r) => r.best!.gloss);
    readChips.replaceChildren(...rs.map((r) => h('span', { class: `chip${r.best ? '' : ' missing'}${tentative ? ' soft' : ''}`, title: r.best ? `match cost ${r.best.cost.toFixed(2)}` : 'not recognized' }, [r.best?.gloss ?? '?'])));
    if (glosses.length) english.textContent = lang.fromGlosses(glosses);
    english.classList.toggle('soft', tentative);
    return glosses;
  };
  let testHeard: string[] = [];
  const finishPhrase = (rs: Recognized[]) => {
    const glosses = showRead(rs, false);
    if (testRec) testHeard.push(...glosses);
    if (!glosses.length) return;
    const text = lang.fromGlosses(glosses);
    phrases.unshift(text);
    history.replaceChildren(...phrases.slice(1, 6).map((p) => h('li', {}, [p])));
    if (voice) speak(text, lang.speechLang);
  };
  on(voiceBtn, 'click', () => { voice = !voice && canSpeak(); voiceBtn.setAttribute('aria-pressed', String(voice)); });
  on(leftBtn, 'click', () => { leftHanded = !leftHanded; leftBtn.setAttribute('aria-pressed', String(leftHanded)); });
  on(clearBtn, 'click', () => { phrases.length = 0; history.replaceChildren(); readChips.replaceChildren(); english.textContent = 'Sign, then pause or lower your hands.'; });

  // Self-test: avatar → virtual camera → recognizer, frame by frame.
  let testRec: Recognizer | null = null;
  let testRun = 0;
  on(testBtn, 'click', () => {
    const glosses = UI.selfTest[testRun++ % UI.selfTest.length]!;
    const signs = glosses.map((g) => signLang.bySign(g)).filter((s): s is SignDef => !!s);
    testRec = new Recognizer(signLang.recognized);
    testHeard = [];
    testPlayer.tl = timeline(signs);
    testPlayer.t = 0;
    testOut.textContent = `Signing: ${glosses.join(' ')}`;
    testPlayer.done = () => {
      const rest = testRec?.flush();
      if (rest) finishPhrase(rest);
      testOut.textContent = `Signed: ${glosses.join(' ')} · Read: ${testHeard.join(' ') || '(nothing)'}`;
      testRec = null;
    };
  });

  // Live camera (public web build only).
  let tracker: Tracker | null = null;
  let camRec: Recognizer | null = null;
  let stream: MediaStream | null = null;
  /** Turn the camera off (button, tab switch, or the page going to the background). */
  const stopCamera = () => {
    if (!stream && !tracker) return;
    const rest = camRec?.flush();
    if (rest) finishPhrase(rest);
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    video.srcObject = null;
    tracker?.close();
    tracker = null;
    camRec = null;
    camBox.classList.remove('live');
    stopBtn.hidden = true;
    camStart.disabled = false;
    camStatus.textContent = 'Camera off. Your video stays on this device.';
    ctxO?.clearRect(0, 0, overlay.width, overlay.height);
  };
  on(stopBtn, 'click', stopCamera);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera(); });
  let lastPartial = 0;
  on(camStart, 'click', async () => {
    if (!LIVE_CAMERA) {
      if (UI.publicUrl) window.open(UI.publicUrl, '_blank', 'noopener');
      return;
    }
    if (tracker) return;
    camStart.disabled = true;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser can’t open the camera.');
      camStatus.textContent = 'Asking for the camera…';
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      video.srcObject = stream;
      await video.play().catch(() => undefined);
      const vision = await import('./vision');
      tracker = await vision.createTracker((s) => { camStatus.textContent = s; });
      camRec = new Recognizer(signLang.recognized);
      camBox.classList.add('live');
      stopBtn.hidden = false;
      camStatus.textContent = 'Show your head, shoulders and hands. Pause or lower your hands to finish a phrase.';
    } catch (e) {
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      camStart.disabled = false;
      const name = (e as { name?: string }).name;
      camStatus.textContent = name === 'NotAllowedError' ? 'Camera access was blocked. Allow it in the browser settings to read signs.'
        : name === 'NotFoundError' ? 'No camera found on this device.'
        : `Couldn’t start camera tracking: ${(e as Error).message || 'unknown error'}`;
    }
  });

  const ctxO = overlay.getContext('2d');
  const drawOverlay = (f: CamFrame) => {
    if (!ctxO) return;
    const r = overlay.getBoundingClientRect();
    if (overlay.width !== Math.round(r.width)) { overlay.width = Math.round(r.width); overlay.height = Math.round(r.height); }
    ctxO.clearRect(0, 0, overlay.width, overlay.height);
    // Video is shown mirrored (object-fit: cover); map landmarks the same way.
    const vw = f.width, vh = f.height, s = Math.max(overlay.width / vw, overlay.height / vh);
    const ox = (overlay.width - vw * s) / 2, oy = (overlay.height - vh * s) / 2;
    const X = (x: number) => overlay.width - (ox + x * vw * s), Y = (y: number) => oy + y * vh * s;
    const accent = getComputedStyle(overlay).getPropertyValue('--accent').trim() || '#7cc4ff';
    ctxO.strokeStyle = accent;
    ctxO.fillStyle = accent;
    ctxO.lineWidth = 2;
    const bones = [[0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [0, 17, 18, 19, 20], [5, 9, 13, 17]];
    for (const hand of f.hands) {
      for (const b of bones) {
        ctxO.beginPath();
        b.forEach((i, k) => { const p = hand.landmarks[i]!; if (k) ctxO.lineTo(X(p.x), Y(p.y)); else ctxO.moveTo(X(p.x), Y(p.y)); });
        ctxO.stroke();
      }
      for (const p of hand.landmarks) { ctxO.beginPath(); ctxO.arc(X(p.x), Y(p.y), 2.5, 0, Math.PI * 2); ctxO.fill(); }
    }
  };

  // ------------------------------------------------------------------ one animation loop for everything
  let last = performance.now();
  const meterBar = meter.firstElementChild as HTMLElement;
  const loop = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!speakPanel.hidden) { avatar.draw(step(player, dt), now); fillBars(); }
    if (!readPanel.hidden) {
      const f = step(testPlayer, dt);
      testAvatar.draw(f, now);
      if (testRec && testPlayer.tl) {
        const cam = synthesize([{ t: testPlayer.t, f }])[0]!;
        const b = toBody(cam);
        const out = b ? testRec.push(b) : null;
        if (out) finishPhrase(out);
        else if (now - lastPartial > UI.partialEveryMs) { lastPartial = now; const p = testRec.partial(); if (p.length) showRead(p, true); }
      }
      if (tracker && camRec) {
        const cf = tracker.detect(video, now);
        if (cf) {
          drawOverlay(cf);
          const b = toBody(cf, leftHanded);
          const out = b ? camRec.push(b) : null;
          meterBar.style.transform = `scaleX(${Math.min(1, camRec.speed / 2)})`;
          if (out) finishPhrase(out);
          else if (now - lastPartial > UI.partialEveryMs) { lastPartial = now; const p = camRec.partial(); if (p.length) showRead(p, true); }
        }
      }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  on(window as unknown as HTMLElement, 'resize', () => { avatar.resize(); testAvatar.resize(); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { avatar.retheme(); testAvatar.retheme(); });

  // A first greeting so the stage isn't empty.
  setTimeout(() => { input.value = 'Hello, nice to meet you'; play(input.value); }, 400);
  return main;
}

render(app());

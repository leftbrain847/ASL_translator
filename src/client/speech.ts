/** Browser speech: recognition (mic → text) and synthesis (text → voice). Both are feature-detected. */

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

const Ctor = (): (new () => SpeechRecognitionLike) | null => {
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => SpeechRecognitionLike) | null;
};

export const canListen = (): boolean => !!Ctor();
export const canSpeak = (): boolean => typeof window !== 'undefined' && 'speechSynthesis' in window;

export interface Listener { stop(): void }

/** Listen once (one utterance). `onText` gets interim text; `onFinal` the finished sentence. */
export function listen(lang: string, h: { onText(t: string): void; onFinal(t: string): void; onError(msg: string): void; onEnd(): void }): Listener | null {
  const C = Ctor();
  if (!C) return null;
  const r = new C();
  r.lang = lang;
  r.interimResults = true;
  r.continuous = false;
  let final = '';
  r.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i]!;
      if (res.isFinal) final += res[0].transcript;
      else interim += res[0].transcript;
    }
    h.onText((final + interim).trim());
  };
  r.onerror = (e) => {
    const msg: Record<string, string> = {
      'not-allowed': 'Microphone access was blocked. Allow it in the browser, or type instead.',
      'service-not-allowed': 'Speech input is not available here. Type instead.',
      'no-speech': 'Didn’t catch that. Try again, a little closer to the mic.',
      network: 'Speech input needs a connection in this browser. Type instead.',
      'audio-capture': 'No microphone found.',
    };
    h.onError(msg[e.error] ?? 'Speech input stopped. Type instead.');
  };
  r.onend = () => {
    if (final.trim()) h.onFinal(final.trim());
    h.onEnd();
  };
  try { r.start(); } catch { return null; }
  return { stop: () => r.stop() };
}

export function speak(text: string, lang: string): void {
  if (!canSpeak() || !text) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = 1;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

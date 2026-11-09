# ASL Translator

A prototype that translates both ways between English and American Sign Language (ASL), in the browser:

- **Speak → Sign:** say or type a sentence. It is rewritten in ASL order (time first, question words last, no articles or "be"), and an avatar signs it with the facial grammar ASL uses: raised brows for yes/no questions, furrowed brows for WH-questions, and a headshake for negation.
- **Sign → Speak:** sign to the camera. The app tracks your hands and body, reads the signs, and shows and speaks the English.

Built on [app_builder](https://github.com/leftbrain847/app_builder) (solo mode). Everything runs on the device; there is no server state.

## Where it runs

| Build | Command | What it is |
| --- | --- | --- |
| Public page | `npm run build:web` | `web/asl-translator.html`, one standalone file with the live camera. The index repo publishes it as this app's "Latest" on the public sprint site and homepage. **Rebuild and commit it whenever `src/` changes.** |
| Sprint demo | `npm run build:demo` / `npm run snapshot` | One offline page with no network code (the day's Claude artifact). It has no live camera, so it shows the self-test, where the avatar signs to a virtual camera. |
| Friends | `npm run build` | Served by the Worker behind Cloudflare Access. **Not ready for the camera yet:** the host's CSP is `'self'` only, so the MediaPipe runtime and models would have to be self-hosted under `/<id>/` first. |

## How it works

One sign lexicon drives both directions (`src/asl/`):

| File | Job |
| --- | --- |
| `lexicon.ts` | 131 signs, each written as ASL parameters: handshape, location, palm and finger direction, movement, repetition, one or two hands. |
| `hand.ts` | A 21-point hand model (MediaPipe's layout) for 28 handshapes, plus the features the recognizer measures on a real hand. |
| `motion.ts` | Turns signs into poses over time. The avatar draws these, and the recognizer builds its templates from them. |
| `camera.ts` | Maps camera landmarks to body space (shoulder width = 1), and back again for the self-test. |
| `recognize.ts` | Connected-sign decoding. One dynamic-programming pass explains a stretch of movement as transitions plus signs, each sign time-warped against its template. |
| `src/lang/` | Language packs. `en.ts` handles English ⇄ ASL gloss. Another spoken or sign language is a new pack listed in `src/lang/index.ts`. |

To add a sign, add an entry to `lexicon.ts`. The avatar can then perform it, and the recognizer can read it. `npm test` fails if the new sign is confused with another one, or if its orientation is undefined.

## Accuracy: what is and isn't known

- **The signs have not been reviewed by a Deaf or fluent signer.** They are citation forms written from common dictionary descriptions, for a right-handed signer. Regional and personal variants exist. A fluent review is needed before anyone relies on this.
- **Recognition is tested on synthetic camera data only.** The avatar signs, a virtual camera films it with tracking noise, and the recognizer reads it. The tests in `test/asl.test.ts` cover:
  - all 131 signs, one at a time;
  - continuous sentences with no pauses;
  - slower signing and a differently sized signer (over 95% of signs);
  - at most 6 false signs in 80 s of random hand movement;
  - a left-handed signer.

  This shows the pipeline works and that the signs are distinguishable from each other. It does **not** measure accuracy on real people, which needs recordings of real signers.
- **Depth is invisible.** The camera works in 2D, so movement toward or away from the camera (a tap on the chest, a push forward) is read mostly from handshape and position.
- **Grammar follows common textbook rules, unreviewed.** Beyond word order: topics and conditionals (raised brows), rhetorical questions, people placed in signing space and pointed back to, directional verbs (GIVE, HELP, ASK, TELL, SHOW, SEND, PAY), plural and aspect reduplication, incorporated negation (DON'T-KNOW) with a headshake over the predicate, and NEXT/LAST on the time line (`src/lang/grammar.ts`). Classifiers and role shift are not covered. Words without a sign (names, most nouns, numbers above five) are fingerspelled with the manual alphabet (`src/asl/fingerspell.ts`); capitalized ones are treated as names and placed in signing space.
- **Assumption to check on a live camera:** MediaPipe's handedness labels assume a mirrored (selfie) image, so on raw camera frames "Left" means the signer's right hand (`CAMERA.labelsMirrored` in `src/asl/camera.ts`). If live tests show hands swapped, flip that flag.

## Privacy and third-party code

- Video never leaves the device. Frames go to MediaPipe's on-device models in the browser.
- Speech input uses the browser's speech recognition. In Chrome that sends audio to Google's speech service, and in Safari to Apple's. Typing works without it.
- Speaking aloud uses the browser's voices, preferring one that runs on the device. If only cloud voices exist (some Chrome setups), the spoken text goes to that voice service.
- [MediaPipe Tasks Vision](https://www.npmjs.com/package/@mediapipe/tasks-vision) 0.10.35 (Apache-2.0) is bundled into the public page. Its WebAssembly runtime (jsDelivr) and its hand and pose models (Google's model storage) load from version-pinned URLs only after the viewer allows the camera.
  - The version is pinned deliberately. MediaPipe 1.x adds a usage logger that posts to `odml.pa.googleapis.com` every 60 seconds with no switch to turn it off; 0.10.35 has none.
  - Re-check for that logger before upgrading: `grep odml node_modules/@mediapipe/tasks-vision/vision_bundle.mjs`.

## Commands

| Command | Does |
| --- | --- |
| `npm run dev` | local dev server |
| `npm test` | lexicon, grammar and recognizer tests (about 10 s) |
| `npm run typecheck` | TypeScript |
| `npm run build:web` | rebuild `web/asl-translator.html` |
| `npm run snapshot` | build the sprint demo and commit-ready snapshot in `snapshots/` |

## Budget

There are no runs or rooms, so the Worker serves the page and nothing else: a few requests per visit.

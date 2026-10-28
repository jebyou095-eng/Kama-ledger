# Kama Ledger — handoff for the next session (state at build v63; see also docs/ARCHITECTURE.md)

Paste or point the new session at this file. It says where the project stands and what to build next.

## The project and the person
- **Kama Ledger**: an offline Dofus profit tracker. Electron + Vite, Windows 11, vanilla JS modules in `src/`. Built by Phenix (Youssef). He is on the **free Claude plan**, wants brief answers, expects an interpretation stated before ambiguous work, and wants confirmation before irreversible edits. He asked not to waste tokens.
- His PC: Intel Core Ultra 5 125U, 16 GB RAM, integrated graphics. A future PC (16/32 GB + RTX 5060) is planned.
- Rules that always hold: Kamo **never touches the game** (he only reads the shared screen and talks/points). Nothing sensitive leaves the PC. API keys stay on his machine.
- Sharing: files go to him as zips; the upload limit is **30 MiB per file**. He runs `npm install` then `npm start` (that builds `dist/`), so zips exclude `node_modules/` and `dist/`.
- Tests: `npm test` (28 suites, all passing at v50). Headless checks live outside the repo in a scratchpad (playwright against vite dev); recreate as needed.

## Since v51 (done)
Live voice moved to a worker; Performance check card + automatic lag guard; main.js split started (livescan, checks, capture, core, hotkey); fast voice-engine download (curl);
Groq test shows the provider's reason; overlay marks use the overlay's real bounds; overlay hidden from screen capture; popup average tolerates OCR dropping the space.
Still unverified on the real PC: v63 scan accuracy with the overlay excluded from capture, live voice in Electron, bat download progress, Groq model access (his project blocked models; he was creating a new Groq project).
Next: finish splitting main.js (review/history screens, then queue + OCR), Step 2 skills-as-data, move the API key to Electron safeStorage (ask first), delete legacy kama-ledger.html (ask first).

## What exists (v50)
- **Scanner**: Tesseract OCR on the shared game screen; market list, item popups (multi-offer), tooltip/jet detection (`src/jet.js`), equipment pricing by jet, filters. Market **card detector** `src/cards.js` + `marketCards()` in `src/scan.js` gives one highlight box per card with the gaps left empty.
- **Kamo** (the helper character): `src/kamo.js` (UI + behaviour), `kamo-brain.js` (rules, `LINES` text), `kamo-ai.js` (price-question analyst), `kamo-friend.js` ("ask a friend" file protocol), `kamo-motion.js` (walking, pointing, poses, shake detector), `kamo-sound.js` (voice), `kamo-tts.js` (live voice), `kamo-notebook.js` (new, see below), `overlay.js` + `electron/*` (see-through overlay over the game, Ctrl+Alt+K ask box).
- **Poses**: lying on the **top edge of the Hôtel de vente window** on his back or belly (13 looks in `LIES`), side view, dizzy when shaken. No camouflage, no side-lying (user rejected them). Window top edge is estimated from the first card (`kind:'win'` mark in `main.js`).
- **Voice**: bf_lily (Kokoro-82M) pre-recorded clips in `public/voice/` (every fixed line in `LINES`, 13 reaction clips, a synthesized snore). `src/voice-index.js` maps normalized text to files and holds loudness envelopes for **lip-sync**. Lines starting with "Zzz" play the snore, then the words. Dynamic sentences use the **optional live voice engine** (`kamo-tts.js`: onnxruntime-web + phonemizer + `voice-engine/kokoro.int8.onnx.part1..4`, ~90 MB, shipped separately; the Electron main process serves the model/wasm over IPC `voice:model` / `voice:wasm`). Without it he falls back to reaction clips.
- **Claude connector** (MCP): `mcp/kama-mcp.mjs` reads `kama-snapshot.json`; tools incl. `kamo_questions`, `kamo_answer`, `kamo_say`. Works only while Claude Desktop is open.
- **Notebook (new, not yet wired)**: `src/kamo-notebook.js` + `tests/kamo-notebook.cjs` (passing). Offline meaning-ish matching (synonyms, word pairs, letter trigrams), entries keep source (user > friend > cloud), votes, corrections, caps, stats. It is **not connected to `kamo.js` yet**.

## Unverified on the real PC (ask him what he saw)
1. Highlight alignment (single-window mode) and the window-top-edge estimate for lying poses.
2. Ctrl+Alt+K ask box, dragging/clicking Kamo, shake-to-dizzy.
3. Live voice engine inside Electron (IPC model load, speed on his iGPU) and lip-sync.
4. Claude Desktop showing the `kamo_*` tools after restart.

## Step 1 of the Brain Stack: DONE in v51
- `kamo.js`: order is rules → notebook → free cloud (Groq, then SambaNova, Gemini) → friend (Claude file protocol) → "curious" line. Old `kl-kamo-kb` answers migrate once into the notebook (`kl-kamo-nb`). Answers from Claude without a question are learned too.
- `src/kamo-cloud.js` (prompt builder with only the items the question names, cascade, 429 cooldown, bad-key skip) + Electron IPC `brain:chat` (fixed hosts only, key never logged) + `brainChat` in `preload.js`.
- Kamo menu → "Kamo's brain (free cloud)": provider, key, model, Test, Report card. Typing "report card" also shows it.
- 👍/👎 on notebook/cloud/friend answers; 👎 → "What should I have said?" → next message is stored with `correct()`. Answers that depend on prices expire after 12 h (`exp` in notebook entries); corrections never expire.
- Tests: `tests/kamo-cloud.cjs` added to `npm test`. Page wiring was smoke-tested in headless Chromium with a fake bridge; the real Groq call is NOT verified yet (needs his key).
- Next: Step 2 below.

## The plan: "Kamo Brain Stack" (agreed with the user)
Goal: free, works without Claude Desktop, gets smarter over time at *his* market. Tiers, in order, stop at the first that answers:
1. **Rules + notebook** (instant, offline). Notebook = answers kept from higher tiers.
2. **Understanding**: semantic match picks the action. (Embedding model MiniLM was considered but Hugging Face is blocked in the build sandbox; the notebook uses a built-in matcher instead. An optional small local LLM may come later.)
3. **Free cloud cascade** (Groq first, then SambaNova, then Gemini; OpenAI-style chat API; the user pastes his own keys). Send only the question + a tiny summary of the relevant items, never the whole ledger. Do the HTTP call in the **Electron main process** via IPC `brain:chat` (avoids CSP/CORS), cool a provider down on HTTP 429.
4. **Ask a friend** (Claude through the connector, existing file protocol) as the last resort; its answer goes into the notebook.

Research notes behind the design: a small model should **not** fill in tool arguments (hard JSON schemas hurt small models; code fills the details, the model only picks among named actions, bad output → next tier). Skills must be **data, not code**, and must pass an automatic test on his real price history before they go live, then be re-tested weekly and switched off on failure; keep few, small skills.

### Build order
**Step 1 (next)**
- Wire `kamo-notebook.js` into `kamo.js`: replace `friendAnswer`'s Jaccard `kbMatch` with the notebook (migrate `kl-kamo-kb` entries as `friend`); store under a localStorage key (e.g. `kl-kamo-nb`).
- `src/kamo-cloud.js` + Electron IPC `brain:chat` + provider presets (Groq, SambaNova, Gemini; model names editable) + prompt builder (cute, ≤2 sentences, user's language) + minimal context from `o.items.snapshot()`.
- Settings UI in the Kamo menu (`index.html`): provider, key, model, "Test" button. Store keys locally only.
- Correction loop: answers from notebook/cloud/friend get 👍/👎 acts; 👎 → "What should I have said?" → next message stored with `correct()`.
- **Report card** in the Kamo menu: questions asked, answered by rules / notebook / cloud / friend, corrections, notebook size.
- Order inside `friendAnswer`: notebook → cloud (async; say "Wait a minute, let me ask a friend…" then the answer; learn it) → friend file. Fall back to the old "curious" line when nothing works.
- Add tests (cloud prompt builder, cascade/cooldown with a fake transport) and keep `npm test` green; bump `APP_BUILD` in `src/diag-plan.js`.

**Step 2**: skills as data (small rules/recipes) with the automatic test gate on price history, user approval, weekly re-test, auto-disable, cap on active skills. Nightly self-check: compare yesterday's "looks cheap" predictions with outcomes and calibrate Kamo's confidence.

**Step 3 (optional)**: a small local model (Gemma 3 1B / Qwen3 class via WebLLM) with a **"Test my PC" speed button**, loaded only on demand so it doesn't compete with Dofus; only used to choose among named actions.

## Other ideas not started
Custom voice upload pack; recording the new dynamic lines in bf_lily; Dofus Q&A from game data (`kama-data.json`); backup/restore; splitting `src/main.js` (very large); README/SPEC updates.

## Housekeeping notes
- Large optional files are git-ignored: `voice-engine/`, `public/voice-engine/`, `public/ort/`. To rebuild the voice pack: Kokoro (kokoro-onnx, int8 model from the `thewh1teagle/kokoro-onnx` release `model-files-v1.0`), voice `bf_lily`, speed 1.1, pitch/tempo ×1.15; scripts were kept outside the repo (`make_pack.py`).
- Game data note: stat ranges in `kama-data.json` disagree with tooltips for some items; they are not used.

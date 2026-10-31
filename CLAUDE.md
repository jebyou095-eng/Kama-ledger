# Kama Ledger: handoff for Claude Code

Offline Dofus market/profit tracker (Electron + Vite). Owner: Phenix (Youssef). Game window is always 1920x1200. He plays and clicks in the game himself; Claude never clicks in or automates the game. API keys stay local (Electron safeStorage); never print or store them.

## Working rules
- Brief answers, low token use. Ask before irreversible edits. Say plainly what is verified and what is not.
- `npm test` must pass before every commit. Bump APP_BUILD in src/diag-plan.js each release (now v79) and commit with a short message.
- Screenshot truth library: tests/screens (run: `npx vite --port 5199` then `node tests/screens/run.mjs`, score 32/36, only the Kokoko overlay popup fails).
- Status for Claude: the app writes kama-status.json (userData) and the MCP server mcp/kama-mcp.mjs exposes kamo_status, kamo_questions, kamo_answer, overview, movers... Read kamo_status first when something fails.

## Architecture notes
- src/main.js (scanEnv lazy getters), src/livescan.js, src/scan.js (Tesseract.js OCR), src/lotrows.js (per-row popup lot reader), src/graph*.js (price chart reader), src/jetprice.js (jet tier, asking price, easy/hard to sell), src/kamo*.js (assistant, skills as data in src/skills/skills.json), src/testlib*.js (in-app screenshot library, tags).
- Perf lesson: one getImageData per strip, `willReadFrequently: true` canvases. Per-pixel-row reads made popup scans take 15-40 s.
- Popups: resource popups show lots 1/10/100/1000 (rows may be fewer than 4); equipment popups list many single offers (qty 1, then qty 10), cheapest first.

## Open problems (as of v79)
1. Verify v79 lot reader on the real screen: Aile de Gruche (truth 1=1 208, 10=12 222, 100=121 111, avg 1 189, only 3 lots), Marteau de Forgeur de Grattoir (450, 450, 500, 900, 950, 9 999, 39 999, then lot 10: 9 000), Bandeau de Vitalite / Komintot (all lot 1).
2. Non-popup panels (item tooltip with "PRIX MOYEN indisponible") are sometimes detected as popups; popup name sometimes read from the wrong line.
3. Startup error "Invalid string length" in status errors; 595 MB heap.
4. Market row accounting (detected vs kept rows); bad prices already in history (cleanup tool needs user confirmation).
5. Unverified on the real PC: overlay excluded from capture, encrypted key flow, Kamo Test with Groq/Gemini.
6. Assumptions to tune from real data: PREMIUM 1.5x median for perfect jets; easy/hard sell thresholds (10/3/1 sold per day).

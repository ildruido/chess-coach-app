# Changelog

All notable changes to Chess Coach are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.27.0] - 2026-11-05

### Added

- The board can be played from the keyboard and with a screen reader: a "Type a move" box (e4, Nf3, O-O, e2e4) under the Practice and lesson boards, every move said in words, and a "Read the board" button that lists the pieces and your legal moves. (CC-074)
- A "Voice chat" button beside the board starts and stops voice chat in one tap, in Practice and in lessons. (CC-074)
- A skip link, page landmarks and a page title for each screen. (CC-074)

### Changed

- If you have played before, the app opens straight into a game with your last level, colour and hint choice. New game still lets you change them; a game you leave before moving no longer lands in Past games. (CC-074)
- Larger tap targets and clearer focus outlines; the selected lesson view keeps readable text in dark mode. (CC-074)

## [0.26.0] - 2026-11-03

### Added

- The page footer has a "Source code" link to the public copy of the app code at the running version, and a release now copies the app files (not the project files) to the public repo automatically. Needs a one-time setup first. (CC-044)

## [0.25.3] - 2026-11-03

### Fixed

- Other players' saved coach answers can no longer reach you, and yours can no longer reach them: the old shared answer areas are closed to every signed-in player, for reading as well as writing. (CC-067)
- "Export my data" now contains only your own games, history and lesson progress, not shared coach answers. Older export files still import. (CC-067)

## [0.25.2] - 2026-10-22

### Fixed

- The coach can no longer be used as a general chat: the server now builds every coach request itself from the position and the engine's analysis, refuses anything else and checks the answer against the engine's facts before showing it. (CC-073)
- The shared coach answer store can only be changed by the server, not by any signed-in player. Saved answers kept in the old shared store are still readable, and an old export's saved coach answers are no longer imported. (CC-073)
- In a lesson quiz the coach's answer is checked against the quiz's own answer squares, not the engine's favourite move. (CC-070)

### Changed

- The automatic dependency audit no longer fails a build when the npm registry itself is down; real findings still fail it. No change to the app.
- Cloud work sessions now set themselves up (dependencies, Postgres, browser path), so the code-style check and the web browser tests run without manual steps. No change to the app.
- Docs and code comments now match the web-only app (no more Claude app, Lab or "one user" wording), and an unused internal permission check was removed. No change to the app.

## [0.25.1] - 2026-10-13

### Fixed

- The "Talk to the coach" box no longer disappears on a lesson's quiz step (the step before an exercise). It stays on screen the whole lesson; until the quiz is answered the coach only sees the question and keeps the answer secret. (CC-057)

## [0.25.0] - 2026-10-13

### Changed

- The automatic dependency audit no longer fails a build when the npm registry itself is down; real findings still fail it. No change to the app.

- Talking to the coach no longer turns reading aloud on by itself. Answers, hints, warnings and move questions in the "Talk to the coach" box (Lessons and Practice) stay on screen as text unless the Read aloud switch is on. Voice chat still listens; turn Read aloud on to hear the answers.
- In Lessons the Read aloud switch now sits under the Back / Next buttons, so it is there on every step, including quizzes and exercises. Exercises behave like every other step.

## [0.24.0] - 2026-10-13

### Changed

- The automatic dependency audit no longer fails a build when the npm registry itself is down; real findings still fail it. No change to the app.

- Lessons now have one box for the coach, "Talk to the coach": type and Send, press Speak, or switch on Voice chat. The separate "Your own question" box is gone.

### Added

- A Read aloud switch in Lessons (shared with Practice): it reads out suggested answers, hints, warnings and each new step. "Stop reading" silences it at once.
- By voice in lessons: "leave lesson", "back" and "skip" join "next", "hint", "try again" and "repeat".

### Fixed

- Saying "leave lesson" was sent to the coach as a question, and leaving a lesson while Voice chat was on left it showing "Thinking…" and the coach kept talking. Leaving now ends Voice chat and stops the reading.

## [0.23.0] - 2026-10-13

### Added

- Talk to the coach in lessons: under "Ask the coach" there is now a "Talk to the coach" box with Speak, Send and a Voice chat switch. Ask a question by voice and hear the answer; say a move in an exercise ("knight f3") and confirm it with "yes"; say "next", "hint", "try again" or "repeat". Free browser speech only, the same as in Practice.

## [0.22.0] - 2026-10-12

Web app only: the Claude app and the Lab are retired.

### Added

- A "Coach diagnostics" switch at the bottom of the page (off by default, remembered on the device). When on, it shows why a hint was held back and how many answers were reused or sent to the coach.

### Removed

- The Claude app and Lab versions are gone from the code and the tests: the artifact adapter, the Lab check panels, the single-file build and their CI jobs. The web app is the only version.

### Changed

- The automatic dependency audit no longer fails a build when the npm registry itself is down; real findings still fail it. No change to the app.

- Export my data and Bring in your data now describe themselves in web terms: export is your backup file, and import restores it.
- When the coach or storage is not available, the messages no longer tell you to open the Claude app.
- The feature tests now run on the web page itself instead of the Lab. The Lab's own check panels (hello, board, engine, coach, save, strength) lost their tests; the board rules, saving and engine speed are now tested on the Practice screen.

## [0.21.2] - 2026-10-12

### Fixed

- Web version: pressing Send with the internet off now says you are offline, even when the browser still claims to be online (for example with a VPN on). If the connection dies while the page waits, the coach now gives up after 30 seconds and says so instead of showing nothing.

## [0.21.1] - 2026-10-12

### Fixed

- With the internet off, Speak and Send now say you are offline and the coach needs a connection, instead of "Couldn't reach Claude" after sending.

## [0.21.0] - 2026-10-11

### Added

- You can now describe a move in everyday words, typed or spoken in "Talk to the coach": "the left bishop to b5", "knight takes the pawn", "take the pawn with my knight", "queen's pawn two squares". "Left" and "right" are as you see the board. When more than one piece could do it, the coach asks "Which knight: the one on b1 or the one on f3?" and you answer with "the left one", "the one on f3" or "b1". A move still needs a "yes" before it is played.

## [0.20.0] - 2026-10-11

### Added

- Behind the scenes only: in the web version, a **Voice chat** switch under "Talk to the coach" makes the chat hands-free. It listens, sends what you said, reads the coach's answer, then listens again. A spoken move still needs a spoken "yes". Say "stop" or switch it off to end it; it also ends by itself after 30 seconds of silence, when the microphone is blocked, or when you leave the page. It never listens while the coach is speaking. The Claude app version is unchanged.

### Fixed

- Web version: if you are signed out on one device (for example after changing your password on another), that device now goes back to the sign-in screen the next time it saves or asks the coach, instead of showing "Saving is off" warnings.

## [0.19.0] - 2026-10-11

### Added

- Voice is more reliable: a line under the coach says what voice can do in your browser (speak, hear, or both, with a warning for Safari and iPhone); long answers are read in short pieces so they are not cut off; reading stops when you leave the page and is woken by your first tap so phones will speak answers; the Stop button disappears if the browser loses track of the reading; "no internet" and "heard nothing" get their own messages when listening (web version).

- Web version: **Change password** next to "Sign out". It asks for your current password, and signs you out on your other devices.
- Behind the scenes only: a private test server can be given a test account with a dummy address (`test@chess-coach.org`) and a dummy password, by one setting on that server; it is off everywhere else. The Claude app version is unchanged.
- Behind the scenes only: the web version's server can now answer the coach from the Anthropic API (live answers, engine tool turns) and keeps a monthly allowance for each person. Nothing in the app changes.
- Behind the scenes only: the web version now has a build of its own (`npm run build:web`) that the server hands out with a sign-in page, strict browser security settings (content policy, no framing) and limits on request size and rate. The Claude app version is unchanged.
- Behind the scenes only: the web version can now import the file saved by "Export my data" into your account ("Bring in your data" at the bottom of the page). Nothing already in the account is overwritten. The Claude app version is unchanged.
- Behind the scenes only: in the web version, a **Speak** button next to "Talk to the coach" lets you dictate with the browser's own speech: press it, say what you want, check the words and press Send. Reading aloud works there too. The Claude app version is unchanged.
- Behind the scenes only: the web version can now be put on a private test address (`render.yaml`, `docs/PREVIEW.md`); the server prints a first invite link in its log when nobody has an account yet. The Claude app version is unchanged.

## [0.18.0] - 2026-10-11

### Added

- "Export my data" at the bottom of the page. One click saves a single file with your games in progress, past games (with their reviews), lesson progress and saved coach answers, ready to move to the web version later. Your first export asks the Claude app for permission to save files, and it asks again each time before saving.

### Changed

- The automatic dependency audit no longer fails a build when the npm registry itself is down; real findings still fail it. No change to the app.

- Behind the scenes only: the page now reaches the Claude app through one small layer, ready for the web version. Nothing looks or behaves differently.
- Behind the scenes only: the web version's server (`server/`) now exists, with a health check and a Postgres store for games, history and lesson progress. Nothing in the app changes.
- Behind the scenes only: the web version's server can now sign people in by invite (email and password, rate-limited), and an admin command makes invites, resets passwords and sets coach allowances. Nothing in the app changes.

## [0.17.0] - 2026-10-10

### Added

- "Talk to the coach" in the Practice coach card. Speak with your device's microphone key (or type) and press Send: ask for a hint, ask for the game review, ask the coach a question about the game, or say a move such as "play knight f3". A move is shown for you to confirm ("yes" or Play it) before it is played. Answers are read aloud, even with Read aloud off. The app never listens on its own.

## [0.16.0] - 2026-10-10

### Added

- A "Coach suggests" card on the Lessons screen picks up to three lessons from the mistakes in your reviewed games (a piece left to be taken, a missed checkmate, a missed free piece, a missed fork, a slip in the opening), and "Your common mistakes" lists the most frequent ones with a tip and the lesson that helps. It also tells you when you are ready for a harder opponent. The recommended path keeps its order, and none of this uses the coach.

## [0.15.0] - 2026-10-10

### Added

- The Lessons screen now opens on a recommended path: all twelve lessons in a good order for a beginner (free pieces first, the Italian Game and the queen mate last). The first lesson you haven't finished is marked "Next on your path". You can still open any lesson, and "By topic" switches back to the grouped list (your choice is remembered).

## [0.14.0] - 2026-10-10

### Changed

- The automatic dependency audit no longer fails a build when the npm registry itself is down; real findings still fail it. No change to the app.

- The coach now has one shared memory of what it has said. Lesson questions, practice hints, move comments and game reviews are all saved there, so the same situation shows the saved answer straight away instead of asking the coach again, which uses less of your plan. A saved answer says "Reused from an earlier answer", with "Ask the coach anyway" and 👎 (which stops it being shown again). Everything you already asked in lessons is carried over. The Lab shows, per feature, how many answers were reused and how many went to the coach.

## [0.13.0] - 2026-10-09

### Added

- Three new lessons. **Opening principles**: take the centre, bring out your knights and bishops, and castle; then do it against the engine within 10 moves, with a counter of pieces out and moves left. **The Italian Game**: its first moves and ideas, then a drill where the engine answers with the book moves and each position is named. Play a different move and the drill says so, tells you the move the Italian Game plays, and lets you take yours back; hints show the piece, then the move. Then two of Black's typical mistakes to punish. **Mate with king and queen**: the box method and the stalemate trap, then two positions to checkmate against the engine at full strength. The safety net warns you before stalemate, a draw, or a move that hangs the queen.

### Changed

- The automatic dependency audit no longer fails a build when the npm registry itself is down; real findings still fail it. No change to the app.

- The lesson list: lessons are numbered in the recommended order and grouped by topic, each with a one-line summary of what it teaches. Each says Not started, In progress (with the step) or Done, with your score from the last time. The top shows how many lessons you have done and a Continue button for the lesson you were last doing. A lesson you finished before still counts as done when you start it again.

## [0.12.0] - 2026-10-09

### Added

- Eight new lessons, after Free pieces: Don't leave pieces hanging, What pieces are worth, Checkmate in one, Back-rank mate, Forks, Pins, Skewers and Discovered attacks. Each explains the idea on the board, has a quick quiz, suggested questions and the Ask the coach box, then 4 to 6 exercises that change when you replay the lesson. In "Don't leave pieces hanging" any move that keeps your pieces safe counts as right; the engine warns you before a move that drops one.

### Changed

- The automatic dependency audit no longer fails a build when the npm registry itself is down; real findings still fail it. No change to the app.

- Lesson exercises: while the engine checks your move, the piece stays where you put it. A good move no longer jumps back first; only a move that gets a warning or "Not quite" goes back.

## [0.11.0] - 2026-10-08

### Added

- Saved coach answers in lessons. Every answer the coach gives you in a lesson is kept. Ask the same question again, even in other words ("why can't I take the horse" or "why not capture the knight"), and its answer shows at once, marked "You asked this before", with no coach call. "Ask the coach anyway" gets a fresh answer. A question that is only close shows "Did you mean …?" first. A question about another square, piece or move never gets someone else's answer. General questions ("What is a pin?") work on any step of the lesson; answers about one position stay with that position. "Explain differently" shows earlier rewordings first. 👍 or 👎 under an answer; 👎 stops it being shown again. Answers are kept in the app's shared storage, so they survive reloads.

## [0.10.0] - 2026-10-08

### Added

- "Ask the coach" under every lesson step. Two or three suggested questions answer at once, with no coach call. You can also type your own question: the coach answers about that step, using the engine's view of the position. If your question names a move ("What if Nf3?"), the engine checks that move first. On text steps, "Explain differently" asks the coach to say it in other words. During an exercise the coach won't give the answer away, and a coach answer counts as help in your score, like a hint. An answer that doesn't match the engine isn't shown, and you can ask again.

## [0.9.0] - 2026-10-08

### Added

- "Read aloud" in the coach card: when it's on, your device reads hints, comments on your moves and the game review out loud, with moves said as words ("knight f3"). It's off at first and remembered on this device. Making a move, pressing Stop reading or turning it off stops the voice. It uses your device's own voice, so it costs nothing from your Claude plan.

## [0.8.1] - 2026-10-07

### Fixed

- Lessons save your place again. The page tried to save lesson progress to an invalid place, so it showed "Couldn't save just now" and a lesson started over each time you opened the app. Progress saved before this fix was never stored, so each lesson starts fresh once.

## [0.8.0] - 2026-10-07

### Added

- Lesson exercises now use real puzzles: 284 beginner puzzles from the lichess puzzle database, each checked by the engine (40 for "Free pieces"). Doing a lesson again gives you new positions. The puzzles are credited at the bottom of the page.

### Fixed

- In an exercise, the board now plays your opponent's last move first, so you can see what just left a piece free.
- When the engine warns you about a move, the line above the board points to the warning instead of saying "Checking your move…".
- Puzzles that take more than one move now say you are not finished yet after each good move.
- "Why?" at your usage limit says the coach is paused, the same as the note at the top of the screen.
- After Start or Resume, keyboard focus moves into the lesson.

## [0.7.0] - 2026-10-07

### Added

- Lessons: a new Lessons screen next to Practice, starting with "Free pieces". Each lesson explains an idea on the board with arrows and marked squares, plays it out, asks a quick question, then gives you exercises. Before a move that loses something, the engine stops it and warns you: try again, ask the coach why, or play it anyway. Hints in exercises (Tell me or Ask me) come from the engine and use none of your plan. Your place in a lesson is saved, and the end shows the idea to remember and your score.
- Usage limit guard: if you reach your Claude plan's usage limit, a note pinned to the top of the screen says so and the coach pauses. The game carries on: comments come from the engine, hints come from the engine where it has a plain one, and a finished game still gets the engine's review. No more coach calls are made until you press "Try the coach again" (nothing retries on its own). Hints and comments keep using the quick model; only the post-game review uses the bigger one.
- Practice games name the opening you are playing (for example "Opening: Italian Game (C50)"), from the lichess openings list.
- Behind the scenes, for the coming lessons: a checked set of beginner puzzles from the lichess puzzle database, and a job that rebuilds it.
- A plan for lessons (no change to the app yet): how lessons look on the board, how exercises and the safety net work, where the puzzles and openings come from, and a first set of 12 beginner lessons. See docs/LESSONS-PLAN.md.

## [0.6.0] - 2026-10-07

### Added

- Past games: every game you finish (checkmate, draw, resigning, or leaving it for a new game) is saved to your account with its date, level, color, result, moves and the hints you used. Between games, the "Past games" list shows them newest first. Open one to replay it move by move on a board, see the hints you used, and read its review. A game you didn't review can be reviewed from there, and the review is saved with it, so opening it again costs no new coach call.

## [0.5.1] - 2026-10-07

### Fixed

- Hints no longer get stuck on "That hint gave away too much too early". When you ask again, the coach is told what slipped so it can try differently. If its second try for that step is held back too, you get a plainer hint built from the engine (for example "The piece to move: your knight on f3."), so you can always go on to the move. The list of threatened pieces the coach reads no longer shows the square of a piece you can capture, which it used to let slip.

## [0.5.0] - 2026-10-07

### Added

- Post-game review: when a game ends, press "Review this game". The engine checks every move, then shows up to five turning points: your biggest mistakes, and the moments you punished one of the engine's slips ("Well spotted"). Each has a small board with arrows, what happened, what was better and why, and the review ends with one lesson to take away. The coach writes the explanations; anything it says that doesn't match the engine is replaced by the engine's own words. Stop cancels it at any time. A clean game shows fewer turning points.

## [0.4.1] - 2026-10-06

### Fixed

- The "which piece" hint no longer gives the move away or gets refused so often. It names the piece and what it will achieve, but not where it goes ("your pawn on e2 should advance to the centre" was too much).

## [0.4.0] - 2026-10-05

### Added

- Running commentary: switch on "Comment on each of my moves" in the coach card, and after each of your moves you get a one-line verdict from the engine (good move, inaccuracy, mistake or missed chance), with the coach saying why. Off by default; switching it off stops comments at once, and the game never waits for one. If a better move is still on the board, the comment won't give it away.

### Changed

- The automatic dependency audit no longer fails a build when the npm registry itself is down; real findings still fail it. No change to the app.

- Tell me or Ask me is now chosen when you set up a game, next to the level and color, and stays the same for the whole match. During the game the coach card shows your choice, locked. A resumed game keeps its choice, and the next game starts from the last one.

### Fixed

- Hints are refused far less often with "That hint gave away too much too early". The coach no longer sees the answer during the question and plan steps, so it can't let it slip. It may now point at one of your pieces that is under attack, or name the opponent's piece you could win. Hints that really give the move away are still held back.

## [0.3.0] - 2026-10-05

### Added

- Hints from your coach during practice games. Press Hint on your turn. "Tell me" gives the plan, then which piece, then the move with why it works, one step at a time. "Ask me" starts with a guiding question (and another if you ask), then the same steps. Switch between them at any time.
- Every hint is checked against the engine before you see it; a hint that disagrees with the engine or gives away too much is not shown.
- The hints you use are saved with your game.
- Hints use Claude on your plan, so the app asks once for permission to use Claude.

## [0.2.0] - 2026-10-05

### Added

- Practice matches: pick an engine level and your color (white, black or random), then play a full game against the engine on a real chessboard. Move by tapping or dragging; all chess rules, including castling, en passant and promotion; check, mate and draws are announced.
- Six engine levels for beginners and casual players, from "First games" to "Club player". Each plays human-like moves, with mistakes that fit its level.
- Take back, resign, new game and flip board.
- Your game in progress is saved to your account as you play and comes back after a reload. This adds a one-time permission prompt for storage.

### Changed

- The automatic dependency audit no longer fails a build when the npm registry itself is down; real findings still fail it. No change to the app.

- The app now opens on the Practice screen. The "Ask the coach" test page and the other technical checks moved to the separate Chess Coach Lab preview.

### Fixed

- The page no longer scrolls sideways on phones.

## [0.1.0] - 2026-10-04

### Added

- Project harness: TypeScript + Vite single-file build, Vitest, Playwright, ESLint, Prettier and GitHub Actions CI.
- `CLAUDE.md` with roles, definition of done, Conventional Commits, SemVer and the release flow.
- Claude skills (`prd-intake`, `build-feature`, `test-handoff`, `release`, `new-app`), agents (`planner`, `reviewer`, `qa`) and lint/test hooks.
- `docs/PRD.md` and `docs/BACKLOG.md` for the Chess Coach MVP.
- Hello page with an "Ask Claude" button that asks the coach a question through the artifact `sample` capability.
- The status line says whether Claude access is already allowed, instead of always promising a permission prompt.

[Unreleased]: https://github.com/ildruido/chess-coach/compare/v0.25.3...HEAD
[0.25.3]: https://github.com/ildruido/chess-coach/compare/v0.25.2...v0.25.3
[0.25.2]: https://github.com/ildruido/chess-coach/compare/v0.25.1...v0.25.2
[0.25.1]: https://github.com/ildruido/chess-coach/compare/v0.25.0...v0.25.1
[0.25.0]: https://github.com/ildruido/chess-coach/compare/v0.24.0...v0.25.0
[0.24.0]: https://github.com/ildruido/chess-coach/compare/v0.23.0...v0.24.0
[0.23.0]: https://github.com/ildruido/chess-coach/compare/v0.22.0...v0.23.0
[0.22.0]: https://github.com/ildruido/chess-coach/compare/v0.21.2...v0.22.0
[0.21.2]: https://github.com/ildruido/chess-coach/compare/v0.21.1...v0.21.2
[0.21.1]: https://github.com/ildruido/chess-coach/compare/v0.21.0...v0.21.1
[0.21.0]: https://github.com/ildruido/chess-coach/compare/v0.20.0...v0.21.0
[0.20.0]: https://github.com/ildruido/chess-coach/compare/v0.19.0...v0.20.0
[0.19.0]: https://github.com/ildruido/chess-coach/compare/v0.18.0...v0.19.0
[0.18.0]: https://github.com/ildruido/chess-coach/compare/v0.17.0...v0.18.0
[0.17.0]: https://github.com/ildruido/chess-coach/compare/v0.16.0...v0.17.0
[0.16.0]: https://github.com/ildruido/chess-coach/compare/v0.15.0...v0.16.0
[0.15.0]: https://github.com/ildruido/chess-coach/compare/v0.14.0...v0.15.0
[0.14.0]: https://github.com/ildruido/chess-coach/compare/v0.13.0...v0.14.0
[0.13.0]: https://github.com/ildruido/chess-coach/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/ildruido/chess-coach/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/ildruido/chess-coach/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/ildruido/chess-coach/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/ildruido/chess-coach/compare/v0.8.1...v0.9.0
[0.8.1]: https://github.com/ildruido/chess-coach/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/ildruido/chess-coach/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/ildruido/chess-coach/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/ildruido/chess-coach/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/ildruido/chess-coach/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/ildruido/chess-coach/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/ildruido/chess-coach/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/ildruido/chess-coach/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/ildruido/chess-coach/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/ildruido/chess-coach/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/ildruido/chess-coach/releases/tag/v0.1.0

# Chess Coach (source code)

The source code of [Chess Coach](https://github.com/ildruido/chess-coach-app): a web app where you play chess against Stockfish and a Claude coach explains what the engine finds.

This repository is a read-only mirror, published with every release. Each commit is one release and carries its version tag (`vX.Y.Z`). Development happens elsewhere, so pull requests here are not merged; open an issue instead.

The app is licensed under the [GNU GPL v3 or later](LICENSE) because it ships Stockfish and chessground, both GPL-3.0. Credits are in the app's footer.

```bash
npm install
npm run dev     # page on localhost
npm test        # unit tests
npm run build   # the web app in dist-web/
```

The backend is in `server/` (Node, Postgres). It needs `DATABASE_URL` and, for the coach, `ANTHROPIC_API_KEY`; see `server/README.md`.

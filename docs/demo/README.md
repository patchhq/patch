# Demo assets

## Video

- [`patch-demo.mp4`](./patch-demo.mp4) — ~40s silent product explainer (H.264 Main / yuv420p).

Rebuild from Remotion:

```bash
cd demos/video
pnpm install --ignore-workspace
pnpm render
cp out/patch-demo.mp4 ../../docs/demo/patch-demo.mp4
```

## Stills (palette `#C6890F` / `#17130E` / `#EDE7D9`)

Screenshot-style assets (macOS terminal, GitHub dark UI, VS Code diff) — not flat poster graphics.

| Asset | What it shows |
|-------|----------------|
| [`init-terminal.svg`](./init-terminal.svg) / [`.png`](./init-terminal.png) | Real terminal: `npx patch init` auto-detecting APIs |
| [`confidence-flow.svg`](./confidence-flow.svg) / [`.png`](./confidence-flow.png) | GitHub-style PR vs Issue from the confidence gate |
| [`fix-diff.svg`](./fix-diff.svg) / [`.png`](./fix-diff.png) | VS Code source-control diff with the actual fix |

**Type:** Display JetBrains Mono italic 800 · Data JetBrains Mono 500 · Body Inter.

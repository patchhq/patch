# Demo assets

- [`patch-demo.mp4`](./patch-demo.mp4) — ~40s silent product explainer (H.264 Main / yuv420p).

Rebuild from Remotion:

```bash
cd demos/video
pnpm install --ignore-workspace
pnpm render
cp out/patch-demo.mp4 ../../docs/demo/patch-demo.mp4
```

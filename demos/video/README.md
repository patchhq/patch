# Patch demo video (silent, auto-zoom)

Professional 42s silent walkthrough rendered with [Remotion](https://www.remotion.dev/).
No narration — camera zooms guide attention through the break → scan → report → CTA.

## Render

```bash
cd demos/video
pnpm install --ignore-workspace
pnpm render
```

Output: `demos/video/out/patch-demo.mp4` (1920×1080, H.264 **Main** / **yuv420p** / faststart).

The render step re-encodes with ffmpeg so the file opens in Windows Media Player, QuickTime, VLC, phones, etc. (Remotion’s default JPEG→`yuvj420p` often fails outside Chrome.)

Preview in the Remotion studio:

```bash
pnpm studio
```

## Type

- **Display** — JetBrains Mono italic 800  
- **Data** — JetBrains Mono 500  
- **Body** — Inter  

## Shots

1. Brand open — **Patch**
2. `ChargeOptions.currency` optional → required
3. Terminal: `npx -y @patch-dev/cli scan --dry-run` + match sites
4. Local report (Issue path / 55% heuristic)
5. Close on install CTA

Requires **ffmpeg** on PATH.

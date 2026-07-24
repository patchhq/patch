# Patch demo video (silent, auto-zoom)

Professional 42s silent walkthrough rendered with [Remotion](https://www.remotion.dev/).
No narration — camera zooms guide attention through the break → scan → report → CTA.

## Render

```bash
cd demos/video
pnpm install --ignore-workspace
pnpm render
```

Output: `out/patch-demo.mp4`. Copy into the docs tree for GitHub:

```bash
cp out/patch-demo.mp4 ../../docs/demo/patch-demo.mp4
```

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

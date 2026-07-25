# Patch demo video (silent explainer)

~40s silent walkthrough rendered with [Remotion](https://www.remotion.dev/).
No narration — simple beats explain **what Patch is** and **how it works**.

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

## Beats (~40s)

1. Brand — what Patch does in one sentence  
2. Problem — APIs break, packages go stale  
3. How it works — Watch → Detect → Fix → Ship  
4. What it covers — call-site API fixes + dependency updates  
5. Outcome — PR when sure, Issue when not  
6. CTA — `npx patch init`

Requires **ffmpeg** on PATH.

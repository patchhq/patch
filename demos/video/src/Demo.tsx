import React from 'react';
import {
  AbsoluteFill,
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { colors, fonts } from './theme';

export const DEMO_FPS = 30;
/** ~40s silent product explainer */
export const DEMO_DURATION_FRAMES = 30 * 40;
export const DEMO_WIDTH = 1920;
export const DEMO_HEIGHT = 1080;

function fade(
  frame: number,
  inStart: number,
  inEnd: number,
  outStart: number,
  outEnd: number,
) {
  return (
    interpolate(frame, [inStart, inEnd], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: Easing.out(Easing.cubic),
    }) *
    interpolate(frame, [outStart, outEnd], [1, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: Easing.in(Easing.cubic),
    })
  );
}

const Atmosphere: React.FC = () => (
  <AbsoluteFill
    style={{
      background: `
        radial-gradient(1200px 700px at 18% 12%, rgba(232, 165, 75, 0.14), transparent 55%),
        radial-gradient(900px 600px at 88% 78%, rgba(94, 207, 154, 0.1), transparent 50%),
        linear-gradient(160deg, #0a100e 0%, ${colors.ink} 45%, #101814 100%)
      `,
    }}
  >
    <AbsoluteFill
      style={{
        opacity: 0.3,
        backgroundImage: `linear-gradient(${colors.line} 1px, transparent 1px), linear-gradient(90deg, ${colors.line} 1px, transparent 1px)`,
        backgroundSize: '64px 64px',
        maskImage: 'radial-gradient(ellipse at center, black 20%, transparent 75%)',
      }}
    />
  </AbsoluteFill>
);

/** 0–4s — brand + one-line promise */
const Open: React.FC<{ frame: number }> = ({ frame }) => {
  const op = fade(frame, 0, 18, 95, 120);
  const y = interpolate(frame, [0, 28], [28, 0], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  return (
    <AbsoluteFill
      style={{
        opacity: op,
        justifyContent: 'center',
        alignItems: 'center',
        transform: `translateY(${y}px)`,
      }}
    >
      <div style={{ textAlign: 'center', maxWidth: 1100 }}>
        <div
          style={{
            fontFamily: fonts.display,
            fontStyle: 'italic',
            fontWeight: 800,
            fontSize: 128,
            letterSpacing: '-0.04em',
            color: colors.paper,
            lineHeight: 1,
          }}
        >
          Patch
        </div>
        <div
          style={{
            marginTop: 28,
            fontFamily: fonts.body,
            fontWeight: 400,
            fontSize: 28,
            color: colors.mist,
            lineHeight: 1.45,
          }}
        >
          When upstream APIs or dependencies change,
          <br />
          Patch finds the breakage and opens a fix.
        </div>
      </div>
    </AbsoluteFill>
  );
};

/** 4–10s — the problem, simplified */
const Problem: React.FC<{ frame: number }> = ({ frame }) => {
  const op = fade(frame, 110, 135, 270, 300);
  const { fps } = useVideoConfig();
  const a = spring({ frame: frame - 130, fps, config: { damping: 18 } });
  const b = spring({ frame: frame - 160, fps, config: { damping: 18 } });

  return (
    <AbsoluteFill style={{ opacity: op, justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ width: 1200 }}>
        <div
          style={{
            fontFamily: fonts.data,
            fontWeight: 500,
            fontSize: 16,
            letterSpacing: '0.14em',
            color: colors.amber,
            marginBottom: 18,
          }}
        >
          THE PROBLEM
        </div>
        <div
          style={{
            fontFamily: fonts.display,
            fontStyle: 'italic',
            fontWeight: 800,
            fontSize: 56,
            color: colors.paper,
            letterSpacing: '-0.03em',
            lineHeight: 1.15,
            marginBottom: 48,
          }}
        >
          Your dependencies move.
          <br />
          Your code doesn&apos;t.
        </div>
        <div style={{ display: 'flex', gap: 28 }}>
          <SimplePanel
            progress={a}
            title="API breaks"
            body="A required field appears. A method renames. Call sites stop compiling."
          />
          <SimplePanel
            progress={b}
            title="Stale packages"
            body="Versions drift. Advisories land. Lockfiles fall behind."
          />
        </div>
      </div>
    </AbsoluteFill>
  );
};

const SimplePanel: React.FC<{
  progress: number;
  title: string;
  body: string;
}> = ({ progress, title, body }) => (
  <div
    style={{
      flex: 1,
      opacity: progress,
      transform: `translateY(${(1 - progress) * 24}px)`,
      borderRadius: 16,
      border: `1px solid ${colors.panelEdge}`,
      background: colors.panel,
      padding: '28px 30px',
    }}
  >
    <div
      style={{
        fontFamily: fonts.display,
        fontStyle: 'italic',
        fontWeight: 800,
        fontSize: 28,
        color: colors.paper,
        marginBottom: 12,
      }}
    >
      {title}
    </div>
    <div
      style={{
        fontFamily: fonts.body,
        fontWeight: 400,
        fontSize: 20,
        color: colors.mist,
        lineHeight: 1.5,
      }}
    >
      {body}
    </div>
  </div>
);

/** 10–22s — how it works in four plain steps */
const HowItWorks: React.FC<{ frame: number }> = ({ frame }) => {
  const op = fade(frame, 290, 315, 640, 670);
  const steps = [
    { t: 'Watch', d: 'Connectors watch specs, SDKs, and package.json.' },
    { t: 'Detect', d: 'Patch diffs what changed since the last scan.' },
    { t: 'Fix', d: 'It proposes a patch and type-checks it in a sandbox.' },
    { t: 'Ship', d: 'Confident? Pull request. Unsure? GitHub Issue.' },
  ];

  return (
    <AbsoluteFill style={{ opacity: op, justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ width: 1180 }}>
        <div
          style={{
            fontFamily: fonts.data,
            fontWeight: 500,
            fontSize: 16,
            letterSpacing: '0.14em',
            color: colors.mint,
            marginBottom: 18,
          }}
        >
          HOW IT WORKS
        </div>
        <div
          style={{
            fontFamily: fonts.display,
            fontStyle: 'italic',
            fontWeight: 800,
            fontSize: 52,
            color: colors.paper,
            letterSpacing: '-0.03em',
            marginBottom: 40,
          }}
        >
          Four steps. One scheduled scan.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {steps.map((step, i) => {
            const appear = 330 + i * 55;
            const p = interpolate(frame, [appear, appear + 20], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
              easing: Easing.out(Easing.cubic),
            });
            return (
              <div
                key={step.t}
                style={{
                  opacity: p,
                  transform: `translateX(${(1 - p) * 28}px)`,
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 28,
                  padding: '18px 24px',
                  borderRadius: 12,
                  border: `1px solid ${colors.panelEdge}`,
                  background: 'rgba(20, 28, 24, 0.85)',
                }}
              >
                <div
                  style={{
                    fontFamily: fonts.data,
                    fontWeight: 500,
                    fontSize: 18,
                    color: colors.amber,
                    width: 36,
                  }}
                >
                  {String(i + 1).padStart(2, '0')}
                </div>
                <div
                  style={{
                    fontFamily: fonts.display,
                    fontStyle: 'italic',
                    fontWeight: 800,
                    fontSize: 30,
                    color: colors.paper,
                    width: 140,
                  }}
                >
                  {step.t}
                </div>
                <div
                  style={{
                    fontFamily: fonts.body,
                    fontWeight: 400,
                    fontSize: 22,
                    color: colors.mist,
                    flex: 1,
                  }}
                >
                  {step.d}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

/** 22–30s — what Patch covers */
const Covers: React.FC<{ frame: number }> = ({ frame }) => {
  const op = fade(frame, 660, 685, 870, 900);
  const { fps } = useVideoConfig();
  const left = spring({ frame: frame - 690, fps, config: { damping: 16 } });
  const right = spring({ frame: frame - 720, fps, config: { damping: 16 } });

  return (
    <AbsoluteFill style={{ opacity: op, justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ width: 1200 }}>
        <div
          style={{
            fontFamily: fonts.data,
            fontWeight: 500,
            fontSize: 16,
            letterSpacing: '0.14em',
            color: colors.amber,
            marginBottom: 18,
          }}
        >
          WHAT PATCH FIXES
        </div>
        <div
          style={{
            fontFamily: fonts.display,
            fontStyle: 'italic',
            fontWeight: 800,
            fontSize: 48,
            color: colors.paper,
            letterSpacing: '-0.03em',
            marginBottom: 40,
          }}
        >
          Two jobs. Same bot.
        </div>
        <div style={{ display: 'flex', gap: 28 }}>
          <CoverCard
            progress={left}
            kicker="Call sites"
            title="API breaking changes"
            lines={[
              'OpenAPI / SDK / docs connectors',
              'Finds every createCharge-style usage',
              'Rewrites the call, then typechecks',
            ]}
          />
          <CoverCard
            progress={right}
            kicker="package.json"
            title="Dependency updates"
            lines={[
              'Dependabot-style version bumps',
              'Patch + minor by default',
              'OSV security advisories → PRs',
            ]}
          />
        </div>
      </div>
    </AbsoluteFill>
  );
};

const CoverCard: React.FC<{
  progress: number;
  kicker: string;
  title: string;
  lines: string[];
}> = ({ progress, kicker, title, lines }) => (
  <div
    style={{
      flex: 1,
      opacity: progress,
      transform: `translateY(${(1 - progress) * 20}px)`,
      borderRadius: 16,
      border: `1px solid ${colors.panelEdge}`,
      background: colors.panel,
      padding: '32px 34px',
      minHeight: 320,
    }}
  >
    <div
      style={{
        fontFamily: fonts.data,
        fontWeight: 500,
        fontSize: 14,
        letterSpacing: '0.1em',
        color: colors.mint,
        marginBottom: 10,
      }}
    >
      {kicker.toUpperCase()}
    </div>
    <div
      style={{
        fontFamily: fonts.display,
        fontStyle: 'italic',
        fontWeight: 800,
        fontSize: 32,
        color: colors.paper,
        marginBottom: 22,
      }}
    >
      {title}
    </div>
    {lines.map((line) => (
      <div
        key={line}
        style={{
          fontFamily: fonts.body,
          fontWeight: 400,
          fontSize: 20,
          color: colors.mist,
          lineHeight: 1.55,
          marginBottom: 10,
          paddingLeft: 16,
          borderLeft: `2px solid ${colors.panelEdge}`,
        }}
      >
        {line}
      </div>
    ))}
  </div>
);

/** 30–36s — outcome */
const Outcome: React.FC<{ frame: number }> = ({ frame }) => {
  const op = fade(frame, 890, 915, 1050, 1080);
  return (
    <AbsoluteFill style={{ opacity: op, justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ textAlign: 'center', maxWidth: 1000 }}>
        <div
          style={{
            fontFamily: fonts.data,
            fontWeight: 500,
            fontSize: 16,
            letterSpacing: '0.14em',
            color: colors.mint,
            marginBottom: 20,
          }}
        >
          THE OUTCOME
        </div>
        <div
          style={{
            fontFamily: fonts.display,
            fontStyle: 'italic',
            fontWeight: 800,
            fontSize: 56,
            color: colors.paper,
            letterSpacing: '-0.03em',
            lineHeight: 1.2,
            marginBottom: 36,
          }}
        >
          A PR when it&apos;s sure.
          <br />
          An Issue when it isn&apos;t.
        </div>
        <div
          style={{
            fontFamily: fonts.body,
            fontWeight: 400,
            fontSize: 24,
            color: colors.mist,
            lineHeight: 1.5,
          }}
        >
          Confidence comes from real validation — not a guess.
        </div>
      </div>
    </AbsoluteFill>
  );
};

/** 36–40s — CTA */
const Closing: React.FC<{ frame: number }> = ({ frame }) => {
  const op = fade(frame, 1070, 1100, DEMO_DURATION_FRAMES - 8, DEMO_DURATION_FRAMES);
  const y = interpolate(frame, [1070, 1110], [24, 0], {
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  return (
    <AbsoluteFill
      style={{
        opacity: op,
        justifyContent: 'center',
        alignItems: 'center',
        transform: `translateY(${y}px)`,
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            fontFamily: fonts.display,
            fontStyle: 'italic',
            fontWeight: 800,
            fontSize: 84,
            color: colors.paper,
            letterSpacing: '-0.03em',
          }}
        >
          Patch
        </div>
        <div
          style={{
            marginTop: 18,
            fontFamily: fonts.body,
            fontWeight: 400,
            fontSize: 22,
            color: colors.mist,
          }}
        >
          Init once. Scan on a schedule. Review the PR.
        </div>
        <div
          style={{
            marginTop: 32,
            display: 'inline-block',
            fontFamily: fonts.data,
            fontWeight: 500,
            fontSize: 28,
            color: colors.ink,
            background: colors.amber,
            padding: '18px 32px',
            borderRadius: 12,
          }}
        >
          npx patch init
        </div>
        <div
          style={{
            marginTop: 20,
            fontFamily: fonts.data,
            fontWeight: 500,
            fontSize: 16,
            color: colors.mist,
          }}
        >
          npmjs.com/package/@patch-dev/cli
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const Demo: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{ backgroundColor: colors.ink }}>
      <Atmosphere />
      <Open frame={frame} />
      <Problem frame={frame} />
      <HowItWorks frame={frame} />
      <Covers frame={frame} />
      <Outcome frame={frame} />
      <Closing frame={frame} />
      <AbsoluteFill
        style={{
          pointerEvents: 'none',
          background:
            'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.35) 100%)',
        }}
      />
    </AbsoluteFill>
  );
};

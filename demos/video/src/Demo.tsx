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
export const DEMO_DURATION_FRAMES = 30 * 42; // 42s
export const DEMO_WIDTH = 1920;
export const DEMO_HEIGHT = 1080;

function fade(frame: number, inStart: number, inEnd: number, outStart: number, outEnd: number) {
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
        opacity: 0.35,
        backgroundImage: `linear-gradient(${colors.line} 1px, transparent 1px), linear-gradient(90deg, ${colors.line} 1px, transparent 1px)`,
        backgroundSize: '64px 64px',
        maskImage: 'radial-gradient(ellipse at center, black 20%, transparent 75%)',
      }}
    />
  </AbsoluteFill>
);

const BrandMark: React.FC<{ frame: number }> = ({ frame }) => {
  const op = fade(frame, 0, 18, 55, 75);
  const y = interpolate(frame, [0, 30], [24, 0], {
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
            fontSize: 132,
            letterSpacing: '-0.04em',
            color: colors.paper,
            lineHeight: 1,
          }}
        >
          Patch
        </div>
        <div
          style={{
            marginTop: 22,
            fontFamily: fonts.body,
            fontWeight: 400,
            fontSize: 22,
            color: colors.mist,
            letterSpacing: '0.02em',
          }}
        >
          upstream API breaks → fixed call sites
        </div>
      </div>
    </AbsoluteFill>
  );
};

const CodePanel: React.FC<{ frame: number }> = ({ frame }) => {
  const op = fade(frame, 80, 100, 240, 265);
  const broken = frame >= 130;
  return (
    <div
      style={{
        position: 'absolute',
        left: 96,
        top: 160,
        width: 760,
        opacity: op,
        borderRadius: 16,
        border: `1px solid ${colors.panelEdge}`,
        background: colors.panel,
        boxShadow: '0 30px 80px rgba(0,0,0,0.45)',
        overflow: 'hidden',
        fontFamily: fonts.data,
        fontWeight: 500,
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: 8,
          padding: '14px 18px',
          borderBottom: `1px solid ${colors.panelEdge}`,
          color: colors.mist,
          fontSize: 14,
          fontWeight: 500,
        }}
      >
        <span style={{ color: colors.danger }}>●</span>
        <span style={{ color: colors.amber }}>●</span>
        <span style={{ color: colors.mint }}>●</span>
        <span style={{ marginLeft: 12 }}>fake-api-client / ChargeOptions</span>
      </div>
      <div style={{ padding: '28px 32px', fontSize: 22, lineHeight: 1.65, color: colors.paper }}>
        <div>
          <span style={{ color: colors.mist }}>export interface</span>{' '}
          <span style={{ color: colors.amber }}>ChargeOptions</span> {'{'}
        </div>
        <div style={{ paddingLeft: 28 }}>
          amount: <span style={{ color: colors.mint }}>number</span>;
        </div>
        <div
          style={{
            paddingLeft: 28,
            marginTop: 6,
            padding: '8px 12px',
            marginLeft: 12,
            borderRadius: 8,
            background: broken ? 'rgba(224,112,96,0.12)' : 'rgba(232,165,75,0.08)',
            border: `1px solid ${broken ? 'rgba(224,112,96,0.35)' : 'rgba(232,165,75,0.25)'}`,
          }}
        >
          {broken ? (
            <>
              currency: <span style={{ color: colors.mint }}>string</span>;
              <span style={{ color: colors.danger, marginLeft: 16, fontSize: 16 }}>
                // required in v1.1
              </span>
            </>
          ) : (
            <>
              currency?: <span style={{ color: colors.mint }}>string</span>;
              <span style={{ color: colors.mist, marginLeft: 16, fontSize: 16 }}>
                // optional in v1.0
              </span>
            </>
          )}
        </div>
        <div>{'}'}</div>
      </div>
    </div>
  );
};

const Terminal: React.FC<{ frame: number }> = ({ frame }) => {
  const op = fade(frame, 250, 275, 930, 960);
  const lines = buildTerminalLines(frame);
  return (
    <div
      style={{
        position: 'absolute',
        right: 88,
        top: 140,
        width: 860,
        height: 620,
        opacity: op,
        borderRadius: 16,
        border: `1px solid ${colors.panelEdge}`,
        background: '#0a0f0d',
        boxShadow: '0 30px 80px rgba(0,0,0,0.5)',
        overflow: 'hidden',
        fontFamily: fonts.data,
        fontWeight: 500,
      }}
    >
      <div
        style={{
          padding: '14px 18px',
          borderBottom: `1px solid ${colors.panelEdge}`,
          color: colors.mist,
          fontSize: 14,
          display: 'flex',
          justifyContent: 'space-between',
          fontWeight: 500,
        }}
      >
        <span>patch scan — dry-run</span>
        <span style={{ color: colors.amber }}>@patch-dev/cli</span>
      </div>
      <div style={{ padding: '22px 26px', fontSize: 18, lineHeight: 1.55 }}>
        {lines.map((l, i) => (
          <div key={i} style={{ color: l.color, whiteSpace: 'pre' }}>
            {l.text}
          </div>
        ))}
        {frame > 280 && frame < 900 && (
          <div
            style={{
              display: 'inline-block',
              width: 10,
              height: 18,
              marginTop: 4,
              background: colors.mint,
              opacity: frame % 20 < 10 ? 1 : 0.2,
            }}
          />
        )}
      </div>
    </div>
  );
};

function buildTerminalLines(frame: number): Array<{ text: string; color: string }> {
  const out: Array<{ text: string; color: string }> = [];
  const push = (at: number, text: string, color = colors.paper) => {
    if (frame >= at) out.push({ text, color });
  };
  push(275, '$ npx patch scan --dry-run', colors.mist);
  push(300, 'Patch scan — 1 connector(s), languages: typescript', colors.paper);
  push(320, '', colors.paper);
  push(330, '▸ fixture-fake-api (package-diff)', colors.amber);
  push(350, '  4 raw change(s)', colors.mist);
  push(370, '  classified 1 event(s), 1 fix instruction(s)', colors.paper);
  push(400, '  ChargeOptions: 4 match site(s)', colors.mint);
  push(440, '    consumer-default.ts:6  confidence=55%  ✓', colors.paper);
  push(470, '    consumer-named.ts:6    confidence=55%  ✓', colors.paper);
  push(500, '    consumer-namespace.ts:6 confidence=55%  ✓', colors.paper);
  push(530, '    consumer-wrapper.ts:6  confidence=55%  ✓', colors.paper);
  push(580, '  dry-run report: .patch/reports/…md', colors.amber);
  push(620, '', colors.paper);
  push(640, 'Done.', colors.mint);
  return out;
}

const Report: React.FC<{ frame: number }> = ({ frame }) => {
  const op = fade(frame, 640, 670, 920, 950);
  const { fps } = useVideoConfig();
  const reveal = spring({
    frame: frame - 670,
    fps,
    config: { damping: 200, stiffness: 80 },
  });
  return (
    <div
      style={{
        position: 'absolute',
        left: 110,
        bottom: 90,
        width: 720,
        opacity: op,
        transform: `translateY(${(1 - reveal) * 40}px)`,
        borderRadius: 16,
        border: `1px solid ${colors.panelEdge}`,
        background: colors.panel,
        boxShadow: '0 24px 70px rgba(0,0,0,0.45)',
        padding: '28px 32px',
      }}
    >
      <div
        style={{
          fontFamily: fonts.data,
          fontWeight: 500,
          color: colors.amber,
          fontSize: 14,
          letterSpacing: '0.08em',
          marginBottom: 12,
        }}
      >
        LOCAL REPORT · BELOW PR THRESHOLD
      </div>
      <div
        style={{
          fontFamily: fonts.display,
          fontStyle: 'italic',
          fontWeight: 800,
          fontSize: 36,
          color: colors.paper,
          letterSpacing: '-0.02em',
          marginBottom: 18,
        }}
      >
        currency is now required
      </div>
      <div
        style={{
          fontFamily: fonts.body,
          fontWeight: 400,
          color: colors.mist,
          fontSize: 17,
          lineHeight: 1.6,
        }}
      >
        Patch found every{' '}
        <span style={{ fontFamily: fonts.data, fontWeight: 500, color: colors.mint }}>
          createCharge
        </span>{' '}
        call site, proposed adding{' '}
        <span style={{ fontFamily: fonts.data, fontWeight: 500, color: colors.amber }}>
          currency: 'usd'
        </span>
        , and type-checked each fix. Heuristic confidence 55% → Issue path (not auto-PR).
      </div>
      <div
        style={{
          marginTop: 22,
          display: 'flex',
          gap: 10,
          flexWrap: 'wrap',
          fontFamily: fonts.data,
          fontWeight: 500,
        }}
      >
        {['4 sites', 'tsc ✓', 'attempt 1', 'dry-run'].map((t) => (
          <span
            key={t}
            style={{
              fontSize: 14,
              color: colors.paper,
              border: `1px solid ${colors.panelEdge}`,
              borderRadius: 999,
              padding: '6px 12px',
              background: 'rgba(255,255,255,0.03)',
            }}
          >
            {t}
          </span>
        ))}
      </div>
    </div>
  );
};

const Closing: React.FC<{ frame: number }> = ({ frame }) => {
  const op = fade(frame, 950, 980, DEMO_DURATION_FRAMES - 5, DEMO_DURATION_FRAMES);
  const y = interpolate(frame, [950, 990], [28, 0], {
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
            fontSize: 88,
            color: colors.paper,
            letterSpacing: '-0.03em',
          }}
        >
          Patch
        </div>
        <div
          style={{
            marginTop: 28,
            display: 'inline-block',
            fontFamily: fonts.data,
            fontWeight: 500,
            fontSize: 26,
            color: colors.ink,
            background: colors.amber,
            padding: '16px 28px',
            borderRadius: 12,
            letterSpacing: '0.01em',
          }}
        >
          npx patch init
        </div>
        <div
          style={{
            marginTop: 22,
            fontFamily: fonts.body,
            fontWeight: 400,
            fontSize: 18,
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
      <BrandMark frame={frame} />
      <CodePanel frame={frame} />
      <Terminal frame={frame} />
      <Report frame={frame} />
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

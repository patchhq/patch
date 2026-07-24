import React from 'react';
import { Composition } from 'remotion';
import { Demo, DEMO_FPS, DEMO_DURATION_FRAMES, DEMO_WIDTH, DEMO_HEIGHT } from './Demo';

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="Demo"
      component={Demo}
      durationInFrames={DEMO_DURATION_FRAMES}
      fps={DEMO_FPS}
      width={DEMO_WIDTH}
      height={DEMO_HEIGHT}
    />
  );
};

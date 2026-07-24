import { loadFont as loadJetBrains } from '@remotion/google-fonts/JetBrainsMono';
import { loadFont as loadInter } from '@remotion/google-fonts/Inter';

// Display needs italic 800; data uses 500
const jetbrains = loadJetBrains('normal', {
  weights: ['500', '800'],
  subsets: ['latin'],
});
loadJetBrains('italic', {
  weights: ['800'],
  subsets: ['latin'],
});

const inter = loadInter('normal', {
  weights: ['400', '500'],
  subsets: ['latin'],
});

export const fonts = {
  /** Display: JetBrains Mono italic 800 */
  display: jetbrains.fontFamily,
  /** Data: JetBrains Mono 500 */
  data: jetbrains.fontFamily,
  /** Body: Inter */
  body: inter.fontFamily,
};

export const colors = {
  ink: '#0c1210',
  panel: '#141c18',
  panelEdge: '#1e2a24',
  mist: '#8fa397',
  paper: '#e8f0ea',
  amber: '#e8a54b',
  amberDim: '#b87a28',
  mint: '#5ecf9a',
  danger: '#e07060',
  line: 'rgba(232, 240, 234, 0.08)',
};

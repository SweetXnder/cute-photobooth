export type ThemeSeries = 'SpongeBob' | 'Big Hero 6' | 'Sanrio' | 'Mofusand';

export type ThemeId =
  | 'spongebob-besties'
  | 'spongebob-coral'
  | 'bighero6-care'
  | 'bighero6-mochi'
  | 'sanrio-duo'
  | 'sanrio-friends'
  | 'mofusand-shark'
  | 'mofusand-berry';

export type LayoutMode = '1x4' | '2x2';

export type FilterId =
  | 'none'
  | 'soft-peach'
  | 'vintage-film'
  | 'bw-purikura'
  | 'y2k-contrast'
  | 'idol-glow';

export type BoothEffectId =
  | 'none'
  | 'bulge'
  | 'pinch'
  | 'twirl'
  | 'mirror'
  | 'thermal'
  | 'xray'
  | 'pop-art';

export type FaceEffectId =
  | 'none'
  | 'cherry'
  | 'durian'
  | 'dragonfruit'
  | 'strawberry'
  | 'peach'
  | 'grape'
  | 'avocado'
  | 'watermelon'
  | 'pear'
  | 'kiwi'
  | 'pineapple'
  | 'banana';

export interface FaceEffectPreset {
  id: FaceEffectId;
  name: string;
  src: string;
  holeCx: number;
  holeCy: number;
  holeW: number;
  holeH: number;
}

export interface NormalizedFaceBox {
  cx: number;
  cy: number;
  w: number;
  h: number;
  angle: number;
}

export interface BoothEffectPreset {
  id: BoothEffectId;
  name: string;
}

export interface FilterPreset {
  id: FilterId;
  name: string;
  description: string;
  cssFilter: string;
  tintColor?: string;
  vignette?: boolean;
}

export interface FrameCharacterPlacement {
  src: string;
  /** Normalized 0..1 coordinates for 1x4 layout */
  x1x4: number;
  y1x4: number;
  w1x4: number;
  rot1x4: number;
  /** Normalized 0..1 coordinates for 2x2 layout */
  x2x2: number;
  y2x2: number;
  w2x2: number;
  rot2x2: number;
}

export type FramePatternType =
  | 'solid-minimal'
  | 'subtle-grid'
  | 'split-pastel'
  | 'soft-check'
  | 'fine-border';

export interface ThemeConfig {
  id: ThemeId;
  series: ThemeSeries;
  title: string;
  subtitle: string;
  previewThumb: string;
  bgPrimary: string;
  bgSecondary: string;
  slotBorderColor: string;
  accentColor: string;
  textColor: string;
  subTextColor: string;
  pattern: FramePatternType;
  headerTitle: string;
  defaultTagline: string;
  defaultDatestamp: string;
  placements: FrameCharacterPlacement[];
}

export interface BurstFrame {
  dataUrl: string;
  faceBoxes: NormalizedFaceBox[];
}

export interface CapturedPose {
  dataUrl: string | null;
  burstFrames: BurstFrame[];
  faceBoxes: NormalizedFaceBox[];
  /** Per-slot locked effects captured at shutter time */
  faceEffect: FaceEffectId;
  boothEffect: BoothEffectId;
}

export function createEmptyPose(): CapturedPose {
  return {
    dataUrl: null,
    burstFrames: [],
    faceBoxes: [],
    faceEffect: 'none',
    boothEffect: 'none',
  };
}

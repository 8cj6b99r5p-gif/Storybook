
export type StoryTheme = 'Watercolor' | 'Cartoon' | 'Pixel Art' | '3D Render' | 'Sketch' | 'Oil Painting';

export interface StoryPage {
  pageNumber: number;
  text: string;
  voiceoverText?: string;
  imagePrompt: string;
  imageData?: string; // Base64 string
  audioData?: string; // Base64 PCM string
  isGeneratingImage?: boolean;
  isGeneratingAudio?: boolean;
  hasError?: boolean;
}

export interface Character {
  id: string;
  name: string;
  imageData: string; // Base64 string
}

export interface Story {
  id: string;
  createdAt: number;
  title: string;
  lesson: string;
  pages: StoryPage[];
  theme?: StoryTheme;
  language?: string;
}

export enum AppState {
  IDLE = 'IDLE',
  CHARACTER_SETUP = 'CHARACTER_SETUP',
  GENERATING_STORY = 'GENERATING_STORY',
  VIEWING_BOOK = 'VIEWING_BOOK',
  VIEWING_LIBRARY = 'VIEWING_LIBRARY',
  ERROR = 'ERROR'
}

export interface ImageEditRequest {
  pageIndex: number;
  prompt: string;
}

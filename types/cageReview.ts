import type { ReviewLabels } from '../store/cageStore';

export type { ReviewLabels };

export interface ReviewSession {
  id: string;
  cage_session_id: string;
  mode: 'quick' | 'coach' | 'skim';
  started_at: number;
  completed_at: number | null;
  current_shot_index: number;
  shots_reviewed: string[];
  vocabulary_observations: string[];
}

export interface ReviewModeInfo {
  id: ReviewSession['mode'];
  title: string;
  description: string;
  time: string;
}

export const REVIEW_MODES: ReviewModeInfo[] = [
  {
    id: 'quick',
    title: 'Quick',
    description: 'One fast question per shot — good contact or not, and where on the face.',
    time: '~10 sec / shot',
  },
  {
    id: 'coach',
    title: 'Coach',
    description: 'Kevin digs in on notable shots — what you were working on, what you felt.',
    time: '30–60 sec / shot',
  },
  {
    id: 'skim',
    title: 'Skim',
    description: 'Kevin only asks about unlabeled shots. Skip the ones already tagged.',
    time: 'Varies',
  },
];

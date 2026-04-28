import type { FillerCategory } from '../types/filler';

export const FILLER_PHRASES: Array<{ id: string; category: FillerCategory; text: string }> = [
  // Tactical — yardage, club selection, course management questions
  { id: 'tactical_let_me_see',    category: 'tactical',       text: 'Let me see...' },
  { id: 'tactical_hmm_looking',   category: 'tactical',       text: 'Hmm, looking at it now...' },
  { id: 'tactical_alright_so',    category: 'tactical',       text: 'Alright, so...' },
  { id: 'tactical_one_sec',       category: 'tactical',       text: 'One sec...' },
  { id: 'tactical_okay_let_me',   category: 'tactical',       text: 'Okay, let me think...' },

  // Conversational — general questions, opinions, reflection
  { id: 'conv_hmm',               category: 'conversational', text: 'Hmm...' },
  { id: 'conv_yeah_so',           category: 'conversational', text: 'Yeah, so...' },
  { id: 'conv_well',              category: 'conversational', text: 'Well...' },
  { id: 'conv_alright',           category: 'conversational', text: 'Alright...' },
  { id: 'conv_okay_lets',         category: 'conversational', text: 'Okay, let me think about that...' },

  // Social — greetings, acknowledgments, light casual
  { id: 'social_hey',             category: 'social',         text: 'Hey...' },
  { id: 'social_alright_then',    category: 'social',         text: 'Alright then...' },
  { id: 'social_yeah',            category: 'social',         text: 'Yeah...' },

  // Ghost — match and comparison questions
  { id: 'ghost_let_me_check',     category: 'ghost',          text: 'Let me check that...' },
  { id: 'ghost_one_sec',          category: 'ghost',          text: 'One sec, looking at the match...' },
  { id: 'ghost_okay_so',          category: 'ghost',          text: 'Okay, so where we are...' },
];

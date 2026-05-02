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

  // ─── Phase P categories ─────────────────────────────────────────────────────
  // LOOKING — vision-based requests (lie analysis, hole layout)
  { id: 'looking_short',          category: 'looking',        text: 'Looking...' },
  { id: 'looking_let_me_see',     category: 'looking',        text: 'Let me see...' },
  { id: 'looking_one_sec',        category: 'looking',        text: 'One sec...' },
  { id: 'looking_at_this',        category: 'looking',        text: 'Looking at this...' },

  // THINKING — deep reasoning, strategic
  { id: 'thinking_yeah',          category: 'thinking',       text: 'Yeah, let me think about this...' },
  { id: 'thinking_hmm_okay',      category: 'thinking',       text: 'Hmm, okay...' },
  { id: 'thinking_good_q',        category: 'thinking',       text: 'Good question, hold on...' },
  { id: 'thinking_work_through',  category: 'thinking',       text: 'Let me work through this...' },

  // CHECKING — slightly-slow data lookup
  { id: 'checking_one_sec',       category: 'checking',       text: 'One sec...' },
  { id: 'checking_pulling_up',    category: 'checking',       text: 'Pulling that up...' },
  { id: 'checking_let_me',        category: 'checking',       text: 'Let me check...' },
  { id: 'checking_yeah_hold',     category: 'checking',       text: 'Yeah, hold on...' },

  // ANALYZING — post-session swing review
  { id: 'analyzing_swings',       category: 'analyzing',      text: 'Looking at those swings...' },
  { id: 'analyzing_break_down',   category: 'analyzing',      text: 'Let me break that down...' },
  { id: 'analyzing_saw',          category: 'analyzing',      text: 'Yeah, I saw something...' },

  // ACKNOWLEDGING — conversational opener
  { id: 'ack_yeah',               category: 'acknowledging',  text: 'Yeah...' },
  { id: 'ack_okay',               category: 'acknowledging',  text: 'Okay...' },
  { id: 'ack_mhm',                category: 'acknowledging',  text: 'Mhm...' },
  { id: 'ack_right',              category: 'acknowledging',  text: 'Right...' },

  // CONFIRMING — quick acknowledgment of action
  { id: 'conf_got_it',            category: 'confirming',     text: 'Got it.' },
  { id: 'conf_logged',            category: 'confirming',     text: 'Logged.' },
  { id: 'conf_on_it',             category: 'confirming',     text: 'On it.' },
  { id: 'conf_done',              category: 'confirming',     text: 'Done.' },

  // ENGAGING — Coach-mode opener for practice surfaces
  { id: 'eng_whats_up',           category: 'engaging',       text: "Yeah, what's up?" },
  { id: 'eng_talk_to_me',         category: 'engaging',       text: 'Talk to me...' },
  { id: 'eng_working_on',         category: 'engaging',       text: 'What are you working on?' },
  { id: 'eng_show_me',            category: 'engaging',       text: 'Show me...' },

  // CASUAL — Psychologist-mode between-shot opener
  { id: 'cas_whats_up',           category: 'casual',         text: "What's up?" },
  { id: 'cas_how_doing',          category: 'casual',         text: 'How you doing?' },
  { id: 'cas_talk',               category: 'casual',         text: 'Talk to me...' },
  { id: 'cas_yeah',               category: 'casual',         text: 'Yeah?' },
];

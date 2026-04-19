/**
 * CommandLibrary — canonical phrase bank for voice command recognition.
 *
 * Each key maps to an array of natural-language phrases a golfer might say.
 * Matching is substring-based (case-insensitive), so short unique substrings
 * take priority — place more specific phrases before broader ones within each
 * array to avoid accidental matches when used with a first-match engine.
 *
 * To add a new phrase: append to the relevant array.
 * To add a new intent:  add a new key here AND add a handler in
 *   useVoiceController + a CommandKey literal in CommandEngine.
 */

import type { CommandKey } from './CommandEngine';

export const COMMAND_LIBRARY: Record<CommandKey, string[]> = {

  // ── Distance ─────────────────────────────────────────────────────────────
  GET_DISTANCE: [
    "what's the distance",
    "how far is it",
    "how many yards",
    "how many meters",
    "pin distance",
    "flag distance",
    "how far to the pin",
    "how far to the flag",
    "how far to the green",
    "distance to the green",
    "how long is this",
    "what's the yardage",
    "yardage",
    "how far",
    "distance",
    "the number",
    "what's the number",
    "what's the carry",
    "carry distance",
    "number",
  ],

  // ── Club recommendation ───────────────────────────────────────────────────
  GET_CLUB: [
    "what should i hit",
    "what club should i use",
    "what club should i hit",
    "which club should i",
    "recommend a club",
    "suggest a club",
    "what do you like",
    "what are you thinking",
    "what iron should i",
    "what wood should i",
    "what hybrid should i",
    "what are you liking",
    "give me a club",
    "which club",
    "what club",
    "what iron",
    "what wood",
  ],

  // ── Caddie advice ─────────────────────────────────────────────────────────
  GET_ADVICE: [
    "what would you do",
    "what do you think",
    "what should i do here",
    "give me advice",
    "give me a tip",
    "any tips",
    "any advice",
    "caddie advice",
    "what's your advice",
    "what's your recommendation",
    "how should i play this",
    "how do i play this",
    "talk me through this",
    "help me out",
    "help me",
    "what should i do",
  ],

  // ── Log / record a shot ───────────────────────────────────────────────────
  LOG_SHOT: [
    "i just hit it",
    "i just hit",
    "just hit",
    "track that shot",
    "add that shot",
    "log that shot",
    "save that shot",
    "mark that shot",
    "log shot",
    "mark shot",
    "save shot",
    "add shot",
    "track that",
  ],

  // ── Record shot (alias — same handler as LOG_SHOT in controller) ──────────
  RECORD_SHOT: [
    "record that shot",
    "record shot",
  ],

  // ── Video recording ───────────────────────────────────────────────────────
  START_VIDEO: [
    "start recording my swing",
    "start recording",
    "record my swing",
    "record my shot",
    "film my swing",
    "film me",
    "video my swing",
    "video on",
    "record video",
    "capture this",
    "capture my swing",
    "record",
  ],

  // ── Photo ─────────────────────────────────────────────────────────────────
  TAKE_PHOTO: [
    "take a photo of this",
    "take a photo",
    "snap a photo",
    "take a picture",
    "snap a picture",
    "capture photo",
    "take photo",
    "snap photo",
    "picture",
  ],

  // ── Hole navigation ───────────────────────────────────────────────────────
  NEXT_HOLE: [
    "move on to the next hole",
    "go to the next hole",
    "advance to the next hole",
    "next hole",
    "advance hole",
    "move to next",
    "go to next",
  ],

  PREV_HOLE: [
    "go back to the previous hole",
    "back to the previous hole",
    "previous hole",
    "last hole",
    "go back a hole",
    "back one hole",
    "go back",
  ],

  // ── Putting ───────────────────────────────────────────────────────────────
  PUTT_MODE: [
    "i'm on the green",
    "i am on the green",
    "on the green",
    "read the green for me",
    "read the green",
    "putting mode",
    "putt mode",
    "green read",
    "putting",
  ],

  // ── Scorecard ─────────────────────────────────────────────────────────────
  SHOW_SCORECARD: [
    "what is my score",
    "show me my score",
    "show me the scorecard",
    "what's my score",
    "how am i doing",
    "how am i playing",
    "show score",
    "open scorecard",
    "scorecard",
    "my score",
    "scores",
  ],

  // ── Hole map / SmartVision ────────────────────────────────────────────────
  SHOW_MAP: [
    "show me the hole",
    "show me the map",
    "open the map",
    "smart vision",
    "show map",
    "hole map",
    "show the hole",
    "open map",
  ],
};

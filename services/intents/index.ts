import { VoiceCommandRouter } from '../voiceCommandRouter';
import { openToolHandler } from './openToolHandler';
import { queryStatusHandler } from './queryStatusHandler';
import { changeSettingHandler } from './changeSettingHandler';
import { acknowledgeHandler } from './acknowledgeHandler';
import { navigateHandler } from './navigateHandler';
import { openCourseHandler } from './openCourseHandler';
import { findMyDataHandler } from './findMyDataHandler';
import { helpHandler } from './helpHandler';
import { rulesQueryHandler } from './rulesQueryHandler';
import { handicapQueryHandler } from './handicapQueryHandler';
import { setTrustQuietHandler, setTrustCompanionHandler } from './setTrustQuietHandler';
import { clubChangeHandler, clubQueryHandler, clubMenuHandler } from './clubHandler';
import { logShotHandler } from './logShotHandler';
import { logScoreHandler } from './logScoreHandler';
import { logPuttsHandler } from './logPuttsHandler';
import { endRoundHandler } from './endRoundHandler';
import { mediaCaptureHandler, mediaPlaybackHandler, puttWatchHandler } from './mediaHandlers';
import { atBallHandler } from './atBallHandler';
import { logIssueHandler } from './logIssueHandler';
import { sequenceHandler } from './sequenceHandler';
import { sessionFocusHandler } from './sessionFocusHandler';
import { declareHoleHandler } from './declareHoleHandler';
import { askGolfFatherHandler } from './askGolfFatherHandler';
import { quickRoundHandler } from './quickRoundHandler';
import { openExternalHandler } from './openExternalHandler';
import { stateYardageHandler } from './stateYardageHandler';
import { refreshGpsHandler } from './refreshGpsHandler';
import { coachRefineHandler } from './coachRefineHandler';
import { positionDeclareHandler } from './positionDeclareHandler';
import { inRoundDiagnosticHandler } from './inRoundDiagnosticHandler';
import { confirmPositionHandler } from './confirmPositionHandler';
import { setHoleNoteHandler } from './setHoleNoteHandler';
import { socialGreetingHandler } from './socialGreetingHandler';
import { undoHandler } from './undoHandler';
import { correctLastShotHandler } from './correctLastShotHandler';

export const voiceCommandRouter = new VoiceCommandRouter();

voiceCommandRouter.registerHandler(openToolHandler);
voiceCommandRouter.registerHandler(queryStatusHandler);
voiceCommandRouter.registerHandler(changeSettingHandler);
voiceCommandRouter.registerHandler(acknowledgeHandler);
voiceCommandRouter.registerHandler(navigateHandler);
voiceCommandRouter.registerHandler(openCourseHandler);
voiceCommandRouter.registerHandler(findMyDataHandler);
voiceCommandRouter.registerHandler(helpHandler);
voiceCommandRouter.registerHandler(rulesQueryHandler);
voiceCommandRouter.registerHandler(handicapQueryHandler);
voiceCommandRouter.registerHandler(setTrustQuietHandler);
voiceCommandRouter.registerHandler(setTrustCompanionHandler);
voiceCommandRouter.registerHandler(clubChangeHandler);
voiceCommandRouter.registerHandler(clubQueryHandler);
voiceCommandRouter.registerHandler(clubMenuHandler);
voiceCommandRouter.registerHandler(logShotHandler);
voiceCommandRouter.registerHandler(logScoreHandler);
voiceCommandRouter.registerHandler(logPuttsHandler);
voiceCommandRouter.registerHandler(endRoundHandler);
voiceCommandRouter.registerHandler(mediaCaptureHandler);
voiceCommandRouter.registerHandler(mediaPlaybackHandler);
voiceCommandRouter.registerHandler(puttWatchHandler);
voiceCommandRouter.registerHandler(atBallHandler);
voiceCommandRouter.registerHandler(logIssueHandler);
voiceCommandRouter.registerHandler(sequenceHandler);
voiceCommandRouter.registerHandler(sessionFocusHandler);
voiceCommandRouter.registerHandler(declareHoleHandler);
voiceCommandRouter.registerHandler(askGolfFatherHandler);
voiceCommandRouter.registerHandler(quickRoundHandler);
voiceCommandRouter.registerHandler(openExternalHandler);
voiceCommandRouter.registerHandler(stateYardageHandler);
voiceCommandRouter.registerHandler(refreshGpsHandler);
voiceCommandRouter.registerHandler(coachRefineHandler);
voiceCommandRouter.registerHandler(positionDeclareHandler);
voiceCommandRouter.registerHandler(inRoundDiagnosticHandler);
voiceCommandRouter.registerHandler(confirmPositionHandler);
voiceCommandRouter.registerHandler(setHoleNoteHandler);
// 2026-07-31 (Tim — "make sure no preprogrammed voice is blocking; process everything optimally
// through the AI"). socialGreetingHandler returned a CANNED per-persona pool line for any greeting /
// check-in ("how are you", "hey Serena", even "nothing, just testing") — so the caddie deflected and
// repeated instead of actually answering, a robotic wall in front of the AI. UNREGISTERED so every
// greeting routes to the BRAIN (both the caddie-tab and hands-free paths fall through to the brain
// when there is no handler for the intent) → real, in-character, varied replies. The handler + its
// clip pools are left in the tree (unused) in case a cost-gated greeting shortcut is ever wanted back.
// voiceCommandRouter.registerHandler(socialGreetingHandler);
voiceCommandRouter.registerHandler(undoHandler);
voiceCommandRouter.registerHandler(correctLastShotHandler);

export {
  openToolHandler,
  queryStatusHandler,
  changeSettingHandler,
  acknowledgeHandler,
  navigateHandler,
  openCourseHandler,
  helpHandler,
  rulesQueryHandler,
  handicapQueryHandler,
  setTrustQuietHandler,
  setTrustCompanionHandler,
  clubChangeHandler,
  clubQueryHandler,
  clubMenuHandler,
  logShotHandler,
  logScoreHandler,
  mediaCaptureHandler,
  mediaPlaybackHandler,
  puttWatchHandler,
  atBallHandler,
  logIssueHandler,
  sequenceHandler,
  declareHoleHandler,
  askGolfFatherHandler,
  quickRoundHandler,
  openExternalHandler,
  stateYardageHandler,
  refreshGpsHandler,
  coachRefineHandler,
  positionDeclareHandler,
  inRoundDiagnosticHandler,
  confirmPositionHandler,
  setHoleNoteHandler,
  socialGreetingHandler,
};

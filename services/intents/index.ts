import { VoiceCommandRouter } from '../voiceCommandRouter';
import { openToolHandler } from './openToolHandler';
import { queryStatusHandler } from './queryStatusHandler';
import { changeSettingHandler } from './changeSettingHandler';
import { acknowledgeHandler } from './acknowledgeHandler';
import { navigateHandler } from './navigateHandler';
import { helpHandler } from './helpHandler';
import { rulesQueryHandler } from './rulesQueryHandler';
import { handicapQueryHandler } from './handicapQueryHandler';
import { setTrustQuietHandler, setTrustCompanionHandler } from './setTrustQuietHandler';
import { clubChangeHandler, clubQueryHandler, clubMenuHandler } from './clubHandler';
import { logShotHandler } from './logShotHandler';
import { logScoreHandler } from './logScoreHandler';
import { mediaCaptureHandler, mediaPlaybackHandler, puttWatchHandler } from './mediaHandlers';
import { atBallHandler } from './atBallHandler';
import { logIssueHandler } from './logIssueHandler';
import { sequenceHandler } from './sequenceHandler';
import { declareHoleHandler } from './declareHoleHandler';
import { askGolfFatherHandler } from './askGolfFatherHandler';
import { quickRoundHandler } from './quickRoundHandler';
import { openExternalHandler } from './openExternalHandler';

export const voiceCommandRouter = new VoiceCommandRouter();

voiceCommandRouter.registerHandler(openToolHandler);
voiceCommandRouter.registerHandler(queryStatusHandler);
voiceCommandRouter.registerHandler(changeSettingHandler);
voiceCommandRouter.registerHandler(acknowledgeHandler);
voiceCommandRouter.registerHandler(navigateHandler);
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
voiceCommandRouter.registerHandler(mediaCaptureHandler);
voiceCommandRouter.registerHandler(mediaPlaybackHandler);
voiceCommandRouter.registerHandler(puttWatchHandler);
voiceCommandRouter.registerHandler(atBallHandler);
voiceCommandRouter.registerHandler(logIssueHandler);
voiceCommandRouter.registerHandler(sequenceHandler);
voiceCommandRouter.registerHandler(declareHoleHandler);
voiceCommandRouter.registerHandler(askGolfFatherHandler);
voiceCommandRouter.registerHandler(quickRoundHandler);
voiceCommandRouter.registerHandler(openExternalHandler);

export {
  openToolHandler,
  queryStatusHandler,
  changeSettingHandler,
  acknowledgeHandler,
  navigateHandler,
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
};

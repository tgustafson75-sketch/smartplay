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
import { mediaCaptureHandler, mediaPlaybackHandler } from './mediaHandlers';
import { atBallHandler } from './atBallHandler';
import { logIssueHandler } from './logIssueHandler';

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
voiceCommandRouter.registerHandler(mediaCaptureHandler);
voiceCommandRouter.registerHandler(mediaPlaybackHandler);
voiceCommandRouter.registerHandler(atBallHandler);
voiceCommandRouter.registerHandler(logIssueHandler);

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
  mediaCaptureHandler,
  mediaPlaybackHandler,
  atBallHandler,
  logIssueHandler,
};

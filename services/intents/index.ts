import { VoiceCommandRouter } from '../voiceCommandRouter';
import { openToolHandler } from './openToolHandler';
import { queryStatusHandler } from './queryStatusHandler';
import { changeSettingHandler } from './changeSettingHandler';
import { acknowledgeHandler } from './acknowledgeHandler';
import { navigateHandler } from './navigateHandler';
import { helpHandler } from './helpHandler';

export const voiceCommandRouter = new VoiceCommandRouter();

voiceCommandRouter.registerHandler(openToolHandler);
voiceCommandRouter.registerHandler(queryStatusHandler);
voiceCommandRouter.registerHandler(changeSettingHandler);
voiceCommandRouter.registerHandler(acknowledgeHandler);
voiceCommandRouter.registerHandler(navigateHandler);
voiceCommandRouter.registerHandler(helpHandler);

export {
  openToolHandler,
  queryStatusHandler,
  changeSettingHandler,
  acknowledgeHandler,
  navigateHandler,
  helpHandler,
};

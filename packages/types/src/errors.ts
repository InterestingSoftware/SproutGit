/** Emitted by the main process for crashes/programmer errors it can't otherwise surface: uncaught exceptions, unhandled rejections, and renderer/child-process crashes. */
export type GlobalErrorEvent = {
  source: 'uncaughtException' | 'unhandledRejection' | 'renderProcessGone' | 'childProcessGone';
  message: string;
  stack?: string;
};

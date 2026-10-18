// DSH bundles this public entry point, while the renderer implementation is
// shared with the standalone local Web preview.
export {
  PixiPlayRenderer,
  loadBrowserFont,
  createPlaySession,
  PLAY_POLL_INTERVAL_MS,
  t,
  getLocale,
  getLanguagePreference,
  setLanguagePreference,
  subscribeLocale,
  localizePage,
  loadSystemLanguage,
  getSystemLanguage,
} from 'qxqy-studio/play/renderer'

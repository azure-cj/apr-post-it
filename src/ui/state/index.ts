/**
 * The app's state: one provider, and the hooks screens read it with.
 *
 *   const app = useApp();          // platform, settings, backend, directory, tracker, session, today()
 *   const user = useUser();        // who is signed in, on a guarded screen
 *   const notify = useNotify();    // notify('Copied. Paste it into Facebook.')
 *   const list = useDirectoryList();
 *   const posts = usePosts();      // { data, loading, error, loadedAt, reload }
 *
 * Errors from core arrive as UserFacingErrors whose message is the sentence to
 * show: show it as written (`sentenceOf` does, and covers the rest).
 */
export {
  AppStateProvider,
  DIRECTORY_REFRESH_MS,
  useApp,
  useNotify,
  type AppState,
  type AppStateProviderProps,
  type Notify,
  type Session,
} from './AppState';
export { manilaDate, manilaTime } from './clock';
export {
  useAssignments,
  useDirectoryList,
  useDirectoryStatus,
  useFindState,
  usePosts,
  useSavedFolder,
  useTeam,
  useUser,
  type RemoteOptions,
  type RemoteView,
} from './hooks';
export { createRemote, sentenceOf, UNEXPECTED, type Remote, type RemoteResource } from './remote';
export { createServices, EMPTY_FIND, forViewer, type DirectoryStatus, type FindState, type Services } from './services';
export { navKeys, paths, sectionOf, type FromList, type NavKey } from './routes';
export { defaultAppSettings, parseSettings, serializeSettings, SETTINGS_KEY, type AppSettings } from './settings';
export { createStore, useStore, type Store } from './store';

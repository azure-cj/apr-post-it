/**
 * The manager's screens: Assign, Tracker, Interns, Records and Settings. Presentational, like
 * the components: rows and callbacks come in as props, and nothing here calls
 * platform() or the backend. The arithmetic is core/summary's.
 */
export { AssignScreen, type AssignScreenProps, type QueueSave } from './AssignScreen';
export { RESULT_LIMIT } from './AssignSearch';
export { DayPicker, type DayPickerProps, type QuickDay } from './DayPicker';
export { InternsScreen, lastPostWords, type InternsScreenProps } from './InternsScreen';
export { SettingsScreen, type SettingsScreenProps } from './SettingsScreen';
export { LIST_LIMIT, TrackerScreen, type TrackerScreenProps } from './TrackerScreen';
export { RecordsScreen, postsCsv, RESULT_ROWS, type RecordsRange, type RecordsScreenProps } from './RecordsScreen';
export { FillQueues, type FillQueuesProps } from './FillQueues';

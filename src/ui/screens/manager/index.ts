/**
 * The manager's screens: Assign, Tracker and Settings. Presentational, like
 * the components: rows and callbacks come in as props, and nothing here calls
 * platform() or the backend. The arithmetic is core/summary's.
 */
export { AssignScreen, type AssignScreenProps, type QueueSave } from './AssignScreen';
export { RESULT_LIMIT } from './AssignSearch';
export { DayPicker, type DayPickerProps, type QuickDay } from './DayPicker';
export { SettingsScreen, type SettingsScreenProps } from './SettingsScreen';
export { LIST_LIMIT, TrackerScreen, type TrackerScreenProps } from './TrackerScreen';

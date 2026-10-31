/**
 * The component library: the checker's design system as React components.
 * Presentational only: data and callbacks come in as props, and nothing here
 * calls platform(). The rules each one carries are in DESIGN.md §10.
 */
export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from './Button';
export { Card, type CardProps } from './Card';
export { CheckList, type CheckListProps } from './CheckList';
export { Chip, type ChipProps } from './Chip';
export { EmptyState, type EmptyStateProps } from './EmptyState';
export { Icon, type IconName, type IconProps } from './Icon';
export { Notice, type NoticeProps, type NoticeTone } from './Notice';
export {
  Badge,
  CategoryDot,
  CategoryTag,
  Pill,
  categoryKind,
  categoryLabel,
  type BadgeProps,
  type CategoryKind,
  type CategoryTagProps,
  type PillProps,
  type Tone,
} from './Pill';
export { SearchBox, type SearchBoxProps } from './SearchBox';
export { Spinner, type SpinnerProps } from './Spinner';
export { TextInput, type TextInputProps } from './TextInput';
export {
  Toast,
  ToastRegion,
  toastDurations,
  useToasts,
  type ToastItem,
  type ToastProps,
  type ToastTone,
  type Toasts,
} from './Toast';
export {
  Sidebar,
  type SidebarNavItem,
  type SidebarProps,
  type SidebarUser,
} from './Sidebar';
export { TitleBar, WindowControls, type TitleBarProps, type WindowControlsProps } from './TitleBar';

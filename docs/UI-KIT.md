# APG Post-It — UI kit (WPF)

Everything a screen needs is in `src/PostIt.App/Theme/` and `src/PostIt.App/Controls/`. Use these keys only;
`tools/xaml_check.py` fails on unknown keys. Visual reference: `docs/mockups/*.png` (the agreed look).

## Page layout

* A page is a `UserControl` in `Views/Intern` or `Views/Manager`, root `d:DataContext="{d:DesignInstance Type=vm:XViewModel}"`.
* The shell already draws the top bar and sidebar. Your page fills the remaining area (about **1080 × 700** at the default
  window size, minimum ~880 × 600). Root element: a `Grid` of cards with **16 px gaps** (`Margin="0,0,16,0"` etc.).
* Card = `<Border Style="{StaticResource Card}">` (radius 16, padding 20). Card headings: `Text.Label` (gold capitals) or `Text.Title`.
* Long content scrolls **inside** a card: `<ScrollViewer VerticalScrollBarVisibility="Auto">`. Don't make the whole page scroll.
* WPF has no `Spacing`, no `Padding` on Grid/StackPanel, no `CornerRadius` on Grid/Button — use `Margin` on children and `Border`.

## Text styles (TextBlock)
| Key | Use |
|---|---|
| `Text.PageTitle` | 26 bold — page heading (optional; the shell shows no page title) |
| `Text.Title` | 20 bold — card/section title, property name |
| `Text.ItemTitle` | 16 semibold — list row title |
| `Text.Subtitle` | 15 muted, wraps |
| `Text.Body` | 14.5 cream, wraps |
| `Text.Muted` | 13.5 muted, wraps |
| `Text.Hint` | 12.5 dim, wraps |
| `Text.Label` | 12.5 bold gold — write the text in CAPITALS ("PRE-POST CHECKS") |
| `Text.FieldLabel` | 15 semibold — label above an input (has bottom margin) |
| `Text.Stat` | 30 bold number in a stat tile |
| `Text.TableHeader`, `Text.Cell` | table header (write in CAPITALS) and cell |
| `Text.Glyph` | icon font — `Text="{StaticResource Icon.Copy}"` |
| `Text.Mono` | monospace small |
| `Text.Avatar` | initials inside an `Avatar` border |

## Surfaces (Border)
`Card`, `Card.Tight`, `Item` (list row, has bottom margin 8), `Item.Selected` (gold border), `Item.Pinned` (amber, for Pending),
`StatTile`, `PublicBox` (green box for the public posting text), `InternalBox` (collapsed internal section), `Divider`
(1 px line with 14 px vertical margin), `Avatar` (30 px circle), `NumberCircle` (26 px circle), `Segment` (container for `Segment.Option`).

## Buttons
`Btn.Primary` (gold), `Btn.Secondary`, `Btn.Ghost`, `Btn.Danger` — height 44. Small: `Btn.Primary.Sm`, `Btn.Secondary.Sm`,
`Btn.Ghost.Sm` (34). `Btn.Icon` (34×34, put a `Text.Glyph` inside, set `ToolTip`). `Btn.Link` (blue text).
Full-width: `HorizontalAlignment="Stretch"` (default in a Grid/StackPanel). Disabled state is automatic from the command's CanExecute.

Icon + label:
```xml
<Button Style="{StaticResource Btn.Primary}" Command="{Binding CopyCommand}">
    <StackPanel Orientation="Horizontal">
        <TextBlock Style="{StaticResource Text.Glyph}" Text="{StaticResource Icon.Copy}" Margin="0,0,8,0" />
        <TextBlock Text="Copy" />
    </StackPanel>
</Button>
```

## Toggles
* Segmented (Today | This week, Posted | Pending): `Border Style="{StaticResource Segment}"` containing a horizontal StackPanel of
  `RadioButton Style="{StaticResource Segment.Option}" GroupName="…"`.
  Bind to an enum: `IsChecked="{Binding Status, Converter={StaticResource EnumEquals}, ConverterParameter=Pending}"`.
* Chips: `ToggleButton Style="{StaticResource Chip}"` or `RadioButton Style="{StaticResource Chip.Radio}"`.
* `CheckBox` (implicit style).

## Inputs
* `TextBox` (implicit): placeholder via `Tag="Paste the post link"`. Always bind
  `Text="{Binding X, UpdateSourceTrigger=PropertyChanged}"`.
* `TextBox.Search` (magnifier glyph), `TextBox.Multiline` (pasted lists; set `Height`), `TextBox.ReadOnly` (selectable plain text).
* `ComboBox` (implicit). Editable “pick or type”: `IsEditable="True" ItemsSource="{Binding Accounts}" Text="{Binding FbAccount, UpdateSourceTrigger=PropertyChanged}"`.
* No DatePicker: use a ◀ date ▶ stepper (two `Btn.Icon` with `Icon.ChevronLeft/Right`) plus `Chip.Radio` quick picks.

## Custom controls (`xmlns:ui="clr-namespace:PostIt.App.Controls"`)
* `<ui:Badge Kind="ok|pending|cool|todo|neutral|cat|gold|info" ShowDot="True" Content="Posted"/>`
  — ok = green, pending = amber, cool = red (cooldown/never/fail), todo/neutral = grey, cat = gold text (category),
  gold = solid gold, info = blue. From a domain value: `Kind="{Binding Status, Converter={StaticResource BadgeKind}}"`
  (AssignmentStatus, PostStatus, CheckStatus, CooldownState, bool) — or expose a `BadgeKind` string from the view-model.
* `<ui:Alert Kind="ok|warn|error|info"><TextBlock TextWrapping="Wrap">…</TextBlock></ui:Alert>` — icon by kind, cream text.
* `<ui:StepChips ActiveStep="2"/>` — the Find · Copy · Post · Log chips (earlier steps show as done).

## Converters (keys)
`BoolToVis`, `BoolToVisInverted`, `NullToCollapsed`, `NullToVisible`, `EmptyToCollapsed` (null/""/0/empty list → Collapsed),
`EmptyToVisible`, `InvertBool`, `EnumEquals`, `BadgeKind`, `CheckGlyph` + `CheckBrush` + `CheckBgBrush` (CheckStatus → ✓/!/✕ and colours),
`Thumbnail` (file path → image; `ConverterParameter=320` decode width).

## Brushes / fonts / icons
`Brush.Bg Panel Panel2 Input Line Line2 Gold GoldDim GoldSoft Cream Muted Muted2 Ink Hover Green GreenBg GreenLine Amber AmberBg
AmberLine Red RedBg RedLine Blue BlueBg BlueLine` (all `Brush.` prefixed). Fonts: `AppFont`, `IconFont`, `MonoFont`.
Icons (`Icon.` prefix): Search Copy Lock Download Folder FolderOpen Link Save Add Close Check CheckCircle Warning Error Info Clock
Calendar Settings People AddPerson List Chart CheckList ChevronLeft ChevronRight ChevronUp ChevronDown ArrowUp ArrowDown Back Forward
OpenExternal Photo Paste SwitchUser Refresh Pin Edit Delete Share Shield Document Tag MapPin Home.

## Patterns
**Lists.** `ItemsControl` + `DataTemplate DataType="{x:Type vm:RowViewModel}"` (DataType is required — the checker uses it).
A command on the page view-model from inside a row:
```xml
<Button Command="{Binding DataContext.OpenCommand, RelativeSource={RelativeSource AncestorType=UserControl}}"
        CommandParameter="{Binding}" … />
```
Prefer giving row view-models their own commands (simpler bindings).

**Tables.** No DataGrid. Header row = `Grid` with fixed `ColumnDefinition`s; each row = the same column widths in the item template,
separated by a `Border` with `BorderThickness="0,0,0,1" BorderBrush="{StaticResource Brush.Line}"`.

**Photos (rounded).**
```xml
<Rectangle RadiusX="10" RadiusY="10" Height="120">
    <Rectangle.Fill>
        <ImageBrush ImageSource="{Binding Path, Converter={StaticResource Thumbnail}, ConverterParameter=360}" Stretch="UniformToFill" />
    </Rectangle.Fill>
</Rectangle>
```

**Rich text.** `<TextBlock><Run Text="Not saved. " FontWeight="Bold"/><Run Text="{Binding Message, Mode=OneWay}"/></TextBlock>`
— `Run.Text` bindings **must** say `Mode=OneWay`.

**Formatting.** View-models expose ready-to-show strings ("Last posted 3 Oct · 26 days ago"); XAML does no date maths.

**Empty / loading.** Show a friendly empty state from a bool on the view-model
(`Visibility="{Binding IsEmpty, Converter={StaticResource BoolToVis}}"`) and nothing fancy for loading (the data is local and fast).

**Tooltips on disabled buttons** need `ToolTipService.ShowOnDisabled="True"` on the button.

## Gotchas that break the build or the screen
* `x:Bind`, `x:DataType`, `Spacing`, `PlaceholderText`, `CornerRadius` on Grid/Button, `MaxLines` on TextBlock — not WPF.
* `{StaticResource}` keys must exist (see above) or be defined earlier in the same file's `Resources`.
* Bindings to read-only properties from TwoWay targets (TextBox.Text, IsChecked, SelectedItem, Run.Text) need `Mode=OneWay`.
* Every `.xaml` keeps its `x:Class` + `.xaml.cs` partial class with `InitializeComponent()`. No event handlers in XAML — use commands.
* `&` must be written `&amp;` in XAML attribute text; `<` as `&lt;`.

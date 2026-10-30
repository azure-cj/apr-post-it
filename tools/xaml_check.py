#!/usr/bin/env python3
"""Static checks for the WPF XAML in src/PostIt.App — a stand-in for the WPF compiler, which
can't run off Windows. Catches the mistakes that most often break a WPF build or silently break
a screen at run time:

  * malformed XML, x:Class without a matching code-behind class
  * {StaticResource Key} / {DynamicResource Key} with no such key in the theme or the file
  * elements/attributes that don't exist in WPF (Spacing, CornerRadius on Grid, x:Bind, PlaceholderText…)
  * custom element types (ui:, vm:, core:, p:) that don't exist in the C# sources
  * {Binding Path} whose first segments are not public properties of the DataContext type:
        root   → d:DataContext="{d:DesignInstance Type=vm:XViewModel}"
        inside <DataTemplate DataType="{x:Type prefix:T}"> → T
  * TwoWay-by-default bindings (TextBox.Text, IsChecked, SelectedItem…) to properties with no setter
  * <Run Text="{Binding …}"> without Mode=OneWay (throws at run time on read-only properties)
  * TextBox.Text bound without UpdateSourceTrigger=PropertyChanged (warning)
  * event handlers in XAML (Click="…") that are missing from code-behind

Usage:  python3 tools/xaml_check.py [file.xaml ...]      (default: every .xaml under src/PostIt.App)
Exit code 1 when there are errors.
"""
import os, re, sys
import xml.etree.ElementTree as ET

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..'))
APP = os.path.join(ROOT, 'src', 'PostIt.App')
CS_DIRS = [os.path.join(ROOT, 'src', d) for d in ('PostIt.Core', 'PostIt.Presentation', 'PostIt.App')]

WPF_NS = 'http://schemas.microsoft.com/winfx/2006/xaml/presentation'
X_NS = 'http://schemas.microsoft.com/winfx/2006/xaml'
D_NS = 'http://schemas.microsoft.com/expression/blend/2008'
MC_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006'

WPF_ELEMENTS = set('''
Grid StackPanel DockPanel WrapPanel Canvas UniformGrid VirtualizingStackPanel Border Decorator Viewbox AdornerDecorator
TextBlock TextBox PasswordBox RichTextBox Label Button ToggleButton RadioButton CheckBox RepeatButton ComboBox ComboBoxItem
ListBox ListBoxItem ListView ListViewItem GridView GridViewColumn ItemsControl ItemsPresenter ScrollViewer ScrollBar Thumb Track
Image Ellipse Rectangle Path Line Polygon Polyline ContentControl ContentPresenter HeaderedContentControl UserControl Window Page
Run LineBreak Hyperlink Span Bold Italic Underline InlineUIContainer Separator ProgressBar Slider ToolTip Popup Expander GroupBox
TabControl TabItem DatePicker Calendar DataGrid DataGridTextColumn DataGridTemplateColumn GridSplitter StatusBar StatusBarItem
Menu MenuItem ContextMenu
DataTemplate ControlTemplate ItemsPanelTemplate HierarchicalDataTemplate Style Setter Trigger DataTrigger MultiTrigger MultiDataTrigger
Condition EventTrigger EventSetter ResourceDictionary RowDefinition ColumnDefinition
SolidColorBrush LinearGradientBrush RadialGradientBrush GradientStop ImageBrush VisualBrush DrawingBrush
DropShadowEffect BlurEffect TranslateTransform ScaleTransform RotateTransform SkewTransform TransformGroup MatrixTransform
Binding MultiBinding PriorityBinding KeyBinding MouseBinding InputBindings
Storyboard DoubleAnimation ColorAnimation ThicknessAnimation BeginStoryboard StopStoryboard
FontFamily Thickness CornerRadius Color Point GeometryGroup RectangleGeometry EllipseGeometry PathGeometry
CollectionViewSource BooleanToVisibilityConverter Application
'''.split())

# Attached-property owners allowed as "Owner.Prop" attributes.
ATTACHED_OWNERS = set('''Grid DockPanel Canvas Panel ScrollViewer TextElement TextBlock RenderOptions KeyboardNavigation
ToolTipService Validation TextOptions VirtualizingPanel VirtualizingStackPanel FocusManager InputMethod Typography
SpellCheck ContextMenuService AutomationProperties Stylus Selector ItemsControl Keyboard UIElement FrameworkElement Control
Border Button Window DesignInstance'''.split())

# Attributes that look plausible but do not exist on these WPF elements (common WinUI/Avalonia/MAUI/HTML habits).
FORBIDDEN = {
    '*': {'Spacing', 'RowSpacing', 'ColumnSpacing', 'PlaceholderText', 'Placeholder', 'IsVisible', 'CharacterSpacing',
          'LetterSpacing', 'Classes', 'Gap', 'HorizontalTextAlignment', 'VerticalTextAlignment', 'BoxShadow'},
    'Grid': {'CornerRadius', 'Padding', 'Orientation', 'BorderBrush', 'BorderThickness'},
    'StackPanel': {'CornerRadius', 'Padding', 'BorderBrush', 'BorderThickness'},
    'DockPanel': {'CornerRadius', 'Padding', 'BorderBrush'},
    'WrapPanel': {'CornerRadius', 'Padding'},
    'Button': {'CornerRadius', 'Text'},
    'TextBlock': {'MaxLines', 'CornerRadius', 'BorderBrush', 'BorderThickness', 'Command'},
    'TextBox': {'CornerRadius', 'Header', 'Watermark'},
    'ComboBox': {'PlaceholderText', 'Header', 'CornerRadius'},
    'Border': {'Command', 'ItemsSource', 'Text', 'Orientation'},
    'Image': {'CornerRadius'},
    'ItemsControl': {'Orientation', 'Spacing', 'CornerRadius'},
    'ProgressBar': {'CornerRadius'},
}

# Target properties that bind TwoWay by default in WPF.
TWOWAY = {('TextBox', 'Text'), ('CheckBox', 'IsChecked'), ('RadioButton', 'IsChecked'), ('ToggleButton', 'IsChecked'),
          ('ComboBox', 'SelectedItem'), ('ComboBox', 'Text'), ('ComboBox', 'SelectedValue'), ('ComboBox', 'SelectedIndex'),
          ('ListBox', 'SelectedItem'), ('ListBox', 'SelectedIndex'), ('Slider', 'Value'), ('Expander', 'IsExpanded'),
          ('TabControl', 'SelectedIndex'), ('TabControl', 'SelectedItem'), ('PasswordBox', 'Password'), ('Run', 'Text'),
          ('Popup', 'IsOpen'), ('DatePicker', 'SelectedDate'), ('ProgressBar', 'Value')}


# ----------------------------------------------------------------------------- C# index
class CsType:
    def __init__(self, name, ns):
        self.name, self.ns, self.props, self.bases = name, ns, {}, []  # props: name -> (type, has_setter)


def strip_generic(t):
    t = t.strip().rstrip('?')
    m = re.match(r'(?:I?ReadOnly)?(?:ObservableCollection|List|IReadOnlyList|IList|IEnumerable|ICollection|IReadOnlyCollection)<(.+)>$', t)
    return m.group(1).strip().rstrip('?') if m else t


def index_cs():
    types = {}
    for d in CS_DIRS:
        for dp, _, files in os.walk(d):
            if os.sep + 'obj' in dp or os.sep + 'bin' in dp:
                continue
            for f in files:
                if not f.endswith('.cs'):
                    continue
                src = open(os.path.join(dp, f), encoding='utf-8').read()
                nsm = re.search(r'namespace\s+([\w.]+)', src)
                ns = nsm.group(1) if nsm else ''
                # split per type declaration
                for m in re.finditer(r'(?:public|internal)\s+(?:sealed\s+|abstract\s+|static\s+|partial\s+)*(class|record|enum|interface|struct)\s+(\w+)(<[^>]+>)?\s*(\(([^)]*)\))?\s*(:\s*([^{\n]+))?', src):
                    kind, name, _, _, params, _, bases = m.groups()
                    t = types.get(name) or CsType(name, ns)
                    types[name] = t
                    if bases:
                        for b in re.split(r',(?![^<]*>)', bases):
                            b = re.sub(r'\(.*', '', b).strip()
                            if b:
                                t.bases.append(re.sub(r'<.*', '', b))
                    if kind == 'record' and params:
                        for p in re.split(r',(?![^<]*>)', params):
                            p = re.sub(r'\s*=.*', '', p.strip())
                            p = re.sub(r'^\[[^\]]*\]\s*', '', p)
                            parts = p.rsplit(' ', 1)
                            if len(parts) == 2:
                                t.props[parts[1]] = (parts[0].strip(), True)
                    # body: from this match to the next top-level type keyword (approximation)
                    start = m.end()
                    nxt = re.search(r'\n(?:public|internal)\s+(?:sealed\s+|abstract\s+|static\s+|partial\s+)*(?:class|record|enum|interface|struct)\s+\w+', src[start:])
                    body = src[start:start + nxt.start()] if nxt else src[start:]
                    if kind == 'enum':
                        continue
                    for pm in re.finditer(r'public\s+(?:override\s+|virtual\s+|new\s+|required\s+|abstract\s+)*([\w<>\[\]?,. ]+?)\s+(\w+)\s*(\{[^}]*\}|=>)', body):
                        ptype, pname, rest = pm.groups()
                        if ptype.split()[-1] in ('class', 'record', 'void', 'event', 'static') or pname in ('get', 'set'):
                            continue
                        has_set = rest.startswith('{') and ('set' in rest or 'init' in rest)
                        t.props.setdefault(pname, (ptype.strip(), has_set))
    # well-known framework bases
    for name, props in {'ObservableObject': {}, 'Exception': {'Message': ('string', False)}}.items():
        types.setdefault(name, CsType(name, ''))
        types[name].props.update(props)
    return types


def find_prop(types, tname, pname, seen=None):
    seen = seen or set()
    t = types.get(tname)
    if not t or tname in seen:
        return None
    seen.add(tname)
    if pname in t.props:
        return t.props[pname]
    for b in t.bases:
        r = find_prop(types, b, pname, seen)
        if r:
            return r
    return None


def known_type_with_unknown_base(types, tname):
    t = types.get(tname)
    if not t:
        return True
    return any(b not in types and not b.startswith('I') for b in t.bases)


# ----------------------------------------------------------------------------- resource keys
def theme_keys():
    keys = set()
    for rel in ('Theme/Colors.xaml', 'Theme/Controls.xaml', 'App.xaml', 'MainWindow.xaml', 'Views/ViewTemplates.xaml'):
        p = os.path.join(APP, rel)
        if os.path.exists(p):
            keys |= set(re.findall(r'x:Key="([^"]+)"', open(p, encoding='utf-8').read()))
    return keys


# ----------------------------------------------------------------------------- checks
def ns_map(path):
    m = {}
    for ev, (prefix, uri) in ET.iterparse(path, events=['start-ns']):
        m[prefix] = uri
    return m


def local(tag):
    return tag.split('}', 1)[1] if '}' in tag else tag


def parse_binding(expr):
    """'{Binding Foo.Bar, Mode=OneWay}' -> (path or None, dict of options)"""
    inner = expr.strip()[1:-1].strip()
    m = re.match(r'Binding\b(.*)$', inner, re.S)
    if not m:
        return None, None
    rest = m.group(1).strip()
    # split on commas not inside braces
    parts, depth, cur = [], 0, ''
    for ch in rest:
        if ch == '{': depth += 1
        if ch == '}': depth -= 1
        if ch == ',' and depth == 0:
            parts.append(cur); cur = ''
        else:
            cur += ch
    if cur.strip():
        parts.append(cur)
    path, opts = None, {}
    for i, p in enumerate(parts):
        p = p.strip()
        if '=' in p and not p.startswith('{'):
            k, v = p.split('=', 1)
            opts[k.strip()] = v.strip()
        elif i == 0 and p:
            path = p
    if 'Path' in opts:
        path = opts['Path']
    return path, opts


def check_file(path, types, keys):
    errors, warns = [], []
    rel = os.path.relpath(path, ROOT)
    src = open(path, encoding='utf-8').read()
    try:
        tree = ET.parse(path)
    except ET.ParseError as e:
        return [f'{rel}: XML error: {e}'], []
    nsm = ns_map(path)
    prefix_of = {v: k for k, v in nsm.items()}
    root = tree.getroot()
    local_keys = set(re.findall(r'x:Key="([^"]+)"', src))

    # x:Class ↔ code-behind
    xclass = root.get(f'{{{X_NS}}}Class')
    if xclass and not path.endswith('App.xaml'):
        cb = path + '.cs'
        cls = xclass.rsplit('.', 1)[-1]
        if not os.path.exists(cb):
            errors.append(f'{rel}: x:Class {xclass} but no {os.path.basename(cb)}')
        elif not re.search(rf'partial\s+class\s+{cls}\b', open(cb, encoding="utf-8").read()):
            errors.append(f'{rel}: code-behind does not declare partial class {cls}')
    codebehind = open(path + '.cs', encoding='utf-8').read() if os.path.exists(path + '.cs') else ''

    def clr_type(prefix, name):
        uri = nsm.get(prefix, '')
        if uri.startswith('clr-namespace:') and 'PostIt' in uri:
            if name not in types:
                errors.append(f'{rel}: type {prefix}:{name} not found in C# sources')
                return None
            return name
        return None

    def resolve_type_ext(val):
        m = re.match(r'\{x:Type\s+(?:Type=)?(\w+):(\w+)\}', val or '')
        if m:
            return clr_type(m.group(1), m.group(2))
        m = re.match(r'\{d:DesignInstance\s+(?:Type=)?(\w+):(\w+)', val or '')
        if m:
            return clr_type(m.group(1), m.group(2))
        return None

    root_ctx = resolve_type_ext(root.get(f'{{{D_NS}}}DataContext'))
    if root.tag.endswith('UserControl') and not root_ctx:
        warns.append(f'{rel}: root has no d:DataContext DesignInstance — bindings not checked')

    def check_path(ctx, pathexpr, elem_name, attr, opts):
        if not ctx or not pathexpr or pathexpr in ('.',) or pathexpr.startswith('('):
            return
        segs = re.split(r'\.', re.sub(r'\[[^\]]*\]', '', pathexpr))
        t = ctx
        for i, seg in enumerate(segs):
            if not seg:
                continue
            if t is None or t not in types:
                return
            p = find_prop(types, t, seg)
            if p is None and seg in ('Count', 'Length') and i > 0:
                return  # Count/Length of a collection or string property: fine
            if p is None:
                if known_type_with_unknown_base(types, t) or t in ('string', 'object'):
                    return
                errors.append(f'{rel}: <{elem_name} {attr}="{{Binding {pathexpr}}}"> — {t} has no public property "{seg}"')
                return
            ptype, has_set = p
            last = i == len(segs) - 1
            if last and (elem_name, attr) in TWOWAY and opts.get('Mode', '') not in ('OneWay', 'OneTime') and not has_set:
                errors.append(f'{rel}: <{elem_name} {attr}="{{Binding {pathexpr}}}"> binds TwoWay by default but {t}.{seg} has no setter — add Mode=OneWay or a setter')
            raw = re.sub(r'.*\.', '', ptype.strip().rstrip('?'))
            is_collection = raw != strip_generic(ptype)
            nt = re.sub(r'.*\.', '', strip_generic(ptype))
            if is_collection:
                # Next segment addresses the collection itself (Count/Length) — element type only via an indexer.
                nxt = segs[i + 1] if i + 1 < len(segs) else None
                if nxt in ('Count', 'Length'):
                    return
                t = nt if nt in types else None
            else:
                t = nt if nt in types else None

    def walk(el, ctx, in_resources):
        name = local(el.tag)
        uri = el.tag[1:].split('}')[0] if el.tag.startswith('{') else ''
        is_prop_element = '.' in name
        if not is_prop_element:
            if uri == WPF_NS and name not in WPF_ELEMENTS:
                warns.append(f'{rel}: <{name}> is not in the checker\'s list of WPF elements — double-check it exists in WPF')
            elif uri.startswith('clr-namespace:') and 'PostIt' in uri:
                clr_type(prefix_of.get(uri, '?'), name)
            elif uri == X_NS and name not in ('Array', 'Static', 'Null', 'Type', 'String', 'Code', 'XData'):
                errors.append(f'{rel}: <x:{name}> is not valid in WPF XAML')
        else:
            owner = name.split('.')[0]
            if name.endswith('.Resources'):
                in_resources = True

        new_ctx = ctx
        if name == 'DataTemplate':
            dt = el.get('DataType')
            new_ctx = resolve_type_ext(dt) if dt else None
            if not dt and not in_resources:
                warns.append(f'{rel}: <DataTemplate> without DataType — its bindings are not checked')

        for akey, aval in el.attrib.items():
            aname = local(akey)
            ans = akey[1:].split('}')[0] if akey.startswith('{') else ''
            if ans == X_NS and aname in ('DataType', 'Bind'):
                errors.append(f'{rel}: x:{aname} is UWP/MAUI-only — WPF uses DataType="{{x:Type …}}" on DataTemplate')
            if '{x:Bind' in aval:
                errors.append(f'{rel}: {{x:Bind}} is not WPF — use {{Binding}}')
            if ans in (D_NS, MC_NS):
                continue
            if not ans and not is_prop_element:
                if '.' in aname:
                    owner = aname.split('.')[0]
                    if owner not in ATTACHED_OWNERS and owner not in types:
                        warns.append(f'{rel}: attached property {aname} on <{name}> — unusual owner')
                else:
                    bad = FORBIDDEN.get('*', set()) | FORBIDDEN.get(name, set())
                    if aname in bad:
                        errors.append(f'{rel}: <{name}> has no property "{aname}" in WPF')
                # event handler?
                if re.match(r'^[A-Z]\w*$', aval or '') and aname in ('Click', 'Loaded', 'TextChanged', 'SelectionChanged',
                        'MouseDown', 'MouseLeftButtonDown', 'MouseLeftButtonUp', 'KeyDown', 'PreviewKeyDown', 'Checked',
                        'Unchecked', 'GotFocus', 'LostFocus', 'PreviewMouseLeftButtonDown', 'MouseDoubleClick', 'Unloaded'):
                    if not re.search(rf'\b{aval}\s*\(', codebehind):
                        errors.append(f'{rel}: event handler {aname}="{aval}" missing from code-behind')
            for km in re.finditer(r'\{(StaticResource|DynamicResource)\s+([^}\s]+)\}', aval or ''):
                k = km.group(2)
                if k.startswith('{') or k.startswith('x:'):
                    continue
                if k not in keys and k not in local_keys:
                    errors.append(f'{rel}: {km.group(1)} "{k}" not defined (see docs/UI-KIT.md)')
            if aval and aval.strip().startswith('{Binding'):
                if 'RelativeSource' in aval or 'ElementName' in aval or 'Source=' in aval:
                    m = re.search(r'Binding\s+(?:Path=)?DataContext\.([\w.]+)', aval)
                    if m and 'AncestorType=UserControl' in aval.replace(' ', '').replace('{x:Type', '').replace('}', '') or (m and 'AncestorType={x:Type UserControl}' in aval):
                        check_path(root_ctx, m.group(1), name, aname, {})
                    continue
                pth, opts = parse_binding(aval)
                if name == 'Run' and aname == 'Text' and opts is not None and opts.get('Mode') not in ('OneWay', 'OneTime'):
                    errors.append(f'{rel}: <Run Text="{aval}"> needs Mode=OneWay (Run.Text binds TwoWay by default)')
                if name == 'TextBox' and aname == 'Text' and opts is not None and opts.get('UpdateSourceTrigger') != 'PropertyChanged' and opts.get('Mode') not in ('OneWay', 'OneTime'):
                    warns.append(f'{rel}: <TextBox Text="{aval}"> updates the view-model only on focus loss — add UpdateSourceTrigger=PropertyChanged')
                if not in_resources:
                    check_path(new_ctx, pth, name, aname, opts or {})
        for child in el:
            walk(child, new_ctx, in_resources)

    walk(root, root_ctx, False)
    return errors, warns


def main(argv):
    files = argv[1:] or [os.path.join(dp, f) for dp, _, fs in os.walk(APP) for f in fs
                         if f.endswith('.xaml') and os.sep + 'obj' not in dp and os.sep + 'bin' not in dp]
    types = index_cs()
    keys = theme_keys()
    all_e, all_w = [], []
    for f in sorted(files):
        e, w = check_file(os.path.abspath(f), types, keys)
        all_e += e; all_w += w
    for w in all_w:
        print('WARN  ' + w)
    for e in all_e:
        print('ERROR ' + e)
    print(f'\n{len(files)} XAML files checked: {len(all_e)} errors, {len(all_w)} warnings')
    return 1 if all_e else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))

using System.Collections;
using System.Globalization;
using System.IO;
using System.Windows;
using System.Windows.Data;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using PostIt.Core;

namespace PostIt.App.Converters;

// Value converters registered in Theme/Controls.xaml (keys in parentheses).

/// <summary>(BoolToVis, BoolToVisInverted) true → Visible, false → Collapsed.</summary>
public sealed class BoolToVisibilityConverter : IValueConverter
{
    public bool Invert { get; set; }

    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        var b = value is bool v && v;
        return b ^ Invert ? Visibility.Visible : Visibility.Collapsed;
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        value is Visibility v && (v == Visibility.Visible) ^ Invert;
}

/// <summary>(NullToCollapsed, NullToVisible) null → Collapsed (or Visible when inverted).</summary>
public sealed class NullToVisibilityConverter : IValueConverter
{
    public bool Invert { get; set; }

    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        (value is not null) ^ Invert ? Visibility.Visible : Visibility.Collapsed;

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => Binding.DoNothing;
}

/// <summary>(EmptyToCollapsed, EmptyToVisible) null / "" / empty collection / 0 → Collapsed (or Visible when inverted).</summary>
public sealed class EmptyToVisibilityConverter : IValueConverter
{
    public bool Invert { get; set; }

    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        var empty = value switch
        {
            null => true,
            string s => string.IsNullOrWhiteSpace(s),
            int i => i == 0,
            ICollection c => c.Count == 0,
            IEnumerable e => !e.GetEnumerator().MoveNext(),
            _ => false,
        };
        return empty ^ Invert ? Visibility.Collapsed : Visibility.Visible;
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => Binding.DoNothing;
}

/// <summary>(InvertBool)</summary>
public sealed class InvertBoolConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) => !(value is bool b && b);
    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => !(value is bool b && b);
}

/// <summary>
/// (EnumEquals) For RadioButtons bound to an enum:
/// IsChecked="{Binding Status, Converter={StaticResource EnumEquals}, ConverterParameter=Pending}".
/// </summary>
public sealed class EnumEqualsConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        value is not null && parameter is not null && string.Equals(value.ToString(), parameter.ToString(), StringComparison.OrdinalIgnoreCase);

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        if (value is true && parameter is not null)
        {
            var enumType = Nullable.GetUnderlyingType(targetType) ?? targetType;
            return enumType.IsEnum ? Enum.Parse(enumType, parameter.ToString()!, ignoreCase: true) : parameter;
        }
        return Binding.DoNothing;
    }
}

/// <summary>
/// (BadgeKind) Maps domain values to a Badge Kind:
/// AssignmentStatus/PostStatus → ok | pending | todo; CheckStatus → ok | pending | cool; CooldownState → cool | ok; bool → ok | cool.
/// </summary>
public sealed class BadgeKindConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) => value switch
    {
        AssignmentStatus.Posted => "ok",
        AssignmentStatus.Pending => "pending",
        AssignmentStatus.ToPost => "todo",
        PostStatus.Posted => "ok",
        PostStatus.Pending => "pending",
        CheckStatus.Pass => "ok",
        CheckStatus.Warn => "pending",
        CheckStatus.Fail => "cool",
        CooldownState c => c.InCooldown ? "cool" : c.NeverPosted ? "info" : "ok",
        bool b => b ? "ok" : "cool",
        string s => s,
        _ => "neutral",
    };

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => Binding.DoNothing;
}

/// <summary>(CheckGlyph) CheckStatus → ✓ / ! / ✕ glyph (use with Text.Glyph).</summary>
public sealed class CheckGlyphConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) => value switch
    {
        CheckStatus.Pass => "",
        CheckStatus.Warn => "",
        CheckStatus.Fail => "",
        _ => "",
    };

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => Binding.DoNothing;
}

/// <summary>(CheckBrush, CheckBgBrush) CheckStatus → green / amber / red foreground or background brush.</summary>
public sealed class CheckBrushConverter : IValueConverter
{
    public bool Background { get; set; }

    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        var key = value switch
        {
            CheckStatus.Pass => "Green",
            CheckStatus.Warn => "Amber",
            CheckStatus.Fail => "Red",
            _ => "Blue",
        };
        return Application.Current.TryFindResource($"Brush.{key}{(Background ? "Bg" : "")}") as Brush ?? Brushes.Gray;
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => Binding.DoNothing;
}

/// <summary>
/// (Thumbnail) File path → decoded, cached, non-locking BitmapImage. ConverterParameter = decode width in px (default 480).
/// Returns null for a missing or unreadable file.
/// </summary>
public sealed class ThumbnailConverter : IValueConverter
{
    private static readonly Dictionary<string, BitmapImage> Cache = new(StringComparer.OrdinalIgnoreCase);

    public object? Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        if (value is not string path || string.IsNullOrWhiteSpace(path) || !File.Exists(path)) return null;
        var width = parameter is not null && int.TryParse(parameter.ToString(), out var w) ? w : 480;
        var key = $"{path}|{width}|{File.GetLastWriteTimeUtc(path).Ticks}";
        lock (Cache)
        {
            if (Cache.TryGetValue(key, out var cached)) return cached;
        }
        try
        {
            var bmp = new BitmapImage();
            bmp.BeginInit();
            bmp.CacheOption = BitmapCacheOption.OnLoad;   // read now, don't keep the file open
            bmp.CreateOptions = BitmapCreateOptions.IgnoreColorProfile;
            bmp.DecodePixelWidth = width;
            bmp.UriSource = new Uri(path, UriKind.Absolute);
            bmp.EndInit();
            bmp.Freeze();
            lock (Cache) Cache[key] = bmp;
            return bmp;
        }
        catch
        {
            return null;
        }
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => Binding.DoNothing;
}

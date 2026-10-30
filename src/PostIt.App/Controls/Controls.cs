using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace PostIt.App.Controls;

/// <summary>Rounded status pill. Kind: ok | pending | cool | todo | neutral | cat | gold | info. Styled in Theme/Controls.xaml.</summary>
public sealed class Badge : ContentControl
{
    public static readonly DependencyProperty KindProperty =
        DependencyProperty.Register(nameof(Kind), typeof(string), typeof(Badge), new PropertyMetadata("neutral"));

    public static readonly DependencyProperty ShowDotProperty =
        DependencyProperty.Register(nameof(ShowDot), typeof(bool), typeof(Badge), new PropertyMetadata(false));

    public string Kind
    {
        get => (string)GetValue(KindProperty);
        set => SetValue(KindProperty, value);
    }

    public bool ShowDot
    {
        get => (bool)GetValue(ShowDotProperty);
        set => SetValue(ShowDotProperty, value);
    }
}

/// <summary>Coloured message box with an icon. Kind: ok | warn | error | info. Styled in Theme/Controls.xaml.</summary>
public sealed class Alert : ContentControl
{
    public static readonly DependencyProperty KindProperty =
        DependencyProperty.Register(nameof(Kind), typeof(string), typeof(Alert), new PropertyMetadata("info"));

    public string Kind
    {
        get => (string)GetValue(KindProperty);
        set => SetValue(KindProperty, value);
    }
}

/// <summary>
/// The "1 Find · 2 Copy · 3 Post · 4 Log" chips. Steps before ActiveStep show as done (green number),
/// ActiveStep is highlighted (cream pill), later ones are dim.
/// <code>&lt;ui:StepChips ActiveStep="2"/&gt;</code>
/// </summary>
public sealed class StepChips : StackPanel
{
    public static readonly DependencyProperty ActiveStepProperty =
        DependencyProperty.Register(nameof(ActiveStep), typeof(int), typeof(StepChips),
            new PropertyMetadata(1, (d, _) => ((StepChips)d).Rebuild()));

    public static readonly DependencyProperty StepsProperty =
        DependencyProperty.Register(nameof(Steps), typeof(string), typeof(StepChips),
            new PropertyMetadata("Find,Copy,Post,Log", (d, _) => ((StepChips)d).Rebuild()));

    public StepChips()
    {
        Orientation = Orientation.Horizontal;
        Rebuild();
    }

    public int ActiveStep
    {
        get => (int)GetValue(ActiveStepProperty);
        set => SetValue(ActiveStepProperty, value);
    }

    /// <summary>Comma-separated step names.</summary>
    public string Steps
    {
        get => (string)GetValue(StepsProperty);
        set => SetValue(StepsProperty, value);
    }

    private static Brush B(string key) =>
        Application.Current?.TryFindResource(key) as Brush ?? Brushes.Gray;

    private void Rebuild()
    {
        Children.Clear();
        var names = (Steps ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        for (var i = 0; i < names.Length; i++)
        {
            var step = i + 1;
            var done = step < ActiveStep;
            var active = step == ActiveStep;

            var number = new TextBlock
            {
                Text = step.ToString(),
                FontSize = 12,
                FontWeight = FontWeights.Bold,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center,
                Foreground = active ? B("Brush.Cream") : done ? B("Brush.Ink") : B("Brush.Muted2"),
            };
            var circle = new Border
            {
                Width = 22,
                Height = 22,
                CornerRadius = new CornerRadius(11),
                Background = active ? B("Brush.Ink") : done ? B("Brush.Green") : B("Brush.Line"),
                Child = number,
            };
            var label = new TextBlock
            {
                Text = names[i],
                FontSize = 14,
                FontWeight = active ? FontWeights.SemiBold : FontWeights.Medium,
                Margin = new Thickness(8, 0, 0, 0),
                VerticalAlignment = VerticalAlignment.Center,
                Foreground = active ? B("Brush.Ink") : done ? B("Brush.Muted") : B("Brush.Muted2"),
            };
            var row = new StackPanel { Orientation = Orientation.Horizontal };
            row.Children.Add(circle);
            row.Children.Add(label);

            Children.Add(new Border
            {
                Height = 32,
                CornerRadius = new CornerRadius(16),
                Padding = new Thickness(5, 0, 13, 0),
                Margin = new Thickness(0, 0, 8, 0),
                Background = active ? B("Brush.Cream") : B("Brush.Panel2"),
                Child = row,
            });
        }
    }
}

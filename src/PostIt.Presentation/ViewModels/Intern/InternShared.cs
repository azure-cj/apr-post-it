using System.Globalization;
using PostIt.Core;
using PostIt.Presentation.Mvvm;

namespace PostIt.Presentation.ViewModels;

// Shared pieces of the intern screens (My Queue, Search, Property, Log, Add the live link).

/// <summary>Base for the intern pages: safe calls into the WPF host and the "Your logs today" list.</summary>
public abstract class InternPageViewModel : PageViewModel
{
    protected InternPageViewModel(AppServices services, INavigator navigator) : base(services, navigator) { }

    /// <summary>"Thu 29 Oct 2026".</summary>
    public string TodayLabel => InternFormat.Date(S.Clock.Today, "ddd d MMM yyyy");

    /// <summary>Runs a host call (clipboard, Explorer, browser) and turns a failure into an error toast.</summary>
    protected void Safely(Action action)
    {
        try { action(); }
        catch (Exception ex) { OnError(ex); }
    }

    /// <summary>For work started from a property setter: awaits it and turns a failure into an error toast.</summary>
    protected async Task SafelyAsync(Func<Task> work)
    {
        try { await work(); }
        catch (Exception ex) { OnError(ex); }
    }

    /// <summary>The rows this user logged today, newest first.</summary>
    protected async Task<IReadOnlyList<MyLogTodayRow>> LoadMyLogsAsync()
    {
        var posts = await S.Posting.GetPostsByAsync(S.Session.Name, S.Clock.Today);
        return posts.Select(p => new MyLogTodayRow(p, url => Safely(() => S.Ui.OpenUrl(url)))).ToList();
    }

    /// <summary>Reads the clipboard for a pasted link; null (with a hint toast) when there is no text.</summary>
    protected string? ReadPastedLink()
    {
        string? text = null;
        Safely(() => text = S.Ui.ReadClipboardText());
        text = text?.Trim();
        if (!string.IsNullOrEmpty(text)) return text;
        S.Notifier.Notify("The clipboard is empty. Copy the post link on Facebook first.", ToastKind.Warning);
        return null;
    }
}

/// <summary>One row of "Your logs today": property, "APG Homes Cavite · 10:17" and a status badge.</summary>
public sealed class MyLogTodayRow
{
    public MyLogTodayRow(PostLogEntry entry, Action<string> openUrl)
    {
        Entry = entry;
        Title = entry.Title;
        Meta = InternFormat.Join(entry.FbAccount, InternFormat.Time(entry.Time));
        StatusLabel = InternFormat.StatusLabel(entry.Status);
        BadgeKind = InternFormat.StatusKind(entry.Status);
        Link = entry.PostLink;
        ViewPostCommand = new RelayCommand(() => openUrl(Link), () => HasLink);
    }

    public PostLogEntry Entry { get; }
    public string Title { get; }
    public string Meta { get; }
    public string StatusLabel { get; }
    public string BadgeKind { get; }
    public string Link { get; }
    public bool HasLink => Link.Length > 0;
    public RelayCommand ViewPostCommand { get; }
}

/// <summary>Display strings for the intern screens. Always English, whatever the PC's regional settings.</summary>
internal static class InternFormat
{
    private static readonly CultureInfo English = CultureInfo.InvariantCulture;

    /// <summary>Date in English, e.g. format "ddd d MMM" → "Tue 3 Nov".</summary>
    public static string Date(DateOnly date, string format) => date.ToString(format, English);

    /// <summary>"09:41".</summary>
    public static string Time(TimeOnly time) => time.ToString("HH:mm", English);

    /// <summary>"1 day", "5 days".</summary>
    public static string Days(int n) => n == 1 ? "1 day" : $"{n} days";

    /// <summary>"today", "yesterday", "26 days ago".</summary>
    public static string DaysAgo(int n) => n <= 0 ? "today" : n == 1 ? "yesterday" : $"{n} days ago";

    /// <summary>"1 photo", "4 photos".</summary>
    public static string Count(int n, string singular, string plural) => n == 1 ? $"1 {singular}" : $"{n} {plural}";

    /// <summary>Joins the non-empty parts with " · ".</summary>
    public static string Join(params string?[] parts) =>
        string.Join(" · ", parts.Where(p => !string.IsNullOrWhiteSpace(p)).Select(p => p!.Trim()));

    /// <summary>"Last posted 3 Oct · 26 days ago", or <paramref name="never"/>.</summary>
    public static string LastPosted(CooldownState cooldown, string never = "Never posted") =>
        cooldown.LastPosted is { } last ? $"Last posted {Date(last, "d MMM")} · {DaysAgo(cooldown.DaysSince ?? 0)}" : never;

    /// <summary>"Cooldown · 5 days left".</summary>
    public static string CooldownBadge(CooldownState cooldown) => $"Cooldown · {Days(cooldown.DaysLeft)} left";

    public static string StatusLabel(PostStatus status) => status == PostStatus.Pending ? "Pending" : "Posted";

    /// <summary>Badge kind for a tracker row status.</summary>
    public static string StatusKind(PostStatus status) => status == PostStatus.Pending ? "pending" : "ok";

    /// <summary>"Jan Dela Cruz" → "Jan".</summary>
    public static string FirstName(string fullName)
    {
        var parts = (fullName ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return parts.Length == 0 ? "" : parts[0];
    }

    /// <summary>Icon-font glyph for a category (codes from Theme/Colors.xaml: MapPin, Home, Tag, Document).</summary>
    public static string CategoryGlyph(string? category)
    {
        var c = (category ?? "").ToLowerInvariant();
        if (c.Contains("house") || c.Contains("condo") || c.Contains("town") || c.Contains("apartment")) return "";
        if (c.Contains("lot") || c.Contains("land") || c.Contains("farm")) return "";
        if (c.Contains("commercial") || c.Contains("office") || c.Contains("retail")) return "";
        return "";
    }
}

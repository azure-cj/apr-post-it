using PostIt.Core;
using PostIt.Core.Testing;
using PostIt.Presentation;

namespace PostIt.Tests;

/// <summary>Records what a view-model asked the WPF host to do.</summary>
public sealed class FakeUi : IUiServices
{
    public string? Clipboard { get; set; }
    public List<string> Opened { get; } = new();
    public string? FolderToPick { get; set; }
    public bool ConfirmAnswer { get; set; } = true;
    public List<string> Confirms { get; } = new();
    public string DownloadsFolder { get; set; } = Path.Combine(Path.GetTempPath(), "postit-tests-downloads");

    public void CopyText(string text) => Clipboard = text;
    public string? ReadClipboardText() => Clipboard;
    public void OpenFolder(string path) => Opened.Add("folder:" + path);
    public void OpenFile(string path) => Opened.Add("file:" + path);
    public void OpenUrl(string url) => Opened.Add("url:" + url);
    public string? PickFolder(string title, string? initialFolder = null) => FolderToPick;
    public bool Confirm(string title, string message, string confirmLabel = "OK") { Confirms.Add(message); return ConfirmAnswer; }
}

/// <summary>Records navigation calls instead of building pages.</summary>
public sealed class FakeNavigator : INavigator
{
    public List<string> Calls { get; } = new();
    public string? Last => Calls.LastOrDefault();

    public void SignIn(AppUser user) => Calls.Add($"SignIn:{user.Name}");
    public void SignOut() => Calls.Add("SignOut");
    public void ShowSearch(string? query = null) => Calls.Add($"Search:{query}");
    public void ShowProperty(string propertyId, string? queueItemKey = null) => Calls.Add($"Property:{propertyId}|{queueItemKey}");
    public void ShowLogPost(string propertyId, string? queueItemKey = null) => Calls.Add($"LogPost:{propertyId}|{queueItemKey}");
    public void ShowCompletePending(string postKey) => Calls.Add($"CompletePending:{postKey}");
    public void ShowMyQueue() => Calls.Add("MyQueue");
    public void ShowAssign(string? intern = null, DateOnly? date = null) => Calls.Add($"Assign:{intern}|{date:yyyy-MM-dd}");
    public void ShowTracker() => Calls.Add("Tracker");
    public void ShowSettings() => Calls.Add("Settings");
    public void GoBack() => Calls.Add("Back");
    public Task RefreshBadgesAsync() { Calls.Add("RefreshBadges"); return Task.CompletedTask; }
}

public sealed class FakeNotifier : INotifier
{
    public List<(string Message, ToastKind Kind)> Messages { get; } = new();
    public string? Last => Messages.Count == 0 ? null : Messages[^1].Message;
    public void Notify(string message, ToastKind kind = ToastKind.Success) => Messages.Add((message, kind));
}

public sealed class FakeSampleData : ISampleData
{
    public int Resets { get; private set; }
    public void EnsureSeeded() { }
    public void Reset() => Resets++;
}

/// <summary>
/// A complete in-memory app: real services (PostingService etc.) over in-memory repositories,
/// a fixed clock (Thu 29 Oct 2026, 09:41) and fake UI. Use it to test services and view-models end to end.
/// </summary>
public sealed class TestApp
{
    public static readonly DateOnly Today = new(2026, 10, 29);

    public FixedClock Clock { get; } = new(Today, new TimeOnly(9, 41));
    public InMemoryPropertyRepository Properties { get; } = new();
    public InMemoryTrackerRepository Tracker { get; } = new();
    public InMemorySettingsStore Settings { get; }
    public FakeUi Ui { get; } = new();
    public FakeNavigator Nav { get; } = new();
    public FakeNotifier Notifier { get; } = new();
    public FakeSampleData SampleData { get; } = new();
    public Session Session { get; } = new();

    public static readonly AppUser Manager = new("Maria Santos", UserRole.Manager);
    public static readonly AppUser Jan = new("Jan Dela Cruz", UserRole.Intern);
    public static readonly AppUser Mika = new("Mika Reyes", UserRole.Intern);

    public TestApp()
    {
        Settings = new InMemorySettingsStore(new AppSettings
        {
            PropertiesFolder = "/props",
            TrackerFolder = "/tracker",
            CooldownDays = 7,
            RepostDueDays = 14,
            FbAccounts = new() { "APG Homes Cavite", "APG Properties PH", "Alpha Premier Listings" },
            Users = new() { Manager, Jan, Mika },
        });
        Session.User = Jan;
    }

    public const string StandardDoc =
        "Category: Lot\nLocation: Tagaytay\n\nFOR SALE: 320 sqm lot\nCool climate.\nPrice: ₱4.2M\nContact: 0917 000 0000 / 0920 000 0000\n\n=== INTERNAL — DO NOT POST ===\nCommission: 3% to agent\nOwner: Mr. Reyes";

    /// <summary>Adds a property with a standard, clean posting doc.</summary>
    public Property AddProperty(string name, string category = "Lot", string? doc = null) =>
        Properties.Add(name, category, doc ?? StandardDoc.Replace("Category: Lot", $"Category: {category}"), "Tagaytay");

    /// <summary>Adds a Posts row as if logged on <paramref name="daysAgo"/> days before Today.</summary>
    public PostLogEntry AddPost(string title, int daysAgo, PostStatus status = PostStatus.Posted, string by = "Jan Dela Cruz",
        string category = "Lot", string account = "APG Homes Cavite", string time = "09:00")
    {
        var link = status == PostStatus.Posted ? $"https://www.facebook.com/groups/test/posts/{Random.Shared.Next(100000, 999999)}/" : "";
        return Tracker.AddPostAsync(new PostLogEntry("", Today.AddDays(-daysAgo), TimeOnly.Parse(time), category, title, status, account, link, by)).Result;
    }

    public CoreServices Core() => new(
        new PostingService(Properties, Tracker, Settings, Clock),
        new AssignmentService(Properties, Tracker, Settings, Clock),
        new TrackerService(Properties, Tracker, Settings, Clock),
        Settings, SampleData, Clock);

    /// <summary>Services as a page view-model sees them (notifier = FakeNotifier).</summary>
    public AppServices Services()
    {
        var c = Core();
        return new AppServices(c.Posting, c.Assignments, c.Tracker, c.Settings, c.SampleData, c.Clock, Ui, Notifier, Session);
    }
}

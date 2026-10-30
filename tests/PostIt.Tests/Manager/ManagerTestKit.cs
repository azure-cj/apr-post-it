using PostIt.Core;
using PostIt.Presentation;

namespace PostIt.Tests.Manager;

/// <summary>Shared setup for the manager-screen tests (clock: Thu 29 Oct 2026, so tomorrow = Fri 30 Oct).</summary>
public static class ManagerTestKit
{
    public const string Jan = "Jan Dela Cruz", Mika = "Mika Reyes";
    public static readonly DateOnly Today = TestApp.Today, Tomorrow = TestApp.Today.AddDays(1);

    /// <summary>
    /// A TestApp signed in as the manager with five properties:
    /// Lot 12 last posted 20 days ago (due), Lot 7 2 days ago (cooldown), Lot 3 10 days ago, Seaside and Casa Amara never.
    /// </summary>
    public static TestApp NewApp()
    {
        var app = new TestApp();
        app.Session.User = TestApp.Manager;
        app.AddProperty("Verdant Hills Lot 12");
        app.AddProperty("Verdant Hills Lot 7");
        app.AddProperty("Verdant Hills Lot 3");
        app.AddProperty("Seaside Residences 2BR", "Condo");
        app.AddProperty("Casa Amara House & Lot", "House & Lot");
        app.AddPost("Verdant Hills Lot 12", 20);
        app.AddPost("Verdant Hills Lot 7", 2);
        app.AddPost("Verdant Hills Lot 3", 10);
        return app;
    }

    /// <summary>Writes a saved queue straight into the tracker.</summary>
    public static void SetQueue(TestApp app, string who, DateOnly date, params (string Property, AssignmentStatus Status)[] items) =>
        app.Tracker.ReplaceQueueAsync(date, who, items.Select(i => new Assignment("", date, who, i.Property, i.Status)).ToList()).Wait();

    /// <summary>The saved queue as "Name:Status,…" in file (posting) order.</summary>
    public static string SavedQueue(TestApp app, string who, DateOnly date) =>
        string.Join(",", app.Tracker.Assignments
            .Where(a => a.Date == date && a.AssignedTo == who)
            .Select(a => $"{a.PropertyName}:{a.Status}"));

    /// <summary>App services whose posting service counts RefreshProperties calls.</summary>
    public static (AppServices Services, CountingPosting Posting) ServicesWithCountingPosting(TestApp app)
    {
        var c = app.Core();
        var posting = new CountingPosting(c.Posting);
        return (new AppServices(posting, c.Assignments, c.Tracker, c.Settings, c.SampleData, c.Clock, app.Ui, app.Notifier, app.Session), posting);
    }

    /// <summary>App services whose assignment service holds back chosen searches until released.</summary>
    public static (AppServices Services, GatedAssignments Assignments) ServicesWithGatedSearch(TestApp app)
    {
        var c = app.Core();
        var gated = new GatedAssignments(c.Assignments);
        return (new AppServices(c.Posting, gated, c.Tracker, c.Settings, c.SampleData, c.Clock, app.Ui, app.Notifier, app.Session), gated);
    }
}

/// <summary>Real posting service that counts <see cref="RefreshProperties"/>.</summary>
public sealed class CountingPosting(IPostingService inner) : IPostingService
{
    public int Refreshes { get; private set; }
    public void RefreshProperties() { Refreshes++; inner.RefreshProperties(); }

    public Task<IReadOnlyList<PropertySummary>> SearchAsync(string query, CancellationToken ct = default) => inner.SearchAsync(query, ct);
    public Task<PropertyDetail> OpenAsync(string propertyId, CancellationToken ct = default) => inner.OpenAsync(propertyId, ct);
    public Task<LogPreview> PreviewLogAsync(LogPostRequest request, CancellationToken ct = default) => inner.PreviewLogAsync(request, ct);
    public Task<LogResult> LogPostAsync(LogPostRequest request, CancellationToken ct = default) => inner.LogPostAsync(request, ct);
    public Task<LogResult> CompletePendingAsync(string postKey, string liveLink, CancellationToken ct = default) => inner.CompletePendingAsync(postKey, liveLink, ct);
    public Task<PostLogEntry?> GetPostAsync(string postKey, CancellationToken ct = default) => inner.GetPostAsync(postKey, ct);
    public Task<IReadOnlyList<PostLogEntry>> GetPostsByAsync(string user, DateOnly date, CancellationToken ct = default) => inner.GetPostsByAsync(user, date, ct);
    public Task<IReadOnlyList<string>> GetFbAccountsAsync(CancellationToken ct = default) => inner.GetFbAccountsAsync(ct);
}

/// <summary>Real assignment service; searches for a gated query wait until <see cref="Release"/> (to test stale results).</summary>
public sealed class GatedAssignments(IAssignmentService inner) : IAssignmentService
{
    private readonly Dictionary<string, TaskCompletionSource> _gates = new();

    public void Gate(string query) => _gates[query] = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    public void Release(string query) => _gates[query].SetResult();

    public async Task<IReadOnlyList<AssignCandidate>> SearchCandidatesAsync(string query, string user, DateOnly date, CancellationToken ct = default)
    {
        if (_gates.TryGetValue(query, out var gate)) await gate.Task;
        return await inner.SearchCandidatesAsync(query, user, date, ct);
    }

    public Task<QueueView> GetQueueAsync(string user, DateOnly date, CancellationToken ct = default) => inner.GetQueueAsync(user, date, ct);
    public Task<AssignCheck> CheckAsync(string propertyId, string user, DateOnly date, CancellationToken ct = default) => inner.CheckAsync(propertyId, user, date, ct);
    public Task<IReadOnlyList<PasteMatch>> MatchPastedListAsync(string text, string user, DateOnly date, CancellationToken ct = default) => inner.MatchPastedListAsync(text, user, date, ct);
    public Task SaveQueueAsync(string user, DateOnly date, IReadOnlyList<string> propertyNames, CancellationToken ct = default) => inner.SaveQueueAsync(user, date, propertyNames, ct);
    public Task<int> CountOpenAsync(string user, DateOnly date, CancellationToken ct = default) => inner.CountOpenAsync(user, date, ct);
}

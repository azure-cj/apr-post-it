using PostIt.Core;

namespace PostIt.Tests.Intern;

/// <summary>
/// The intern screens' standard world (clock Thu 29 Oct 2026 09:41):
/// Verdant Hills Lot 12 last posted 26 days ago (3 Oct, due), Lot 7 in cooldown (27 Oct, 5 days left),
/// Lot 3 posted 10 days ago, Seaside Residences 2BR and Casa Amara House &amp; Lot never posted.
/// </summary>
internal static class InternWorld
{
    public const string Jan = "Jan Dela Cruz";
    public const string Mika = "Mika Reyes";
    public const string Link = "https://www.facebook.com/groups/apghomescavite/posts/1084512730024318/";
    public static readonly DateOnly Today = TestApp.Today;

    public static TestApp NewApp()
    {
        var app = new TestApp();
        app.AddProperty("Verdant Hills Lot 12");
        app.AddProperty("Verdant Hills Lot 7");
        app.AddProperty("Verdant Hills Lot 3");
        app.AddProperty("Seaside Residences 2BR", "Condo");
        app.AddProperty("Casa Amara House & Lot", "House & Lot");
        app.AddPost("Verdant Hills Lot 12", 26, by: "Mia Santos");
        app.AddPost("Verdant Hills Lot 7", 2, by: Mika);
        app.AddPost("Verdant Hills Lot 3", 10, by: Mika);
        return app;
    }

    /// <summary>Writes <paramref name="who"/>'s queue for <paramref name="date"/> straight into the tracker, in this order.</summary>
    public static void SetQueue(TestApp app, string who, DateOnly date, params (string Property, AssignmentStatus Status)[] items) =>
        app.Tracker.ReplaceQueueAsync(date, who, items.Select(i => new Assignment("", date, who, i.Property, i.Status)).ToList()).Wait();

    public static string QueueKey(string property, string who = Jan) => Assignment.MakeKey(Today, who, property);

    /// <summary>Waits (briefly) for fire-and-forget work started by a property setter.</summary>
    public static async Task Eventually(Func<bool> condition)
    {
        for (var i = 0; i < 200 && !condition(); i++) await Task.Delay(5);
    }
}

/// <summary>Posting service whose Search/Preview results can be held back and released in any order.</summary>
internal sealed class GatedPosting(IPostingService inner) : IPostingService
{
    public bool HoldSearches { get; set; }
    public bool HoldPreviews { get; set; }
    public List<(string Query, TaskCompletionSource<IReadOnlyList<PropertySummary>> Gate, IReadOnlyList<PropertySummary> Result)> Searches { get; } = new();
    public List<(LogPostRequest Request, TaskCompletionSource<LogPreview> Gate, LogPreview Result)> Previews { get; } = new();

    public void ReleaseSearch(int index) => Searches[index].Gate.SetResult(Searches[index].Result);
    public void ReleasePreview(int index) => Previews[index].Gate.SetResult(Previews[index].Result);

    public async Task<IReadOnlyList<PropertySummary>> SearchAsync(string query, CancellationToken ct = default)
    {
        var result = await inner.SearchAsync(query, ct);
        if (!HoldSearches) return result;
        var gate = new TaskCompletionSource<IReadOnlyList<PropertySummary>>();
        Searches.Add((query, gate, result));
        return await gate.Task;
    }

    public async Task<LogPreview> PreviewLogAsync(LogPostRequest request, CancellationToken ct = default)
    {
        var result = await inner.PreviewLogAsync(request, ct);
        if (!HoldPreviews) return result;
        var gate = new TaskCompletionSource<LogPreview>();
        Previews.Add((request, gate, result));
        return await gate.Task;
    }

    public Task<PropertyDetail> OpenAsync(string propertyId, CancellationToken ct = default) => inner.OpenAsync(propertyId, ct);
    public Task<LogResult> LogPostAsync(LogPostRequest request, CancellationToken ct = default) => inner.LogPostAsync(request, ct);
    public Task<LogResult> CompletePendingAsync(string postKey, string liveLink, CancellationToken ct = default) => inner.CompletePendingAsync(postKey, liveLink, ct);
    public Task<PostLogEntry?> GetPostAsync(string postKey, CancellationToken ct = default) => inner.GetPostAsync(postKey, ct);
    public Task<IReadOnlyList<PostLogEntry>> GetPostsByAsync(string user, DateOnly date, CancellationToken ct = default) => inner.GetPostsByAsync(user, date, ct);
    public Task<IReadOnlyList<string>> GetFbAccountsAsync(CancellationToken ct = default) => inner.GetFbAccountsAsync(ct);
    public void RefreshProperties() => inner.RefreshProperties();
}

/// <summary>Property folders whose photo paths are real files (InMemoryPropertyRepository only makes up paths).</summary>
internal sealed class RealPhotoFolders(Property property, string doc) : IPropertyRepository
{
    public Task<IReadOnlyList<Property>> GetAllAsync(CancellationToken ct = default) =>
        Task.FromResult<IReadOnlyList<Property>>(new[] { property });

    public Task<Property?> GetAsync(string id, CancellationToken ct = default) =>
        Task.FromResult(string.Equals(id, property.Id, StringComparison.OrdinalIgnoreCase) ? property : null);

    public Task<string> ReadPostingDocAsync(Property p, CancellationToken ct = default) => Task.FromResult(doc);

    public void Refresh() { }
}

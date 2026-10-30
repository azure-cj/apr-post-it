namespace PostIt.Core;

/// <summary>
/// Phase 1 for interns: find a property, read its posting doc with the pre-post checks, then log the post
/// in the tracker (refused inside the cooldown). Also turns a Pending group post into Posted once it's live.
/// </summary>
public sealed class PostingService : IPostingService
{
    private const string Uncategorized = "Uncategorized";

    private static readonly string[] FacebookHosts =
        { "facebook.com", "www.facebook.com", "m.facebook.com", "web.facebook.com", "fb.com", "fb.me" };

    private readonly IPropertyRepository _properties;
    private readonly ITrackerRepository _tracker;
    private readonly ISettingsStore _settings;
    private readonly IClock _clock;

    /// <summary>Creates the service over the given storage, settings and clock.</summary>
    public PostingService(IPropertyRepository properties, ITrackerRepository tracker, ISettingsStore settings, IClock clock)
    {
        _properties = properties;
        _tracker = tracker;
        _settings = settings;
        _clock = clock;
    }

    private CooldownPolicy Policy => CooldownPolicy.From(_settings.Current);

    /// <inheritdoc />
    public async Task<IReadOnlyList<PropertySummary>> SearchAsync(string query, CancellationToken ct = default)
    {
        var properties = await _properties.GetAllAsync(ct);
        var history = PostHistory.Of(await _tracker.GetPostsAsync(ct));
        var (policy, today) = (Policy, _clock.Today);
        return PropertySearch.Filter(properties, query).Select(p => history.Summarize(p, policy, today)).ToList();
    }

    /// <inheritdoc />
    public async Task<PropertyDetail> OpenAsync(string propertyId, CancellationToken ct = default)
    {
        var property = await GetPropertyAsync(propertyId, ct);
        var text = PostingTextParser.Parse(await _properties.ReadPostingDocAsync(property, ct));
        property = WithDocMetadata(property, text);

        var history = PostHistory.Of(await _tracker.GetPostsAsync(ct));
        return new PropertyDetail(
            property,
            text,
            PrePostChecker.Run(text),
            Policy.Evaluate(history.LastPosted(property.Name), _clock.Today),
            history.For(property.Name),
            DocWarning(property, text));
    }

    /// <inheritdoc />
    public async Task<LogPreview> PreviewLogAsync(LogPostRequest request, CancellationToken ct = default)
    {
        var property = await GetPropertyAsync(request.PropertyId, ct);
        if (property.Category == Uncategorized)
            property = WithDocMetadata(property, PostingTextParser.Parse(await _properties.ReadPostingDocAsync(property, ct)));

        var posts = await _tracker.GetPostsAsync(ct);
        var queueItem = request.QueueItemKey is { } key
            ? (await _tracker.GetAssignmentsAsync(ct)).FirstOrDefault(a => string.Equals(a.Key, key, StringComparison.OrdinalIgnoreCase))
            : null;

        var now = _clock.Now;
        var row = new PostLogEntry(
            Key: "",
            Date: _clock.Today,
            Time: new TimeOnly(now.Hour, now.Minute),
            Type: property.Category,
            Title: property.Name,
            Status: request.Status,
            FbAccount: (request.FbAccount ?? "").Trim(),
            PostLink: (request.PostLink ?? "").Trim(),
            PostedBy: (request.PostedBy ?? "").Trim());

        var policy = Policy;
        var cooldown = policy.Evaluate(CooldownPolicy.LastPosted(posts, property.Name), row.Date);

        var problems = new List<string>();
        if (row.FbAccount.Length == 0) problems.Add("Type the FB account name.");
        if (row.Status == PostStatus.Posted && row.PostLink.Length == 0) problems.Add("Paste the post link.");
        if (row.PostLink.Length > 0 && LinkProblem(row.PostLink, posts) is { } linkProblem) problems.Add(linkProblem);
        if (queueItem?.Status == AssignmentStatus.Posted) problems.Add("This queue item is already closed.");
        if (cooldown.InCooldown) problems.Add(CooldownProblem(property.Name, cooldown, policy));

        return new LogPreview(row, cooldown, problems, problems.Count == 0);
    }

    /// <inheritdoc />
    public async Task<LogResult> LogPostAsync(LogPostRequest request, CancellationToken ct = default)
    {
        var preview = await PreviewLogAsync(request, ct);
        if (!preview.CanSave) return new LogResult(false, preview.Problems[0], null, preview.Problems);

        var saved = await _tracker.AddPostAsync(preview.Row, ct);
        var message = saved.Status == PostStatus.Posted
            ? "Logged. The row is in the tracker sheet."
            : "Logged as Pending. It stays pinned at the top of your queue until you add the live link.";

        try
        {
            await MarkQueueItemAsync(request.QueueItemKey, saved, ct);
        }
        catch (UserFacingException ex)
        {
            // The post is saved; only the queue tick failed. Say so instead of looking like nothing happened.
            message += $" Your queue could not be updated: {ex.Message}";
        }
        return new LogResult(true, message, saved, Array.Empty<string>());
    }

    /// <inheritdoc />
    public async Task<LogResult> CompletePendingAsync(string postKey, string liveLink, CancellationToken ct = default)
    {
        var posts = await _tracker.GetPostsAsync(ct);
        var row = posts.FirstOrDefault(p => p.Key == postKey);
        if (row is null) return Refused("That post is no longer in the tracker.");
        if (row.Status != PostStatus.Pending) return Refused("This post is already live.");

        var link = (liveLink ?? "").Trim();
        var problem = link.Length == 0 ? "Paste the post link." : LinkProblem(link, posts);
        if (problem is not null) return Refused(problem);

        var updated = row with { Status = PostStatus.Posted, PostLink = link };
        await _tracker.UpdatePostAsync(updated, ct);

        var item = (await _tracker.GetAssignmentsAsync(ct))
            .Where(a => a.Date == row.Date && a.Status != AssignmentStatus.Posted && Wording.SamePerson(a.AssignedTo, row.PostedBy) && SameProperty(a.PropertyName, row.Title))
            .OrderBy(a => a.Status == AssignmentStatus.Pending ? 0 : 1)
            .FirstOrDefault();
        if (item is not null) await _tracker.UpdateAssignmentAsync(item with { Status = AssignmentStatus.Posted }, ct);

        return new LogResult(true, "Live link added — marked as Posted.", updated, Array.Empty<string>());
    }

    /// <inheritdoc />
    public async Task<PostLogEntry?> GetPostAsync(string postKey, CancellationToken ct = default) =>
        (await _tracker.GetPostsAsync(ct)).FirstOrDefault(p => p.Key == postKey);

    /// <inheritdoc />
    public async Task<IReadOnlyList<PostLogEntry>> GetPostsByAsync(string user, DateOnly date, CancellationToken ct = default)
    {
        var mine = (await _tracker.GetPostsAsync(ct)).Where(p => p.Date == date && Wording.SamePerson(p.PostedBy, user));
        return PostHistory.NewestFirst(mine).ToList();
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<string>> GetFbAccountsAsync(CancellationToken ct = default)
    {
        var fromTracker = PostHistory.NewestFirst(await _tracker.GetPostsAsync(ct)).Select(p => p.FbAccount);
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        return _settings.Current.FbAccounts.Concat(fromTracker)
            .Select(a => (a ?? "").Trim())
            .Where(a => a.Length > 0 && seen.Add(a))
            .ToList();
    }

    /// <inheritdoc />
    public void RefreshProperties() => _properties.Refresh();

    // ---------------------------------------------------------------- helpers

    private async Task<Property> GetPropertyAsync(string id, CancellationToken ct) =>
        await _properties.GetAsync(id, ct) ?? throw new UserFacingException("That property folder no longer exists.");

    /// <summary>Fills Category/Location from the doc's metadata when the folder layout didn't give them.</summary>
    private static Property WithDocMetadata(Property property, PostingText text) => property with
    {
        Category = property.Category == Uncategorized && text.Category is { } category ? category : property.Category,
        Location = property.Location ?? text.Location,
    };

    private static string? DocWarning(Property property, PostingText text)
    {
        if (property.PostingDocPath is null) return "No posting doc (.txt, .md or .docx) found in this folder.";
        if (property.PostingDocPath.EndsWith(".gdoc", StringComparison.OrdinalIgnoreCase))
            return "This folder only has a Google Docs shortcut (.gdoc). The prototype reads .txt, .md or .docx — export the doc into the folder.";
        if (text.PublicText.Length == 0) return "The posting doc has no text to post.";
        return null;
    }

    /// <summary>Marks the queue item Posted/Pending: the one given, else the poster's matching To-post item for today.</summary>
    private async Task MarkQueueItemAsync(string? queueItemKey, PostLogEntry saved, CancellationToken ct)
    {
        var status = saved.Status == PostStatus.Pending ? AssignmentStatus.Pending : AssignmentStatus.Posted;
        var assignments = await _tracker.GetAssignmentsAsync(ct);
        var item = queueItemKey is not null
            ? assignments.FirstOrDefault(a => string.Equals(a.Key, queueItemKey, StringComparison.OrdinalIgnoreCase))
            : assignments.FirstOrDefault(a => a.Date == saved.Date && a.Status == AssignmentStatus.ToPost
                                              && Wording.SamePerson(a.AssignedTo, saved.PostedBy) && SameProperty(a.PropertyName, saved.Title));
        if (item is not null && item.Status != status) await _tracker.UpdateAssignmentAsync(item with { Status = status }, ct);
    }

    private static string CooldownProblem(string name, CooldownState c, CooldownPolicy policy) =>
        $"Not saved. {name} was posted {Wording.DaysAgo(c.DaysSince ?? 0)} ({Wording.Date(c.LastPosted!.Value, "d MMM")}). " +
        $"The cooldown is {Wording.Days(policy.CooldownDays)} — it can be posted again on {Wording.Date(c.AvailableOn!.Value, "ddd d MMM yyyy")}.";

    /// <summary>Null when <paramref name="link"/> is a Facebook link not yet in the tracker; otherwise what's wrong.</summary>
    private static string? LinkProblem(string link, IEnumerable<PostLogEntry> posts)
    {
        if (!IsFacebookLink(link)) return "The post link must be a facebook.com link.";
        var key = LinkKey(link);
        var duplicate = posts.FirstOrDefault(p => p.PostLink.Length > 0 && LinkKey(p.PostLink) == key);
        return duplicate is null ? null : $"This link is already logged ({duplicate.Title}, {Wording.Date(duplicate.Date, "d MMM")}).";
    }

    private static bool IsFacebookLink(string link) =>
        Uri.TryCreate(link, UriKind.Absolute, out var uri)
        && (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp)
        && FacebookHosts.Contains(uri.Host, StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// Compares links the way Facebook treats them: www./m./web. hosts, letter case, a trailing "/" and
    /// tracking parameters (__cft__, mibextid…) don't make a different post.
    /// </summary>
    private static string LinkKey(string link)
    {
        if (!Uri.TryCreate(link.Trim(), UriKind.Absolute, out var uri)) return link.Trim().ToLowerInvariant();

        var host = uri.Host.ToLowerInvariant();
        foreach (var prefix in new[] { "www.", "m.", "web." })
            if (host.StartsWith(prefix, StringComparison.Ordinal)) host = host[prefix.Length..];

        var query = uri.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries)
            .Where(p => !p.StartsWith("__", StringComparison.Ordinal) && !p.StartsWith("mibextid=", StringComparison.OrdinalIgnoreCase)
                        && !p.StartsWith("rdid=", StringComparison.OrdinalIgnoreCase) && !p.StartsWith("share_url=", StringComparison.OrdinalIgnoreCase))
            .OrderBy(p => p, StringComparer.Ordinal);
        return $"{host}{uri.AbsolutePath.TrimEnd('/')}?{string.Join('&', query)}".ToLowerInvariant();
    }

    private static bool SameProperty(string a, string b) => PropertyNameMatcher.Normalize(a) == PropertyNameMatcher.Normalize(b);

    private static LogResult Refused(string problem) => new(false, problem, null, new[] { problem });
}

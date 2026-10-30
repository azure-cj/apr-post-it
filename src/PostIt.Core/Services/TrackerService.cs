namespace PostIt.Core;

/// <summary>The manager's overview for a day: posts so far, each intern's progress and what needs attention.</summary>
public sealed class TrackerService : ITrackerService
{
    private readonly IPropertyRepository _properties;
    private readonly ITrackerRepository _tracker;
    private readonly ISettingsStore _settings;

    /// <summary>Creates the service over the given storage and settings. The dashboard date is always passed in, so the clock isn't needed.</summary>
    public TrackerService(IPropertyRepository properties, ITrackerRepository tracker, ISettingsStore settings, IClock clock)
    {
        _properties = properties;
        _tracker = tracker;
        _settings = settings;
    }

    /// <inheritdoc />
    public async Task<TrackerDashboard> GetDashboardAsync(DateOnly date, CancellationToken ct = default)
    {
        var properties = await _properties.GetAllAsync(ct);
        var posts = await _tracker.GetPostsAsync(ct);
        var dayQueue = (await _tracker.GetAssignmentsAsync(ct)).Where(a => a.Date == date).ToList();
        var settings = _settings.Current;

        var interns = settings.Users
            .Where(u => u.Role == UserRole.Intern)
            .Select(u => Progress(u, dayQueue))
            .OrderBy(p => p.Total > 0 ? 0 : 1)
            .ThenBy(p => p.User.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();

        var attention = NeedsAttention(properties, PostHistory.Of(posts), dayQueue, CooldownPolicy.From(settings), date);

        return new TrackerDashboard(
            Date: date,
            PostedToday: posts.Count(p => p.Date == date && p.Status == PostStatus.Posted),
            PendingOpen: posts.Count(p => p.Status == PostStatus.Pending),
            InternsDone: interns.Count(i => i.Done),
            InternsAssigned: interns.Count(i => i.Total > 0),
            DueForRepost: attention.Count(a => a.Kind == AttentionKind.DueForRepost),
            NeverPosted: attention.Count(a => a.Kind == AttentionKind.NeverPosted),
            TodaysPosts: PostHistory.NewestFirst(posts.Where(p => p.Date == date)).ToList(),
            Interns: interns,
            NeedsAttention: attention);
    }

    private static InternProgress Progress(AppUser intern, IReadOnlyList<Assignment> dayQueue)
    {
        var queue = dayQueue.Where(a => Wording.SamePerson(a.AssignedTo, intern.Name)).ToList();
        return new InternProgress(intern,
            Total: queue.Count,
            Posted: queue.Count(a => a.Status == AssignmentStatus.Posted),
            Pending: queue.Count(a => a.Status == AssignmentStatus.Pending),
            ToPost: queue.Count(a => a.Status == AssignmentStatus.ToPost));
    }

    /// <summary>Never-posted properties first (by name), then the ones due for a repost, longest since posted first.</summary>
    private static IReadOnlyList<AttentionItem> NeedsAttention(
        IEnumerable<Property> properties, PostHistory history, IReadOnlyList<Assignment> dayQueue, CooldownPolicy policy, DateOnly date)
    {
        var summaries = properties.Select(p => history.Summarize(p, policy, date)).ToList();

        var never = summaries
            .Where(s => s.Cooldown.NeverPosted)
            .OrderBy(s => s.Name, StringComparer.OrdinalIgnoreCase)
            .Select(s =>
            {
                var holder = dayQueue.FirstOrDefault(a => PropertyNameMatcher.Normalize(a.PropertyName) == PropertyNameMatcher.Normalize(s.Name));
                var detail = holder is null ? "Never posted · not assigned" : $"Never posted · in {Wording.FirstName(holder.AssignedTo)}'s queue";
                return new AttentionItem(s, AttentionKind.NeverPosted, detail);
            });

        var due = summaries
            .Where(s => !s.Cooldown.NeverPosted && s.Cooldown.DueForRepost)
            .OrderByDescending(s => s.Cooldown.DaysSince)
            .ThenBy(s => s.Name, StringComparer.OrdinalIgnoreCase)
            .Select(s => new AttentionItem(s, AttentionKind.DueForRepost, $"Last posted {Wording.Days(s.Cooldown.DaysSince ?? 0)} ago"));

        return never.Concat(due).ToList();
    }
}

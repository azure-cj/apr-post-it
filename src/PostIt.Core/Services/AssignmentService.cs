namespace PostIt.Core;

/// <summary>
/// Phase 2 queues: the manager builds each intern's list for a date (refusing properties in cooldown on that
/// date or already in someone else's queue), and interns work through it.
/// </summary>
public sealed class AssignmentService : IAssignmentService
{
    private readonly IPropertyRepository _properties;
    private readonly ITrackerRepository _tracker;
    private readonly ISettingsStore _settings;

    /// <summary>Creates the service over the given storage and settings. Queue dates are always passed in, so the clock isn't needed.</summary>
    public AssignmentService(IPropertyRepository properties, ITrackerRepository tracker, ISettingsStore settings, IClock clock)
    {
        _properties = properties;
        _tracker = tracker;
        _settings = settings;
    }

    /// <inheritdoc />
    public async Task<QueueView> GetQueueAsync(string user, DateOnly date, CancellationToken ct = default)
    {
        var data = await LoadAsync(ct);
        var queue = data.Queue(user, date);
        var byName = PropertySearch.ByName(data.Properties);

        QueueItem ToItem(Assignment a)
        {
            var summary = byName.TryGetValue(PropertyNameMatcher.Normalize(a.PropertyName), out var p)
                ? data.History.Summarize(p, data.Policy, date)
                : null;
            return new QueueItem(a, summary, PostFor(a, user, data.History));
        }

        var items = queue.Where(a => a.Status == AssignmentStatus.Pending)
            .Concat(queue.Where(a => a.Status == AssignmentStatus.ToPost))
            .Concat(queue.Where(a => a.Status == AssignmentStatus.Posted))
            .Select(ToItem)
            .ToList();

        return new QueueView(date, user, items,
            ToPost: queue.Count(a => a.Status == AssignmentStatus.ToPost),
            Posted: queue.Count(a => a.Status == AssignmentStatus.Posted),
            Pending: queue.Count(a => a.Status == AssignmentStatus.Pending));
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<AssignCandidate>> SearchCandidatesAsync(string query, string user, DateOnly date, CancellationToken ct = default)
    {
        var data = await LoadAsync(ct);
        return PropertySearch.Filter(data.Properties, query)
            .Select(p => new AssignCandidate(data.History.Summarize(p, data.Policy, date), data.Check(p, user, date)))
            .ToList();
    }

    /// <inheritdoc />
    public async Task<AssignCheck> CheckAsync(string propertyId, string user, DateOnly date, CancellationToken ct = default)
    {
        var data = await LoadAsync(ct);
        var property = data.Properties.FirstOrDefault(p => string.Equals(p.Id, propertyId, StringComparison.OrdinalIgnoreCase));
        return property is null
            ? new AssignCheck(false, AssignBlock.NotFound, "That property folder no longer exists.", CooldownState.Never)
            : data.Check(property, user, date);
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<PasteMatch>> MatchPastedListAsync(string text, string user, DateOnly date, CancellationToken ct = default)
    {
        var data = await LoadAsync(ct);
        var byName = PropertySearch.ByName(data.Properties);
        var names = data.Properties.Select(p => p.Name).ToList();
        var seen = new HashSet<string>();
        var matches = new List<PasteMatch>();

        foreach (var typed in PastedLines(text))
        {
            if (!seen.Add(PropertyNameMatcher.Normalize(typed))) continue;

            var (kind, name) = PropertyNameMatcher.Match(typed, names);
            if (kind == PasteMatchKind.NotFound || name is null)
            {
                matches.Add(new PasteMatch(typed, PasteMatchKind.NotFound, null, null));
                continue;
            }
            var property = byName[PropertyNameMatcher.Normalize(name)];
            matches.Add(new PasteMatch(typed, kind, data.History.Summarize(property, data.Policy, date), data.Check(property, user, date)));
        }
        return matches;
    }

    /// <inheritdoc />
    public async Task SaveQueueAsync(string user, DateOnly date, IReadOnlyList<string> propertyNames, CancellationToken ct = default)
    {
        var data = await LoadAsync(ct);
        var byName = PropertySearch.ByName(data.Properties);
        var saved = data.Queue(user, date);
        var seen = new HashSet<string>();
        var queue = new List<Assignment>();

        foreach (var name in propertyNames)
        {
            var key = PropertyNameMatcher.Normalize(name);
            if (key.Length == 0 || !seen.Add(key)) continue;

            // Items already in the saved queue keep their status (even if their folder has since gone).
            var existing = saved.FirstOrDefault(a => PropertyNameMatcher.Normalize(a.PropertyName) == key);
            if (existing is not null)
            {
                queue.Add(existing);
                continue;
            }

            if (!byName.TryGetValue(key, out var property))
                throw new UserFacingException($"\"{name.Trim()}\" was not found in the property folders.");
            var check = data.Check(property, user, date);
            if (!check.CanAdd) throw new UserFacingException($"Can't add {property.Name}: {check.Message}.");

            queue.Add(new Assignment(Assignment.MakeKey(date, user, property.Name), date, user.Trim(), property.Name, AssignmentStatus.ToPost));
        }

        await _tracker.ReplaceQueueAsync(date, user, queue, ct);
    }

    /// <inheritdoc />
    public async Task<int> CountOpenAsync(string user, DateOnly date, CancellationToken ct = default)
    {
        var assignments = await _tracker.GetAssignmentsAsync(ct);
        return assignments.Count(a => a.Date == date && Wording.SamePerson(a.AssignedTo, user) && a.Status != AssignmentStatus.Posted);
    }

    // ---------------------------------------------------------------- helpers

    /// <summary>The row that closed (or pended) a queue item: same date, property and poster. Pending items prefer a Pending row.</summary>
    private static PostLogEntry? PostFor(Assignment item, string user, PostHistory history)
    {
        var rows = history.For(item.PropertyName).Where(p => p.Date == item.Date && Wording.SamePerson(p.PostedBy, user)).ToList();
        return item.Status == AssignmentStatus.Pending
            ? rows.FirstOrDefault(p => p.Status == PostStatus.Pending) ?? rows.FirstOrDefault()
            : rows.FirstOrDefault();
    }

    /// <summary>Lines of a pasted list without numbering or bullets ("1.", "2)", "-", "*", "•", "–"); blanks skipped.</summary>
    private static IEnumerable<string> PastedLines(string text) =>
        (text ?? "").Replace("\r\n", "\n").Replace('\r', '\n').Split('\n')
            .Select(line => ListMarker.Replace(line, "").Trim())
            .Where(line => line.Length > 0);

    private static readonly System.Text.RegularExpressions.Regex ListMarker =
        new(@"^\s*(?:\d+\s*[.)]|[-*•–—])\s*", System.Text.RegularExpressions.RegexOptions.CultureInvariant);

    private async Task<Snapshot> LoadAsync(CancellationToken ct)
    {
        var properties = await _properties.GetAllAsync(ct);
        var posts = await _tracker.GetPostsAsync(ct);
        var assignments = await _tracker.GetAssignmentsAsync(ct);
        return new Snapshot(properties, PostHistory.Of(posts), assignments, CooldownPolicy.From(_settings.Current));
    }

    /// <summary>Everything one call needs, loaded once.</summary>
    private sealed record Snapshot(
        IReadOnlyList<Property> Properties,
        PostHistory History,
        IReadOnlyList<Assignment> Assignments,
        CooldownPolicy Policy)
    {
        /// <summary>The (date, user) queue in file order.</summary>
        public List<Assignment> Queue(string user, DateOnly date) =>
            Assignments.Where(a => a.Date == date && Wording.SamePerson(a.AssignedTo, user)).ToList();

        /// <summary>May <paramref name="property"/> go into <paramref name="user"/>'s queue for <paramref name="date"/>?</summary>
        public AssignCheck Check(Property property, string user, DateOnly date)
        {
            var cooldown = Policy.Evaluate(History.LastPosted(property.Name), date);
            if (cooldown.InCooldown)
                return new AssignCheck(false, AssignBlock.InCooldown,
                    $"In cooldown until {Wording.Date(cooldown.AvailableOn!.Value, "ddd d MMM")} ({Wording.Days(cooldown.DaysLeft)} left)", cooldown);

            var key = PropertyNameMatcher.Normalize(property.Name);
            var other = Assignments.FirstOrDefault(a => a.Date == date && !Wording.SamePerson(a.AssignedTo, user)
                                                        && PropertyNameMatcher.Normalize(a.PropertyName) == key);
            if (other is not null)
                return new AssignCheck(false, AssignBlock.AssignedToSomeoneElse,
                    $"Already in {Wording.FirstName(other.AssignedTo)}'s queue for {Wording.Date(date, "ddd d MMM")}", cooldown);

            var message = cooldown.NeverPosted ? "Never posted"
                : cooldown.DueForRepost ? $"Due — last posted {Wording.Days(cooldown.DaysSince ?? 0)} ago"
                : $"Last posted {Wording.Days(cooldown.DaysSince ?? 0)} ago";
            return new AssignCheck(true, AssignBlock.None, message, cooldown);
        }
    }
}

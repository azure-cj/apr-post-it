namespace PostIt.Core;

/// <summary>
/// The Posts tab indexed by normalised property name, built once per service call so that
/// cooldowns and histories for many properties cost one pass over the tracker.
/// </summary>
internal sealed class PostHistory
{
    private readonly Dictionary<string, List<PostLogEntry>> _byTitle;

    private PostHistory(Dictionary<string, List<PostLogEntry>> byTitle) => _byTitle = byTitle;

    /// <summary>Indexes <paramref name="posts"/> (file order). Each property's rows end up newest first.</summary>
    public static PostHistory Of(IEnumerable<PostLogEntry> posts)
    {
        var byTitle = new Dictionary<string, List<PostLogEntry>>();
        foreach (var post in NewestFirst(posts))
        {
            var key = PropertyNameMatcher.Normalize(post.Title);
            if (!byTitle.TryGetValue(key, out var list)) byTitle[key] = list = new List<PostLogEntry>();
            list.Add(post);
        }
        return new PostHistory(byTitle);
    }

    /// <summary>Rows sorted newest first by date and time; rows logged later in the file win ties.</summary>
    public static IEnumerable<PostLogEntry> NewestFirst(IEnumerable<PostLogEntry> posts) =>
        posts.Select((post, index) => (post, index))
             .OrderByDescending(x => x.post.Date).ThenByDescending(x => x.post.Time).ThenByDescending(x => x.index)
             .Select(x => x.post);

    /// <summary>Every row for the property, newest first.</summary>
    public IReadOnlyList<PostLogEntry> For(string title) =>
        _byTitle.TryGetValue(PropertyNameMatcher.Normalize(title), out var list) ? list : Array.Empty<PostLogEntry>();

    /// <summary>Date of the newest Posted or Pending row, or null when the property was never posted.</summary>
    public DateOnly? LastPosted(string title) => For(title).FirstOrDefault(CooldownPolicy.CountsAsPosted)?.Date;

    /// <summary>The property as a search result, with its cooldown as of <paramref name="asOf"/>.</summary>
    public PropertySummary Summarize(Property property, CooldownPolicy policy, DateOnly asOf) =>
        new(property.Id, property.Name, property.Category, property.Location, policy.Evaluate(LastPosted(property.Name), asOf));
}

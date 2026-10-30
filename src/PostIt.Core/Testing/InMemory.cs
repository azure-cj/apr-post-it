namespace PostIt.Core.Testing;

// In-memory adapters for tests and for exercising services without touching disk.

public sealed class InMemorySettingsStore(AppSettings? initial = null, string dataFolder = "") : ISettingsStore
{
    public string DataFolder { get; } = dataFolder;
    public AppSettings Current { get; private set; } = initial ?? new AppSettings();
    public event EventHandler? Changed;

    public void Save(AppSettings settings)
    {
        Current = settings.Clone();
        Changed?.Invoke(this, EventArgs.Empty);
    }
}

public sealed class InMemoryPropertyRepository : IPropertyRepository
{
    private readonly List<Property> _properties = new();
    private readonly Dictionary<string, string> _docs = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>Adds a property whose posting doc is <paramref name="doc"/>. Id = "Category/Name".</summary>
    public Property Add(string name, string category, string doc = "", string? location = null, int photos = 2)
    {
        var id = $"{category}/{name}";
        var folder = $"/props/{id}";
        var p = new Property(id, name, category, location, folder, doc.Length > 0 ? folder + "/posting.txt" : null,
            Enumerable.Range(1, photos).Select(i => $"{folder}/photo-{i}.jpg").ToList());
        _properties.RemoveAll(x => x.Id == id);
        _properties.Add(p);
        _docs[id] = doc;
        return p;
    }

    public Task<IReadOnlyList<Property>> GetAllAsync(CancellationToken ct = default) =>
        Task.FromResult<IReadOnlyList<Property>>(_properties.OrderBy(p => p.Name, StringComparer.OrdinalIgnoreCase).ToList());

    public Task<Property?> GetAsync(string id, CancellationToken ct = default) =>
        Task.FromResult(_properties.FirstOrDefault(p => string.Equals(p.Id, id, StringComparison.OrdinalIgnoreCase)));

    public Task<string> ReadPostingDocAsync(Property property, CancellationToken ct = default) =>
        Task.FromResult(_docs.TryGetValue(property.Id, out var d) ? d : "");

    public void Refresh() { }
}

public sealed class InMemoryTrackerRepository : ITrackerRepository
{
    private readonly List<PostLogEntry> _posts = new();
    private readonly List<Assignment> _assignments = new();
    private int _nextRow = 2; // mimic sheet rows (row 1 = header)

    public IReadOnlyList<PostLogEntry> Posts => _posts;
    public IReadOnlyList<Assignment> Assignments => _assignments;

    public Task<IReadOnlyList<PostLogEntry>> GetPostsAsync(CancellationToken ct = default) =>
        Task.FromResult<IReadOnlyList<PostLogEntry>>(_posts.ToList());

    public Task<PostLogEntry> AddPostAsync(PostLogEntry entry, CancellationToken ct = default)
    {
        var saved = entry with { Key = (_nextRow++).ToString() };
        _posts.Add(saved);
        return Task.FromResult(saved);
    }

    public Task UpdatePostAsync(PostLogEntry entry, CancellationToken ct = default)
    {
        var i = _posts.FindIndex(p => p.Key == entry.Key);
        if (i < 0) throw new UserFacingException($"Post row {entry.Key} was not found in the tracker.");
        _posts[i] = entry;
        return Task.CompletedTask;
    }

    public Task<IReadOnlyList<Assignment>> GetAssignmentsAsync(CancellationToken ct = default) =>
        Task.FromResult<IReadOnlyList<Assignment>>(_assignments.ToList());

    public Task ReplaceQueueAsync(DateOnly date, string assignedTo, IReadOnlyList<Assignment> items, CancellationToken ct = default)
    {
        var at = _assignments.FindIndex(a => a.Date == date && Same(a.AssignedTo, assignedTo));
        _assignments.RemoveAll(a => a.Date == date && Same(a.AssignedTo, assignedTo));
        var fixedItems = items.Select(a => a with { Key = Assignment.MakeKey(a.Date, a.AssignedTo, a.PropertyName) });
        if (at < 0 || at > _assignments.Count) _assignments.AddRange(fixedItems);
        else _assignments.InsertRange(at, fixedItems);
        return Task.CompletedTask;
    }

    public Task UpdateAssignmentAsync(Assignment assignment, CancellationToken ct = default)
    {
        var i = _assignments.FindIndex(a => a.Key == assignment.Key);
        if (i < 0) throw new UserFacingException("That queue item no longer exists.");
        _assignments[i] = assignment;
        return Task.CompletedTask;
    }

    private static bool Same(string a, string b) => string.Equals(a.Trim(), b.Trim(), StringComparison.OrdinalIgnoreCase);
}

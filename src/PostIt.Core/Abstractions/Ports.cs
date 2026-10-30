namespace PostIt.Core;

// ============================================================================
//  Ports: what the services need from the outside world. The prototype ships
//  local implementations (Infrastructure/); a Google Drive + Sheets version
//  can replace them later without touching services or screens.
// ============================================================================

public interface IClock
{
    DateOnly Today { get; }
    TimeOnly Now { get; }
}

public sealed class SystemClock : IClock
{
    public DateOnly Today => DateOnly.FromDateTime(DateTime.Now);
    public TimeOnly Now => TimeOnly.FromDateTime(DateTime.Now);
}

/// <summary>Fixed/settable clock for tests and demos.</summary>
public sealed class FixedClock(DateOnly today, TimeOnly now) : IClock
{
    public DateOnly Today { get; set; } = today;
    public TimeOnly Now { get; set; } = now;
}

public interface ISettingsStore
{
    /// <summary>%LOCALAPPDATA%\APG.PostIt (or a temp folder in tests).</summary>
    string DataFolder { get; }

    /// <summary>The current settings (cached). Never null.</summary>
    AppSettings Current { get; }

    /// <summary>Persists and replaces <see cref="Current"/>; raises <see cref="Changed"/>.</summary>
    void Save(AppSettings settings);

    event EventHandler? Changed;
}

/// <summary>Reads the property folders. Must notice when Settings.PropertiesFolder changes.</summary>
public interface IPropertyRepository
{
    /// <summary>All properties, sorted by Name. Cached until <see cref="Refresh"/> or the folder setting changes.</summary>
    Task<IReadOnlyList<Property>> GetAllAsync(CancellationToken ct = default);

    Task<Property?> GetAsync(string id, CancellationToken ct = default);

    /// <summary>Raw text of the posting doc (.txt/.md, or the paragraphs of a .docx). "" when there is none.</summary>
    Task<string> ReadPostingDocAsync(Property property, CancellationToken ct = default);

    void Refresh();
}

/// <summary>
/// The posting tracker sheet. Prototype: two CSV files in Settings.TrackerFolder
/// (Posts.csv, Assignments.csv). Throws <see cref="UserFacingException"/> when a file is locked.
/// </summary>
public interface ITrackerRepository
{
    /// <summary>All rows of the Posts tab, in file order (oldest first). Keys are stable row ids.</summary>
    Task<IReadOnlyList<PostLogEntry>> GetPostsAsync(CancellationToken ct = default);

    /// <summary>Appends a row; returns it with its Key filled in.</summary>
    Task<PostLogEntry> AddPostAsync(PostLogEntry entry, CancellationToken ct = default);

    /// <summary>Rewrites the row with the same Key (used to turn Pending into Posted).</summary>
    Task UpdatePostAsync(PostLogEntry entry, CancellationToken ct = default);

    /// <summary>All rows of the Assignments tab, in file order (which is the posting order within a queue).</summary>
    Task<IReadOnlyList<Assignment>> GetAssignmentsAsync(CancellationToken ct = default);

    /// <summary>Replaces every row for (date, assignedTo) with <paramref name="items"/>, in that order.</summary>
    Task ReplaceQueueAsync(DateOnly date, string assignedTo, IReadOnlyList<Assignment> items, CancellationToken ct = default);

    /// <summary>Updates the status of the row with the same Key.</summary>
    Task UpdateAssignmentAsync(Assignment assignment, CancellationToken ct = default);
}

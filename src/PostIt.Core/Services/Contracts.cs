namespace PostIt.Core;

// ============================================================================
//  Service contracts used by the screens. Implementations live next to this
//  file (PostingService, AssignmentService, TrackerService).
// ============================================================================

// ---------- Posting (Phase 1: search → open → copy → log) ----------

public sealed record PropertySummary(
    string Id,
    string Name,
    string Category,
    string? Location,
    CooldownState Cooldown);

public sealed record PropertyDetail(
    Property Property,
    PostingText Text,
    IReadOnlyList<CheckResult> Checks,
    CooldownState Cooldown,
    IReadOnlyList<PostLogEntry> History,   // newest first
    string? DocWarning);                   // e.g. "No posting doc found in this folder."

public sealed record LogPostRequest(
    string PropertyId,
    string FbAccount,
    string PostLink,
    PostStatus Status,
    string PostedBy,
    string? QueueItemKey);

/// <summary>Live preview of what Save will write, recomputed as the intern types.</summary>
/// <param name="Row">The tracker row the app will write ("Written for you").</param>
/// <param name="Problems">Blocking problems in plain English; empty when Save is allowed.</param>
public sealed record LogPreview(
    PostLogEntry Row,
    CooldownState Cooldown,
    IReadOnlyList<string> Problems,
    bool CanSave);

public sealed record LogResult(
    bool Saved,
    string Message,                 // shown to the user either way
    PostLogEntry? Entry,
    IReadOnlyList<string> Problems);

public interface IPostingService
{
    /// <summary>Case-insensitive contains-match on name, category and location. Empty query → all. Sorted by name.</summary>
    Task<IReadOnlyList<PropertySummary>> SearchAsync(string query, CancellationToken ct = default);

    Task<PropertyDetail> OpenAsync(string propertyId, CancellationToken ct = default);

    Task<LogPreview> PreviewLogAsync(LogPostRequest request, CancellationToken ct = default);

    /// <summary>
    /// Validates, refuses inside the cooldown, appends the Posts row and — when QueueItemKey is set —
    /// marks that queue item Posted/Pending. Never throws for validation problems (returns Saved=false).
    /// </summary>
    Task<LogResult> LogPostAsync(LogPostRequest request, CancellationToken ct = default);

    /// <summary>Adds the live link to a Pending post: the row becomes Posted, its queue item too. No cooldown check.</summary>
    Task<LogResult> CompletePendingAsync(string postKey, string liveLink, CancellationToken ct = default);

    Task<PostLogEntry?> GetPostAsync(string postKey, CancellationToken ct = default);

    /// <summary>Rows logged by <paramref name="user"/> on <paramref name="date"/>, newest first.</summary>
    Task<IReadOnlyList<PostLogEntry>> GetPostsByAsync(string user, DateOnly date, CancellationToken ct = default);

    /// <summary>FB accounts from settings, then any others seen in the tracker. Distinct, settings order first.</summary>
    Task<IReadOnlyList<string>> GetFbAccountsAsync(CancellationToken ct = default);

    void RefreshProperties();
}

// ---------- Assignments (Phase 2: manager builds queues, interns work them) ----------

public sealed record QueueItem(
    Assignment Assignment,
    PropertySummary? Property,      // null when the folder no longer exists
    PostLogEntry? Post);            // the row that closed/pended this item, if any

/// <summary>An intern's queue for a date. Items: Pending first (pinned), then ToPost in order, then Posted.</summary>
public sealed record QueueView(
    DateOnly Date,
    string User,
    IReadOnlyList<QueueItem> Items,
    int ToPost,
    int Posted,
    int Pending);

public enum AssignBlock { None, InCooldown, AssignedToSomeoneElse, NotFound }

/// <summary>Whether a property may be added to a queue for a date (cooldown is judged against that date).</summary>
public sealed record AssignCheck(bool CanAdd, AssignBlock Block, string Message, CooldownState Cooldown);

public sealed record AssignCandidate(PropertySummary Property, AssignCheck Check);

public enum PasteMatchKind { Exact, Suggestion, NotFound }

/// <summary>One line of a pasted list matched against the property folders.</summary>
public sealed record PasteMatch(
    string Typed,
    PasteMatchKind Kind,
    PropertySummary? Property,      // the exact match, or the suggestion
    AssignCheck? Check);            // null when NotFound

public interface IAssignmentService
{
    Task<QueueView> GetQueueAsync(string user, DateOnly date, CancellationToken ct = default);

    /// <summary>Search for the Assign screen, each result with its AssignCheck for (user, date).</summary>
    Task<IReadOnlyList<AssignCandidate>> SearchCandidatesAsync(string query, string user, DateOnly date, CancellationToken ct = default);

    Task<AssignCheck> CheckAsync(string propertyId, string user, DateOnly date, CancellationToken ct = default);

    /// <summary>One property name per line; blank lines ignored; leading "1.", "-", "•" stripped.</summary>
    Task<IReadOnlyList<PasteMatch>> MatchPastedListAsync(string text, string user, DateOnly date, CancellationToken ct = default);

    /// <summary>
    /// Saves the queue in this order. Items already in the saved queue keep their status;
    /// new ones are ToPost; removed ones are deleted.
    /// </summary>
    Task SaveQueueAsync(string user, DateOnly date, IReadOnlyList<string> propertyNames, CancellationToken ct = default);

    /// <summary>Number of ToPost + Pending items in the user's queue for the date (nav badge).</summary>
    Task<int> CountOpenAsync(string user, DateOnly date, CancellationToken ct = default);
}

// ---------- Tracker (Phase 2: manager overview) ----------

public sealed record InternProgress(AppUser User, int Total, int Posted, int Pending, int ToPost)
{
    public bool Done => Total > 0 && ToPost == 0 && Pending == 0;
}

public enum AttentionKind { DueForRepost, NeverPosted }

public sealed record AttentionItem(PropertySummary Property, AttentionKind Kind, string Detail);

public sealed record TrackerDashboard(
    DateOnly Date,
    int PostedToday,
    int PendingOpen,                        // all Pending rows, any date
    int InternsDone,
    int InternsAssigned,
    int DueForRepost,
    int NeverPosted,
    IReadOnlyList<PostLogEntry> TodaysPosts,   // newest first
    IReadOnlyList<InternProgress> Interns,     // every intern in settings, assigned ones first
    IReadOnlyList<AttentionItem> NeedsAttention); // never posted first, then longest since posted

public interface ITrackerService
{
    Task<TrackerDashboard> GetDashboardAsync(DateOnly date, CancellationToken ct = default);
}

// ---------- Sample data ----------

public interface ISampleData
{
    /// <summary>First run: copy the bundled sample folders, write a tracker with history relative to today, point settings at it.</summary>
    void EnsureSeeded();

    /// <summary>Wipe and recreate the PROTOTYPE sample data (dates recomputed from today) and point settings back at it.</summary>
    void Reset();
}

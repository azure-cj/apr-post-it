using System.Globalization;
using System.Text.Json.Serialization;

namespace PostIt.Core.Google;

// ============================================================================
//  ITrackerRepository over the Apps Script backend.
//
//  Rows live in the company's existing tracker sheet, in its existing column
//  order — the script finds each column by header name. Two things that were
//  local checks become server guarantees here: the cooldown, and who a post is
//  credited to.
// ============================================================================

public sealed class ScriptTrackerRepository : ITrackerRepository
{
    private readonly IScriptClient _client;

    public ScriptTrackerRepository(IScriptClient client) => _client = client;

    // ------------------------------------------------------------ posts

    public async Task<IReadOnlyList<PostLogEntry>> GetPostsAsync(CancellationToken ct = default)
    {
        var reply = await _client.CallAsync<PostsReply>("posts", null, ct).ConfigureAwait(false);
        return reply.Posts.Select(ToEntry).ToList();
    }

    public async Task<PostLogEntry> AddPostAsync(PostLogEntry entry, CancellationToken ct = default)
    {
        // Date, time and Posted By are decided by the server: the clock is shared
        // and the name comes from the key, so neither can drift or be spoofed.
        var reply = await _client.CallAsync<LogPostReply>("logPost", new
        {
            property = entry.Title,
            propertyId = "",
            type = entry.Type,
            fbAccount = entry.FbAccount,
            postLink = entry.PostLink,
            postedBy = entry.PostedBy,
        }, ct).ConfigureAwait(false);

        var date = ParseDate(reply.Date) ?? entry.Date;
        return entry with
        {
            Key = MakeKey(date, entry.Title),
            Date = date,
            Status = reply.Status == "Pending" ? PostStatus.Pending : PostStatus.Posted,
            PostedBy = string.IsNullOrWhiteSpace(reply.PostedBy) ? entry.PostedBy : reply.PostedBy,
        };
    }

    /// <summary>
    /// The only update the tracker allows is completing a pending post with its live
    /// link. Anything else is a correction, and corrections are made in the sheet.
    /// </summary>
    public async Task UpdatePostAsync(PostLogEntry entry, CancellationToken ct = default)
    {
        if (entry.Status != PostStatus.Posted || string.IsNullOrWhiteSpace(entry.PostLink))
            throw new UserFacingException("Only adding the live link to a pending post can be saved from here. Edit the sheet for anything else.");

        await _client.CallAsync<ScriptReply>("addLink", new
        {
            property = entry.Title,
            postLink = entry.PostLink,
        }, ct).ConfigureAwait(false);
    }

    // ------------------------------------------------------ assignments

    public async Task<IReadOnlyList<Assignment>> GetAssignmentsAsync(CancellationToken ct = default)
    {
        var reply = await _client.CallAsync<AssignmentsReply>("assignments", null, ct).ConfigureAwait(false);

        return reply.Assignments
            .Select(r =>
            {
                var date = ParseDate(r.Date) ?? default;
                return new Assignment(
                    Key: Assignment.MakeKey(date, r.AssignedTo ?? "", r.Property ?? ""),
                    Date: date,
                    AssignedTo: r.AssignedTo ?? "",
                    PropertyName: r.Property ?? "",
                    Status: ToStatus(r.Status));
            })
            .ToList();
    }

    public async Task ReplaceQueueAsync(
        DateOnly date, string assignedTo, IReadOnlyList<Assignment> items, CancellationToken ct = default)
    {
        await _client.CallAsync<ScriptReply>("saveQueue", new
        {
            date = date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            assignedTo,
            items = items.Select(i => new { property = i.PropertyName, status = Label(i.Status) }).ToList(),
        }, ct).ConfigureAwait(false);
    }

    public async Task UpdateAssignmentAsync(Assignment assignment, CancellationToken ct = default)
    {
        await _client.CallAsync<ScriptReply>("setStatus", new
        {
            property = assignment.PropertyName,
            assignedTo = assignment.AssignedTo,
            status = Label(assignment.Status),
        }, ct).ConfigureAwait(false);
    }

    // ------------------------------------------------------------ mapping

    private static PostLogEntry ToEntry(PostRow r)
    {
        var date = ParseDate(r.Date) ?? default;
        return new PostLogEntry(
            Key: MakeKey(date, r.Title ?? ""),
            Date: date,
            Time: ParseTime(r.Time),
            Type: r.Type ?? "",
            Title: r.Title ?? "",
            Status: string.Equals(r.Status, "Pending", StringComparison.OrdinalIgnoreCase)
                ? PostStatus.Pending : PostStatus.Posted,
            FbAccount: r.FbAccount ?? "",
            PostLink: r.PostLink ?? "",
            PostedBy: r.PostedBy ?? "");
    }

    private static string MakeKey(DateOnly date, string title) => $"{date:yyyy-MM-dd}|{title.Trim()}";

    private static AssignmentStatus ToStatus(string? s) => s?.Trim().ToLowerInvariant() switch
    {
        "posted" => AssignmentStatus.Posted,
        "pending" => AssignmentStatus.Pending,
        _ => AssignmentStatus.ToPost,
    };

    private static string Label(AssignmentStatus s) => s switch
    {
        AssignmentStatus.Posted => "Posted",
        AssignmentStatus.Pending => "Pending",
        _ => "To post",
    };

    /// <summary>Sheets can hand back a date as text or as a serialised date; accept both.</summary>
    private static DateOnly? ParseDate(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        if (DateOnly.TryParse(raw, CultureInfo.InvariantCulture, DateTimeStyles.None, out var d)) return d;
        if (DateTime.TryParse(raw, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var dt))
            return DateOnly.FromDateTime(dt);
        return null;
    }

    private static TimeOnly ParseTime(string? raw) =>
        TimeOnly.TryParse(raw, CultureInfo.InvariantCulture, DateTimeStyles.None, out var t) ? t : default;
}

// ---------------------------------------------------------------- payloads

public sealed class PostsReply : ScriptReply
{
    [JsonPropertyName("posts")] public List<PostRow> Posts { get; set; } = new();
}

public sealed class PostRow
{
    public string? Date { get; set; }
    public string? Type { get; set; }
    public string? Title { get; set; }
    public string? Time { get; set; }
    public string? Status { get; set; }
    public string? FbAccount { get; set; }
    public string? PostLink { get; set; }
    public string? PostedBy { get; set; }
    public string? PropertyId { get; set; }
}

public sealed class AssignmentsReply : ScriptReply
{
    [JsonPropertyName("assignments")] public List<AssignmentRow> Assignments { get; set; } = new();
}

public sealed class AssignmentRow
{
    public string? Date { get; set; }
    public string? AssignedTo { get; set; }
    public string? Property { get; set; }
    public string? Status { get; set; }
    public string? PropertyId { get; set; }
}

public sealed class LogPostReply : ScriptReply
{
    public string? Status { get; set; }
    public string? Date { get; set; }
    public string? PostedBy { get; set; }
}

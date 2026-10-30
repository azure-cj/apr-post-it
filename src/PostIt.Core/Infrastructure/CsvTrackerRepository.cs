using System.Globalization;

namespace PostIt.Core;

/// <summary>
/// The tracker sheet as two CSV files in <see cref="AppSettings.TrackerFolder"/>, one per tab:
/// <c>Posts.csv</c> (Date, Type, Title, Time, Status, FB Account, Post Link, Posted By) and
/// <c>Assignments.csv</c> (Date, Assigned To, Property, Status). Both open cleanly in Excel.
/// <para>A post's Key is its sheet row number ("2" is the first data row). Rows are only ever appended
/// or updated in place, so keys stay valid. Rows the app can't read are kept exactly as they are.</para>
/// </summary>
public sealed class CsvTrackerRepository : ITrackerRepository
{
    internal const string PostsFileName = "Posts.csv";
    internal const string AssignmentsFileName = "Assignments.csv";
    internal static readonly string[] PostsHeader = { "Date", "Type", "Title", "Time", "Status", "FB Account", "Post Link", "Posted By" };
    internal static readonly string[] AssignmentsHeader = { "Date", "Assigned To", "Property", "Status" };

    private const string DateFormat = "yyyy-MM-dd";
    private const string TimeFormat = "HH:mm";
    private static readonly string[] DateFormats = { DateFormat, "yyyy/M/d", "M/d/yyyy", "M/d/yy", "d-MMM-yyyy", "d-MMM-yy", "d MMM yyyy" };
    private static readonly string[] TimeFormats = { TimeFormat, "H:mm", "HH:mm:ss", "H:mm:ss", "h:mm tt", "h:mm:ss tt" };

    private readonly ISettingsStore _settings;
    private readonly SemaphoreSlim _gate = new(1, 1);

    /// <summary>Uses the tracker folder named in <paramref name="settings"/> (re-read on every call).</summary>
    public CsvTrackerRepository(ISettingsStore settings) => _settings = settings;

    // ---------------------------------------------------------------- Posts tab

    /// <inheritdoc />
    public Task<IReadOnlyList<PostLogEntry>> GetPostsAsync(CancellationToken ct = default) =>
        Run<IReadOnlyList<PostLogEntry>>(() => ReadPosts(LoadPosts()).ToList(), ct);

    /// <inheritdoc />
    public Task<PostLogEntry> AddPostAsync(PostLogEntry entry, CancellationToken ct = default) => Run(() =>
    {
        var (sheet, path) = (LoadPosts(), PostsPath());
        sheet.Append(WritePost(BlankRow(sheet), PostColumns.Of(sheet), entry));
        sheet.Save(path);
        return entry with { Key = RowKey(sheet.Rows.Count - 1) };
    }, ct);

    /// <inheritdoc />
    public Task UpdatePostAsync(PostLogEntry entry, CancellationToken ct = default) => Run(() =>
    {
        var (sheet, path) = (LoadPosts(), PostsPath());
        var columns = PostColumns.Of(sheet);
        if (!int.TryParse(entry.Key, NumberStyles.None, CultureInfo.InvariantCulture, out var rowNumber)
            || rowNumber < 2 || rowNumber - 2 >= sheet.Rows.Count)
            throw new UserFacingException($"Post row {entry.Key} was not found in the tracker.");

        var index = rowNumber - 2;
        var current = TryReadPost(sheet.Rows[index], columns, entry.Key);
        if (current is null || PropertyNameMatcher.Normalize(current.Title) != PropertyNameMatcher.Normalize(entry.Title))
            throw new UserFacingException($"{PostsFileName} changed since it was loaded (were rows added or deleted in Excel?). Go back and try again.");

        sheet.Rows[index] = WritePost(sheet.Rows[index], columns, entry);
        sheet.Save(path);
        return true;
    }, ct);

    // ---------------------------------------------------------------- Assignments tab

    /// <inheritdoc />
    public Task<IReadOnlyList<Assignment>> GetAssignmentsAsync(CancellationToken ct = default) =>
        Run<IReadOnlyList<Assignment>>(() => ReadAssignments(LoadAssignments()).Select(x => x.Assignment).ToList(), ct);

    /// <inheritdoc />
    public Task ReplaceQueueAsync(DateOnly date, string assignedTo, IReadOnlyList<Assignment> items, CancellationToken ct = default) => Run(() =>
    {
        var (sheet, path) = (LoadAssignments(), AssignmentsPath());
        var columns = AssignmentColumns.Of(sheet);

        var at = -1;
        foreach (var (index, a) in ReadAssignments(sheet).Reverse())
        {
            if (a.Date != date || !Wording.SamePerson(a.AssignedTo, assignedTo)) continue;
            sheet.Rows.RemoveAt(index);
            at = index;
        }

        var rows = items.Select(a => WriteAssignment(BlankRow(sheet), columns, a)).ToList();
        if (at < 0) rows.ForEach(sheet.Append);
        else sheet.Rows.InsertRange(at, rows);
        sheet.Save(path);
        return true;
    }, ct);

    /// <inheritdoc />
    public Task UpdateAssignmentAsync(Assignment assignment, CancellationToken ct = default) => Run(() =>
    {
        var (sheet, path) = (LoadAssignments(), AssignmentsPath());
        var match = ReadAssignments(sheet).FirstOrDefault(x => string.Equals(x.Assignment.Key, assignment.Key, StringComparison.OrdinalIgnoreCase));
        if (match.Assignment is null) throw new UserFacingException("That queue item no longer exists.");

        sheet.Rows[match.Index] = WriteAssignment(sheet.Rows[match.Index], AssignmentColumns.Of(sheet), match.Assignment with { Status = assignment.Status });
        sheet.Save(path);
        return true;
    }, ct);

    // ---------------------------------------------------------------- seeding

    /// <summary>Writes both tabs from scratch into <paramref name="folder"/> (used by the sample-data seeder).</summary>
    internal static void WriteNew(string folder, IEnumerable<PostLogEntry> posts, IEnumerable<Assignment> assignments)
    {
        Directory.CreateDirectory(folder);

        var postSheet = CsvSheet.Empty(PostsHeader);
        foreach (var post in posts) postSheet.Append(WritePost(BlankRow(postSheet), PostColumns.Of(postSheet), post));
        postSheet.Save(Path.Combine(folder, PostsFileName));

        var assignmentSheet = CsvSheet.Empty(AssignmentsHeader);
        foreach (var a in assignments) assignmentSheet.Append(WriteAssignment(BlankRow(assignmentSheet), AssignmentColumns.Of(assignmentSheet), a));
        assignmentSheet.Save(Path.Combine(folder, AssignmentsFileName));
    }

    // ---------------------------------------------------------------- rows ↔ records

    /// <summary>Column positions in this file (people may move or add columns in Excel).</summary>
    private sealed record PostColumns(int Date, int Type, int Title, int Time, int Status, int Account, int Link, int By)
    {
        public static PostColumns Of(CsvSheet s) => new(
            s.Column("Date", 0), s.Column("Type", 1), s.Column("Title", 2), s.Column("Time", 3),
            s.Column("Status", 4), s.Column("FB Account", 5), s.Column("Post Link", 6), s.Column("Posted By", 7));
    }

    private sealed record AssignmentColumns(int Date, int AssignedTo, int Property, int Status)
    {
        public static AssignmentColumns Of(CsvSheet s) => new(
            s.Column("Date", 0), s.Column("Assigned To", 1), s.Column("Property", 2), s.Column("Status", 3));
    }

    private static IEnumerable<PostLogEntry> ReadPosts(CsvSheet sheet)
    {
        var columns = PostColumns.Of(sheet);
        for (var i = 0; i < sheet.Rows.Count; i++)
            if (TryReadPost(sheet.Rows[i], columns, RowKey(i)) is { } post) yield return post;
    }

    private static PostLogEntry? TryReadPost(CsvRow row, PostColumns c, string key)
    {
        var title = row.Get(c.Title);
        if (title.Length == 0 || !TryParseDate(row.Get(c.Date), out var date) || !TryParsePostStatus(row.Get(c.Status), out var status))
            return null;
        var time = TryParseTime(row.Get(c.Time), out var t) ? t : TimeOnly.MinValue;
        return new PostLogEntry(key, date, time, row.Get(c.Type), title, status, row.Get(c.Account), row.Get(c.Link), row.Get(c.By));
    }

    private static CsvRow WritePost(CsvRow row, PostColumns c, PostLogEntry e) => row.With(
        (c.Date, e.Date.ToString(DateFormat, CultureInfo.InvariantCulture)),
        (c.Type, e.Type),
        (c.Title, e.Title),
        (c.Time, e.Time.ToString(TimeFormat, CultureInfo.InvariantCulture)),
        (c.Status, e.Status == PostStatus.Pending ? "Pending" : "Posted"),
        (c.Account, e.FbAccount),
        (c.Link, e.PostLink),
        (c.By, e.PostedBy));

    /// <summary>Readable rows with their index in <see cref="CsvSheet.Rows"/>.</summary>
    private static IEnumerable<(int Index, Assignment Assignment)> ReadAssignments(CsvSheet sheet)
    {
        var c = AssignmentColumns.Of(sheet);
        for (var i = 0; i < sheet.Rows.Count; i++)
        {
            var row = sheet.Rows[i];
            var (assignedTo, property) = (row.Get(c.AssignedTo), row.Get(c.Property));
            if (assignedTo.Length == 0 || property.Length == 0 || !TryParseDate(row.Get(c.Date), out var date)
                || !TryParseAssignmentStatus(row.Get(c.Status), out var status))
                continue;
            yield return (i, new Assignment(Assignment.MakeKey(date, assignedTo, property), date, assignedTo, property, status));
        }
    }

    private static CsvRow WriteAssignment(CsvRow row, AssignmentColumns c, Assignment a) => row.With(
        (c.Date, a.Date.ToString(DateFormat, CultureInfo.InvariantCulture)),
        (c.AssignedTo, a.AssignedTo.Trim()),
        (c.Property, a.PropertyName.Trim()),
        (c.Status, a.Status switch { AssignmentStatus.Posted => "Posted", AssignmentStatus.Pending => "Pending", _ => "To post" }));

    private static CsvRow BlankRow(CsvSheet sheet) => CsvRow.From(new string[sheet.Header.Fields.Count].Select(_ => ""));

    private static string RowKey(int rowIndex) => (rowIndex + 2).ToString(CultureInfo.InvariantCulture);

    private static bool TryParseDate(string s, out DateOnly date) =>
        DateOnly.TryParseExact(s, DateFormats, CultureInfo.InvariantCulture, DateTimeStyles.AllowWhiteSpaces, out date);

    private static bool TryParseTime(string s, out TimeOnly time) =>
        TimeOnly.TryParseExact(s, TimeFormats, CultureInfo.InvariantCulture, DateTimeStyles.AllowWhiteSpaces, out time);

    /// <summary>"Posted" / "Pending" (any case). A blank status counts as Posted (a row typed in by hand).</summary>
    private static bool TryParsePostStatus(string s, out PostStatus status)
    {
        status = PostStatus.Posted;
        if (s.Length == 0 || s.Equals("Posted", StringComparison.OrdinalIgnoreCase)) return true;
        if (!s.Equals("Pending", StringComparison.OrdinalIgnoreCase)) return false;
        status = PostStatus.Pending;
        return true;
    }

    /// <summary>"To post" / "ToPost" / "Pending" / "Posted" (any case). Blank means To post.</summary>
    private static bool TryParseAssignmentStatus(string s, out AssignmentStatus status)
    {
        switch (s.Replace(" ", "").ToLowerInvariant())
        {
            case "" or "topost": status = AssignmentStatus.ToPost; return true;
            case "pending": status = AssignmentStatus.Pending; return true;
            case "posted": status = AssignmentStatus.Posted; return true;
            default: status = default; return false;
        }
    }

    // ---------------------------------------------------------------- files

    private CsvSheet LoadPosts() => CsvSheet.Load(PostsPath(), PostsHeader);
    private CsvSheet LoadAssignments() => CsvSheet.Load(AssignmentsPath(), AssignmentsHeader);
    private string PostsPath() => Path.Combine(TrackerFolder(), PostsFileName);
    private string AssignmentsPath() => Path.Combine(TrackerFolder(), AssignmentsFileName);

    /// <summary>The tracker folder from settings, created if it doesn't exist yet.</summary>
    private string TrackerFolder()
    {
        var folder = _settings.Current.TrackerFolder?.Trim() ?? "";
        if (folder.Length == 0) throw new UserFacingException("No tracker folder is set. Choose one in Settings.");
        try
        {
            Directory.CreateDirectory(folder);
            return folder;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException)
        {
            throw new UserFacingException($"The tracker folder \"{folder}\" can't be opened. Check Settings.", ex);
        }
    }

    /// <summary>One file operation at a time (read, change, write), off the UI thread.</summary>
    private async Task<T> Run<T>(Func<T> work, CancellationToken ct)
    {
        await _gate.WaitAsync(ct).ConfigureAwait(false);
        try { return await Task.Run(work, ct).ConfigureAwait(false); }
        finally { _gate.Release(); }
    }
}

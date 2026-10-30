namespace PostIt.Core;

// ============================================================================
//  Domain model. Shared contract for every layer — change only with care.
// ============================================================================

public enum UserRole { Intern, Manager }

public sealed record AppUser(string Name, UserRole Role)
{
    /// <summary>First letters of the first two words: "Jan Dela Cruz" → "JD", "Bea Lim" → "BL".</summary>
    public string Initials
    {
        get
        {
            var parts = Name.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length == 0) return "?";
            if (parts.Length == 1) return parts[0][..Math.Min(2, parts[0].Length)].ToUpperInvariant();
            return $"{char.ToUpperInvariant(parts[0][0])}{char.ToUpperInvariant(parts[1][0])}";
        }
    }

    public string RoleLabel => Role == UserRole.Manager ? "Manager" : "Intern";
}

/// <summary>One property folder (Drive folder in production, a local folder in the prototype).</summary>
/// <param name="Id">Stable id: the folder path relative to the properties root, using '/' separators.</param>
/// <param name="Name">Folder name — this is the "Title" written to the tracker.</param>
/// <param name="Category">Lot, House &amp; Lot, Condo, Commercial… ("Type" in the tracker).</param>
public sealed record Property(
    string Id,
    string Name,
    string Category,
    string? Location,
    string FolderPath,
    string? PostingDocPath,
    IReadOnlyList<string> PhotoPaths);

/// <summary>The posting doc split into the part that may be posted and the part that may not.</summary>
public sealed record PostingText(
    string PublicText,
    string InternalText,
    bool HasInternalSection,
    string? Category,
    string? Location);

public enum CheckStatus { Pass, Warn, Fail }

/// <summary>One pre-post check line, e.g. ("Price present", Pass, "₱4.2M").</summary>
public sealed record CheckResult(string Name, CheckStatus Status, string Detail);

public enum PostStatus { Posted, Pending }

/// <summary>A row of the "Posts" tab of the tracker sheet.</summary>
/// <param name="Key">Opaque id assigned by the repository ("" for a row not yet saved).</param>
public sealed record PostLogEntry(
    string Key,
    DateOnly Date,
    TimeOnly Time,
    string Type,
    string Title,
    PostStatus Status,
    string FbAccount,
    string PostLink,
    string PostedBy);

public enum AssignmentStatus { ToPost, Pending, Posted }

/// <summary>A row of the "Assignments" tab (Phase 2): Date, Assigned to, Property, Status. Row order = posting order.</summary>
/// <param name="Key">Natural key: "yyyy-MM-dd|Assigned to|Property" (see <see cref="MakeKey"/>).</param>
public sealed record Assignment(
    string Key,
    DateOnly Date,
    string AssignedTo,
    string PropertyName,
    AssignmentStatus Status)
{
    public static string MakeKey(DateOnly date, string assignedTo, string propertyName) =>
        $"{date:yyyy-MM-dd}|{assignedTo.Trim()}|{propertyName.Trim()}";
}

/// <summary>Result of applying the repost rules to a property's last-posted date.</summary>
/// <param name="LastPosted">Most recent Posted or Pending row for the property, or null.</param>
/// <param name="DaysSince">Whole days between LastPosted and the evaluation date.</param>
/// <param name="InCooldown">True when DaysSince &lt; CooldownDays (posting is refused).</param>
/// <param name="DaysLeft">Days until AvailableOn (0 when not in cooldown).</param>
/// <param name="AvailableOn">LastPosted + CooldownDays.</param>
/// <param name="DueForRepost">Not posted for RepostDueDays or more.</param>
/// <param name="NeverPosted">No rows at all.</param>
public sealed record CooldownState(
    DateOnly? LastPosted,
    int? DaysSince,
    bool InCooldown,
    int DaysLeft,
    DateOnly? AvailableOn,
    bool DueForRepost,
    bool NeverPosted)
{
    public static CooldownState Never { get; } = new(null, null, false, 0, null, true, true);
}

/// <summary>Prototype settings, stored as JSON in %LOCALAPPDATA%\APG.PostIt\settings.json.</summary>
public sealed class AppSettings
{
    /// <summary>Root of the property folders: &lt;root&gt;/&lt;Category&gt;/&lt;Property&gt;/ (or &lt;root&gt;/&lt;Property&gt;/).</summary>
    public string PropertiesFolder { get; set; } = "";

    /// <summary>Folder holding Posts.csv and Assignments.csv (the two tabs of the tracker sheet).</summary>
    public string TrackerFolder { get; set; } = "";

    public int CooldownDays { get; set; } = 7;
    public int RepostDueDays { get; set; } = 14;

    public List<string> FbAccounts { get; set; } = new();
    public List<AppUser> Users { get; set; } = new();

    /// <summary>True while the app is pointed at the bundled PROTOTYPE sample data.</summary>
    public bool UsingSampleData { get; set; }

    /// <summary>The Apps Script web app's /exec link. Set = use Drive and the tracker sheet instead of local folders.</summary>
    public string ScriptUrl { get; set; } = "";

    /// <summary>This person's key from the Team tab. It is also their identity: the server reads their role from it.</summary>
    public string ScriptKey { get; set; } = "";

    /// <summary>True once both the web app link and a key are set.</summary>
    public bool UsingGoogle => !string.IsNullOrWhiteSpace(ScriptUrl) && !string.IsNullOrWhiteSpace(ScriptKey);

    public string? LastUserName { get; set; }

    public AppSettings Clone() => new()
    {
        PropertiesFolder = PropertiesFolder,
        TrackerFolder = TrackerFolder,
        CooldownDays = CooldownDays,
        RepostDueDays = RepostDueDays,
        FbAccounts = new List<string>(FbAccounts),
        Users = new List<AppUser>(Users),
        UsingSampleData = UsingSampleData,
        ScriptUrl = ScriptUrl,
        ScriptKey = ScriptKey,
        LastUserName = LastUserName,
    };
}

/// <summary>Thrown for problems the user can fix (file open in Excel, folder missing…). Message is shown as-is.</summary>
public sealed class UserFacingException(string message, Exception? inner = null) : Exception(message, inner);

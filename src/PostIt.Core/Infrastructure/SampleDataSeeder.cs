namespace PostIt.Core;

/// <summary>
/// The PROTOTYPE sample data: copies the bundled property folders into <c>&lt;DataFolder&gt;/PROTOTYPE-sample</c>,
/// writes a tracker whose dates are relative to today (so the demo always shows the same situations),
/// and points the settings at it.
/// </summary>
public sealed class SampleDataSeeder : ISampleData
{
    private const string SampleFolderName = "PROTOTYPE-sample";

    private const string Jan = "Jan Dela Cruz", Mika = "Mika Reyes", Paolo = "Paolo Santos", Bea = "Bea Lim";
    private const string Cavite = "APG Homes Cavite", PhAccount = "APG Properties PH", Listings = "Alpha Premier Listings";

    private readonly ISettingsStore _settings;
    private readonly IClock _clock;
    private readonly string _bundledSampleFolder;

    /// <param name="settings">Where to point PropertiesFolder/TrackerFolder.</param>
    /// <param name="clock">"Today" for the seeded history.</param>
    /// <param name="bundledSampleFolder">The app's SampleData folder (contains <c>Properties/</c>).</param>
    public SampleDataSeeder(ISettingsStore settings, IClock clock, string bundledSampleFolder)
    {
        _settings = settings;
        _clock = clock;
        _bundledSampleFolder = bundledSampleFolder;
    }

    private string SampleRoot => Path.Combine(_settings.DataFolder, SampleFolderName);

    /// <inheritdoc />
    public void EnsureSeeded()
    {
        var s = _settings.Current;
        var noFolderYet = string.IsNullOrWhiteSpace(s.PropertiesFolder);
        var sampleMissing = s.UsingSampleData && (!Directory.Exists(s.PropertiesFolder) || !Directory.Exists(SampleRoot));
        if (noFolderYet || sampleMissing) Reset();
    }

    /// <inheritdoc />
    public void Reset()
    {
        var root = SampleRoot;
        var properties = Path.Combine(root, "Properties");
        var tracker = Path.Combine(root, "Tracker");
        try
        {
            DeleteFolder(root);
            CopyFolder(Path.Combine(_bundledSampleFolder, "Properties"), properties);
            Directory.CreateDirectory(properties);
            CsvTrackerRepository.WriteNew(tracker, SeedPosts(_clock.Today), SeedAssignments(_clock.Today));
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            throw new UserFacingException("The sample data is open in another program (Excel?). Close it and try again.", ex);
        }

        var s = _settings.Current.Clone();
        s.PropertiesFolder = properties;
        s.TrackerFolder = tracker;
        s.UsingSampleData = true;
        s.CooldownDays = 7;
        s.RepostDueDays = 14;
        s.FbAccounts = new List<string> { Cavite, PhAccount, Listings };
        s.Users = new List<AppUser>
        {
            new("Maria Santos", UserRole.Manager),
            new(Jan, UserRole.Intern), new(Mika, UserRole.Intern), new(Paolo, UserRole.Intern), new(Bea, UserRole.Intern),
        };
        _settings.Save(s);
    }

    // ---------------------------------------------------------------- seed tracker

    private static readonly Dictionary<string, string> Categories = new()
    {
        ["Verdant Hills Lot 12"] = "Lot", ["Verdant Hills Lot 7"] = "Lot", ["Verdant Hills Lot 3"] = "Lot",
        ["Greenfield Farm Lot"] = "Lot", ["Antipolo Ridge Lot 18"] = "Lot", ["Sta. Rosa Lot 22"] = "Lot",
        ["Casa Amara House & Lot"] = "House & Lot", ["Sunrise Homes Block 3 Lot 9"] = "House & Lot", ["Imus Townhomes Phase 2"] = "House & Lot",
        ["Villa Rosario Unit 4B"] = "Condo", ["Lakeshore Villas Unit 7"] = "Condo", ["Seaside Residences 2BR"] = "Condo",
        ["Mabini Commercial Space"] = "Commercial", ["Prime Tower Office 1201"] = "Commercial",
    };

    /// <summary>
    /// The Posts tab as of <paramref name="today"/>, oldest first. Last posted: Verdant Hills Lot 12 26 days ago (due),
    /// Lot 7 2 days ago (cooldown), Lot 3 21 days ago, Villa Rosario yesterday, Mabini 32, Greenfield 18; Seaside and
    /// Sta. Rosa never. Today: 4 posted (Jan, Bea, Paolo, Mika) and 2 pending (Casa Amara by Jan, Prime Tower by Bea).
    /// </summary>
    internal static IReadOnlyList<PostLogEntry> SeedPosts(DateOnly today)
    {
        var rows = new (string Title, int DaysAgo, string Time, string By, string Account, PostStatus Status)[]
        {
            // The facts the demo relies on.
            ("Verdant Hills Lot 12", 26, "14:05", Jan, Cavite, PostStatus.Posted),
            ("Verdant Hills Lot 7", 20, "10:12", Mika, PhAccount, PostStatus.Posted),
            ("Verdant Hills Lot 7", 2, "15:40", Jan, Cavite, PostStatus.Posted),
            ("Verdant Hills Lot 3", 21, "09:55", Paolo, Listings, PostStatus.Posted),
            ("Villa Rosario Unit 4B", 1, "16:22", Jan, PhAccount, PostStatus.Posted),
            ("Casa Amara House & Lot", 15, "11:03", Bea, Cavite, PostStatus.Posted),
            ("Casa Amara House & Lot", 0, "10:31", Jan, Cavite, PostStatus.Pending),
            ("Sunrise Homes Block 3 Lot 9", 0, "10:17", Jan, Listings, PostStatus.Posted),
            ("Mabini Commercial Space", 32, "13:48", Mika, PhAccount, PostStatus.Posted),
            ("Greenfield Farm Lot", 18, "10:40", Paolo, Cavite, PostStatus.Posted),
            ("Antipolo Ridge Lot 18", 12, "15:15", Bea, Listings, PostStatus.Posted),
            ("Antipolo Ridge Lot 18", 0, "11:36", Mika, PhAccount, PostStatus.Posted),
            ("Lakeshore Villas Unit 7", 0, "11:20", Paolo, Listings, PostStatus.Posted),
            ("Imus Townhomes Phase 2", 0, "10:58", Bea, Cavite, PostStatus.Posted),
            ("Prime Tower Office 1201", 40, "09:30", Jan, PhAccount, PostStatus.Posted),
            ("Prime Tower Office 1201", 0, "11:52", Bea, PhAccount, PostStatus.Pending),
            // Older history for realism (each older than that property's last post).
            ("Mabini Commercial Space", 45, "10:20", Bea, Listings, PostStatus.Posted),
            ("Casa Amara House & Lot", 44, "14:30", Jan, Cavite, PostStatus.Posted),
            ("Verdant Hills Lot 12", 41, "09:15", Mika, Cavite, PostStatus.Posted),
            ("Verdant Hills Lot 3", 38, "16:05", Jan, PhAccount, PostStatus.Posted),
            ("Verdant Hills Lot 7", 34, "11:45", Bea, Listings, PostStatus.Posted),
            ("Greenfield Farm Lot", 33, "13:10", Jan, PhAccount, PostStatus.Posted),
            ("Imus Townhomes Phase 2", 30, "10:05", Paolo, Cavite, PostStatus.Posted),
            ("Antipolo Ridge Lot 18", 27, "15:50", Mika, Listings, PostStatus.Posted),
            ("Villa Rosario Unit 4B", 23, "09:40", Bea, PhAccount, PostStatus.Posted),
            ("Sunrise Homes Block 3 Lot 9", 22, "14:15", Paolo, Cavite, PostStatus.Posted),
            ("Lakeshore Villas Unit 7", 19, "11:25", Jan, Listings, PostStatus.Posted),
            ("Imus Townhomes Phase 2", 16, "16:30", Mika, PhAccount, PostStatus.Posted),
            ("Villa Rosario Unit 4B", 9, "10:50", Paolo, Cavite, PostStatus.Posted),
            ("Lakeshore Villas Unit 7", 5, "13:35", Bea, PhAccount, PostStatus.Posted),
        };

        return rows
            .Select((r, i) => new PostLogEntry(
                Key: "",
                Date: today.AddDays(-r.DaysAgo),
                Time: TimeOnly.ParseExact(r.Time, "HH:mm", System.Globalization.CultureInfo.InvariantCulture),
                Type: Categories[r.Title],
                Title: r.Title,
                Status: r.Status,
                FbAccount: r.Account,
                PostLink: r.Status == PostStatus.Posted ? SampleLink(r.Account, i) : "",
                PostedBy: r.By))
            .OrderBy(p => p.Date).ThenBy(p => p.Time)
            .ToList();
    }

    /// <summary>Queues: today for all four interns (Jan's has one of each status), yesterday's for Jan; tomorrow is left empty.</summary>
    internal static IReadOnlyList<Assignment> SeedAssignments(DateOnly today)
    {
        var yesterday = today.AddDays(-1);
        Assignment A(DateOnly date, string who, string property, AssignmentStatus status) =>
            new(Assignment.MakeKey(date, who, property), date, who, property, status);

        return new[]
        {
            A(yesterday, Jan, "Villa Rosario Unit 4B", AssignmentStatus.Posted),
            A(today, Jan, "Casa Amara House & Lot", AssignmentStatus.Pending),
            A(today, Jan, "Sunrise Homes Block 3 Lot 9", AssignmentStatus.Posted),
            A(today, Jan, "Verdant Hills Lot 12", AssignmentStatus.ToPost),
            A(today, Jan, "Seaside Residences 2BR", AssignmentStatus.ToPost),
            A(today, Jan, "Mabini Commercial Space", AssignmentStatus.ToPost),
            A(today, Jan, "Greenfield Farm Lot", AssignmentStatus.ToPost),
            A(today, Mika, "Antipolo Ridge Lot 18", AssignmentStatus.Posted),
            A(today, Paolo, "Lakeshore Villas Unit 7", AssignmentStatus.Posted),
            A(today, Bea, "Imus Townhomes Phase 2", AssignmentStatus.Posted),
            A(today, Bea, "Prime Tower Office 1201", AssignmentStatus.Pending),
            A(today, Bea, "Sta. Rosa Lot 22", AssignmentStatus.ToPost),
        };
    }

    /// <summary>A plausible, unique group-post link.</summary>
    private static string SampleLink(string account, int index)
    {
        var group = account switch { Cavite => "apghomescavite", PhAccount => "phrealestatebuyandsell", _ => "alphapremierlistings" };
        return $"https://www.facebook.com/groups/{group}/posts/{1084512730024318L + index * 7919L}/";
    }

    // ---------------------------------------------------------------- folders

    private static void DeleteFolder(string folder)
    {
        if (!Directory.Exists(folder)) return;
        foreach (var file in Directory.EnumerateFiles(folder, "*", SearchOption.AllDirectories))
            File.SetAttributes(file, FileAttributes.Normal); // copies from a read-only install folder
        Directory.Delete(folder, recursive: true);
    }

    private static void CopyFolder(string source, string target)
    {
        if (!Directory.Exists(source)) return;
        Directory.CreateDirectory(target);
        foreach (var dir in Directory.EnumerateDirectories(source, "*", SearchOption.AllDirectories))
            Directory.CreateDirectory(Path.Combine(target, Path.GetRelativePath(source, dir)));
        foreach (var file in Directory.EnumerateFiles(source, "*", SearchOption.AllDirectories))
        {
            var copy = Path.Combine(target, Path.GetRelativePath(source, file));
            File.Copy(file, copy, overwrite: true);
            File.SetAttributes(copy, FileAttributes.Normal);
        }
    }
}

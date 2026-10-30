using System.Globalization;
using PostIt.Core;
using PostIt.Presentation.Mvvm;

namespace PostIt.Presentation.ViewModels;

/// <summary>
/// Where the data lives, the repost rules, FB accounts and the team. Edits a copy of the settings;
/// Save validates (folders must exist, numbers 1–90, at least one manager) and writes it back.
/// </summary>
public sealed class SettingsViewModel : PageViewModel
{
    public const int MinDays = 1, MaxDays = 90;
    private const string SampleFolderName = "PROTOTYPE-sample"; // see SampleDataSeeder

    private AppSettings _loaded = new();
    private string? _samplePropertiesFolder;
    private string? _sampleTrackerFolder;

    private string _propertiesFolder = "";
    private string _trackerFolder = "";
    private string _cooldownDaysText = "";
    private string _repostDueDaysText = "";
    private string _fbAccountsText = "";
    private string _teamText = "";
    private bool _propertiesFolderMissing;
    private bool _trackerFolderMissing;

    public SettingsViewModel(AppServices s, INavigator n) : base(s, n)
    {
        BrowsePropertiesFolderCommand = Command(() => Browse("Choose the properties folder", PropertiesFolder, path => PropertiesFolder = path));
        BrowseTrackerFolderCommand = Command(() => Browse("Choose the tracker folder", TrackerFolder, path => TrackerFolder = path));
        OpenDataFolderCommand = Command(OpenDataFolder);
        SaveCommand = Command(Save, () => IsChanged && IsValid);
        UndoCommand = Command(LoadFields, () => IsChanged);
        ResetSampleDataCommand = Command(ResetSampleData);
        LoadFields();
    }

    public override string Title => "Settings";
    public override NavKey Nav => NavKey.Settings;

    public override Task LoadAsync()
    {
        LoadFields();
        return Task.CompletedTask;
    }

    // ------------------------------------------------------------------ data

    public string PropertiesFolder
    {
        get => _propertiesFolder;
        set
        {
            if (!Set(ref _propertiesFolder, value ?? "")) return;
            _propertiesFolderMissing = false;
            RaiseState(nameof(PropertiesFolderError));
        }
    }

    public string TrackerFolder
    {
        get => _trackerFolder;
        set
        {
            if (!Set(ref _trackerFolder, value ?? "")) return;
            _trackerFolderMissing = false;
            RaiseState(nameof(TrackerFolderError));
        }
    }

    /// <summary>Inline error under the properties folder ("" when fine).</summary>
    public string PropertiesFolderError => FolderError(PropertiesFolder, _propertiesFolderMissing, "properties");

    public string TrackerFolderError => FolderError(TrackerFolder, _trackerFolderMissing, "tracker");

    public string PropertiesFolderHint =>
        "One sub-folder per property (optionally grouped in category folders). Works with a Google Drive for desktop folder.";

    public string TrackerFolderHint => "Holds Posts.csv and Assignments.csv — the two tabs of the tracker sheet.";

    /// <summary>The folders still point at the bundled PROTOTYPE sample data.</summary>
    public bool UsingSampleData => IsSamplePath(PropertiesFolder, _samplePropertiesFolder) && IsSamplePath(TrackerFolder, _sampleTrackerFolder);

    public string DataFolder => S.Settings.DataFolder;

    public RelayCommand BrowsePropertiesFolderCommand { get; }
    public RelayCommand BrowseTrackerFolderCommand { get; }
    public RelayCommand OpenDataFolderCommand { get; }

    // ------------------------------------------------------------------ rules

    public string CooldownDaysText
    {
        get => _cooldownDaysText;
        set { if (Set(ref _cooldownDaysText, value ?? "")) RaiseState(nameof(CooldownDaysError)); }
    }

    public string RepostDueDaysText
    {
        get => _repostDueDaysText;
        set { if (Set(ref _repostDueDaysText, value ?? "")) RaiseState(nameof(RepostDueDaysError)); }
    }

    public string CooldownDaysError => DaysError(CooldownDaysText);
    public string RepostDueDaysError => DaysError(RepostDueDaysText);

    public string CooldownHint => "A property posted fewer days ago than this can't be posted or assigned.";
    public string RepostDueHint => "Properties not posted for this many days show as due for a repost.";

    // ------------------------------------------------------------------ team & accounts

    /// <summary>One FB account per line.</summary>
    public string FbAccountsText
    {
        get => _fbAccountsText;
        set { if (Set(ref _fbAccountsText, value ?? "")) RaiseState(); }
    }

    /// <summary>One person per line: "Name, Intern" or "Name, Manager".</summary>
    public string TeamText
    {
        get => _teamText;
        set { if (Set(ref _teamText, value ?? "")) RaiseState(nameof(TeamError)); }
    }

    public string TeamError => ParseTeam(TeamText).Error ?? "";

    public string FbAccountsHint => "One per line. Interns pick from these when they log a post.";
    public string TeamHint => "One per line: “Name, Intern” or “Name, Manager”. Everyone listed can sign in.";

    // ------------------------------------------------------------------ save

    public bool IsValid =>
        PropertiesFolderError.Length == 0 && TrackerFolderError.Length == 0 &&
        CooldownDaysError.Length == 0 && RepostDueDaysError.Length == 0 && TeamError.Length == 0;

    public bool IsChanged =>
        !SamePath(PropertiesFolder, _loaded.PropertiesFolder) ||
        !SamePath(TrackerFolder, _loaded.TrackerFolder) ||
        CooldownDaysText.Trim() != _loaded.CooldownDays.ToString(CultureInfo.InvariantCulture) ||
        RepostDueDaysText.Trim() != _loaded.RepostDueDays.ToString(CultureInfo.InvariantCulture) ||
        !Lines(FbAccountsText).SequenceEqual(_loaded.FbAccounts.Select(a => a.Trim()).Where(a => a.Length > 0)) ||
        !Lines(TeamText).SequenceEqual(Lines(FormatTeam(_loaded.Users)));

    /// <summary>Line under the Save button.</summary>
    public string SaveStateText => !IsValid ? "Fix the fields marked in red to save."
        : IsChanged ? "You have unsaved changes."
        : "Settings are stored on this PC only.";

    public RelayCommand SaveCommand { get; }
    public RelayCommand UndoCommand { get; }

    // ------------------------------------------------------------------ danger zone

    public RelayCommand ResetSampleDataCommand { get; }

    // ------------------------------------------------------------------ actions

    private void LoadFields()
    {
        _loaded = S.Settings.Current.Clone();
        if (_loaded.UsingSampleData)
        {
            _samplePropertiesFolder = _loaded.PropertiesFolder;
            _sampleTrackerFolder = _loaded.TrackerFolder;
        }
        else if (!string.IsNullOrWhiteSpace(S.Settings.DataFolder))
        {
            _samplePropertiesFolder = Path.Combine(S.Settings.DataFolder, SampleFolderName, "Properties");
            _sampleTrackerFolder = Path.Combine(S.Settings.DataFolder, SampleFolderName, "Tracker");
        }

        _propertiesFolder = _loaded.PropertiesFolder;
        _trackerFolder = _loaded.TrackerFolder;
        _cooldownDaysText = _loaded.CooldownDays.ToString(CultureInfo.InvariantCulture);
        _repostDueDaysText = _loaded.RepostDueDays.ToString(CultureInfo.InvariantCulture);
        _fbAccountsText = string.Join("\r\n", _loaded.FbAccounts);
        _teamText = FormatTeam(_loaded.Users);
        _propertiesFolderMissing = _trackerFolderMissing = false;

        Raise(nameof(PropertiesFolder), nameof(TrackerFolder), nameof(CooldownDaysText), nameof(RepostDueDaysText),
            nameof(FbAccountsText), nameof(TeamText), nameof(DataFolder));
        RaiseState(nameof(PropertiesFolderError), nameof(TrackerFolderError), nameof(CooldownDaysError),
            nameof(RepostDueDaysError), nameof(TeamError));
    }

    private void Save()
    {
        var properties = PropertiesFolder.Trim();
        var tracker = TrackerFolder.Trim();

        // A folder the manager changed must exist (an unchanged one may be offline for a moment, e.g. Drive not synced).
        _propertiesFolderMissing = !SamePath(properties, _loaded.PropertiesFolder) && !Directory.Exists(properties);
        _trackerFolderMissing = !SamePath(tracker, _loaded.TrackerFolder) && !Directory.Exists(tracker);
        RaiseState(nameof(PropertiesFolderError), nameof(TrackerFolderError));
        if (!IsValid) return;

        var copy = S.Settings.Current.Clone();
        copy.PropertiesFolder = properties;
        copy.TrackerFolder = tracker;
        copy.CooldownDays = int.Parse(CooldownDaysText.Trim(), CultureInfo.InvariantCulture);
        copy.RepostDueDays = int.Parse(RepostDueDaysText.Trim(), CultureInfo.InvariantCulture);
        copy.FbAccounts = Lines(FbAccountsText).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        copy.Users = ParseTeam(TeamText).Users;
        copy.UsingSampleData = UsingSampleData;

        try
        {
            S.Settings.Save(copy);
            S.Posting.RefreshProperties();
        }
        catch (Exception ex)
        {
            OnError(ex);
            return;
        }

        if (SignedOutBecauseRemoved("Settings saved.")) return;
        S.Notifier.Notify("Settings saved.");
        LoadFields();
    }

    private void ResetSampleData()
    {
        var message = "This wipes the PROTOTYPE sample folders and tracker and creates them again, with dates moved to today. " +
                      "Your own folders aren't touched." + (IsChanged ? " Unsaved changes on this page will be lost." : "");
        if (!S.Ui.Confirm("Reset sample data?", message, "Reset")) return;

        try
        {
            S.SampleData.Reset();
            S.Posting.RefreshProperties();
        }
        catch (Exception ex)
        {
            OnError(ex);
            return;
        }

        if (SignedOutBecauseRemoved("Sample data reset.")) return;
        LoadFields();
        S.Notifier.Notify("Sample data reset. Dates were moved to today.");
    }

    /// <summary>Signs out when the signed-in person is no longer on the team (or changed role). True when signed out.</summary>
    private bool SignedOutBecauseRemoved(string what)
    {
        var me = S.Session.User;
        if (me is null) return false;
        var stillThere = S.Settings.Current.Users.Any(u => ManagerFormat.SamePerson(u.Name, me.Name) && u.Role == me.Role);
        if (stillThere) return false;
        S.Notifier.Notify($"{what} You're no longer on the team as {me.RoleLabel.ToLowerInvariant()}, so you've been signed out.", ToastKind.Info);
        Navigator.SignOut();
        return true;
    }

    private void Browse(string title, string current, Action<string> apply)
    {
        try
        {
            var picked = S.Ui.PickFolder(title, string.IsNullOrWhiteSpace(current) ? null : current.Trim());
            if (!string.IsNullOrWhiteSpace(picked)) apply(picked);
        }
        catch (Exception ex)
        {
            OnError(ex);
        }
    }

    private void OpenDataFolder()
    {
        try { S.Ui.OpenFolder(S.Settings.DataFolder); }
        catch (Exception ex) { OnError(ex); }
    }

    /// <summary>Raises the given properties plus everything that depends on all fields.</summary>
    private void RaiseState(params string[] names)
    {
        Raise(names);
        Raise(nameof(IsValid), nameof(IsChanged), nameof(SaveStateText), nameof(UsingSampleData));
    }

    // ------------------------------------------------------------------ parsing & validation

    private static string FolderError(string path, bool missing, string which) =>
        string.IsNullOrWhiteSpace(path) ? $"Choose the {which} folder."
        : missing ? "Folder not found. Check the path, or pick it with Browse…"
        : "";

    private static string DaysError(string text) =>
        int.TryParse(text.Trim(), NumberStyles.None, CultureInfo.InvariantCulture, out var n) && n is >= MinDays and <= MaxDays
            ? ""
            : $"Enter a whole number from {MinDays} to {MaxDays}.";

    /// <summary>Parses "Name, Intern" / "Name, Manager" lines. Error is null when the team is valid.</summary>
    internal static (List<AppUser> Users, string? Error) ParseTeam(string text)
    {
        var users = new List<AppUser>();
        var lines = (text ?? "").Replace("\r\n", "\n").Replace('\r', '\n').Split('\n');
        for (var i = 0; i < lines.Length; i++)
        {
            var line = lines[i].Trim();
            if (line.Length == 0) continue;

            var comma = line.LastIndexOf(',');
            if (comma < 0) return (users, $"Line {i + 1}: add the role after a comma, e.g. “{line}, Intern”.");
            var name = string.Join(' ', line[..comma].Split(' ', StringSplitOptions.RemoveEmptyEntries));
            var roleText = line[(comma + 1)..].Trim();
            if (name.Length == 0) return (users, $"Line {i + 1}: the name is missing.");

            UserRole role;
            if (roleText.Equals("intern", StringComparison.OrdinalIgnoreCase)) role = UserRole.Intern;
            else if (roleText.Equals("manager", StringComparison.OrdinalIgnoreCase)) role = UserRole.Manager;
            else return (users, $"Line {i + 1}: the role must be Intern or Manager.");

            if (users.Any(u => ManagerFormat.SamePerson(u.Name, name))) return (users, $"{name} is listed twice.");
            users.Add(new AppUser(name, role));
        }

        if (users.Count == 0) return (users, "Add the team: one person per line.");
        if (users.All(u => u.Role != UserRole.Manager)) return (users, "Add at least one manager, e.g. “Maria Santos, Manager”.");
        return (users, null);
    }

    private static string FormatTeam(IEnumerable<AppUser> users) =>
        string.Join("\r\n", users.Select(u => $"{u.Name}, {u.RoleLabel}"));

    private static IEnumerable<string> Lines(string text) =>
        (text ?? "").Replace("\r\n", "\n").Replace('\r', '\n').Split('\n').Select(l => l.Trim()).Where(l => l.Length > 0);

    private static string NormalizePath(string? path) => (path ?? "").Trim().TrimEnd('\\', '/');

    private static bool SamePath(string? a, string? b) =>
        string.Equals(NormalizePath(a), NormalizePath(b), StringComparison.OrdinalIgnoreCase);

    private static bool IsSamplePath(string path, string? samplePath) =>
        samplePath is not null && NormalizePath(path).Length > 0 && SamePath(path, samplePath);
}

using System.Collections.ObjectModel;
using PostIt.Core;
using PostIt.Presentation.Mvvm;

namespace PostIt.Presentation.ViewModels;

/// <summary>
/// Sign in, two ways.
///
/// Connected to the company Drive, you paste the key your manager gave you and
/// the server says who you are — the app never decides its own role. On the
/// prototype's sample data there are no keys, so you pick a name from a list.
/// </summary>
public sealed class SignInViewModel : PageViewModel
{
    private string _propertiesFolderText = "";
    private string _trackerFolderText = "";
    private bool _usingSampleData;
    private string _scriptUrl = "";
    private string _key = "";
    private string _status = "";
    private bool _busy;

    public SignInViewModel(AppServices s, INavigator n) : base(s, n)
    {
        ResetSampleDataCommand = Command(ResetSampleData);
        ConnectCommand = AsyncCommand(ConnectAsync, () => !Busy && CanConnect);
        Reload();
    }

    public override string Title => "Sign in";
    public override NavKey Nav => NavKey.None;

    public string Heading => UsingKey ? "Sign in to Post-It" : "Who's using Post-It?";

    public string Subtitle => UsingKey
        ? "Paste the key your manager gave you. It says who you are and what you can do."
        : "Prototype sign-in — pick your name. Connect to the company Drive in Settings to use keys instead.";

    /// <summary>True when a backend is wired up, so a key is what signs you in.</summary>
    public bool UsingKey => S.Backend is not null;

    /// <summary>The list of names, used only on sample data.</summary>
    public bool UsingNames => !UsingKey;

    /// <summary>The web app's /exec link. Shown so a first-time setup can be done here.</summary>
    public string ScriptUrl
    {
        get => _scriptUrl;
        set { if (Set(ref _scriptUrl, value)) Raise(nameof(CanConnect)); }
    }

    /// <summary>This person's key from the Team tab. Never shown back once saved.</summary>
    public string Key
    {
        get => _key;
        set { if (Set(ref _key, value)) Raise(nameof(CanConnect)); }
    }

    public bool CanConnect => !string.IsNullOrWhiteSpace(ScriptUrl) && !string.IsNullOrWhiteSpace(Key);

    /// <summary>What happened on the last attempt. Empty until one is made.</summary>
    public string Status { get => _status; private set => Set(ref _status, value); }

    public bool HasStatus => !string.IsNullOrWhiteSpace(Status);

    public bool Busy
    {
        get => _busy;
        private set { if (Set(ref _busy, value)) Raise(nameof(NotBusy)); }
    }

    /// <summary>For IsEnabled bindings, which want a bool and not a Visibility.</summary>
    public bool NotBusy => !Busy;

    public AsyncRelayCommand ConnectCommand { get; }

    public ObservableCollection<UserTileViewModel> Managers { get; } = new();
    public ObservableCollection<UserTileViewModel> Interns { get; } = new();

    // All four are false when a key signs you in, so the name list and its
    // "nobody on the team" notice stay out of the way without the view having
    // to nest anything.
    public bool HasManagers => UsingNames && Managers.Count > 0;
    public bool HasInterns => UsingNames && Interns.Count > 0;
    public bool HasUsers => HasManagers || HasInterns;
    public bool HasNoUsers => UsingNames && !HasUsers;

    /// <summary>"Properties: C:\…\Properties".</summary>
    public string PropertiesFolderText { get => _propertiesFolderText; private set => Set(ref _propertiesFolderText, value); }

    /// <summary>"Tracker: C:\…\Tracker (Posts.csv, Assignments.csv)".</summary>
    public string TrackerFolderText { get => _trackerFolderText; private set => Set(ref _trackerFolderText, value); }

    public bool UsingSampleData { get => _usingSampleData; private set => Set(ref _usingSampleData, value); }

    public RelayCommand ResetSampleDataCommand { get; }

    public override Task LoadAsync()
    {
        Reload();
        return Task.CompletedTask;
    }

    private void Reload()
    {
        var settings = S.Settings.Current;
        Managers.Clear();
        Interns.Clear();
        foreach (var user in settings.Users)
        {
            var tile = new UserTileViewModel(user, u => Navigator.SignIn(u));
            (user.CanManage ? Managers : Interns).Add(tile);
        }

        PropertiesFolderText = string.IsNullOrWhiteSpace(settings.PropertiesFolder)
            ? "Properties: no folder set yet"
            : $"Properties: {settings.PropertiesFolder}";
        TrackerFolderText = string.IsNullOrWhiteSpace(settings.TrackerFolder)
            ? "Tracker: no folder set yet"
            : $"Tracker: {settings.TrackerFolder} (Posts.csv, Assignments.csv)";
        UsingSampleData = settings.UsingSampleData;
        _scriptUrl = settings.ScriptUrl;
        _key = settings.ScriptKey;
        Raise(nameof(HasManagers), nameof(HasInterns), nameof(HasUsers), nameof(HasNoUsers),
              nameof(ScriptUrl), nameof(Key), nameof(CanConnect), nameof(UsingKey), nameof(UsingNames),
              nameof(Heading), nameof(Subtitle));
    }

    /// <summary>
    /// Saves the link and key, then asks the server who this is. The reply, not
    /// the app, decides the role — so a tampered client gains nothing.
    /// </summary>
    private async Task ConnectAsync()
    {
        if (S.Backend is null) return;

        Busy = true;
        Status = "Checking with the server\u2026";
        Raise(nameof(HasStatus));
        try
        {
            var settings = S.Settings.Current.Clone();
            settings.ScriptUrl = ScriptUrl.Trim();
            settings.ScriptKey = Key.Trim();
            S.Settings.Save(settings);

            var signedIn = await S.Backend.SignInAsync();
            Status = "";
            Raise(nameof(HasStatus));
            Navigator.SignIn(signedIn.User);
        }
        catch (Exception ex)
        {
            Status = ex is UserFacingException ? ex.Message : "Could not reach the server. Check the link and try again.";
            Raise(nameof(HasStatus));
        }
        finally
        {
            Busy = false;
        }
    }

    private void ResetSampleData()
    {
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
        Reload();
        S.Notifier.Notify("Sample data reset. Pick your name to start.");
    }
}

/// <summary>One person on the sign-in page.</summary>
public sealed class UserTileViewModel
{
    public UserTileViewModel(AppUser user, Action<AppUser> signIn)
    {
        User = user;
        SignInCommand = new RelayCommand(() => signIn(user));
    }

    public AppUser User { get; }
    public string Name => User.Name;
    public string Initials => User.Initials;
    public string RoleLabel => User.RoleLabel;

    /// <summary>Manager → gold, intern → neutral.</summary>
    public string BadgeKind => User.CanManage ? "gold" : "neutral";

    public RelayCommand SignInCommand { get; }
}

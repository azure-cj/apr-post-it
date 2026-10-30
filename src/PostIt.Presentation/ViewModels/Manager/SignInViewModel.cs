using System.Collections.ObjectModel;
using PostIt.Core;
using PostIt.Presentation.Mvvm;

namespace PostIt.Presentation.ViewModels;

/// <summary>
/// Prototype sign-in: pick your name from the team in settings. No sidebar is shown on this page.
/// The real app would sign people in with their company Google account.
/// </summary>
public sealed class SignInViewModel : PageViewModel
{
    private string _propertiesFolderText = "";
    private string _trackerFolderText = "";
    private bool _usingSampleData;

    public SignInViewModel(AppServices s, INavigator n) : base(s, n)
    {
        ResetSampleDataCommand = Command(ResetSampleData);
        Reload();
    }

    public override string Title => "Sign in";
    public override NavKey Nav => NavKey.None;

    public string Heading => "Who's using Post-It?";
    public string Subtitle => "Prototype sign-in — pick your name. The real app would sign you in with your company Google account.";

    public ObservableCollection<UserTileViewModel> Managers { get; } = new();
    public ObservableCollection<UserTileViewModel> Interns { get; } = new();

    public bool HasManagers => Managers.Count > 0;
    public bool HasInterns => Interns.Count > 0;
    public bool HasUsers => HasManagers || HasInterns;
    public bool HasNoUsers => !HasUsers;

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
            (user.Role == UserRole.Manager ? Managers : Interns).Add(tile);
        }

        PropertiesFolderText = string.IsNullOrWhiteSpace(settings.PropertiesFolder)
            ? "Properties: no folder set yet"
            : $"Properties: {settings.PropertiesFolder}";
        TrackerFolderText = string.IsNullOrWhiteSpace(settings.TrackerFolder)
            ? "Tracker: no folder set yet"
            : $"Tracker: {settings.TrackerFolder} (Posts.csv, Assignments.csv)";
        UsingSampleData = settings.UsingSampleData;
        Raise(nameof(HasManagers), nameof(HasInterns), nameof(HasUsers), nameof(HasNoUsers));
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
    public string BadgeKind => User.Role == UserRole.Manager ? "gold" : "neutral";

    public RelayCommand SignInCommand { get; }
}

using PostIt.Core;
using PostIt.Presentation;
using PostIt.Presentation.ViewModels;

namespace PostIt.Tests.Manager;

public class SignInViewModelTests
{
    [Test]
    public async Task Groups_people_by_role_and_signs_in_the_one_picked()
    {
        var app = new TestApp();
        app.Session.User = null;
        var vm = new SignInViewModel(app.Services(), app.Nav);
        await vm.LoadAsync();

        Assert.Equal("Sign in", vm.Title);
        Assert.Equal(NavKey.None, vm.Nav);
        Assert.Equal("Maria Santos", string.Join(",", vm.Managers.Select(t => t.Name)));
        Assert.Equal("Jan Dela Cruz,Mika Reyes", string.Join(",", vm.Interns.Select(t => t.Name)));
        Assert.Equal("gold", vm.Managers[0].BadgeKind);
        Assert.Equal("Manager", vm.Managers[0].RoleLabel);
        Assert.Equal("MS", vm.Managers[0].Initials);
        Assert.Equal("neutral", vm.Interns[0].BadgeKind);
        Assert.Equal("Intern", vm.Interns[0].RoleLabel);
        Assert.True(vm.HasUsers);
        Assert.False(vm.HasNoUsers);

        vm.Interns[1].SignInCommand.Execute(null);
        Assert.Equal("SignIn:Mika Reyes", app.Nav.Last);
    }

    [Test]
    public async Task Footer_says_where_the_data_lives()
    {
        var app = new TestApp();
        var s = app.Settings.Current.Clone();
        s.UsingSampleData = true;
        app.Settings.Save(s);

        var vm = new SignInViewModel(app.Services(), app.Nav);
        await vm.LoadAsync();

        Assert.Equal("Properties: /props", vm.PropertiesFolderText);
        Assert.Contains("Tracker: /tracker", vm.TrackerFolderText);
        Assert.True(vm.UsingSampleData);
    }

    [Test]
    public async Task No_users_offers_to_reset_the_sample_data()
    {
        var app = new TestApp();
        var s = app.Settings.Current.Clone();
        s.Users.Clear();
        app.Settings.Save(s);

        var vm = new SignInViewModel(app.Services(), app.Nav);
        await vm.LoadAsync();
        Assert.True(vm.HasNoUsers);
        Assert.False(vm.HasManagers);
        Assert.False(vm.HasInterns);

        vm.ResetSampleDataCommand.Execute(null);
        Assert.Equal(1, app.SampleData.Resets);
        Assert.Equal(ToastKind.Success, app.Notifier.Messages.Last().Kind);
        Assert.Count(0, app.Nav.Calls);
    }
}

/// <summary>
/// Signing in with a key. The point of these: the role comes back from the
/// server, so nothing the client does can promote anybody.
/// </summary>
public class KeySignInTests
{
    private sealed class FakeBackend : IBackendConnection
    {
        private readonly Func<SignedInUser> _reply;
        public int Calls { get; private set; }

        public FakeBackend(Func<SignedInUser> reply) => _reply = reply;

        public bool IsConfigured => true;

        public Task<SignedInUser> SignInAsync(CancellationToken ct = default)
        {
            Calls++;
            return Task.FromResult(_reply());
        }
    }

    private static FakeBackend Returns(string name, UserRole role, params string[] accounts) =>
        new(() => new SignedInUser(new AppUser(name, role), accounts));

    private static FakeBackend Refuses(string message) =>
        new(() => throw new UserFacingException(message));

    [Test]
    public async Task With_a_backend_the_page_asks_for_a_key_rather_than_a_name()
    {
        var app = new TestApp();
        var vm = new SignInViewModel(app.Services(Returns("Jan Dela Cruz", UserRole.Intern)), app.Nav);
        await vm.LoadAsync();

        Assert.True(vm.UsingKey);
        Assert.False(vm.UsingNames);
        Assert.Contains("key", vm.Subtitle);
        Assert.False(vm.CanConnect);                      // nothing typed yet
    }

    [Test]
    public async Task Without_a_backend_it_still_shows_the_sample_data_names()
    {
        var app = new TestApp();
        var vm = new SignInViewModel(app.Services(), app.Nav);
        await vm.LoadAsync();

        Assert.False(vm.UsingKey);
        Assert.True(vm.UsingNames);
        Assert.True(vm.HasUsers);
    }

    [Test]
    public async Task The_server_decides_the_role_and_the_link_and_key_are_remembered()
    {
        var app = new TestApp();
        var backend = Returns("Maria Santos", UserRole.Admin, "APG Homes");
        var vm = new SignInViewModel(app.Services(backend), app.Nav);
        await vm.LoadAsync();

        vm.ScriptUrl = "  https://script.google.com/macros/s/AK/exec  ";
        vm.Key = "  7f3a9c  ";
        Assert.True(vm.CanConnect);

        await vm.ConnectCommand.ExecuteAsync();

        Assert.Equal(1, backend.Calls);
        Assert.Equal("SignIn:Maria Santos", app.Nav.Last);
        Assert.Equal("https://script.google.com/macros/s/AK/exec", app.Settings.Current.ScriptUrl);  // trimmed
        Assert.Equal("7f3a9c", app.Settings.Current.ScriptKey);
        Assert.True(app.Settings.Current.UsingGoogle);
        Assert.False(vm.Busy);
        Assert.False(vm.HasStatus);
    }

    [Test]
    public async Task An_admin_signed_in_this_way_keeps_manager_powers()
    {
        // Admin is a third role, so every "is a manager" check had to become
        // "can manage" — otherwise an admin quietly loses the manager screens.
        var admin = new AppUser("Maria Santos", UserRole.Admin);
        Assert.True(admin.CanManage);
        Assert.True(admin.IsAdmin);
        Assert.Equal("Admin", admin.RoleLabel);

        var app = new TestApp();
        app.Session.User = admin;
        Assert.True(app.Session.IsManager);
        Assert.True(app.Session.IsAdmin);
        Assert.False(app.Session.IsIntern);
        await Task.CompletedTask;
    }

    [Test]
    public async Task A_refused_key_says_why_and_does_not_sign_anyone_in()
    {
        var app = new TestApp();
        var vm = new SignInViewModel(
            app.Services(Refuses("Your key was not recognised. Ask your manager for a new one.")), app.Nav);
        await vm.LoadAsync();

        vm.ScriptUrl = "https://script.google.com/macros/s/AK/exec";
        vm.Key = "wrong";
        await vm.ConnectCommand.ExecuteAsync();

        Assert.Contains("not recognised", vm.Status);
        Assert.True(vm.HasStatus);
        Assert.Null(app.Nav.Last);
        Assert.False(vm.Busy);
    }
}

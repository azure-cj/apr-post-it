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

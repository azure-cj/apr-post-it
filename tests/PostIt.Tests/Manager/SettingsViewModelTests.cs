using PostIt.Core;
using PostIt.Presentation;
using PostIt.Presentation.ViewModels;

namespace PostIt.Tests.Manager;

public class SettingsViewModelTests : IDisposable
{
    private readonly string _temp = Path.Combine(Path.GetTempPath(), "postit-mgr-settings-" + Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        if (Directory.Exists(_temp)) Directory.Delete(_temp, recursive: true);
    }

    private string NewFolder(string name)
    {
        var path = Path.Combine(_temp, name);
        Directory.CreateDirectory(path);
        return path;
    }

    private static (TestApp App, SettingsViewModel Vm, CountingPosting Posting) Open(Action<AppSettings>? tweak = null)
    {
        var app = new TestApp();
        app.Session.User = TestApp.Manager;
        if (tweak is not null)
        {
            var s = app.Settings.Current.Clone();
            tweak(s);
            app.Settings.Save(s);
        }
        var (services, posting) = ManagerTestKit.ServicesWithCountingPosting(app);
        var vm = new SettingsViewModel(services, app.Nav);
        vm.LoadAsync().Wait();
        return (app, vm, posting);
    }

    [Test]
    public void Shows_a_copy_of_the_current_settings()
    {
        var (_, vm, _) = Open();

        Assert.Equal("Settings", vm.Title);
        Assert.Equal(NavKey.Settings, vm.Nav);
        Assert.Equal("/props", vm.PropertiesFolder);
        Assert.Equal("/tracker", vm.TrackerFolder);
        Assert.Equal("7", vm.CooldownDaysText);
        Assert.Equal("14", vm.RepostDueDaysText);
        Assert.Equal("APG Homes Cavite\r\nAPG Properties PH\r\nAlpha Premier Listings", vm.FbAccountsText);
        Assert.Equal("Maria Santos, Manager\r\nJan Dela Cruz, Intern\r\nMika Reyes, Intern", vm.TeamText);
        Assert.False(vm.IsChanged);
        Assert.True(vm.IsValid);
        Assert.False(vm.SaveCommand.CanExecute(null), "nothing changed");
        Assert.False(vm.UsingSampleData);
    }

    [Test]
    public void Day_numbers_must_be_whole_numbers_from_1_to_90()
    {
        var (_, vm, _) = Open();

        foreach (var bad in new[] { "0", "91", "abc", "7.5", "-3", "" })
        {
            vm.CooldownDaysText = bad;
            Assert.Equal("Enter a whole number from 1 to 90.", vm.CooldownDaysError, $"\"{bad}\"");
            Assert.False(vm.SaveCommand.CanExecute(null), $"\"{bad}\" blocks Save");
        }

        vm.CooldownDaysText = " 5 ";
        Assert.Equal("", vm.CooldownDaysError);
        Assert.True(vm.SaveCommand.CanExecute(null));

        vm.RepostDueDaysText = "100";
        Assert.Equal("Enter a whole number from 1 to 90.", vm.RepostDueDaysError);
        Assert.False(vm.IsValid);
        Assert.Equal("Fix the fields marked in red to save.", vm.SaveStateText);
    }

    [Test]
    public void Team_needs_a_role_on_every_line_and_at_least_one_manager()
    {
        var (_, vm, _) = Open();

        vm.TeamText = "Jan Dela Cruz, Intern\nMika Reyes, Intern";
        Assert.Contains("at least one manager", vm.TeamError);
        Assert.False(vm.SaveCommand.CanExecute(null));

        vm.TeamText = "Maria Santos, Manager\nJan Dela Cruz, Boss";
        Assert.Equal("Line 2: the role must be Intern or Manager.", vm.TeamError);

        vm.TeamText = "Maria Santos, Manager\n\nJan Dela Cruz";
        Assert.Equal("Line 3: add the role after a comma, e.g. “Jan Dela Cruz, Intern”.", vm.TeamError);

        vm.TeamText = "Maria Santos, Manager\n, Intern";
        Assert.Equal("Line 2: the name is missing.", vm.TeamError);

        vm.TeamText = "Maria Santos, Manager\nmaria santos, Intern";
        Assert.Equal("maria santos is listed twice.", vm.TeamError);

        vm.TeamText = "  ";
        Assert.Equal("Add the team: one person per line.", vm.TeamError);

        vm.TeamText = "Maria Santos, manager\r\nBea Lim,intern";
        Assert.Equal("", vm.TeamError);
        Assert.True(vm.SaveCommand.CanExecute(null));
    }

    [Test]
    public void A_changed_folder_must_exist()
    {
        var (app, vm, posting) = Open();

        vm.PropertiesFolder = "";
        Assert.Equal("Choose the properties folder.", vm.PropertiesFolderError);
        Assert.False(vm.SaveCommand.CanExecute(null));

        vm.PropertiesFolder = Path.Combine(_temp, "not-there");
        Assert.True(vm.SaveCommand.CanExecute(null), "existence is checked on Save");
        vm.SaveCommand.Execute(null);

        Assert.Equal("Folder not found. Check the path, or pick it with Browse…", vm.PropertiesFolderError);
        Assert.Equal("/props", app.Settings.Current.PropertiesFolder, "nothing saved");
        Assert.Equal(0, posting.Refreshes);
        Assert.Count(0, app.Notifier.Messages);

        vm.PropertiesFolder = NewFolder("Properties");
        Assert.Equal("", vm.PropertiesFolderError, "editing clears the error");
    }

    [Test]
    public void Save_persists_the_copy_and_refreshes_the_properties()
    {
        var (app, vm, posting) = Open();
        var properties = NewFolder("Properties");
        var tracker = NewFolder("Tracker");

        vm.PropertiesFolder = properties;
        vm.TrackerFolder = tracker + Path.DirectorySeparatorChar;
        vm.CooldownDaysText = "5";
        vm.RepostDueDaysText = "21";
        vm.FbAccountsText = "APG Homes Cavite\r\n\r\n  New Page  \r\napg homes cavite";
        vm.TeamText = "Maria Santos, Manager\r\nJan Dela Cruz, Intern\r\nBea Lim, Intern";
        Assert.True(vm.IsChanged);
        Assert.Equal("You have unsaved changes.", vm.SaveStateText);

        vm.SaveCommand.Execute(null);

        var s = app.Settings.Current;
        Assert.Equal(properties, s.PropertiesFolder);
        Assert.Equal(tracker + Path.DirectorySeparatorChar, s.TrackerFolder);
        Assert.Equal(5, s.CooldownDays);
        Assert.Equal(21, s.RepostDueDays);
        Assert.Equal("APG Homes Cavite,New Page", string.Join(",", s.FbAccounts));
        Assert.Equal("Maria Santos:Manager,Jan Dela Cruz:Intern,Bea Lim:Intern", string.Join(",", s.Users.Select(u => $"{u.Name}:{u.Role}")));
        Assert.False(s.UsingSampleData);
        Assert.Equal(1, posting.Refreshes);
        Assert.Equal("Settings saved.", app.Notifier.Last);
        Assert.False(vm.IsChanged, "fields reloaded from the saved settings");
        Assert.Count(0, app.Nav.Calls);
    }

    [Test]
    public void Unchanged_folders_are_not_rechecked()
    {
        var (app, vm, _) = Open(); // "/props" and "/tracker" don't exist on disk
        vm.CooldownDaysText = "6";
        vm.SaveCommand.Execute(null);
        Assert.Equal(6, app.Settings.Current.CooldownDays);
        Assert.Equal("Settings saved.", app.Notifier.Last);
    }

    [Test]
    public void Sample_data_flag_follows_the_folders()
    {
        var (app, vm, _) = Open(s => s.UsingSampleData = true);
        Assert.True(vm.UsingSampleData);

        vm.RepostDueDaysText = "15";
        vm.SaveCommand.Execute(null);
        Assert.True(app.Settings.Current.UsingSampleData, "still on the sample folders");

        vm.PropertiesFolder = NewFolder("Mine");
        Assert.False(vm.UsingSampleData);
        vm.SaveCommand.Execute(null);
        Assert.False(app.Settings.Current.UsingSampleData);

        vm.PropertiesFolder = "/props";
        Assert.True(vm.UsingSampleData, "pointing back at the sample paths");
    }

    [Test]
    public void Browse_fills_the_folder_and_cancel_keeps_it()
    {
        var (app, vm, _) = Open();
        app.Ui.FolderToPick = "/picked/properties";
        vm.BrowsePropertiesFolderCommand.Execute(null);
        Assert.Equal("/picked/properties", vm.PropertiesFolder);

        app.Ui.FolderToPick = null;
        vm.BrowseTrackerFolderCommand.Execute(null);
        Assert.Equal("/tracker", vm.TrackerFolder);
    }

    [Test]
    public void Undo_restores_the_saved_values()
    {
        var (_, vm, _) = Open();
        vm.CooldownDaysText = "abc";
        vm.TeamText = "";
        Assert.True(vm.UndoCommand.CanExecute(null));

        vm.UndoCommand.Execute(null);

        Assert.Equal("7", vm.CooldownDaysText);
        Assert.Equal("", vm.TeamError);
        Assert.False(vm.IsChanged);
        Assert.False(vm.UndoCommand.CanExecute(null));
    }

    [Test]
    public void Removing_yourself_from_the_team_signs_you_out()
    {
        var (app, vm, _) = Open();
        vm.TeamText = "Ana Cruz, Manager\nJan Dela Cruz, Intern";

        vm.SaveCommand.Execute(null);

        Assert.Equal("Ana Cruz", app.Settings.Current.Users[0].Name);
        Assert.Equal("SignOut", app.Nav.Last);
        Assert.Contains("signed out", app.Notifier.Last);
    }

    [Test]
    public void Changing_your_own_role_signs_you_out()
    {
        var (app, vm, _) = Open();
        vm.TeamText = "Ana Cruz, Manager\nMaria Santos, Intern";
        vm.SaveCommand.Execute(null);
        Assert.Equal("SignOut", app.Nav.Last);
    }

    [Test]
    public void Reset_sample_data_asks_then_resets()
    {
        var (app, vm, posting) = Open();

        app.Ui.ConfirmAnswer = false;
        vm.ResetSampleDataCommand.Execute(null);
        Assert.Equal(0, app.SampleData.Resets);

        vm.CooldownDaysText = "3";
        app.Ui.ConfirmAnswer = true;
        vm.ResetSampleDataCommand.Execute(null);

        Assert.Equal(1, app.SampleData.Resets);
        Assert.Equal(1, posting.Refreshes);
        Assert.Contains("Unsaved changes on this page will be lost.", app.Ui.Confirms.Last());
        Assert.Equal("Sample data reset. Dates were moved to today.", app.Notifier.Last);
        Assert.Equal("7", vm.CooldownDaysText, "fields reloaded");
        Assert.Count(0, app.Nav.Calls);
    }

    [Test]
    public void Open_data_folder_opens_the_settings_folder()
    {
        var (app, vm, _) = Open();
        vm.OpenDataFolderCommand.Execute(null);
        Assert.Equal("folder:", app.Ui.Opened.Single());
    }
}

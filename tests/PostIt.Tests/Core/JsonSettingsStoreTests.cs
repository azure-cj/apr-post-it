using PostIt.Core;

namespace PostIt.Tests.CoreLogic;

public class JsonSettingsStoreTests
{
    [Test]
    public void Missing_file_gives_defaults_and_creates_the_folder()
    {
        using var t = new TempDir();
        var store = new JsonSettingsStore(t.PathOf("data/sub"));

        Assert.True(Directory.Exists(t.PathOf("data/sub")));
        Assert.Equal(t.PathOf("data/sub"), store.DataFolder);
        Assert.Equal(7, store.Current.CooldownDays);
        Assert.Equal(14, store.Current.RepostDueDays);
        Assert.Equal("", store.Current.PropertiesFolder);
        Assert.Count(0, store.Current.Users);
    }

    [Test]
    public void Round_trips_every_setting_including_users()
    {
        using var t = new TempDir();
        var store = new JsonSettingsStore(t.Root);
        var changed = 0;
        store.Changed += (_, _) => changed++;

        var s = new AppSettings
        {
            PropertiesFolder = @"G:\My Drive\Properties",
            TrackerFolder = "/tracker",
            CooldownDays = 5,
            RepostDueDays = 21,
            FbAccounts = new() { "APG Homes Cavite", "Alpha Premier Listings" },
            Users = new() { new("Maria Santos", UserRole.Manager), new("Jan Dela Cruz", UserRole.Intern) },
            UsingSampleData = true,
            LastUserName = "Jan Dela Cruz",
        };
        store.Save(s);
        s.FbAccounts.Add("changed after save");

        Assert.Equal(1, changed);
        Assert.Count(2, store.Current.FbAccounts, "Current is a copy");

        var json = File.ReadAllText(t.PathOf("settings.json"));
        Assert.Contains("\"Role\": \"Manager\"", json);
        Assert.DoesNotContain("Initials", json);

        var reloaded = new JsonSettingsStore(t.Root).Current;
        Assert.Equal(@"G:\My Drive\Properties", reloaded.PropertiesFolder);
        Assert.Equal("/tracker", reloaded.TrackerFolder);
        Assert.Equal(5, reloaded.CooldownDays);
        Assert.Equal(21, reloaded.RepostDueDays);
        Assert.Equal("APG Homes Cavite|Alpha Premier Listings", string.Join("|", reloaded.FbAccounts));
        Assert.Equal(new AppUser("Maria Santos", UserRole.Manager), reloaded.Users[0]);
        Assert.Equal(new AppUser("Jan Dela Cruz", UserRole.Intern), reloaded.Users[1]);
        Assert.True(reloaded.UsingSampleData);
        Assert.Equal("Jan Dela Cruz", reloaded.LastUserName);
        Assert.False(File.Exists(t.PathOf("settings.json.tmp")));
    }

    [Test]
    public void Accepts_users_written_with_their_computed_properties()
    {
        using var t = new TempDir();
        t.Write("settings.json",
            "{ \"CooldownDays\": 7, \"Users\": [ { \"Name\": \"Bea Lim\", \"Role\": \"Intern\", \"Initials\": \"BL\", \"RoleLabel\": \"Intern\" }, { \"name\": \"Maria Santos\", \"role\": 1 } ] }");

        var users = new JsonSettingsStore(t.Root).Current.Users;

        Assert.Equal(new AppUser("Bea Lim", UserRole.Intern), users[0]);
        Assert.Equal(new AppUser("Maria Santos", UserRole.Manager), users[1]);
    }

    [Test]
    public void Corrupt_file_is_set_aside_and_defaults_are_used()
    {
        using var t = new TempDir();
        t.Write("settings.json", "{ \"CooldownDays\": 3, oops");

        var store = new JsonSettingsStore(t.Root);

        Assert.Equal(7, store.Current.CooldownDays);
        Assert.True(File.Exists(t.PathOf("settings.bad.json")));
        Assert.False(File.Exists(t.PathOf("settings.json")));

        store.Save(store.Current);
        Assert.True(File.Exists(t.PathOf("settings.json")));
    }
}

using PostIt.Core;

namespace PostIt.Tests.CoreLogic;

public class SampleDataSeederTests
{
    private const string Jan = "Jan Dela Cruz";

    private static SampleDataSeeder Seeder(DiskApp app, string? bundled = null) =>
        new(app.Settings, app.Clock, bundled ?? RepoFiles.BundledSampleData);

    [Test]
    public async Task Reset_builds_the_demo_from_the_bundled_folders()
    {
        using var app = new DiskApp();
        var s = app.Settings.Current.Clone();
        s.LastUserName = Jan;
        app.Settings.Save(s);

        Seeder(app).Reset();

        // Settings point at the sample.
        var settings = app.Settings.Current;
        var sampleRoot = Path.Combine(app.Settings.DataFolder, "PROTOTYPE-sample");
        Assert.Equal(Path.Combine(sampleRoot, "Properties"), settings.PropertiesFolder);
        Assert.Equal(Path.Combine(sampleRoot, "Tracker"), settings.TrackerFolder);
        Assert.True(settings.UsingSampleData);
        Assert.Equal(7, settings.CooldownDays);
        Assert.Equal(14, settings.RepostDueDays);
        Assert.Equal("APG Homes Cavite|APG Properties PH|Alpha Premier Listings", string.Join("|", settings.FbAccounts));
        Assert.Equal("Maria Santos:Manager,Jan Dela Cruz:Intern,Mika Reyes:Intern,Paolo Santos:Intern,Bea Lim:Intern",
            string.Join(",", settings.Users.Select(u => $"{u.Name}:{u.Role}")));
        Assert.Equal(Jan, settings.LastUserName);
        Assert.Equal(Jan, new JsonSettingsStore(app.Settings.DataFolder).Current.LastUserName, "saved to disk");

        // Folders were copied, posts relate to them by name, tracker opens in Excel.
        var all = await app.Posting.SearchAsync("");
        Assert.Count(14, all);
        Assert.True(File.ReadAllBytes(Path.Combine(settings.TrackerFolder, "Posts.csv"))[0] == 0xEF, "BOM");

        var lot7 = all.Single(p => p.Name == "Verdant Hills Lot 7");
        Assert.Equal("Lot/Verdant Hills Lot 7", lot7.Id);
        Assert.True(lot7.Cooldown.InCooldown);
        Assert.Equal(5, lot7.Cooldown.DaysLeft);

        Assert.True(all.Single(p => p.Name == "Seaside Residences 2BR").Cooldown.NeverPosted);
        Assert.True(all.Single(p => p.Name == "Sta. Rosa Lot 22").Cooldown.NeverPosted);
        Assert.Equal(2, all.Count(p => p.Cooldown.NeverPosted));
        Assert.True(all.Single(p => p.Name == "Verdant Hills Lot 12").Cooldown.DueForRepost);
        Assert.True(all.Single(p => p.Name == "Villa Rosario Unit 4B").Cooldown.InCooldown);

        // Jan's queue today.
        var queue = await app.Assignments.GetQueueAsync(Jan, app.Clock.Today);
        Assert.Equal(4, queue.ToPost);
        Assert.Equal(1, queue.Posted);
        Assert.Equal(1, queue.Pending);
        Assert.Equal("Casa Amara House & Lot", queue.Items[0].Assignment.PropertyName);
        Assert.Equal(PostStatus.Pending, queue.Items[0].Post?.Status);
        Assert.Equal("Verdant Hills Lot 12,Seaside Residences 2BR,Mabini Commercial Space,Greenfield Farm Lot",
            string.Join(",", queue.Items.Skip(1).Take(4).Select(i => i.Assignment.PropertyName)));
        Assert.True(queue.Items.All(i => i.Property is not null), "every queue item has its folder");
        Assert.Equal(1, (await app.Assignments.GetQueueAsync(Jan, app.Clock.Today.AddDays(-1))).Posted);
        Assert.Count(0, (await app.Tracker.GetAssignmentsAsync()).Where(a => a.Date > app.Clock.Today));

        // Manager's dashboard.
        var dashboard = await app.Dashboard.GetDashboardAsync(app.Clock.Today);
        Assert.Equal(4, dashboard.PostedToday);
        Assert.Equal(2, dashboard.PendingOpen);
        Assert.Equal(4, dashboard.InternsAssigned);
        Assert.Equal(2, dashboard.InternsDone);
        Assert.Equal(2, dashboard.NeverPosted);
        Assert.Equal(4, dashboard.DueForRepost);
        Assert.Equal("Never posted · in Jan's queue", dashboard.NeedsAttention[0].Detail);
        Assert.Equal("Never posted · in Bea's queue", dashboard.NeedsAttention[1].Detail);
        Assert.Equal("Mabini Commercial Space", dashboard.NeedsAttention[2].Property.Name);

        // Every posted row has a unique link; pending rows have none.
        var posts = await app.Tracker.GetPostsAsync();
        Assert.True(posts.Count >= 28, $"{posts.Count} rows");
        Assert.True(posts.Where(p => p.Status == PostStatus.Pending).All(p => p.PostLink == ""));
        Assert.Equal(posts.Count(p => p.Status == PostStatus.Posted), posts.Where(p => p.Status == PostStatus.Posted).Select(p => p.PostLink).Distinct().Count());
        Assert.True(posts.Zip(posts.Skip(1)).All(x => (x.First.Date, x.First.Time).CompareTo((x.Second.Date, x.Second.Time)) <= 0), "oldest first");

        // The doc that must not be posted as-is.
        var mabini = await app.Posting.OpenAsync("Commercial/Mabini Commercial Space");
        Assert.Equal(CheckStatus.Fail, mabini.Checks.Single(c => c.Name == "No commission wording").Status);
        Assert.Equal(2, mabini.History.Count);
        Assert.Equal(new DateOnly(2026, 9, 27), mabini.History[0].Date);
    }

    [Test]
    public async Task The_demo_flows_work_on_the_seeded_files()
    {
        using var app = new DiskApp();
        Seeder(app).Reset();
        var today = app.Clock.Today;

        // Jan logs the next queue item, then completes the pending one.
        var queue = await app.Assignments.GetQueueAsync(Jan, today);
        var next = queue.Items.First(i => i.Assignment.Status == AssignmentStatus.ToPost);
        var logged = await app.Posting.LogPostAsync(new LogPostRequest(next.Property!.Id, "APG Homes Cavite",
            "https://www.facebook.com/groups/apghomescavite/posts/9990001/", PostStatus.Posted, Jan, next.Assignment.Key));
        Assert.True(logged.Saved, logged.Message);

        var pendingKey = queue.Items[0].Post!.Key;
        var completed = await app.Posting.CompletePendingAsync(pendingKey, "https://www.facebook.com/groups/apghomescavite/posts/9990002/");
        Assert.True(completed.Saved, completed.Message);

        var after = await app.Assignments.GetQueueAsync(Jan, today);
        Assert.Equal(3, after.ToPost);
        Assert.Equal(3, after.Posted);
        Assert.Equal(0, after.Pending);
        Assert.Equal(PostStatus.Posted, (await app.Posting.GetPostAsync(pendingKey))?.Status);

        // Cooldown refuses Lot 7; the manager builds tomorrow's queue.
        var lot7 = await app.Posting.LogPostAsync(new LogPostRequest("Lot/Verdant Hills Lot 7", "APG Homes Cavite",
            "https://www.facebook.com/groups/apghomescavite/posts/9990003/", PostStatus.Posted, Jan, null));
        Assert.False(lot7.Saved);

        await app.Assignments.SaveQueueAsync("Mika Reyes", today.AddDays(1), new[] { "Verdant Hills Lot 3", "Sta Rosa Lot 22" });
        Assert.Equal(2, await app.Assignments.CountOpenAsync("Mika Reyes", today.AddDays(1)));
    }

    [Test]
    public void EnsureSeeded_seeds_once_and_again_only_when_the_sample_is_gone()
    {
        using var app = new DiskApp();
        var seeder = Seeder(app);

        seeder.EnsureSeeded();
        var posts = Path.Combine(app.Settings.Current.TrackerFolder, "Posts.csv");
        Assert.True(File.Exists(posts));

        File.AppendAllText(posts, "marker-row\r\n");
        seeder.EnsureSeeded();
        Assert.Contains("marker-row", File.ReadAllText(posts));

        Directory.Delete(Path.Combine(app.Settings.DataFolder, "PROTOTYPE-sample"), recursive: true);
        seeder.EnsureSeeded();
        Assert.DoesNotContain("marker-row", File.ReadAllText(posts));

        var real = app.Settings.Current.Clone();
        real.UsingSampleData = false;
        real.PropertiesFolder = app.Temp.PathOf("real-drive-folder");
        app.Settings.Save(real);
        seeder.EnsureSeeded();
        Assert.Equal(app.Temp.PathOf("real-drive-folder"), app.Settings.Current.PropertiesFolder, "a real folder is never replaced");
    }

    [Test]
    public async Task Reset_without_bundled_folders_still_works()
    {
        using var app = new DiskApp();

        Seeder(app, app.Temp.PathOf("nothing-here")).Reset();

        Assert.True(Directory.Exists(app.Settings.Current.PropertiesFolder));
        Assert.Count(0, await app.Posting.SearchAsync(""));
        Assert.True((await app.Tracker.GetPostsAsync()).Count > 0);
    }
}

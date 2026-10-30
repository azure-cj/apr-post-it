using PostIt.Core;

namespace PostIt.Tests.CoreLogic;

public class TrackerServiceTests
{
    private const string Jan = "Jan Dela Cruz", Mika = "Mika Reyes", Bea = "Bea Lim";
    private static readonly DateOnly Today = TestApp.Today;

    [Test]
    public async Task Dashboard_summarises_the_day()
    {
        var app = new TestApp();
        var s = app.Settings.Current.Clone();
        s.Users.Add(new AppUser(Bea, UserRole.Intern));
        s.Users.Add(new AppUser("Aaron Idle", UserRole.Intern));
        app.Settings.Save(s);

        foreach (var name in new[] { "Verdant Hills Lot 12", "Verdant Hills Lot 3", "Mabini Commercial Space", "Seaside Residences 2BR", "Sta. Rosa Lot 22", "Antipolo Ridge Lot 18", "Casa Amara House & Lot" })
            app.AddProperty(name);
        app.AddPost("Verdant Hills Lot 12", 26);
        app.AddPost("Verdant Hills Lot 3", 21);
        app.AddPost("Mabini Commercial Space", 32);
        app.AddPost("Mabini Commercial Space", 45);
        app.AddPost("Antipolo Ridge Lot 18", 0, time: "11:36", by: Mika);
        app.AddPost("Verdant Hills Lot 3", 0, time: "10:17");
        app.AddPost("Casa Amara House & Lot", 0, PostStatus.Pending, time: "10:31");
        app.AddPost("Casa Amara House & Lot", 3, PostStatus.Pending, time: "15:00", by: Bea);

        Assignment A(string who, string property, AssignmentStatus status) => new("", Today, who, property, status);
        await app.Tracker.ReplaceQueueAsync(Today, Jan, new[]
        {
            A(Jan, "Casa Amara House & Lot", AssignmentStatus.Pending), A(Jan, "Verdant Hills Lot 3", AssignmentStatus.Posted),
            A(Jan, "Seaside Residences 2BR", AssignmentStatus.ToPost),
        });
        await app.Tracker.ReplaceQueueAsync(Today, Mika, new[] { A(Mika, "Antipolo Ridge Lot 18", AssignmentStatus.Posted) });
        await app.Tracker.ReplaceQueueAsync(Today.AddDays(1), Bea, new[] { new Assignment("", Today.AddDays(1), Bea, "Sta. Rosa Lot 22", AssignmentStatus.ToPost) });

        var d = await app.Core().Tracker.GetDashboardAsync(Today);

        Assert.Equal(Today, d.Date);
        Assert.Equal(2, d.PostedToday);
        Assert.Equal(2, d.PendingOpen);
        Assert.Equal("11:36,10:31,10:17", string.Join(",", d.TodaysPosts.Select(p => p.Time.ToString("HH:mm"))));

        Assert.Equal("Jan Dela Cruz:3/1/1/1,Mika Reyes:1/1/0/0,Aaron Idle:0/0/0/0,Bea Lim:0/0/0/0",
            string.Join(",", d.Interns.Select(i => $"{i.User.Name}:{i.Total}/{i.Posted}/{i.Pending}/{i.ToPost}")));
        Assert.Equal(2, d.InternsAssigned);
        Assert.Equal(1, d.InternsDone);

        Assert.Equal("Seaside Residences 2BR|Never posted · in Jan's queue,Sta. Rosa Lot 22|Never posted · not assigned," +
                     "Mabini Commercial Space|Last posted 32 days ago,Verdant Hills Lot 12|Last posted 26 days ago",
            string.Join(",", d.NeedsAttention.Select(a => $"{a.Property.Name}|{a.Detail}")));
        Assert.Equal(AttentionKind.NeverPosted, d.NeedsAttention[0].Kind);
        Assert.Equal(AttentionKind.DueForRepost, d.NeedsAttention[2].Kind);
        Assert.Equal(2, d.DueForRepost);
        Assert.Equal(2, d.NeverPosted);
    }

    [Test]
    public async Task Empty_tracker_lists_every_property_as_never_posted()
    {
        var app = new TestApp();
        app.AddProperty("B Lot");
        app.AddProperty("A Lot");

        var d = await app.Core().Tracker.GetDashboardAsync(Today);

        Assert.Equal(0, d.PostedToday);
        Assert.Equal(0, d.InternsAssigned);
        Assert.Equal("Jan Dela Cruz,Mika Reyes", string.Join(",", d.Interns.Select(i => i.User.Name)), "interns only, by name");
        Assert.Equal("A Lot,B Lot", string.Join(",", d.NeedsAttention.Select(a => a.Property.Name)));
        Assert.Equal(2, d.NeverPosted);
        Assert.Equal(0, d.DueForRepost);
    }
}

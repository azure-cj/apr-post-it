using PostIt.Core;
using PostIt.Presentation.ViewModels;
using static PostIt.Tests.Intern.InternWorld;

namespace PostIt.Tests.Intern;

public class InternSearchTests
{
    [Test]
    public async Task Initial_query_is_applied_on_load_and_rows_show_cooldown_and_due()
    {
        var app = NewApp();
        var vm = new SearchViewModel(app.Services(), app.Nav, "verdant");
        Assert.Equal("Search", vm.Title);
        Assert.Equal("verdant", vm.Query);

        await vm.LoadAsync();

        Assert.Equal("Verdant Hills Lot 12,Verdant Hills Lot 3,Verdant Hills Lot 7", string.Join(",", vm.Results.Select(r => r.Name)));
        Assert.Equal("3 matches", vm.CountText);

        var lot12 = vm.Results[0];
        Assert.Equal("Last posted 3 Oct · 26 days ago", lot12.Meta);
        Assert.True(lot12.IsDue, "26 days ≥ the 14-day repost period");
        Assert.False(lot12.IsInCooldown);
        Assert.Equal("Lot", lot12.Category);

        var lot3 = vm.Results[1];
        Assert.False(lot3.IsDue);
        Assert.False(lot3.IsInCooldown);

        var lot7 = vm.Results[2];
        Assert.True(lot7.IsInCooldown);
        Assert.Equal("Cooldown · 5 days left", lot7.CooldownText);
        Assert.Equal("Last posted 27 Oct · 2 days ago", lot7.Meta);
        Assert.False(lot7.IsDue);
    }

    [Test]
    public async Task Typing_filters_live_and_counts_matches()
    {
        var app = NewApp();
        var vm = new SearchViewModel(app.Services(), app.Nav, null);
        await vm.LoadAsync();
        Assert.Equal("5 properties", vm.CountText);
        Assert.False(vm.NoResults);

        vm.Query = "seaside";
        var seaside = vm.Results.Single();
        Assert.Equal("1 match", vm.CountText);
        Assert.Equal("Never posted", seaside.Meta);
        Assert.False(seaside.IsDue, "never posted is not shown as Due");

        vm.Query = "zzz";
        Assert.True(vm.NoResults);
        Assert.Equal("No matches", vm.CountText);
        Assert.Contains("zzz", vm.NoResultsText);

        vm.ClearCommand.Execute(null);
        Assert.Equal("", vm.Query);
        Assert.Equal("5 properties", vm.CountText);
        Assert.False(vm.ClearCommand.CanExecute(null));
    }

    [Test]
    public async Task Open_goes_to_the_property_without_a_queue_item()
    {
        var app = NewApp();
        var vm = new SearchViewModel(app.Services(), app.Nav, "casa");
        await vm.LoadAsync();

        vm.Results.Single().OpenCommand.Execute(null);

        Assert.Equal("Property:House & Lot/Casa Amara House & Lot|", app.Nav.Last);
    }

    [Test]
    public async Task Only_the_newest_search_result_is_shown()
    {
        var app = NewApp();
        var posting = new GatedPosting(app.Core().Posting);
        var vm = new SearchViewModel(app.Services() with { Posting = posting }, app.Nav, null);
        await vm.LoadAsync();

        posting.HoldSearches = true;
        vm.Query = "verdant";
        vm.Query = "seaside";
        Assert.Count(2, posting.Searches);

        posting.ReleaseSearch(1);   // the newer one finishes first…
        await Eventually(() => vm.Results.Count == 1);
        Assert.Equal("Seaside Residences 2BR", vm.Results.Single().Name);

        posting.ReleaseSearch(0);   // …and the older, slower one must not overwrite it
        await Task.Delay(30);
        Assert.Equal("Seaside Residences 2BR", vm.Results.Single().Name);
        Assert.Equal("1 match", vm.CountText);
    }

    [Test]
    public async Task Older_result_arriving_first_is_replaced_by_the_newer_one()
    {
        var app = NewApp();
        var posting = new GatedPosting(app.Core().Posting);
        var vm = new SearchViewModel(app.Services() with { Posting = posting }, app.Nav, null);
        await vm.LoadAsync();

        posting.HoldSearches = true;
        vm.Query = "verdant";
        vm.Query = "verdant 7";
        posting.ReleaseSearch(0);
        await Task.Delay(30);
        Assert.Equal(5, vm.Results.Count);   // stale: ignored, the previous list stays

        posting.ReleaseSearch(1);
        await Eventually(() => vm.Results.Count == 1);
        Assert.Equal("Verdant Hills Lot 7", vm.Results.Single().Name);
    }

    [Test]
    public async Task Shows_todays_logs_by_this_intern_only()
    {
        var app = NewApp();
        app.AddPost("Seaside Residences 2BR", 0, category: "Condo", time: "08:52", account: "APG Properties PH");
        app.AddPost("Casa Amara House & Lot", 0, category: "House & Lot", time: "09:10", by: Mika);

        var vm = new SearchViewModel(app.Services(), app.Nav, null);
        await vm.LoadAsync();

        var log = vm.MyLogs.Single();
        Assert.Equal("Seaside Residences 2BR", log.Title);
        Assert.Equal("APG Properties PH · 08:52", log.Meta);
        Assert.Equal("ok", log.BadgeKind);
        log.ViewPostCommand.Execute(null);
        Assert.Equal("url:" + log.Link, app.Ui.Opened.Single());
    }
}

using PostIt.Core;
using PostIt.Presentation;
using PostIt.Presentation.ViewModels;
using PostIt.Tests.CoreLogic;
using static PostIt.Tests.Intern.InternWorld;

namespace PostIt.Tests.Intern;

public class InternPropertyTests
{
    [Test]
    public async Task Loads_text_checks_history_and_photos()
    {
        var app = NewApp();
        var vm = new PropertyViewModel(app.Services(), app.Nav, "Lot/Verdant Hills Lot 12", null);
        await vm.LoadAsync();

        Assert.True(vm.IsLoaded);
        Assert.Equal("Verdant Hills Lot 12", vm.Title);
        Assert.Equal(NavKey.Search, vm.Nav);
        Assert.Equal("Lot · Tagaytay · Last posted 3 Oct 2026 (26 days ago)", vm.Subtitle);
        Assert.Equal(2, vm.ActiveStep);
        Assert.False(vm.IsInCooldown);
        Assert.False(vm.IsCopyBlocked);
        Assert.False(vm.HasDocWarning);
        Assert.True(vm.CanCopy);

        Assert.Equal("Price present,Contact numbers present,No commission wording,Internal section hidden,Last posted 26 days ago",
            string.Join(",", vm.Checks.Select(c => c.Name)));
        Assert.True(vm.Checks.All(c => c.Status == CheckStatus.Pass));
        Assert.Equal("OK to repost", vm.Checks[^1].Detail);

        var history = vm.History.Single();
        Assert.Equal("3 Oct 2026", history.Date);
        Assert.Equal("APG Homes Cavite", history.FbAccount);
        Assert.Equal("Mia", history.By);
        Assert.Equal("ok", history.BadgeKind);
        Assert.False(vm.NeverPosted);

        Assert.Equal("2 files in the property folder", vm.PhotoCountText);
        Assert.Equal("photo-1.jpg", vm.Photos[0].FileName);
        vm.Photos[0].OpenCommand.Execute(null);
        Assert.Equal("file:/props/Lot/Verdant Hills Lot 12/photo-1.jpg", app.Ui.Opened.Last());

        vm.OpenFolderCommand.Execute(null);
        Assert.Equal("folder:/props/Lot/Verdant Hills Lot 12", app.Ui.Opened.Last());
    }

    [Test]
    public async Task Copy_copies_only_the_public_text()
    {
        var app = NewApp();
        var vm = new PropertyViewModel(app.Services(), app.Nav, "Lot/Verdant Hills Lot 12", null);
        await vm.LoadAsync();

        vm.CopyCommand.Execute(null);

        Assert.Equal(vm.PublicText, app.Ui.Clipboard);
        Assert.Contains("FOR SALE: 320 sqm lot", app.Ui.Clipboard);
        Assert.Contains("Price: ₱4.2M", app.Ui.Clipboard);
        Assert.DoesNotContain("Commission", app.Ui.Clipboard);
        Assert.DoesNotContain("INTERNAL", app.Ui.Clipboard);
        Assert.DoesNotContain("Mr. Reyes", app.Ui.Clipboard);
        Assert.DoesNotContain("Category:", app.Ui.Clipboard);
        Assert.True(vm.HasCopied);
        Assert.Equal(3, vm.ActiveStep);
        Assert.Equal(("Copied the public text. Rephrase it in your AI tool, then post it with the photos.", ToastKind.Success),
            app.Notifier.Messages.Single());
    }

    [Test]
    public async Task Internal_section_is_hidden_until_shown_and_never_copied()
    {
        var app = NewApp();
        var vm = new PropertyViewModel(app.Services(), app.Nav, "Lot/Verdant Hills Lot 12", null);
        await vm.LoadAsync();

        Assert.True(vm.HasInternalSection);
        Assert.False(vm.HasNoInternalSection);
        Assert.False(vm.IsInternalShown);
        Assert.Equal("Show", vm.InternalToggleLabel);
        Assert.Contains("Commission: 3% to agent", vm.InternalText);

        vm.ToggleInternalCommand.Execute(null);
        Assert.True(vm.IsInternalShown);
        Assert.Equal("Hide", vm.InternalToggleLabel);

        vm.CopyCommand.Execute(null);
        Assert.DoesNotContain("Commission", app.Ui.Clipboard);
    }

    [Test]
    public async Task Copy_is_blocked_when_the_public_text_mentions_commission()
    {
        var app = NewApp();
        app.AddProperty("Leaky Lot", "Lot", "Category: Lot\nLocation: Tagaytay\n\nFOR SALE: 200 sqm lot\nPrice: ₱2M\nContact: 0917 000 0000\nCommission: 5% to agent");
        var vm = new PropertyViewModel(app.Services(), app.Nav, "Lot/Leaky Lot", null);
        await vm.LoadAsync();

        Assert.True(vm.IsCopyBlocked);
        Assert.Equal("Copy is blocked: the public text mentions commission (\"Commission\"). Ask your manager to fix the posting doc.",
            vm.CopyBlockedMessage);
        Assert.False(vm.CanCopy);
        Assert.False(vm.CopyCommand.CanExecute(null));

        vm.CopyCommand.Execute(null);
        Assert.Null(app.Ui.Clipboard);
        Assert.Equal(2, vm.ActiveStep);
        Assert.Equal(CheckStatus.Fail, vm.Checks.Single(c => c.Name == "No commission wording").Status);
        Assert.True(vm.HasNoInternalSection, "no internal marker in this doc");
    }

    [Test]
    public async Task Cooldown_is_explained_above_the_text()
    {
        var app = NewApp();
        var vm = new PropertyViewModel(app.Services(), app.Nav, "Lot/Verdant Hills Lot 7", null);
        await vm.LoadAsync();

        Assert.True(vm.IsInCooldown);
        Assert.Equal("In cooldown — posted 2 days ago (27 Oct). It can be posted again on Tue 3 Nov. Logging will be refused.",
            vm.CooldownMessage);
        var cooldown = vm.Checks[^1];
        Assert.Equal(CheckStatus.Fail, cooldown.Status);
        Assert.Equal("Last posted 2 days ago", cooldown.Name);
        Assert.Equal("in cooldown, 5 days left", cooldown.Detail);
        Assert.True(vm.CanCopy, "reading and copying is still allowed; logging is what gets refused");
    }

    [Test]
    public async Task Never_posted_property_and_missing_doc()
    {
        var app = NewApp();
        app.Properties.Add("Empty Folder", "Lot", "", "Imus", photos: 0);
        var vm = new PropertyViewModel(app.Services(), app.Nav, "Lot/Empty Folder", null);
        await vm.LoadAsync();

        Assert.Equal("Lot · Imus · Never posted", vm.Subtitle);
        Assert.True(vm.NeverPosted);
        Assert.True(vm.HasDocWarning);
        Assert.Contains("No posting doc", vm.DocWarning);
        Assert.False(vm.CanCopy);
        Assert.True(vm.NoPhotos);
        Assert.False(vm.DownloadAllCommand.CanExecute(null));
        Assert.Equal("Never posted", vm.Checks[^1].Name);
    }

    [Test]
    public async Task Next_and_back_keep_the_queue_item()
    {
        var app = NewApp();
        var key = QueueKey("Verdant Hills Lot 12");
        var vm = new PropertyViewModel(app.Services(), app.Nav, "Lot/Verdant Hills Lot 12", key);
        Assert.Equal(NavKey.MyQueue, vm.Nav);
        Assert.False(vm.NextCommand.CanExecute(null), "nothing to log before the property is loaded");

        await vm.LoadAsync();
        vm.NextCommand.Execute(null);
        Assert.Equal($"LogPost:Lot/Verdant Hills Lot 12|{key}", app.Nav.Last);

        vm.BackCommand.Execute(null);
        Assert.Equal("Back", app.Nav.Last);
    }

    [Test]
    public async Task Missing_folder_shows_an_error_instead_of_the_page()
    {
        var app = NewApp();
        var vm = new PropertyViewModel(app.Services(), app.Nav, "Lot/Gone", null);
        await vm.LoadAsync();

        Assert.False(vm.IsLoaded);
        Assert.True(vm.HasLoadError);
        Assert.Equal("That property folder no longer exists.", vm.LoadError);
        Assert.Equal("Property", vm.Title);
        Assert.False(vm.NextCommand.CanExecute(null));
    }

    [Test]
    public async Task Download_all_copies_the_photos_to_downloads_and_opens_the_folder()
    {
        using var temp = new TempDir();
        var app = NewApp();
        var photos = new[]
        {
            temp.Write("props/Lot/Sunny Lot/photo-1.jpg", "one"),
            temp.Write("props/Lot/Sunny Lot/photo-2.jpg", "two"),
            temp.Write("props/Lot/Sunny Lot/photo-3.png", "three"),
        };
        var property = new Property("Lot/Sunny Lot", "Sunny Lot", "Lot", "Tagaytay", temp.PathOf("props/Lot/Sunny Lot"),
            temp.Write("props/Lot/Sunny Lot/posting.txt", TestApp.StandardDoc), photos);
        var posting = new PostingService(new RealPhotoFolders(property, TestApp.StandardDoc), app.Tracker, app.Settings, app.Clock);
        app.Ui.DownloadsFolder = temp.PathOf("Downloads");

        var vm = new PropertyViewModel(app.Services() with { Posting = posting }, app.Nav, property.Id, null);
        await vm.LoadAsync();
        Assert.Equal("3 files in the property folder", vm.PhotoCountText);

        await vm.DownloadAllCommand.ExecuteAsync();

        var target = Path.Combine(temp.PathOf("Downloads"), "APG Post-It", "Sunny Lot");
        Assert.Equal("one", File.ReadAllText(Path.Combine(target, "photo-1.jpg")));
        Assert.Equal("two", File.ReadAllText(Path.Combine(target, "photo-2.jpg")));
        Assert.Equal("three", File.ReadAllText(Path.Combine(target, "photo-3.png")));
        Assert.Equal("folder:" + target, app.Ui.Opened.Last());
        Assert.Equal(("Saved 3 photos to Downloads\\APG Post-It\\Sunny Lot", ToastKind.Success), app.Notifier.Messages.Last());

        // Again after a photo changed: overwritten, not duplicated.
        File.WriteAllText(photos[0], "one, edited");
        await vm.DownloadAllCommand.ExecuteAsync();
        Assert.Equal("one, edited", File.ReadAllText(Path.Combine(target, "photo-1.jpg")));
        Assert.Count(3, Directory.GetFiles(target));
    }

    [Test]
    public async Task Download_all_reports_missing_files()
    {
        using var temp = new TempDir();
        var app = NewApp();
        var photos = new[] { temp.Write("p/photo-1.jpg", "one"), temp.PathOf("p/photo-2.jpg") };   // the second one is gone
        var property = new Property("Lot/Half Lot", "Half Lot", "Lot", null, temp.PathOf("p"), null, photos);
        var posting = new PostingService(new RealPhotoFolders(property, TestApp.StandardDoc), app.Tracker, app.Settings, app.Clock);
        app.Ui.DownloadsFolder = temp.PathOf("Downloads");

        var vm = new PropertyViewModel(app.Services() with { Posting = posting }, app.Nav, property.Id, null);
        await vm.LoadAsync();
        await vm.DownloadAllCommand.ExecuteAsync();

        Assert.Equal(("Saved 1 photo to Downloads\\APG Post-It\\Half Lot (1 file was missing)", ToastKind.Warning), app.Notifier.Messages.Last());
        Assert.True(File.Exists(Path.Combine(temp.PathOf("Downloads"), "APG Post-It", "Half Lot", "photo-1.jpg")));
    }

    [Test]
    public async Task Host_failures_become_error_toasts()
    {
        var app = NewApp();
        var vm = new PropertyViewModel(app.Services() with { Ui = new ThrowingUi() }, app.Nav, "Lot/Verdant Hills Lot 12", null);
        await vm.LoadAsync();

        vm.CopyCommand.Execute(null);
        vm.OpenFolderCommand.Execute(null);

        Assert.Equal("The clipboard is busy. Try Copy again.", app.Notifier.Messages[0].Message);
        Assert.Equal(ToastKind.Error, app.Notifier.Messages[0].Kind);
        Assert.False(vm.HasCopied, "a failed copy does not move the steps on");
        Assert.Equal("Folder not found: /props/Lot/Verdant Hills Lot 12", app.Notifier.Messages[1].Message);
    }

    private sealed class ThrowingUi : IUiServices
    {
        public string DownloadsFolder => Path.GetTempPath();
        public void CopyText(string text) => throw new UserFacingException("The clipboard is busy. Try Copy again.");
        public string? ReadClipboardText() => null;
        public void OpenFolder(string path) => throw new UserFacingException($"Folder not found: {path}");
        public void OpenFile(string path) => throw new UserFacingException($"File not found: {path}");
        public void OpenUrl(string url) => throw new UserFacingException("That doesn't look like a web link.");
        public string? PickFolder(string title, string? initialFolder = null) => null;
        public bool Confirm(string title, string message, string confirmLabel = "OK") => false;
    }
}

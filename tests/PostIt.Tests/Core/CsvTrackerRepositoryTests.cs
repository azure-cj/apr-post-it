using System.Text;
using PostIt.Core;
using PostIt.Core.Testing;

namespace PostIt.Tests.CoreLogic;

public class CsvTrackerRepositoryTests
{
    private const string Header = "Date,Type,Title,Time,Status,FB Account,Post Link,Posted By";
    private static readonly DateOnly Today = TestApp.Today;

    private static (CsvTrackerRepository Repo, string Folder) NewRepo(TempDir temp, string folder = "tracker")
    {
        var path = temp.PathOf(folder);
        return (new CsvTrackerRepository(new InMemorySettingsStore(new AppSettings { TrackerFolder = path })), path);
    }

    private static PostLogEntry Post(string title, PostStatus status = PostStatus.Posted, string link = "https://www.facebook.com/groups/x/posts/1/",
        string by = "Jan Dela Cruz", string account = "APG Homes Cavite", string type = "Lot", int daysAgo = 0, string time = "10:17") =>
        new("", Today.AddDays(-daysAgo), TimeOnly.Parse(time), type, title, status, account, link, by);

    [Test]
    public async Task Round_trips_awkward_text_and_numbers_rows_like_the_sheet()
    {
        using var temp = new TempDir();
        var (repo, _) = NewRepo(temp);
        var tricky = Post("Casa \"Amara\", House & Lot", account: "APG, Homes\nCavite", by: "Jan Dela Cruz", type: "Dasmariñas ₱6.5M");

        var first = await repo.AddPostAsync(tricky);
        var second = await repo.AddPostAsync(Post("Sta. Rosa Lot 22", PostStatus.Pending, link: ""));

        Assert.Equal("2", first.Key);
        Assert.Equal("3", second.Key);
        var posts = await repo.GetPostsAsync();
        Assert.Count(2, posts);
        Assert.Equal(tricky with { Key = "2" }, posts[0]);
        Assert.Equal(PostStatus.Pending, posts[1].Status);
        Assert.Equal("", posts[1].PostLink);
    }

    [Test]
    public async Task Writes_UTF8_with_BOM_and_Excel_friendly_rows()
    {
        using var temp = new TempDir();
        var (repo, folder) = NewRepo(temp);
        await repo.AddPostAsync(Post("Casa Amara House & Lot", type: "House & Lot", time: "09:05"));
        await repo.ReplaceQueueAsync(Today, "Jan Dela Cruz", new[] { new Assignment("", Today, "Jan Dela Cruz", "Seaside Residences 2BR", AssignmentStatus.ToPost) });

        var bytes = File.ReadAllBytes(Path.Combine(folder, "Posts.csv"));
        Assert.True(bytes.Length > 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF, "BOM present");
        var lines = Encoding.UTF8.GetString(bytes).TrimStart('﻿').Split("\r\n");
        Assert.Equal(Header, lines[0]);
        Assert.Equal("2026-10-29,House & Lot,Casa Amara House & Lot,09:05,Posted,APG Homes Cavite,https://www.facebook.com/groups/x/posts/1/,Jan Dela Cruz", lines[1]);

        var assignmentBytes = File.ReadAllBytes(Path.Combine(folder, "Assignments.csv"));
        Assert.True(assignmentBytes[0] == 0xEF && assignmentBytes[1] == 0xBB && assignmentBytes[2] == 0xBF, "BOM present");
        var assignments = Encoding.UTF8.GetString(assignmentBytes);
        Assert.Contains("Date,Assigned To,Property,Status\r\n2026-10-29,Jan Dela Cruz,Seaside Residences 2BR,To post\r\n", assignments);
    }

    [Test]
    public async Task Rows_it_cannot_read_are_kept_and_still_count_as_sheet_rows()
    {
        using var temp = new TempDir();
        var (repo, folder) = NewRepo(temp);
        var garbage1 = "TOTAL,,,,,,,";
        var garbage2 = "2026-10-01,Lot,\"Unclosed quote,10:00,Posted,,,";
        var garbage3 = "not a date,Lot,Verdant Hills Lot 3,10:00,Posted,,,";
        File.WriteAllText(Path.Combine(folder.EnsureFolder(), "Posts.csv"), string.Join("\n",
            Header,
            "2026-10-20,Lot,Verdant Hills Lot 7,10:12,Posted,APG Homes Cavite,https://fb.com/1,Mika Reyes",
            garbage1, garbage2, garbage3,
            "10/27/2026,Lot,Verdant Hills Lot 7,3:40 PM,posted,APG Homes Cavite,https://fb.com/2,Jan Dela Cruz") + "\n");

        var posts = await repo.GetPostsAsync();
        Assert.Equal("2,6", string.Join(",", posts.Select(p => p.Key)));
        Assert.Equal(new DateOnly(2026, 10, 27), posts[1].Date);
        Assert.Equal(new TimeOnly(15, 40), posts[1].Time);

        var added = await repo.AddPostAsync(Post("Sunrise Homes Block 3 Lot 9"));
        Assert.Equal("7", added.Key);
        await repo.UpdatePostAsync(posts[1] with { PostLink = "https://fb.com/2b" });

        var text = File.ReadAllText(Path.Combine(folder, "Posts.csv"));
        Assert.Contains("\r\n" + garbage1 + "\r\n" + garbage2 + "\r\n" + garbage3 + "\r\n", text);
        Assert.Contains("2026-10-27,Lot,Verdant Hills Lot 7,15:40,Posted,APG Homes Cavite,https://fb.com/2b,Jan Dela Cruz", text);
        Assert.Equal("2,6,7", string.Join(",", (await repo.GetPostsAsync()).Select(p => p.Key)));
    }

    [Test]
    public async Task Keys_stay_stable_across_updates_and_appends()
    {
        using var temp = new TempDir();
        var (repo, _) = NewRepo(temp);
        await repo.AddPostAsync(Post("A Lot"));
        var pending = await repo.AddPostAsync(Post("B Lot", PostStatus.Pending, link: ""));
        await repo.AddPostAsync(Post("C Lot"));

        await repo.UpdatePostAsync(pending with { Status = PostStatus.Posted, PostLink = "https://www.facebook.com/groups/x/posts/9/" });
        await repo.AddPostAsync(Post("D Lot"));

        var posts = await repo.GetPostsAsync();
        Assert.Equal("2:A Lot,3:B Lot,4:C Lot,5:D Lot", string.Join(",", posts.Select(p => $"{p.Key}:{p.Title}")));
        Assert.Equal(PostStatus.Posted, posts[1].Status);
        Assert.Equal("https://www.facebook.com/groups/x/posts/9/", posts[1].PostLink);
    }

    [Test]
    public async Task Update_refuses_unknown_rows_and_rows_that_moved()
    {
        using var temp = new TempDir();
        var (repo, _) = NewRepo(temp);
        var saved = await repo.AddPostAsync(Post("A Lot"));

        var missing = await Assert.ThrowsAsync<UserFacingException>(() => repo.UpdatePostAsync(saved with { Key = "99" }));
        Assert.Equal("Post row 99 was not found in the tracker.", missing.Message);

        var moved = await Assert.ThrowsAsync<UserFacingException>(() => repo.UpdatePostAsync(saved with { Title = "Another Lot" }));
        Assert.Contains("changed since it was loaded", moved.Message);
    }

    [Test]
    public async Task Columns_added_or_moved_in_Excel_are_respected()
    {
        using var temp = new TempDir();
        var (repo, folder) = NewRepo(temp);
        File.WriteAllText(Path.Combine(folder.EnsureFolder(), "Posts.csv"),
            "Title,Date,Type,Time,Status,FB Account,Post Link,Posted By,Notes\r\n" +
            "Verdant Hills Lot 7,2026-10-27,Lot,15:40,Pending,APG Homes Cavite,,Jan Dela Cruz,call owner first\r\n");

        var post = (await repo.GetPostsAsync()).Single();
        Assert.Equal("Verdant Hills Lot 7", post.Title);
        await repo.UpdatePostAsync(post with { Status = PostStatus.Posted, PostLink = "https://fb.com/7" });

        var lines = File.ReadAllText(Path.Combine(folder, "Posts.csv")).Split("\r\n");
        Assert.Equal("Verdant Hills Lot 7,2026-10-27,Lot,15:40,Posted,APG Homes Cavite,https://fb.com/7,Jan Dela Cruz,call owner first", lines[1]);
    }

    [Test]
    public async Task Replacing_a_queue_keeps_its_place_and_new_queues_go_at_the_end()
    {
        using var temp = new TempDir();
        var (repo, folder) = NewRepo(temp);
        Assignment A(string who, string property, AssignmentStatus status = AssignmentStatus.ToPost) => new("", Today, who, property, status);

        await repo.ReplaceQueueAsync(Today, "Jan Dela Cruz", new[] { A("Jan Dela Cruz", "Lot 1"), A("Jan Dela Cruz", "Lot 2") });
        await repo.ReplaceQueueAsync(Today, "Mika Reyes", new[] { A("Mika Reyes", "Lot 3") });
        await repo.ReplaceQueueAsync(Today, "jan dela cruz ", new[] { A("Jan Dela Cruz", "Lot 2", AssignmentStatus.Posted), A("Jan Dela Cruz", "Lot 4"), A("Jan Dela Cruz", "Lot 1") });
        await repo.ReplaceQueueAsync(Today, "Bea Lim", new[] { A("Bea Lim", "Lot 5") });

        var rows = await repo.GetAssignmentsAsync();
        Assert.Equal("Jan:Lot 2:Posted,Jan:Lot 4:ToPost,Jan:Lot 1:ToPost,Mika:Lot 3:ToPost,Bea:Lot 5:ToPost",
            string.Join(",", rows.Select(r => $"{r.AssignedTo.Split(' ')[0]}:{r.PropertyName}:{r.Status}")));
        Assert.Equal(Assignment.MakeKey(Today, "Jan Dela Cruz", "Lot 2"), rows[0].Key);

        await repo.ReplaceQueueAsync(Today, "Mika Reyes", Array.Empty<Assignment>());
        Assert.Count(4, await repo.GetAssignmentsAsync());
        Assert.DoesNotContain("Mika", File.ReadAllText(Path.Combine(folder, "Assignments.csv")));
    }

    [Test]
    public async Task Assignment_status_reads_both_spellings_and_updates_by_key()
    {
        using var temp = new TempDir();
        var (repo, folder) = NewRepo(temp);
        File.WriteAllText(Path.Combine(folder.EnsureFolder(), "Assignments.csv"),
            "Date,Assigned To,Property,Status\n2026-10-29,Jan Dela Cruz,Lot 1,ToPost\n2026-10-29,Jan Dela Cruz,Lot 2,to post\n2026-10-29,Jan Dela Cruz,Lot 3,Done?\n2026-10-29,Jan Dela Cruz,Lot 4,PENDING\n");

        var rows = await repo.GetAssignmentsAsync();
        Assert.Equal("ToPost,ToPost,Pending", string.Join(",", rows.Select(r => r.Status)));

        await repo.UpdateAssignmentAsync(rows[0] with { Status = AssignmentStatus.Posted });
        var text = File.ReadAllText(Path.Combine(folder, "Assignments.csv"));
        Assert.Contains("2026-10-29,Jan Dela Cruz,Lot 1,Posted\r\n", text);
        Assert.Contains("2026-10-29,Jan Dela Cruz,Lot 3,Done?\r\n", text);

        var gone = await Assert.ThrowsAsync<UserFacingException>(() =>
            repo.UpdateAssignmentAsync(new Assignment(Assignment.MakeKey(Today, "Jan Dela Cruz", "Lot 9"), Today, "Jan Dela Cruz", "Lot 9", AssignmentStatus.Posted)));
        Assert.Equal("That queue item no longer exists.", gone.Message);
    }

    [Test]
    public async Task Locked_file_gives_a_plain_English_error()
    {
        using var temp = new TempDir();
        var (repo, folder) = NewRepo(temp);
        await repo.AddPostAsync(Post("A Lot"));
        var path = Path.Combine(folder, "Posts.csv");

        using (new FileStream(path, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
        {
            var read = await Assert.ThrowsAsync<UserFacingException>(() => repo.GetPostsAsync());
            Assert.Equal("Posts.csv is open in another program (Excel?). Close it and try again.", read.Message);
            await Assert.ThrowsAsync<UserFacingException>(() => repo.AddPostAsync(Post("B Lot")));
        }

        Assert.Count(1, await repo.GetPostsAsync());
    }

    [Test]
    public async Task Missing_files_and_folder_are_an_empty_tracker()
    {
        using var temp = new TempDir();
        var (repo, folder) = NewRepo(temp, "not/yet/there");

        Assert.Count(0, await repo.GetPostsAsync());
        Assert.Count(0, await repo.GetAssignmentsAsync());
        Assert.True(Directory.Exists(folder));

        var noFolder = new CsvTrackerRepository(new InMemorySettingsStore(new AppSettings()));
        var ex = await Assert.ThrowsAsync<UserFacingException>(() => noFolder.GetPostsAsync());
        Assert.Equal("No tracker folder is set. Choose one in Settings.", ex.Message);
    }
}

internal static class FolderExtensions
{
    public static string EnsureFolder(this string folder) => Directory.CreateDirectory(folder).FullName;
}

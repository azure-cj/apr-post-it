using System.Net;
using System.Text;
using System.Text.Json;
using PostIt.Core;
using PostIt.Core.Google;

namespace PostIt.Tests.GoogleBackend;

/// <summary>
/// The Apps Script adapters, against a stub transport. Nothing here touches the
/// network: the point is the mapping and, above all, that a server refusal
/// reaches the user as a sentence rather than an HTTP code.
/// </summary>
public class ScriptBackendTests
{
    private const string Url = "https://script.google.com/macros/s/AKfy/exec";

    // ------------------------------------------------------------ harness

    private sealed class Stub : HttpMessageHandler
    {
        private readonly Func<string, (HttpStatusCode, string)> _reply;
        public List<Dictionary<string, JsonElement>> Requests { get; } = new();
        public List<HttpRequestMessage> Raw { get; } = new();

        public Stub(Func<string, (HttpStatusCode, string)> reply) => _reply = reply;

        public Stub(string json) : this(_ => (HttpStatusCode.OK, json)) { }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var body = request.Content is null ? "{}" : await request.Content.ReadAsStringAsync(ct);
            Requests.Add(JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(body)!);
            Raw.Add(request);

            var (code, json) = _reply(body);
            return new HttpResponseMessage(code)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json"),
            };
        }
    }

    private static ScriptClient Client(Stub stub, string key = "testkey") =>
        new(() => (Url, key), new HttpClient(stub));

    private static PostLogEntry Entry(string title = "Casa Amara", PostStatus status = PostStatus.Posted,
        string link = "https://www.facebook.com/groups/x/posts/1/") =>
        new("", new DateOnly(2026, 1, 1), new TimeOnly(9, 0), "Lot", title, status, "APG Homes", link, "Jan Dela Cruz");

    // ------------------------------------------------- refusals reach the user

    [Test]
    public async Task Cooldown_refusal_arrives_as_the_servers_own_sentence()
    {
        var stub = new Stub("""
            {"ok":false,"error":"cooldown","lastPosted":"2026-01-01","nextAllowed":"2026-01-08",
             "message":"Posted 2 day(s) ago. Next allowed Jan 8."}
            """);
        var repo = new ScriptTrackerRepository(Client(stub));

        var error = await Assert.ThrowsAsync<UserFacingException>(() => repo.AddPostAsync(Entry()));
        Assert.Equal("Posted 2 day(s) ago. Next allowed Jan 8.", error.Message);
    }

    [Test]
    public async Task An_unknown_key_says_what_to_do_about_it()
    {
        var stub = new Stub("""{"ok":false,"error":"unauthorized"}""");
        var repo = new ScriptTrackerRepository(Client(stub));

        var error = await Assert.ThrowsAsync<UserFacingException>(() => repo.GetPostsAsync());
        Assert.Contains("key", error.Message);
    }

    [Test]
    public async Task A_forbidden_action_keeps_the_servers_wording()
    {
        var stub = new Stub("""{"ok":false,"error":"forbidden","message":"You are not assigned to APG Rentals."}""");
        var repo = new ScriptTrackerRepository(Client(stub));

        var error = await Assert.ThrowsAsync<UserFacingException>(() => repo.AddPostAsync(Entry()));
        Assert.Equal("You are not assigned to APG Rentals.", error.Message);
    }

    [Test]
    public async Task A_sign_in_page_instead_of_json_names_the_real_mistake()
    {
        // The commonest setup error: the web app was deployed without "Anyone" access.
        var stub = new Stub(_ => (HttpStatusCode.OK, "<!DOCTYPE html><html><body>Sign in</body></html>"));
        var repo = new ScriptTrackerRepository(Client(stub));

        var error = await Assert.ThrowsAsync<UserFacingException>(() => repo.GetPostsAsync());
        Assert.Contains("Redeploy", error.Message);
    }

    [Test]
    public async Task A_dead_connection_does_not_leak_an_http_exception()
    {
        var stub = new Stub(_ => throw new HttpRequestException("no such host"));
        var repo = new ScriptTrackerRepository(Client(stub));

        var error = await Assert.ThrowsAsync<UserFacingException>(() => repo.GetPostsAsync());
        Assert.Contains("connection", error.Message);
    }

    [Test]
    public async Task Without_a_url_and_key_it_says_so_before_calling_anything()
    {
        var stub = new Stub("""{"ok":true}""");
        var client = new ScriptClient(() => ("", ""), new HttpClient(stub));
        var repo = new ScriptTrackerRepository(client);

        var error = await Assert.ThrowsAsync<UserFacingException>(() => repo.GetPostsAsync());
        Assert.Contains("Settings", error.Message);
        Assert.Count(0, stub.Requests);
    }

    // ---------------------------------------------------- the key travels safely

    [Test]
    public async Task The_key_goes_in_the_body_never_in_a_header()
    {
        // .NET strips custom headers across the redirect Apps Script performs,
        // so a key sent as a header would silently vanish.
        var stub = new Stub("""{"ok":true,"posts":[]}""");
        await new ScriptTrackerRepository(Client(stub, "s3cret")).GetPostsAsync();

        Assert.Equal("s3cret", stub.Requests[0]["key"].GetString());
        Assert.Equal("posts", stub.Requests[0]["action"].GetString());
        Assert.False(stub.Raw[0].Headers.Any(h => h.Value.Any(v => v.Contains("s3cret"))));
    }

    // ------------------------------------------------------------- mapping

    [Test]
    public async Task Posts_map_out_of_the_sheets_loose_date_and_time_formats()
    {
        var stub = new Stub("""
            {"ok":true,"posts":[
              {"date":"2026-01-05","type":"Lot","title":"Verdant Hills Lot 7","time":"14:30",
               "status":"Posted","fbAccount":"APG Homes","postLink":"https://fb.com/1","postedBy":"Jan Dela Cruz"},
              {"date":"2026-01-06T00:00:00.000Z","type":"Condo","title":"Casa Amara","time":"",
               "status":"Pending","fbAccount":"APG Rentals","postLink":"","postedBy":"Bea Lim"}]}
            """);
        var posts = await new ScriptTrackerRepository(Client(stub)).GetPostsAsync();

        Assert.Count(2, posts);
        Assert.Equal(new DateOnly(2026, 1, 5), posts[0].Date);
        Assert.Equal(new TimeOnly(14, 30), posts[0].Time);
        Assert.Equal(PostStatus.Posted, posts[0].Status);
        Assert.Equal(new DateOnly(2026, 1, 6), posts[1].Date);   // serialised date, not text
        Assert.Equal(PostStatus.Pending, posts[1].Status);
    }

    [Test]
    public async Task A_saved_post_takes_the_servers_date_and_name_not_the_clients()
    {
        var stub = new Stub("""{"ok":true,"status":"Pending","date":"2026-03-09","postedBy":"Jan Dela Cruz"}""");
        var repo = new ScriptTrackerRepository(Client(stub));

        var saved = await repo.AddPostAsync(Entry(status: PostStatus.Pending, link: ""));

        Assert.Equal(new DateOnly(2026, 3, 9), saved.Date);
        Assert.Equal(PostStatus.Pending, saved.Status);
        Assert.Equal("Jan Dela Cruz", saved.PostedBy);
    }

    [Test]
    public async Task Editing_a_row_other_than_adding_its_link_is_refused_locally()
    {
        var stub = new Stub("""{"ok":true}""");
        var repo = new ScriptTrackerRepository(Client(stub));

        var error = await Assert.ThrowsAsync<UserFacingException>(
            () => repo.UpdatePostAsync(Entry(status: PostStatus.Pending, link: "")));

        Assert.Contains("sheet", error.Message);
        Assert.Count(0, stub.Requests);      // never reached the network
    }

    [Test]
    public async Task Saving_a_queue_sends_the_items_in_order()
    {
        var stub = new Stub("""{"ok":true,"saved":2}""");
        var repo = new ScriptTrackerRepository(Client(stub));
        var date = new DateOnly(2026, 4, 2);

        await repo.ReplaceQueueAsync(date, "Jan Dela Cruz", new[]
        {
            new Assignment("", date, "Jan Dela Cruz", "Casa Amara", AssignmentStatus.ToPost),
            new Assignment("", date, "Jan Dela Cruz", "Lot 9", AssignmentStatus.Pending),
        });

        var sent = stub.Requests[0];
        Assert.Equal("2026-04-02", sent["date"].GetString());
        var items = sent["items"].EnumerateArray().ToList();
        Assert.Equal("Casa Amara", items[0].GetProperty("property").GetString());
        Assert.Equal("To post", items[0].GetProperty("status").GetString());
        Assert.Equal("Pending", items[1].GetProperty("status").GetString());
    }

    // ------------------------------------------------------------ properties

    [Test]
    public async Task A_manager_gets_the_internal_half_rejoined_for_the_parser()
    {
        var stub = new Stub("""
            {"ok":true,"property":{"id":"1AbC","name":"Casa Amara","category":"Condo","location":"Antipolo",
             "publicText":"FOR SALE\nPHP 8,500,000","internalText":"Commission: 3%","hasInternal":true,
             "photos":[{"id":"p1","name":"front.jpg","url":"https://drive.google.com/uc?id=p1","thumb":"t"}]}}
            """);
        var repo = new ScriptPropertyRepository(Client(stub));

        var property = Assert.NotNull(await repo.GetAsync("1AbC"));
        var raw = await repo.ReadPostingDocAsync(property);
        var parsed = PostingTextParser.Parse(raw);

        Assert.True(parsed.HasInternalSection);
        Assert.Equal("Commission: 3%", parsed.InternalText);
        Assert.DoesNotContain("Commission", parsed.PublicText);
        Assert.Count(1, property.PhotoPaths);
        Assert.Count(1, stub.Requests);          // detail fetched once, then cached
    }

    [Test]
    public async Task An_intern_receives_no_internal_text_at_all()
    {
        // The server simply omits the field. Nothing to hide client-side,
        // because nothing arrived.
        var stub = new Stub("""
            {"ok":true,"property":{"id":"1AbC","name":"Casa Amara","category":"Condo",
             "publicText":"FOR SALE\nPHP 8,500,000","hasInternal":true,"photos":[]}}
            """);
        var repo = new ScriptPropertyRepository(Client(stub));

        var property = Assert.NotNull(await repo.GetAsync("1AbC"));
        var parsed = PostingTextParser.Parse(await repo.ReadPostingDocAsync(property));

        Assert.False(parsed.HasInternalSection);
        Assert.Equal("", parsed.InternalText);
        Assert.Contains("PHP 8,500,000", parsed.PublicText);
    }

    [Test]
    public async Task The_folder_path_becomes_the_category_line()
    {
        // The library nests Category > Sub-category > Listing type, and all three
        // matter when telling two "Lot 7"s apart.
        var stub = new Stub("""
            {"ok":true,"properties":[
              {"id":"1","name":"Lot 7","category":"CONDO / HOUSE AND LOT",
               "listingType":"FOR SALE","subCategory":"Lot","photoCount":3},
              {"id":"2","name":"Silang 40","category":"COMMERCIAL SPACE",
               "listingType":"For lease","photoCount":7}]}
            """);
        var all = await new ScriptPropertyRepository(Client(stub)).GetAllAsync();

        Assert.Equal("CONDO / HOUSE AND LOT \u00b7 Lot \u00b7 FOR SALE", all[0].Category);
        Assert.Equal("COMMERCIAL SPACE \u00b7 For lease", all[1].Category);   // no sub-category, no empty gap
    }

    [Test]
    public async Task Photo_links_from_the_directory_sheet_become_photo_paths()
    {
        var stub = new Stub("""
            {"ok":true,"property":{"id":"1","name":"Silang 40","category":"COMMERCIAL SPACE",
             "publicText":"FOR RENT","cutAt":"--- line","live":true,
             "photos":[{"id":"p1","url":"https://drive.google.com/uc?export=download&id=p1","thumb":"t1"},
                       {"id":"p2","url":"https://drive.google.com/uc?export=download&id=p2","thumb":"t2"}]}}
            """);
        var property = Assert.NotNull(await new ScriptPropertyRepository(Client(stub)).GetAsync("1"));

        Assert.Count(2, property.PhotoPaths);
        Assert.Contains("id=p2", property.PhotoPaths[1]);
    }

    [Test]
    public async Task The_property_list_is_fetched_once_and_then_cached_until_refreshed()
    {
        var stub = new Stub("""
            {"ok":true,"properties":[
              {"id":"2","name":"Verdant Hills Lot 7","category":"Lot","photoCount":4},
              {"id":"1","name":"Casa Amara","category":"Condo","photoCount":12}]}
            """);
        var repo = new ScriptPropertyRepository(Client(stub));

        var first = await repo.GetAllAsync();
        await repo.GetAllAsync();
        Assert.Count(1, stub.Requests);
        Assert.Equal("Casa Amara", first[0].Name);     // sorted by name

        repo.Refresh();
        await repo.GetAllAsync();
        Assert.Count(2, stub.Requests);
    }
}

using PostIt.Core;
using PostIt.Core.Testing;

namespace PostIt.Tests.CoreLogic;

public class FolderPropertyRepositoryTests
{
    private static (FolderPropertyRepository Repo, InMemorySettingsStore Settings) NewRepo(string root)
    {
        var settings = new InMemorySettingsStore(new AppSettings { PropertiesFolder = root });
        return (new FolderPropertyRepository(settings), settings);
    }

    /// <summary>Nested category folders, flat property folders, a Photos subfolder, a .gdoc, a .docx and things to skip.</summary>
    private static TempDir BuildFolders()
    {
        var t = new TempDir();
        t.Write("props/Lot/Verdant Hills Lot 12/posting.txt", "Category: Somewhere Else\nLocation: Tagaytay\n\nFOR SALE: 320 sqm lot");
        t.Write("props/Lot/Verdant Hills Lot 12/notes.txt", "older notes");
        t.Write("props/Lot/Verdant Hills Lot 12/README.txt", "read me");
        t.Write("props/Lot/Verdant Hills Lot 12/~$posting.docx", "lock");
        foreach (var photo in new[] { "photo-10.jpg", "photo-2.JPG", "photo-1.jpeg", "floor plan.pdf" }) t.Write($"props/Lot/Verdant Hills Lot 12/{photo}");
        t.Write("props/Lot/Verdant Hills Lot 12/Photos/aerial.png");
        t.Write("props/Lot/Verdant Hills Lot 12/Photos/.thumb.jpg");
        t.Write("props/Lot/Drive Lot/Posting Doc.gdoc", "{\"url\":\"https://docs.google.com/document/d/x\"}");
        t.Write("props/Lot/Drive Lot/a.webp");
        t.Folder("props/Lot/Empty Lot");
        t.Folder("props/Lot/_archive/Old Lot");
        t.Write("props/Condo/Seaside Residences 2BR/listing.md", "Category: Penthouse\nLocation: Pasay\n\nBay view");
        t.Write("props/Condo/Seaside Residences 2BR/listing.docx");
        Docx.Write(t.PathOf("props/Mabini Commercial Space/posting.docx"),
            "Category: Commercial", "Location: Makati", "", "FOR LEASE:\t120 sqm", "Line one\nline two", "=== INTERNAL ===", "Commission 5%");
        t.Write("props/Loose Lot/photo.gif");
        t.Write("props/.git/config", "x");
        t.Write("props/_templates/Template/posting.txt", "x");
        return t;
    }

    [Test]
    public async Task Reads_nested_and_flat_layouts()
    {
        using var t = BuildFolders();
        var (repo, _) = NewRepo(t.PathOf("props"));

        var all = await repo.GetAllAsync();

        Assert.Equal("Drive Lot|Empty Lot|Loose Lot|Mabini Commercial Space|Seaside Residences 2BR|Verdant Hills Lot 12", string.Join("|", all.Select(p => p.Name)));
        var verdant = all.Single(p => p.Name == "Verdant Hills Lot 12");
        Assert.Equal("Lot/Verdant Hills Lot 12", verdant.Id);
        Assert.Equal("Lot", verdant.Category, "category folder wins over doc metadata in the nested layout");
        Assert.Equal("Tagaytay", verdant.Location);
        Assert.Equal(t.PathOf("props/Lot/Verdant Hills Lot 12"), verdant.FolderPath);

        var mabini = all.Single(p => p.Name == "Mabini Commercial Space");
        Assert.Equal("Mabini Commercial Space", mabini.Id);
        Assert.Equal("Commercial", mabini.Category, "flat folder takes its category from the doc");
        Assert.Equal("Makati", mabini.Location);

        var loose = all.Single(p => p.Name == "Loose Lot");
        Assert.Equal("Uncategorized", loose.Category);
        Assert.Null(loose.PostingDocPath);
        Assert.Count(1, loose.PhotoPaths);

        Assert.Equal("Condo", all.Single(p => p.Name == "Seaside Residences 2BR").Category);
        Assert.Null(all.Single(p => p.Name == "Empty Lot").PostingDocPath);
        Assert.Equal(verdant, await repo.GetAsync("lot/verdant hills lot 12"));
        Assert.Null(await repo.GetAsync("Lot/Old Lot"));
    }

    [Test]
    public async Task Picks_the_posting_doc_by_priority_and_photos_in_natural_order()
    {
        using var t = BuildFolders();
        var (repo, _) = NewRepo(t.PathOf("props"));
        var all = await repo.GetAllAsync();
        string Doc(string name) => Path.GetFileName(all.Single(p => p.Name == name).PostingDocPath ?? "");

        Assert.Equal("posting.txt", Doc("Verdant Hills Lot 12"));
        Assert.Equal("listing.md", Doc("Seaside Residences 2BR"));
        Assert.Equal("posting.docx", Doc("Mabini Commercial Space"));
        Assert.Equal("Posting Doc.gdoc", Doc("Drive Lot"));

        var photos = all.Single(p => p.Name == "Verdant Hills Lot 12").PhotoPaths.Select(Path.GetFileName);
        Assert.Equal("aerial.png,photo-1.jpeg,photo-2.JPG,photo-10.jpg", string.Join(",", photos));
    }

    [Test]
    public async Task Other_txt_beats_md_and_docx()
    {
        using var t = new TempDir();
        t.Write("props/Lot/A/z notes.txt", "txt");
        t.Write("props/Lot/A/a.md", "md");
        Docx.Write(t.PathOf("props/Lot/B/b.docx"), "docx");
        t.Write("props/Lot/B/c.md", "md");
        var (repo, _) = NewRepo(t.PathOf("props"));
        var all = await repo.GetAllAsync();

        Assert.Equal("z notes.txt", Path.GetFileName(all.Single(p => p.Name == "A").PostingDocPath));
        Assert.Equal("c.md", Path.GetFileName(all.Single(p => p.Name == "B").PostingDocPath));
    }

    [Test]
    public async Task Reads_txt_docx_and_gdoc()
    {
        using var t = BuildFolders();
        t.Write("props/Lot/Bom Lot/posting.txt", "﻿Category: Lot\nPrice: ₱4.2M\nDasmariñas");
        var (repo, _) = NewRepo(t.PathOf("props"));
        var all = await repo.GetAllAsync();

        var docx = await repo.ReadPostingDocAsync(all.Single(p => p.Name == "Mabini Commercial Space"));
        Assert.Equal("Category: Commercial\nLocation: Makati\n\nFOR LEASE:\t120 sqm\nLine one\nline two\n=== INTERNAL ===\nCommission 5%", docx);

        var txt = await repo.ReadPostingDocAsync(all.Single(p => p.Name == "Bom Lot"));
        Assert.Equal("Category: Lot\nPrice: ₱4.2M\nDasmariñas", txt.TrimStart('﻿'));
        Assert.Contains("₱4.2M", txt);

        Assert.Equal("", await repo.ReadPostingDocAsync(all.Single(p => p.Name == "Drive Lot")));
        Assert.Equal("", await repo.ReadPostingDocAsync(all.Single(p => p.Name == "Loose Lot")));
    }

    [Test]
    public async Task Damaged_docx_is_a_user_facing_error_but_does_not_break_the_scan()
    {
        using var t = BuildFolders();
        var (repo, _) = NewRepo(t.PathOf("props"));
        var seaside = (await repo.GetAllAsync()).Single(p => p.Name == "Seaside Residences 2BR");
        var broken = seaside with { PostingDocPath = t.PathOf("props/Condo/Seaside Residences 2BR/listing.docx") };

        var ex = await Assert.ThrowsAsync<UserFacingException>(() => repo.ReadPostingDocAsync(broken));
        Assert.Equal("\"listing.docx\" could not be read. Open it in Word and save it again.", ex.Message);
    }

    [Test]
    public async Task Missing_root_is_a_user_facing_error()
    {
        var (repo, _) = NewRepo("/no/such/folder/props");
        var ex = await Assert.ThrowsAsync<UserFacingException>(() => repo.GetAllAsync());
        Assert.Equal("The property folder \"/no/such/folder/props\" was not found. Check Settings.", ex.Message);
    }

    [Test]
    public async Task Cache_is_refreshed_on_request_and_when_the_folder_setting_changes()
    {
        using var t = BuildFolders();
        var (repo, settings) = NewRepo(t.PathOf("props"));
        Assert.Count(6, await repo.GetAllAsync());

        t.Write("props/Lot/New Lot/posting.txt", "FOR SALE");
        Assert.Count(6, await repo.GetAllAsync(), "cached");
        repo.Refresh();
        Assert.Count(7, await repo.GetAllAsync());

        t.Write("other/Condo/Only One/posting.txt", "x");
        var s = settings.Current.Clone();
        s.PropertiesFolder = t.PathOf("other");
        settings.Save(s);
        Assert.Equal("Only One", (await repo.GetAllAsync()).Single().Name);
    }
}

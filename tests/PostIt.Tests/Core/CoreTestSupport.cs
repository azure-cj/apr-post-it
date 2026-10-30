using System.IO.Compression;
using System.Text;
using System.Xml.Linq;
using PostIt.Core;

namespace PostIt.Tests.CoreLogic;

/// <summary>A throw-away folder under the system temp folder, deleted on Dispose.</summary>
public sealed class TempDir : IDisposable
{
    public TempDir()
    {
        Root = Path.Combine(Path.GetTempPath(), "postit-core-" + Guid.NewGuid().ToString("N")[..10]);
        Directory.CreateDirectory(Root);
    }

    public string Root { get; }

    public string PathOf(string relative) => Path.Combine(Root, relative.Replace('/', Path.DirectorySeparatorChar));

    /// <summary>Writes a UTF-8 (no BOM) file, creating folders as needed.</summary>
    public string Write(string relative, string content = "")
    {
        var path = PathOf(relative);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, content, new UTF8Encoding(false));
        return path;
    }

    public string Folder(string relative) => Directory.CreateDirectory(PathOf(relative)).FullName;

    public void Dispose()
    {
        try { Directory.Delete(Root, recursive: true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }
}

public static class RepoFiles
{
    /// <summary>The repository root, found by walking up from the test assembly to APG.PostIt.sln.</summary>
    public static string Root
    {
        get
        {
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "APG.PostIt.sln"))) dir = dir.Parent;
            return dir?.FullName ?? throw new InvalidOperationException("APG.PostIt.sln not found above " + AppContext.BaseDirectory);
        }
    }

    /// <summary>src/PostIt.App/SampleData (contains Properties/).</summary>
    public static string BundledSampleData => Path.Combine(Root, "src", "PostIt.App", "SampleData");

    public static string SampleDoc(string category, string property) =>
        File.ReadAllText(Path.Combine(BundledSampleData, "Properties", category, property, "posting.txt"));
}

/// <summary>Builds minimal but valid Word .docx files (System.IO.Compression only).</summary>
public static class Docx
{
    private static readonly XNamespace W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

    /// <summary>One w:p per paragraph; "\t" becomes w:tab and "\n" becomes w:br. Each paragraph is split over two runs.</summary>
    public static void Write(string path, params string[] paragraphs)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        using var zip = ZipFile.Open(path, ZipArchiveMode.Create);
        Add(zip, "[Content_Types].xml",
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">" +
            "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>" +
            "<Default Extension=\"xml\" ContentType=\"application/xml\"/>" +
            "<Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/></Types>");
        Add(zip, "_rels/.rels",
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
            "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/></Relationships>");

        var body = new XElement(W + "body", paragraphs.Select(Paragraph));
        var document = new XDocument(new XElement(W + "document", new XAttribute(XNamespace.Xmlns + "w", W), body));
        Add(zip, "word/document.xml", document.ToString(SaveOptions.DisableFormatting));
    }

    private static XElement Paragraph(string text)
    {
        var half = text.Length / 2;
        return new XElement(W + "p", Run(text[..half]), Run(text[half..]));
    }

    private static XElement Run(string text)
    {
        var run = new XElement(W + "r");
        var current = new StringBuilder();
        void Flush()
        {
            if (current.Length == 0) return;
            run.Add(new XElement(W + "t", new XAttribute(XNamespace.Xml + "space", "preserve"), current.ToString()));
            current.Clear();
        }
        foreach (var c in text)
        {
            if (c == '\t') { Flush(); run.Add(new XElement(W + "tab")); }
            else if (c == '\n') { Flush(); run.Add(new XElement(W + "br")); }
            else current.Append(c);
        }
        Flush();
        return run;
    }

    private static void Add(ZipArchive zip, string name, string content)
    {
        using var writer = new StreamWriter(zip.CreateEntry(name).Open(), new UTF8Encoding(false));
        writer.Write(content);
    }
}

/// <summary>The real app over a temp data folder: JSON settings, folder properties, CSV tracker, real services.</summary>
public sealed class DiskApp : IDisposable
{
    public DiskApp()
    {
        Settings = new JsonSettingsStore(Temp.PathOf("data"));
        Properties = new FolderPropertyRepository(Settings);
        Tracker = new CsvTrackerRepository(Settings);
        Posting = new PostingService(Properties, Tracker, Settings, Clock);
        Assignments = new AssignmentService(Properties, Tracker, Settings, Clock);
        Dashboard = new TrackerService(Properties, Tracker, Settings, Clock);
    }

    public TempDir Temp { get; } = new();
    public FixedClock Clock { get; } = new(TestApp.Today, new TimeOnly(9, 41));
    public JsonSettingsStore Settings { get; }
    public FolderPropertyRepository Properties { get; }
    public CsvTrackerRepository Tracker { get; }
    public PostingService Posting { get; }
    public AssignmentService Assignments { get; }
    public TrackerService Dashboard { get; }

    /// <summary>Points the settings at folders inside the temp folder.</summary>
    public void UseFolders(string properties = "props", string tracker = "tracker")
    {
        var s = Settings.Current.Clone();
        s.PropertiesFolder = Temp.PathOf(properties);
        s.TrackerFolder = Temp.PathOf(tracker);
        Settings.Save(s);
    }

    public void Dispose() => Temp.Dispose();
}

namespace PostIt.Core;

/// <summary>
/// Reads property folders from <see cref="AppSettings.PropertiesFolder"/>. Two layouts work, even mixed:
/// <c>&lt;root&gt;/&lt;Category&gt;/&lt;Property&gt;/</c> and <c>&lt;root&gt;/&lt;Property&gt;/</c> (a folder that itself holds a
/// posting doc or photos is a property; otherwise it is a category folder).
/// The scan is cached for a minute, until <see cref="Refresh"/>, or until the folder setting changes.
/// </summary>
public sealed class FolderPropertyRepository : IPropertyRepository
{
    private const string Uncategorized = "Uncategorized";
    private static readonly TimeSpan CacheLifetime = TimeSpan.FromSeconds(60);
    private static readonly string[] PhotoExtensions = { ".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif" };

    private readonly ISettingsStore _settings;
    private readonly object _gate = new();
    private IReadOnlyList<Property>? _cache;
    private string? _cacheRoot;
    private DateTime _cachedAtUtc;

    /// <summary>Reads the folder named in <paramref name="settings"/> (re-read on every call).</summary>
    public FolderPropertyRepository(ISettingsStore settings) => _settings = settings;

    /// <inheritdoc />
    public Task<IReadOnlyList<Property>> GetAllAsync(CancellationToken ct = default)
    {
        var root = _settings.Current.PropertiesFolder?.Trim() ?? "";
        lock (_gate)
        {
            if (_cache is not null && _cacheRoot == root && DateTime.UtcNow - _cachedAtUtc < CacheLifetime)
                return Task.FromResult(_cache);
        }

        return Task.Run(() =>
        {
            var scanned = Scan(root, ct);
            lock (_gate) (_cache, _cacheRoot, _cachedAtUtc) = (scanned, root, DateTime.UtcNow);
            return scanned;
        }, ct);
    }

    /// <inheritdoc />
    public async Task<Property?> GetAsync(string id, CancellationToken ct = default)
    {
        var all = await GetAllAsync(ct);
        return all.FirstOrDefault(p => string.Equals(p.Id, id, StringComparison.OrdinalIgnoreCase));
    }

    /// <inheritdoc />
    public Task<string> ReadPostingDocAsync(Property property, CancellationToken ct = default) =>
        Task.Run(() => ReadDoc(property.PostingDocPath), ct);

    /// <inheritdoc />
    public void Refresh()
    {
        lock (_gate) _cache = null;
    }

    // ---------------------------------------------------------------- scanning

    private static IReadOnlyList<Property> Scan(string root, CancellationToken ct)
    {
        if (root.Length == 0) throw new UserFacingException("No property folder is set. Choose one in Settings.");
        if (!Directory.Exists(root)) throw new UserFacingException($"The property folder \"{root}\" was not found. Check Settings.");

        var properties = new List<Property>();
        foreach (var folder in VisibleSubfolders(root))
        {
            ct.ThrowIfCancellationRequested();
            if (IsPropertyFolder(folder))
            {
                properties.Add(ReadProperty(root, folder, category: null));
                continue;
            }
            foreach (var propertyFolder in VisibleSubfolders(folder))
                properties.Add(ReadProperty(root, propertyFolder, category: Path.GetFileName(folder)));
        }
        return properties.OrderBy(p => p.Name, StringComparer.OrdinalIgnoreCase).ToList();
    }

    /// <summary>Reads one property. A null <paramref name="category"/> means a flat folder: the doc's metadata decides.</summary>
    private static Property ReadProperty(string root, string folder, string? category)
    {
        var doc = FindPostingDoc(folder);
        var meta = PostingTextParser.Parse(TryReadDoc(doc));
        return new Property(
            Id: Path.GetRelativePath(root, folder).Replace(Path.DirectorySeparatorChar, '/'),
            Name: Path.GetFileName(folder),
            Category: category ?? meta.Category ?? Uncategorized,
            Location: meta.Location,
            FolderPath: folder,
            PostingDocPath: doc,
            PhotoPaths: FindPhotos(folder));
    }

    private static bool IsPropertyFolder(string folder) => FindPostingDoc(folder) is not null || FindPhotos(folder).Count > 0;

    /// <summary>posting.txt, then any other .txt, .md, .docx, and finally a Google Docs shortcut (.gdoc).</summary>
    private static string? FindPostingDoc(string folder)
    {
        var files = VisibleFiles(folder)
            .Where(f => !Path.GetFileName(f).StartsWith("README", StringComparison.OrdinalIgnoreCase))
            .OrderBy(Path.GetFileName, StringComparer.OrdinalIgnoreCase)
            .ToList();

        return files.FirstOrDefault(f => Path.GetFileName(f).Equals("posting.txt", StringComparison.OrdinalIgnoreCase))
               ?? files.FirstOrDefault(f => HasExtension(f, ".txt"))
               ?? files.FirstOrDefault(f => HasExtension(f, ".md"))
               ?? files.FirstOrDefault(f => HasExtension(f, ".docx"))
               ?? files.FirstOrDefault(f => HasExtension(f, ".gdoc"));
    }

    /// <summary>Photos in the folder and in its "Photos" subfolder, in natural name order (photo-2 before photo-10).</summary>
    private static IReadOnlyList<string> FindPhotos(string folder)
    {
        var photoFolders = VisibleSubfolders(folder).Where(f => Path.GetFileName(f).Equals("photos", StringComparison.OrdinalIgnoreCase));
        return new[] { folder }.Concat(photoFolders)
            .SelectMany(VisibleFiles)
            .Where(f => PhotoExtensions.Any(ext => HasExtension(f, ext)))
            .OrderBy(f => Path.GetFileName(f), NaturalComparer.Instance)
            .ToList();
    }

    private static IEnumerable<string> VisibleSubfolders(string folder) =>
        SafeEnumerate(() => Directory.EnumerateDirectories(folder)).Where(IsVisible);

    private static IEnumerable<string> VisibleFiles(string folder) =>
        SafeEnumerate(() => Directory.EnumerateFiles(folder))
            .Where(f => IsVisible(f) && !Path.GetFileName(f).StartsWith("~$", StringComparison.Ordinal));

    /// <summary>Skips hidden entries and the "_archive" / ".sync" style folders people keep next to real ones.</summary>
    private static bool IsVisible(string path)
    {
        var name = Path.GetFileName(path);
        if (name.StartsWith('.') || name.StartsWith('_')) return false;
        try { return (File.GetAttributes(path) & (FileAttributes.Hidden | FileAttributes.System)) == 0; }
        catch (IOException) { return false; }
        catch (UnauthorizedAccessException) { return false; }
    }

    private static IEnumerable<string> SafeEnumerate(Func<IEnumerable<string>> list)
    {
        try { return list().ToList(); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { return Array.Empty<string>(); }
    }

    private static bool HasExtension(string path, string extension) =>
        Path.GetExtension(path).Equals(extension, StringComparison.OrdinalIgnoreCase);

    // ---------------------------------------------------------------- reading the doc

    /// <summary>For the scan: a doc that can't be read just has no metadata.</summary>
    private static string TryReadDoc(string? path)
    {
        try { return ReadDoc(path); }
        catch (UserFacingException) { return ""; }
    }

    private static string ReadDoc(string? path)
    {
        if (path is null || HasExtension(path, ".gdoc") || !File.Exists(path)) return "";
        var name = Path.GetFileName(path);
        try
        {
            using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            return HasExtension(path, ".docx") ? DocxText.Read(stream) : TextFile.Read(stream);
        }
        catch (Exception ex) when (ex is InvalidDataException or System.Xml.XmlException)
        {
            throw new UserFacingException($"\"{name}\" could not be read. Open it in Word and save it again.", ex);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            throw new UserFacingException($"\"{name}\" is open in another program or can't be read. Close it and try again.", ex);
        }
    }

    /// <summary>Compares names with embedded numbers by value: "photo-2" &lt; "photo-10".</summary>
    private sealed class NaturalComparer : IComparer<string>
    {
        public static readonly NaturalComparer Instance = new();

        public int Compare(string? x, string? y)
        {
            x ??= ""; y ??= "";
            int i = 0, j = 0;
            while (i < x.Length && j < y.Length)
            {
                if (char.IsDigit(x[i]) && char.IsDigit(y[j]))
                {
                    var (a, b) = (TakeDigits(x, ref i), TakeDigits(y, ref j));
                    var byValue = a.Length != b.Length ? a.Length.CompareTo(b.Length) : string.CompareOrdinal(a, b);
                    if (byValue != 0) return byValue;
                    continue;
                }
                var byChar = char.ToUpperInvariant(x[i]).CompareTo(char.ToUpperInvariant(y[j]));
                if (byChar != 0) return byChar;
                i++; j++;
            }
            return (x.Length - i).CompareTo(y.Length - j);
        }

        private static string TakeDigits(string s, ref int i)
        {
            var start = i;
            while (i < s.Length && char.IsDigit(s[i])) i++;
            return s[start..i].TrimStart('0');
        }
    }
}

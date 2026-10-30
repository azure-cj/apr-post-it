using System.Text.Json.Serialization;

namespace PostIt.Core.Google;

// ============================================================================
//  IPropertyRepository over the Apps Script backend.
//
//  Drive folder ids take the place of folder paths, and photo "paths" are
//  Drive URLs. Nothing above this line knows the difference.
// ============================================================================

public sealed class ScriptPropertyRepository : IPropertyRepository
{
    /// <summary>Marker re-inserted so <see cref="PostingTextParser"/> splits the text as it always has.</summary>
    private const string InternalMarker = "=== INTERNAL — DO NOT POST ===";

    private readonly IScriptClient _client;
    private readonly SemaphoreSlim _gate = new(1, 1);

    private IReadOnlyList<Property>? _all;
    private readonly Dictionary<string, PropertyDetail> _details = new(StringComparer.Ordinal);

    public ScriptPropertyRepository(IScriptClient client) => _client = client;

    public async Task<IReadOnlyList<Property>> GetAllAsync(CancellationToken ct = default)
    {
        if (_all is not null) return _all;

        await _gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            if (_all is not null) return _all;
            var reply = await _client.CallAsync<PropertiesReply>("properties", null, ct).ConfigureAwait(false);

            _all = reply.Properties
                .Select(p => new Property(
                    Id: p.Id,
                    Name: p.Name,
                    Category: Describe(p.Category, p.ListingType, p.SubCategory),
                    Location: null,
                    FolderPath: DriveFolderUrl(p.Id),
                    PostingDocPath: null,
                    PhotoPaths: Array.Empty<string>()))
                .OrderBy(p => p.Name, StringComparer.CurrentCultureIgnoreCase)
                .ToList();
            return _all;
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>Full detail, including photo URLs. One request, then cached until <see cref="Refresh"/>.</summary>
    public async Task<Property?> GetAsync(string id, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(id)) return null;

        var detail = await DetailAsync(id, ct).ConfigureAwait(false);
        if (detail is null) return null;

        return new Property(
            Id: detail.Id,
            Name: detail.Name,
            Category: Describe(detail.Category, detail.ListingType, detail.SubCategory),
            Location: string.IsNullOrWhiteSpace(detail.Location) ? null : detail.Location,
            FolderPath: DriveFolderUrl(detail.Id),
            PostingDocPath: null,
            PhotoPaths: detail.Photos.Select(p => p.Url).Where(u => !string.IsNullOrWhiteSpace(u)).ToList());
    }

    /// <summary>
    /// The posting doc as raw text. The server has already split it, so the two halves
    /// are rejoined with a marker the parser recognises. An intern's reply carries no
    /// internal half at all, so for them there is nothing to rejoin.
    /// </summary>
    public async Task<string> ReadPostingDocAsync(Property property, CancellationToken ct = default)
    {
        var detail = await DetailAsync(property.Id, ct).ConfigureAwait(false);
        if (detail is null) return "";

        return string.IsNullOrWhiteSpace(detail.InternalText)
            ? detail.PublicText
            : $"{detail.PublicText}\n\n{InternalMarker}\n{detail.InternalText}";
    }

    public void Refresh()
    {
        _all = null;
        lock (_details) _details.Clear();
    }

    private async Task<PropertyDetail?> DetailAsync(string id, CancellationToken ct)
    {
        lock (_details)
        {
            if (_details.TryGetValue(id, out var cached)) return cached;
        }

        var reply = await _client
            .CallAsync<PropertyReply>("property", new { id }, ct)
            .ConfigureAwait(false);

        if (reply.Property is null) return null;

        lock (_details) _details[id] = reply.Property;
        return reply.Property;
    }

    private static string DriveFolderUrl(string id) => $"https://drive.google.com/drive/folders/{id}";

    /// <summary>"COMMERCIAL SPACE · For lease" — the folder path, as one line.</summary>
    private static string Describe(string? category, string? listingType, string? subCategory) =>
        string.Join(" · ", new[] { category, subCategory, listingType }
            .Where(part => !string.IsNullOrWhiteSpace(part)));
}

// ---------------------------------------------------------------- payloads

public sealed class PropertiesReply : ScriptReply
{
    [JsonPropertyName("properties")] public List<PropertySummary> Properties { get; set; } = new();
}

public sealed class PropertySummary
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string? Category { get; set; }
    public string? ListingType { get; set; }
    public string? SubCategory { get; set; }
    public int PhotoCount { get; set; }

    /// <summary>The directory flagged something: no document, no photos, no separator.</summary>
    public bool HasIssues { get; set; }
}

public sealed class PropertyReply : ScriptReply
{
    [JsonPropertyName("property")] public PropertyDetail? Property { get; set; }
}

public sealed class PropertyDetail
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string? Category { get; set; }
    public string? Location { get; set; }
    public string PublicText { get; set; } = "";

    /// <summary>Present only for a manager or admin key. Absent means "not yours to see".</summary>
    public string? InternalText { get; set; }

    public bool HasInternal { get; set; }

    public string? ListingType { get; set; }
    public string? SubCategory { get; set; }

    /// <summary>Which marker the posting text was cut at, for auditing.</summary>
    public string? CutAt { get; set; }

    /// <summary>What the directory flagged about this property, if anything.</summary>
    public string? Issues { get; set; }

    /// <summary>True when the text was re-read from the document rather than taken from the sheet.</summary>
    public bool Live { get; set; }

    public List<PhotoRef> Photos { get; set; } = new();
}

public sealed class PhotoRef
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Url { get; set; } = "";
    public string Thumb { get; set; } = "";
}

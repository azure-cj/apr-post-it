namespace PostIt.Core;

/// <summary>The search box rule shared by the Search and Assign screens.</summary>
internal static class PropertySearch
{
    /// <summary>
    /// Properties where every word of <paramref name="query"/> appears in the normalised
    /// "name category location" (so "verdant 12", "condo pasay" and "blk 3" all work). Empty query → all. Sorted by name.
    /// </summary>
    public static IReadOnlyList<Property> Filter(IEnumerable<Property> properties, string? query)
    {
        var words = PropertyNameMatcher.Normalize(query ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries);
        return properties
            .Where(p =>
            {
                var haystack = PropertyNameMatcher.Normalize($"{p.Name} {p.Category} {p.Location}");
                return words.All(w => haystack.Contains(w, StringComparison.Ordinal));
            })
            .OrderBy(p => p.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    /// <summary>Lookup by normalised name; the first folder wins when two share a name.</summary>
    public static Dictionary<string, Property> ByName(IEnumerable<Property> properties)
    {
        var byName = new Dictionary<string, Property>();
        foreach (var p in properties) byName.TryAdd(PropertyNameMatcher.Normalize(p.Name), p);
        return byName;
    }
}

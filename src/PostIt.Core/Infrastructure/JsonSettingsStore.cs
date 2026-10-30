using System.Text.Json;
using System.Text.Json.Serialization;

namespace PostIt.Core;

/// <summary>
/// Settings kept as <c>settings.json</c> in the data folder. A missing file gives the defaults;
/// a corrupt one is set aside as <c>settings.bad.json</c> so the app still starts.
/// </summary>
public sealed class JsonSettingsStore : ISettingsStore
{
    private const string FileName = "settings.json";
    private const string BadFileName = "settings.bad.json";

    private static readonly JsonSerializerOptions Json = new()
    {
        WriteIndented = true,
        PropertyNameCaseInsensitive = true,
        Converters = { new JsonStringEnumConverter(), new AppUserConverter() },
    };

    private readonly string _path;

    /// <summary>Loads (or defaults) the settings stored in <paramref name="dataFolder"/>, creating the folder if needed.</summary>
    public JsonSettingsStore(string dataFolder)
    {
        DataFolder = dataFolder;
        Directory.CreateDirectory(dataFolder);
        _path = Path.Combine(dataFolder, FileName);
        Current = Load();
    }

    /// <inheritdoc />
    public string DataFolder { get; }

    /// <inheritdoc />
    public AppSettings Current { get; private set; }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public void Save(AppSettings settings)
    {
        var temp = _path + ".tmp";
        try
        {
            File.WriteAllText(temp, JsonSerializer.Serialize(settings, Json));
            File.Move(temp, _path, overwrite: true);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            throw new UserFacingException($"Settings could not be saved to \"{_path}\". {ex.Message}", ex);
        }

        Current = settings.Clone();
        Changed?.Invoke(this, EventArgs.Empty);
    }

    private AppSettings Load()
    {
        if (!File.Exists(_path)) return new AppSettings();
        try
        {
            var loaded = JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(_path), Json)
                         ?? throw new JsonException("settings.json is empty.");
            loaded.FbAccounts ??= new List<string>();
            loaded.Users ??= new List<AppUser>();
            loaded.PropertiesFolder ??= "";
            loaded.TrackerFolder ??= "";
            return loaded;
        }
        catch (JsonException)
        {
            try { File.Move(_path, Path.Combine(DataFolder, BadFileName), overwrite: true); }
            catch (IOException) { /* still start with defaults; the next Save overwrites the bad file */ }
            return new AppSettings();
        }
    }

    /// <summary>Writes a user as {"Name", "Role"} only, so the computed Initials/RoleLabel never get in the way.</summary>
    private sealed class AppUserConverter : JsonConverter<AppUser>
    {
        public override AppUser Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            using var doc = JsonDocument.ParseValue(ref reader);
            var root = doc.RootElement;
            if (root.ValueKind == JsonValueKind.String) return new AppUser(root.GetString() ?? "", UserRole.Intern);

            string name = "", role = "";
            foreach (var p in root.EnumerateObject())
            {
                if (p.Name.Equals("Name", StringComparison.OrdinalIgnoreCase)) name = p.Value.GetString() ?? "";
                else if (p.Name.Equals("Role", StringComparison.OrdinalIgnoreCase)) role = p.Value.ToString();
            }
            return new AppUser(name, Enum.TryParse<UserRole>(role, ignoreCase: true, out var r) ? r : UserRole.Intern);
        }

        public override void Write(Utf8JsonWriter writer, AppUser value, JsonSerializerOptions options)
        {
            writer.WriteStartObject();
            writer.WriteString("Name", value.Name);
            writer.WriteString("Role", value.Role.ToString());
            writer.WriteEndObject();
        }
    }
}

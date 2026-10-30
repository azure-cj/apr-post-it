using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace PostIt.Core.Google;

// ============================================================================
//  Transport to the Apps Script web app (server/apps-script/Code.gs).
//
//  Everything the app knows about Google goes through this one class: one
//  POST per call, every reply shaped { ok, ... } or { ok:false, error, message }.
//  No Google SDK, no OAuth, no credentials on this machine — the script runs
//  as the Drive owner and the key says who is asking.
// ============================================================================

/// <summary>Reply envelope shared by every endpoint.</summary>
public class ScriptReply
{
    [JsonPropertyName("ok")]      public bool Ok { get; set; }
    [JsonPropertyName("error")]   public string? Error { get; set; }
    [JsonPropertyName("message")] public string? Message { get; set; }
}

public sealed class PingReply : ScriptReply
{
    [JsonPropertyName("name")]       public string Name { get; set; } = "";
    [JsonPropertyName("role")]       public string Role { get; set; } = "Intern";
    [JsonPropertyName("fbAccounts")] public List<string> FbAccounts { get; set; } = new();
}

public interface IScriptClient
{
    bool IsConfigured { get; }

    /// <summary>Sends one request. Throws <see cref="UserFacingException"/> for anything the user should read.</summary>
    Task<T> CallAsync<T>(string action, object? payload = null, CancellationToken ct = default) where T : ScriptReply;
}

public sealed class ScriptClient : IScriptClient, IDisposable
{
    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly Func<(string ExecUrl, string Key)> _config;
    private readonly HttpClient _http;
    private readonly bool _ownsHttp;

    public ScriptClient(Func<(string, string)> config, HttpClient? http = null)
    {
        _config = config;
        _ownsHttp = http is null;

        // AllowAutoRedirect must stay on: an Apps Script web app answers with a
        // 302 to script.googleusercontent.com and the body is behind it.
        _http = http ?? new HttpClient(new HttpClientHandler { AllowAutoRedirect = true })
        {
            Timeout = TimeSpan.FromSeconds(60),
        };
    }

    public bool IsConfigured
    {
        get
        {
            var (url, key) = _config();
            return !string.IsNullOrWhiteSpace(url) && !string.IsNullOrWhiteSpace(key);
        }
    }

    public async Task<T> CallAsync<T>(string action, object? payload = null, CancellationToken ct = default)
        where T : ScriptReply
    {
        var (url, key) = _config();
        if (string.IsNullOrWhiteSpace(url) || string.IsNullOrWhiteSpace(key))
            throw new UserFacingException("Post-It is not connected yet. Add the web app link and your key in Settings.");

        // The key travels in the body, never in a header: .NET drops custom
        // headers across the cross-origin redirect Apps Script performs.
        var body = Merge(payload, action, key);

        HttpResponseMessage response;
        try
        {
            response = await _http.PostAsJsonAsync(url, body, Json, ct).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (TaskCanceledException)
        {
            throw new UserFacingException("Google did not answer in time. Check your connection and try again.");
        }
        catch (HttpRequestException ex)
        {
            throw new UserFacingException("Could not reach Google. Check your connection.", ex);
        }

        if (!response.IsSuccessStatusCode)
            throw new UserFacingException($"Google answered {(int)response.StatusCode}. Check the web app link in Settings.");

        var text = await response.Content.ReadAsStringAsync(ct).ConfigureAwait(false);

        // A sign-in page instead of JSON means the deployment is not public to
        // the caller — the single most common setup mistake.
        if (text.TrimStart().StartsWith('<'))
            throw new UserFacingException("Google returned a sign-in page. Redeploy the script with access set to \"Anyone\".");

        T? reply;
        try
        {
            reply = JsonSerializer.Deserialize<T>(text, Json);
        }
        catch (JsonException ex)
        {
            throw new UserFacingException("Google sent something unexpected. Check the web app link in Settings.", ex);
        }

        if (reply is null)
            throw new UserFacingException("Google sent an empty reply.");

        if (!reply.Ok) throw Translate(reply, action);
        return reply;
    }

    /// <summary>Turns a server refusal into the sentence the user should see.</summary>
    private static UserFacingException Translate(ScriptReply reply, string action) => reply.Error switch
    {
        "unauthorized" => new UserFacingException(
            reply.Message ?? "Your key was not recognised. Ask your manager for a new one."),
        "forbidden" => new UserFacingException(
            reply.Message ?? "Your account is not allowed to do that."),
        "cooldown" => new UserFacingException(
            reply.Message ?? "This property is still inside its cooldown."),
        "busy" => new UserFacingException(
            "Someone else is saving right now. Try again in a moment."),
        _ => new UserFacingException(reply.Message ?? $"Google refused the request ({action}).")
    };

    private static Dictionary<string, object?> Merge(object? payload, string action, string key)
    {
        var body = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
        if (payload is not null)
        {
            var element = JsonSerializer.SerializeToElement(payload, Json);
            foreach (var property in element.EnumerateObject()) body[property.Name] = property.Value;
        }
        body["action"] = action;
        body["key"] = key;
        return body;
    }

    public void Dispose()
    {
        if (_ownsHttp) _http.Dispose();
    }
}

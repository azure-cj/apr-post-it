namespace PostIt.Core.Google;

// ============================================================================
//  IBackendConnection over the Apps Script web app: one ping, and the reply
//  says who the key belongs to.
// ============================================================================

public sealed class BackendConnection : IBackendConnection
{
    private readonly IScriptClient _client;

    public BackendConnection(IScriptClient client) => _client = client;

    public bool IsConfigured => _client.IsConfigured;

    public async Task<SignedInUser> SignInAsync(CancellationToken ct = default)
    {
        var reply = await _client.CallAsync<PingReply>("ping", null, ct).ConfigureAwait(false);

        if (string.IsNullOrWhiteSpace(reply.Name))
            throw new UserFacingException(
                "The server did not say who that key belongs to. Ask your manager to check the Team tab.");

        return new SignedInUser(new AppUser(reply.Name, ParseRole(reply.Role)), reply.FbAccounts);
    }

    /// <summary>Anything unrecognised is an intern: the least power, not the most.</summary>
    private static UserRole ParseRole(string? role) => role?.Trim().ToLowerInvariant() switch
    {
        "admin" => UserRole.Admin,
        "manager" => UserRole.Manager,
        _ => UserRole.Intern,
    };
}

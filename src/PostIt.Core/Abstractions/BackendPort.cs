namespace PostIt.Core;

// ============================================================================
//  Signing in.
//
//  There is no password and no Google sign-in. Each person has a key from the
//  Team tab, and the key IS the identity: the server resolves it to a name and
//  a role before it will do anything. So the app does not decide who you are —
//  it asks, and believes the answer.
//
//  The port lives here with the other ports; only the adapter below knows that
//  the thing on the other end happens to be Google.
// ============================================================================

public interface IBackendConnection
{
    /// <summary>True once a web app link and a key are both set.</summary>
    bool IsConfigured { get; }

    /// <summary>
    /// Asks the server who this key belongs to. Throws <see cref="UserFacingException"/>
    /// when the key is unknown or the server cannot be reached.
    /// </summary>
    Task<SignedInUser> SignInAsync(CancellationToken ct = default);
}

/// <param name="User">Name and role, both decided by the server.</param>
/// <param name="FbAccounts">The Facebook accounts this person may post from. Empty means any.</param>
public sealed record SignedInUser(AppUser User, IReadOnlyList<string> FbAccounts);

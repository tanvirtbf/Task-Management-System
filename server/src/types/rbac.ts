/**
 * RBAC WIRE SHAPES (API_DESIGN.md §34).
 *
 * snake_case, like every other payload in this API. These are the only RBAC
 * types the client sees — the server-side `PermissionEntry` / `ActorPermissions`
 * stay internal.
 */

/** One permission, as the client's `can()` needs it. Mirrors `PermissionEntry`. */
export interface WirePermissionEntry {
    /** Everywhere in the workspace. */
    all: boolean;
    /** Full reach inside these spaces. */
    space_ids: string[];
    /** Items the holder created / is assigned to, anywhere. */
    own: boolean;
    /** Items the holder created / is assigned to, inside these spaces only. */
    own_space_ids: string[];
}

/** `GET /api/v1/me/permissions` */
export interface WireMyPermissions {
    /**
     * `workspaces.permissions_version` this snapshot was resolved at. The
     * client compares it to decide whether cached data is still trustworthy
     * (landmine L10) — a change means "purge and refetch".
     */
    version: number;
    /** The workspace owner, who always holds everything (plan D-7). */
    is_owner: boolean;
    /** Legacy `users.role`, still shown as a badge while D-6 keeps the column. */
    role: string;
    /**
     * Spaces this person may see. **`null` means every space** — the JSON
     * encoding of the unrestricted `VisibilityScope`. An empty array means
     * they see none.
     */
    visible_space_ids: string[] | null;
    /**
     * Every permission the caller actually holds, keyed by permission key.
     * A key that grants nothing is absent, so `Object.keys(...)` is the
     * complete list of what this person can do.
     */
    permissions: Record<string, WirePermissionEntry>;
}

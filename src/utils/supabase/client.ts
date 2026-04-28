import { createBrowserClient } from '@supabase/ssr';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { Session, SupabaseClient, User } from '@supabase/supabase-js';

const REMEMBER_ME_STORAGE_KEY = 'mofid_remember_me';

const authStorage = {
    getItem(key: string): string | null {
        if (typeof window === 'undefined') {
            return null;
        }

        try {
            const rememberPreference = window.localStorage.getItem(REMEMBER_ME_STORAGE_KEY);

            if (rememberPreference === 'false') {
                return window.sessionStorage.getItem(key);
            }

            return window.localStorage.getItem(key) ?? window.sessionStorage.getItem(key);
        } catch {
            return null;
        }
    },
    setItem(key: string, value: string): void {
        if (typeof window === 'undefined') {
            return;
        }

        try {
            const rememberPreference = window.localStorage.getItem(REMEMBER_ME_STORAGE_KEY);

            if (rememberPreference === 'false') {
                window.sessionStorage.setItem(key, value);
                window.localStorage.removeItem(key);
                return;
            }

            window.localStorage.setItem(key, value);
            window.sessionStorage.removeItem(key);
        } catch {
            // no-op
        }
    },
    removeItem(key: string): void {
        if (typeof window === 'undefined') {
            return;
        }

        try {
            window.localStorage.removeItem(key);
            window.sessionStorage.removeItem(key);
        } catch {
            // no-op
        }
    },
};

type BrowserSupabaseClient = SupabaseClient;

declare global {
    var __mofidSupabaseClient: BrowserSupabaseClient | undefined;
    var __mofidSupabaseServerClient: BrowserSupabaseClient | undefined;
}

function buildBrowserClient() {
    const useRelaxedLockInDevelopment =
        typeof window !== 'undefined' && process.env.NODE_ENV !== 'production';

    return createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            auth: {
                storage: authStorage,
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true,
                ...(useRelaxedLockInDevelopment
                    ? {
                        // Dev-only: avoids noisy orphaned browser lock warnings during Strict Mode remounts.
                        lock: async <T>(_name: string, _acquireTimeout: number, fn: () => Promise<T>) =>
                            Promise.resolve(fn()),
                        lockAcquireTimeout: 15000,
                    }
                    : {}),
            },
        }
    );
}

function buildServerClient() {
    return createSupabaseClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            auth: {
                persistSession: false,
                autoRefreshToken: false,
                detectSessionInUrl: false,
            },
        }
    );
}

function getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

function wait(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableFetchIssue(error: unknown) {
    const message = getErrorMessage(error);
    return (
        message.includes("Failed to fetch") ||
        message.includes("AuthRetryableFetchError") ||
        message.includes("NetworkError") ||
        message.includes("Load failed")
    );
}

function getSupabaseProjectRef() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) {
        return null;
    }

    return supabaseUrl.replace(/^https?:\/\//, "").split(".")[0] ?? null;
}

function extractUserFromAuthToken(parsed: unknown): User | null {
    if (!parsed || typeof parsed !== "object") {
        return null;
    }

    const asRecord = parsed as Record<string, unknown>;

    if (asRecord.user && typeof asRecord.user === "object") {
        return asRecord.user as User;
    }

    if (asRecord.currentSession && typeof asRecord.currentSession === "object") {
        const currentSession = asRecord.currentSession as Record<string, unknown>;
        if (currentSession.user && typeof currentSession.user === "object") {
            return currentSession.user as User;
        }
    }

    if (asRecord.session && typeof asRecord.session === "object") {
        const session = asRecord.session as Record<string, unknown>;
        if (session.user && typeof session.user === "object") {
            return session.user as User;
        }
    }

    return null;
}

export function getCachedSupabaseUser(): User | null {
    if (typeof window === "undefined") {
        return null;
    }

    try {
        const projectRef = getSupabaseProjectRef();
        if (!projectRef) {
            return null;
        }

        const authTokenKey = `sb-${projectRef}-auth-token`;
        const raw =
            window.localStorage.getItem(authTokenKey) ??
            window.sessionStorage.getItem(authTokenKey);

        if (!raw) {
            return null;
        }

        const parsed = JSON.parse(raw);

        if (Array.isArray(parsed)) {
            for (const entry of parsed) {
                const candidateUser = extractUserFromAuthToken(entry);
                if (candidateUser) {
                    return candidateUser;
                }
            }
            return null;
        }

        return extractUserFromAuthToken(parsed);
    } catch {
        return null;
    }
}

export function hasSupabaseAuthTokenSnapshot(): boolean {
    if (typeof window === "undefined") {
        return false;
    }

    try {
        const projectRef = getSupabaseProjectRef();
        if (!projectRef) {
            return false;
        }

        const authTokenKey = `sb-${projectRef}-auth-token`;
        return Boolean(
            window.localStorage.getItem(authTokenKey) ??
            window.sessionStorage.getItem(authTokenKey)
        );
    } catch {
        return false;
    }
}

export function createClient() {
    if (typeof window === 'undefined') {
        if (!globalThis.__mofidSupabaseServerClient) {
            globalThis.__mofidSupabaseServerClient = buildServerClient();
        }

        return globalThis.__mofidSupabaseServerClient;
    }

    if (!globalThis.__mofidSupabaseClient) {
        globalThis.__mofidSupabaseClient = buildBrowserClient();
    }

    return globalThis.__mofidSupabaseClient;
}

export const supabase = createClient();

let stableAuthUserPromise: Promise<{ user: User | null; error: string | null }> | null = null;

export async function getSafeAuthSession(): Promise<{ session: Session | null; error: string | null }> {
    try {
        const { data, error } = await supabase.auth.getSession();
        return {
            session: data.session ?? null,
            error: error?.message ?? null,
        };
    } catch (error) {
        if (isRetryableFetchIssue(error)) {
            return { session: null, error: null };
        }

        return { session: null, error: getErrorMessage(error) };
    }
}

export async function getStableAuthUser() {
    if (stableAuthUserPromise) {
        return stableAuthUserPromise;
    }

    stableAuthUserPromise = (async () => {
        try {
            const cachedUser = getCachedSupabaseUser();
            const hasTokenSnapshot = hasSupabaseAuthTokenSnapshot();
            const { session, error: sessionError } = await getSafeAuthSession();
            let sessionUser = session?.user ?? cachedUser ?? null;

            if (sessionError) {
                return { user: sessionUser, error: sessionError };
            }

            if (!sessionUser) {
                const { data: cookieBackedUserData, error: cookieBackedUserError } =
                    await supabase.auth.getUser();

                if (cookieBackedUserData.user) {
                    return { user: cookieBackedUserData.user, error: null };
                }

                if (cookieBackedUserError && !isRetryableFetchIssue(cookieBackedUserError)) {
                    return { user: cachedUser ?? null, error: cookieBackedUserError.message };
                }

                if (hasTokenSnapshot) {
                    await wait(220);
                    const { session: retrySession, error: retrySessionError } =
                        await getSafeAuthSession();
                    sessionUser =
                        retrySession?.user ?? getCachedSupabaseUser() ?? null;

                    if (retrySessionError) {
                        return { user: sessionUser, error: retrySessionError };
                    }

                    if (!sessionUser) {
                        const {
                            data: retryCookieUserData,
                            error: retryCookieUserError,
                        } = await supabase.auth.getUser();

                        if (retryCookieUserData.user) {
                            return { user: retryCookieUserData.user, error: null };
                        }

                        if (
                            retryCookieUserError &&
                            !isRetryableFetchIssue(retryCookieUserError)
                        ) {
                            return {
                                user: cachedUser ?? null,
                                error: retryCookieUserError.message,
                            };
                        }
                    }
                }

                return { user: sessionUser ?? cachedUser ?? null, error: null };
            }

            if (!session?.user) {
                return { user: sessionUser, error: null };
            }

            const { data: userData, error: userError } = await supabase.auth.getUser();
            return {
                user: userData.user ?? sessionUser,
                error: userError?.message ?? null,
            };
        } catch (error) {
            const message = getErrorMessage(error);

            if (message.includes("Lock broken by another request with the 'steal' option")) {
                await new Promise((resolve) => window.setTimeout(resolve, 180));
                const { session } = await getSafeAuthSession();
                return { user: session?.user ?? null, error: null };
            }

            if (isRetryableFetchIssue(error)) {
                const { session } = await getSafeAuthSession();
                return { user: session?.user ?? null, error: null };
            }

            return { user: null, error: message };
        } finally {
            window.setTimeout(() => {
                stableAuthUserPromise = null;
            }, 0);
        }
    })();

    return stableAuthUserPromise;
}

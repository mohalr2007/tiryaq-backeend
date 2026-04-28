import { getStableAuthUser, supabase } from './client';

export type AccountType = 'patient' | 'doctor';

type ExistingAccountLookup = {
    user_id: string;
    email: string;
    account_type: AccountType | null;
    full_name: string | null;
    specialty: string | null;
};

export interface SignupData {
    email: string;
    passwordHash: string; // Ideally raw password for auth, hash if stored manually (Supabase handles raw for Auth)
    password: string;
    name: string;
    accountType: AccountType;
    specialty?: string;
    license?: string;
}

function formatRoleLabel(accountType: AccountType) {
    return accountType === 'doctor' ? 'médecin' : 'patient';
}

export async function findExistingAccountByEmail(email: string) {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
        return null;
    }

    const { data, error } = await supabase.rpc('find_account_by_email', { _email: normalizedEmail });
    if (error) {
        console.error('Account lookup error:', error.message);
        return null;
    }

    const rows = (data ?? []) as ExistingAccountLookup[];
    return rows[0] ?? null;
}

// ==========================================
// Authentication Functions (Backend Logic)
// ==========================================

/**
 * Sign up a new user with email and password
 * Includes additional metadata (name, role, etc.)
 */
export async function signUpUser(data: SignupData) {
    try {
        const existingAccount = await findExistingAccountByEmail(data.email);
        if (existingAccount?.account_type) {
            return {
                success: false,
                error: `Cet email est déjà enregistré comme ${formatRoleLabel(existingAccount.account_type)}. Connectez-vous avec ce compte existant.`,
            };
        }

        const { data: authData, error } = await supabase.auth.signUp({
            email: data.email,
            password: data.password,
            options: {
                data: {
                    full_name: data.name,
                    account_type: data.accountType,
                    specialty: data.specialty || null,
                    license_number: data.license || null,
                },
            },
        });

        if (error) {
            console.error("Signup error:", error.message);
            return { success: false, error: error.message };
        }

        return { success: true, user: authData.user };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown signup error";
        console.error("Unexpected signup error:", err);
        return { success: false, error: message };
    }
}

/**
 * Log in an existing user with email and password
 */
export async function logInUser(email: string, password: string) {
    try {
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });

        if (error) {
            console.error("Login error:", error.message);
            return { success: false, error: error.message };
        }

        return { success: true, user: data.user, session: data.session };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown login error";
        console.error("Unexpected login error:", err);
        return { success: false, error: message };
    }
}

/**
 * Log in with Google OAuth Provider
 */
export async function logInWithGoogle() {
    try {
        const { data, error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                // Automatically redirect back to the app after Google auth
                redirectTo: `${window.location.origin}/auth/callback`,
            },
        });

        if (error) {
            console.error("Google Auth error:", error.message);
            return { success: false, error: error.message };
        }

        return { success: true, url: data.url };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown Google auth error";
        console.error("Unexpected Google Auth error:", err);
        return { success: false, error: message };
    }
}

/**
 * Sign out the current user
 */
export async function logOutUser() {
    try {
        const { error } = await supabase.auth.signOut();
        if (error) {
            console.error("Logout error:", error.message);
            return { success: false, error: error.message };
        }
        return { success: true };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown logout error";
        console.error("Unexpected logout error:", err);
        return { success: false, error: message };
    }
}

/**
 * Get the current logged-in user (e.g. after Google OAuth)
 */
export async function getCurrentUser() {
    const { user } = await getStableAuthUser();
    return user;
}

// made by mohamed
/**
 * Update user profile metadata (used after Google OAuth to complete profile)
 * Saves account_type, full_name, specialty, license_number to Supabase user metadata
 * Also sets the password so the user can log in via email/password afterwards
 */
export async function updateUserProfile(data: {
    name: string;
    accountType: AccountType;
    specialty?: string;
    license?: string;
    password?: string;
}) {
    try {
        // Update metadata (name, role, etc.)
        const { error: metaError } = await supabase.auth.updateUser({
            data: {
                full_name: data.name,
                account_type: data.accountType,
                specialty: data.specialty || null,
                license_number: data.license || null,
            }
        });

        if (metaError) {
            console.error("Profile update error:", metaError.message);
            return { success: false, error: metaError.message };
        }

        // Also set the password so the user can log in via email/password
        if (data.password) {
            const { error: passError } = await supabase.auth.updateUser({
                password: data.password,
            });
            if (passError) {
                console.error("Password update error:", passError.message);
                return { success: false, error: passError.message };
            }
        }

        return { success: true };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown profile update error";
        console.error("Unexpected profile update error:", err);
        return { success: false, error: message };
    }
}
// made by mohamed

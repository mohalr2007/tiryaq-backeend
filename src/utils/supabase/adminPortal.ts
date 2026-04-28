import { createClient } from "@supabase/supabase-js";

export type AdminPortalJson =
  | string
  | number
  | boolean
  | null
  | { [key: string]: AdminPortalJson | undefined }
  | AdminPortalJson[];

type AdminPortalDatabase = {
  public: {
    Tables: {
      admin_users: {
        Row: {
          id: string;
          username: string;
          full_name: string | null;
          password_hash: string;
          role: "super_admin" | "admin";
          is_active: boolean;
          created_at: string;
          updated_at: string;
          last_login_at: string | null;
        };
        Insert: {
          id: string;
          username: string;
          full_name?: string | null;
          password_hash: string;
          role?: "super_admin" | "admin";
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
          last_login_at?: string | null;
        };
        Update: {
          id?: string;
          username?: string;
          full_name?: string | null;
          password_hash?: string;
          role?: "super_admin" | "admin";
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
          last_login_at?: string | null;
        };
        Relationships: [];
      };
      admin_activity_logs: {
        Row: {
          id: number;
          admin_user_id: string | null;
          action: string;
          target_type: string | null;
          target_id: string | null;
          metadata: AdminPortalJson;
          created_at: string;
        };
        Insert: {
          id?: number;
          admin_user_id?: string | null;
          action: string;
          target_type?: string | null;
          target_id?: string | null;
          metadata?: AdminPortalJson;
          created_at?: string;
        };
        Update: {
          id?: number;
          admin_user_id?: string | null;
          action?: string;
          target_type?: string | null;
          target_id?: string | null;
          metadata?: AdminPortalJson;
          created_at?: string;
        };
        Relationships: [];
      };
      admin_doctor_verifications: {
        Row: {
          doctor_id: string;
          verification_status: "pending" | "approved" | "rejected";
          is_doctor_verified: boolean;
          verification_note: string | null;
          request_message: string | null;
          requested_at: string | null;
          submitted_by_site_user_id: string | null;
          verified_by_admin_user_id: string | null;
          verified_by_admin_label: string | null;
          verified_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          doctor_id: string;
          verification_status?: "pending" | "approved" | "rejected";
          is_doctor_verified?: boolean;
          verification_note?: string | null;
          request_message?: string | null;
          requested_at?: string | null;
          submitted_by_site_user_id?: string | null;
          verified_by_admin_user_id?: string | null;
          verified_by_admin_label?: string | null;
          verified_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          doctor_id?: string;
          verification_status?: "pending" | "approved" | "rejected";
          is_doctor_verified?: boolean;
          verification_note?: string | null;
          request_message?: string | null;
          requested_at?: string | null;
          submitted_by_site_user_id?: string | null;
          verified_by_admin_user_id?: string | null;
          verified_by_admin_label?: string | null;
          verified_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      admin_doctor_verification_files: {
        Row: {
          id: string;
          doctor_id: string;
          document_type: "clinic_document" | "medical_certificate" | "other";
          file_name: string;
          mime_type: string;
          file_size_bytes: number;
          storage_bucket: string;
          storage_path: string;
          uploaded_by_site_user_id: string;
          uploaded_at: string;
          is_active: boolean;
        };
        Insert: {
          id?: string;
          doctor_id: string;
          document_type: "clinic_document" | "medical_certificate" | "other";
          file_name: string;
          mime_type: string;
          file_size_bytes: number;
          storage_bucket?: string;
          storage_path: string;
          uploaded_by_site_user_id: string;
          uploaded_at?: string;
          is_active?: boolean;
        };
        Update: {
          id?: string;
          doctor_id?: string;
          document_type?: "clinic_document" | "medical_certificate" | "other";
          file_name?: string;
          mime_type?: string;
          file_size_bytes?: number;
          storage_bucket?: string;
          storage_path?: string;
          uploaded_by_site_user_id?: string;
          uploaded_at?: string;
          is_active?: boolean;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

type AdminPortalSupabaseClient = ReturnType<typeof createClient<AdminPortalDatabase>>;

declare global {
  var __tiryaqAdminPortalSupabaseClient: AdminPortalSupabaseClient | undefined;
}

export function createAdminPortalClient() {
  if (globalThis.__tiryaqAdminPortalSupabaseClient) {
    return globalThis.__tiryaqAdminPortalSupabaseClient;
  }

  const supabaseUrl = process.env.ADMIN_SUPABASE_URL;
  const serviceRoleKey = process.env.ADMIN_SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "ADMIN_SUPABASE_URL ou ADMIN_SUPABASE_SERVICE_ROLE_KEY n'est pas configuré. Ajoutez les variables du projet Supabase admin dans front/.env.local puis redémarrez npm run dev."
    );
  }

  globalThis.__tiryaqAdminPortalSupabaseClient = createClient<AdminPortalDatabase>(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return globalThis.__tiryaqAdminPortalSupabaseClient;
}

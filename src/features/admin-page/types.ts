export type AdminPortalRole = "super_admin" | "admin";

export type AdminPortalSession = {
  adminUserId: string;
  username: string;
  fullName: string | null;
  role: AdminPortalRole;
  exp: number;
};

export type AdminUserPublic = {
  id: string;
  username: string;
  fullName: string | null;
  role: AdminPortalRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
};

export type AdminDoctorStatus = "pending" | "approved" | "rejected";
export type AdminDoctorDocumentType = "clinic_document" | "medical_certificate" | "other";
export type AdminReportStatus = "open" | "reviewed" | "dismissed" | "actioned";
export type AdminModerationActionType =
  | "warning"
  | "temporary_block"
  | "permanent_block"
  | "false_alert";
export type AdminUserModerationStatus =
  | "active"
  | "warned"
  | "temporarily_blocked"
  | "permanently_blocked";

export type AdminManagedDoctor = {
  id: string;
  fullName: string | null;
  specialty: string | null;
  address: string | null;
  avatarUrl: string | null;
  gender: string | null;
  bio: string | null;
  createdAt: string | null;
  isAcceptingAppointments: boolean | null;
  workingHoursStart: string | null;
  workingHoursEnd: string | null;
  verificationStatus: AdminDoctorStatus;
  isDoctorVerified: boolean;
  verifiedAt: string | null;
  verifiedByAdmin: string | null;
  verificationNote: string | null;
  requestMessage: string | null;
  requestedAt: string | null;
  hasSubmittedDocuments: boolean;
  documentsCount: number;
  moderationStatus: AdminUserModerationStatus;
  moderationReason: string | null;
};

export type AdminDoctorVerificationFile = {
  id: string;
  documentType: AdminDoctorDocumentType;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  uploadedAt: string;
  url: string | null;
};

export type AdminManagedDoctorDetails = AdminManagedDoctor & {
  files: AdminDoctorVerificationFile[];
  email: string | null;
};

export type AdminCommunityReport = {
  id: string;
  reportType: "post" | "comment";
  reportStatus: AdminReportStatus;
  reason: string;
  createdAt: string;
  reviewedAt: string | null;
  reporterName: string | null;
  targetUserId: string | null;
  targetUserName: string | null;
  targetUserEmail: string | null;
  targetModerationStatus: AdminUserModerationStatus;
  contentPreview: string | null;
  subjectTitle: string | null;
  isHidden: boolean;
};

export type AdminBlockedEmail = {
  id: string;
  email: string;
  status: "blocked" | "released";
  reason: string | null;
  handledByAdminLabel: string | null;
  blockedAt: string;
  releasedAt: string | null;
  releaseNote: string | null;
};

export type AdminPortalOverview = {
  totalDoctors: number;
  pendingDoctors: number;
  approvedDoctors: number;
  rejectedDoctors: number;
  totalAdmins: number;
  openReports: number;
  blockedEmails: number;
};

export type AdminPortalDoctorsResponse = {
  doctors: AdminManagedDoctor[];
};

export type AdminPortalAdminsResponse = {
  admins: AdminUserPublic[];
};

export type AdminPortalReportsResponse = {
  reports: AdminCommunityReport[];
  blockedEmails: AdminBlockedEmail[];
};

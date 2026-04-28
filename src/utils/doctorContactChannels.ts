export type DoctorContactFields = {
  contact_phone?: string | null;
  contact_phone_enabled?: boolean | null;
  contact_email?: string | null;
  contact_email_enabled?: boolean | null;
  facebook_url?: string | null;
  facebook_enabled?: boolean | null;
  instagram_url?: string | null;
  instagram_enabled?: boolean | null;
  x_url?: string | null;
  x_enabled?: boolean | null;
  whatsapp_url?: string | null;
  whatsapp_enabled?: boolean | null;
  telegram_url?: string | null;
  telegram_enabled?: boolean | null;
  linkedin_url?: string | null;
  linkedin_enabled?: boolean | null;
  gmail_url?: string | null;
  gmail_enabled?: boolean | null;
};

export type DoctorPublicChannelKey =
  | "phone"
  | "email"
  | "facebook"
  | "instagram"
  | "x"
  | "whatsapp"
  | "telegram"
  | "linkedin"
  | "gmail";

export type DoctorPublicChannel = {
  key: DoctorPublicChannelKey;
  value: string;
  href: string;
};

function cleanValue(value: string | null | undefined) {
  return (value ?? "").trim();
}

function ensureHttpUrl(value: string, prefix: string) {
  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  const sanitizedValue = value.replace(/^@/, "").replace(/^\/+/, "");
  return `${prefix}${sanitizedValue}`;
}

function normalizePhoneHref(value: string) {
  const normalized = value.replace(/[^\d+]/g, "");
  return normalized ? `tel:${normalized}` : "";
}

function normalizeWhatsAppHref(value: string) {
  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  const normalized = value.replace(/[^\d]/g, "");
  return normalized ? `https://wa.me/${normalized}` : "";
}

function normalizeTelegramHref(value: string) {
  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  return ensureHttpUrl(value, "https://t.me/");
}

function normalizeMailHref(value: string) {
  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  return value.includes("@") ? `mailto:${value}` : "";
}

export function buildDoctorPublicChannels(doctor: DoctorContactFields): DoctorPublicChannel[] {
  const channels: DoctorPublicChannel[] = [];

  const contactPhone = cleanValue(doctor.contact_phone);
  if (doctor.contact_phone_enabled && contactPhone) {
    const href = normalizePhoneHref(contactPhone);
    if (href) {
      channels.push({ key: "phone", value: contactPhone, href });
    }
  }

  const contactEmail = cleanValue(doctor.contact_email);
  if (doctor.contact_email_enabled && contactEmail) {
    const href = normalizeMailHref(contactEmail);
    if (href) {
      channels.push({ key: "email", value: contactEmail, href });
    }
  }

  const facebookUrl = cleanValue(doctor.facebook_url);
  if (doctor.facebook_enabled && facebookUrl) {
    channels.push({
      key: "facebook",
      value: facebookUrl,
      href: ensureHttpUrl(facebookUrl, "https://facebook.com/"),
    });
  }

  const instagramUrl = cleanValue(doctor.instagram_url);
  if (doctor.instagram_enabled && instagramUrl) {
    channels.push({
      key: "instagram",
      value: instagramUrl,
      href: ensureHttpUrl(instagramUrl, "https://instagram.com/"),
    });
  }

  const xUrl = cleanValue(doctor.x_url);
  if (doctor.x_enabled && xUrl) {
    channels.push({
      key: "x",
      value: xUrl,
      href: ensureHttpUrl(xUrl, "https://x.com/"),
    });
  }

  const whatsappUrl = cleanValue(doctor.whatsapp_url);
  if (doctor.whatsapp_enabled && whatsappUrl) {
    const href = normalizeWhatsAppHref(whatsappUrl);
    if (href) {
      channels.push({ key: "whatsapp", value: whatsappUrl, href });
    }
  }

  const telegramUrl = cleanValue(doctor.telegram_url);
  if (doctor.telegram_enabled && telegramUrl) {
    channels.push({
      key: "telegram",
      value: telegramUrl,
      href: normalizeTelegramHref(telegramUrl),
    });
  }

  const linkedinUrl = cleanValue(doctor.linkedin_url);
  if (doctor.linkedin_enabled && linkedinUrl) {
    channels.push({
      key: "linkedin",
      value: linkedinUrl,
      href: ensureHttpUrl(linkedinUrl, "https://linkedin.com/in/"),
    });
  }

  const gmailUrl = cleanValue(doctor.gmail_url);
  if (doctor.gmail_enabled && gmailUrl) {
    const href = normalizeMailHref(gmailUrl);
    if (href) {
      channels.push({ key: "gmail", value: gmailUrl, href });
    }
  }

  return channels;
}

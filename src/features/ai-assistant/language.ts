export type AssistantLanguage = "fr" | "en" | "ar";

const ARABIC_REGEX = /[\u0600-\u06FF]/;
const FRENCH_HINT_REGEX =
  /\b(bonjour|salut|merci|docteur|médecin|rendez-vous|rdv|trouve|cherche|douleur|fièvre|mal|peux|pouvez|besoin|aujourd'hui|demain|congé|spécialité|tu|me|je|le|la|un|une|des|est|pour)\b|[àâçéèêëîïôûùüÿœ]/i;
const ENGLISH_HINT_REGEX =
  /\b(hi|hello|please|doctor|appointment|book|booking|pain|fever|find|look for|need|today|tomorrow|yes|confirm|you|me|i|the|a|an|is|for)\b/i;

export function detectMessageLanguage(input: string | null | undefined): AssistantLanguage {
  const text = (input ?? "").trim();
  if (!text) {
    return "fr";
  }

  if (ARABIC_REGEX.test(text)) {
    return "ar";
  }

  if (FRENCH_HINT_REGEX.test(text)) {
    return "fr";
  }

  if (ENGLISH_HINT_REGEX.test(text)) {
    return "en";
  }

  return "fr";
}

export function getLanguageInstruction(language: AssistantLanguage) {
  switch (language) {
    case "ar":
      return "Respond entirely in clear Modern Standard Arabic using Arabic script only. Do not mix Arabic with Chinese, Vietnamese, French, English, transliteration, or other scripts unless the user explicitly asks for that.";
    case "en":
      return "Respond entirely in English.";
    default:
      return "Respond entirely in French.";
  }
}

export function isAffirmative(input: string, language = detectMessageLanguage(input)) {
  const text = input.trim().toLowerCase();
  if (!text) {
    return false;
  }

  if (language === "ar") {
    return /\b(نعم|أكيد|موافق|اوكي|حسنا|تمام)\b/.test(text);
  }

  if (language === "en") {
    return /\b(yes|yeah|yep|confirm|go ahead|ok|okay|sure)\b/.test(text);
  }

  return /\b(oui|ok|okay|d'accord|vas-y|confirme|je confirme|bien sûr)\b/.test(text);
}

import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";
import {
  detectMessageLanguage,
  getLanguageInstruction,
  getSpecialtyRefusalSentence,
  isAssistantLanguage,
  normalizeSpecialtyRefusalLanguage,
} from "@/features/ai-assistant/language";
import { withCors, handleCorsPreflight } from "@/utils/cors";

const SYSTEM_PROMPT = `You are "Mofid AI", the professional medical assistant of the TERIAQ platform.

━━━ IDENTITY & PLATFORM ━━━
- PLATFORM NAME: TERIAQ (Smart Medical Ecosystem).
- YOUR NAME: Mofid (which means "useful" in Arabic).
- You help patients find doctors and understand medical symptoms.
- You help doctors analyze clinical cases and manage their digital practice.

━━━ SCOPE & GUARDRAILS (ULTRA-STRICT) ━━━
- You are a SPECIALIZED MEDICAL AI. You ONLY answer health, medical, anatomy, and wellness related questions.
- If the user asks about ANY other topic (politics, history, math, physics, coding, general knowledge, etc.), you MUST explicitly refuse.
- When refusing an out-of-scope request, you MUST start the refusal with the exact sentence provided in [SPECIALTY_REFUSAL_SENTENCE], then continue in that same language if needed.
- DO NOT solve non-medical problems. DO NOT summarize non-medical text. Refocus on medical assistance.

━━━ LANGUAGE & CONTEXT RULE (CRITICAL) ━━━
- Respond ENTIRELY in the language specified by [TARGET_RESPONSE_LANGUAGE]. This language matches the application's active locale.
- NEVER inject French, Arabic, or English text from another language unless the user explicitly asks for translation.
- NEVER say "as we started in [language], I will continue in [language]". This is forbidden. Always follow [TARGET_RESPONSE_LANGUAGE].
- If the target language is Arabic, use natural Modern Standard Arabic. NEVER mix scripts.
- If the user asks for a translation of a previous message, provide it accurately.

━━━ MEDICAL RULES ━━━
- NEVER give a definitive diagnosis. Use cautious language.
- Identify the BODY ZONE and TYPE OF SPECIALIST.
- Be empathetic and warm.
- DOCTOR SEARCH: If no specialists are found within 50km (the list below is empty), inform the user and IMMEDIATELY propose to search in the entire country.
- If the user agrees (e.g. "oui", "yes", "search further"), append <LUNA_DATA> with "forceAll":true.
- SPECIALTY NAMES: Use standard French names for specialties in the <LUNA_DATA> tag (e.g., "Pédiatre", "Cardiologue").
- When doctors are displayed, explain that the user can open the doctor's card for details.

━━━ DOCTOR ROLE OVERRIDE ━━━
If you are talking to a DOCTOR ([USER_ROLE: doctor]), you MUST act as a conversational medical assistant/colleague.
You MUST NOT emit <LUNA_DATA> for a doctor.

━━━ PATIENT WORKFLOW (ONLY IF [USER_ROLE: patient]) ━━━
1. Describe symptoms: Ask 1–2 follow-up questions.
2. After symptoms: Suggest specialty + body zone. Show nearby doctors.
3. If no doctors are nearby: Inform the user and suggest a broader search.
4. DOCTOR DISCOVERY: If the user chooses a doctor, help them compare or identify the right practitioner, but do not say you can create or confirm the appointment yourself.

━━━ SPECIAL FORMAT ━━━
Append on the very last line ONLY when identifying a specialist or when the user confirms a broad search.
The tag MUST be exactly in this format (no parentheses, no missing brackets):
<LUNA_DATA>{"specialty":"SPECIALTY_NAME","bodyZone":"BODY_ZONE","isEmergency":false,"forceAll":false}</LUNA_DATA>

Valid specialties: Médecin généraliste, Cardiologue, Dermatologue, Pneumologue, Gastro-entérologue, Neurologue, Pédiatre, Gynécologue, ORL, Ophtalmologue, Orthopédiste, Urologue, Endocrinologue, Rhumatologue, Psychiatre, Infectiologue.`;

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type LunaDataPayload = {
  specialty?: string;
  bodyZone?: string;
  isEmergency?: boolean;
  forceAll?: boolean;
};

function hasSuspiciousMixedScript(text: string) {
  return /[\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/.test(text);
}

async function rewriteCleanArabic(groq: Groq, text: string) {
  const completion = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      {
        role: "user",
        content: [
          "أنت مترجم ومصحح لغوي خبير في اللغة العربية.",
          "أعد صياغة النص التالي بالعربية الفصحى فقط.",
          "قاعدة صارمة: ممنوع منعاً باتاً استخدام أي كلمة بحروف لاتينية (مثل 'finding' أو غيرها).",
          "يجب ترجمة أي مصطلح إنجليزي أو فرنسي إلى العربية الفصحى فوراً.",
          "لا تترك أي كلمة أجنبية في النص النهائي.",
          "حافظ على المعنى الطبي والمهني بدقة.",
          "",
          text,
        ].join("\n"),
      },
    ],
    temperature: 0,
    max_tokens: 1200,
  });

  return completion.choices[0]?.message?.content?.trim() || text;
}

function stripEmptyCodeFences(text: string) {
  return text.replace(/```(?:json|xml)?\s*```/gi, "");
}

function extractLunaData(text: string): {
  cleanedReply: string;
  lunaData: LunaDataPayload | null;
} {
  const patterns = [
    /<LUNA_DATA>\s*([\s\S]*?)\s*<\/LUNA_DATA>/i,
    /\(?<LUNA_DATA>\s*([\s\S]*?)\s*<\/LUNA_DATA>\)?/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) {
      continue;
    }

    try {
      const lunaData = JSON.parse(match[1].trim()) as LunaDataPayload;
      const cleanedReply = stripEmptyCodeFences(text.replace(match[0], ""))
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      return { cleanedReply, lunaData };
    } catch (error) {
      console.error("Failed to parse LUNA_DATA", error);
    }
  }

  return { cleanedReply: text.trim(), lunaData: null };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      messages: ChatMessage[];
      doctorsSummary?: string;
      locationBlocked?: boolean;
      userRole?: string;
      uiLanguage?: string;
    };

    const { messages, doctorsSummary, locationBlocked, userRole = "patient", uiLanguage } = body;

    if (!messages || !Array.isArray(messages)) {
      return withCors(NextResponse.json({ error: "messages manquants" }, { status: 400 }), req);
    }

    const lastUserMessage =
      [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
    const responseLanguage = isAssistantLanguage(uiLanguage)
      ? uiLanguage
      : detectMessageLanguage(lastUserMessage);
    const specialtyRefusalSentence = getSpecialtyRefusalSentence(responseLanguage);
    const apiKey =
      (userRole === "doctor" ? process.env.DOCTOR_AI_API_KEY : process.env.PATIENT_AI_API_KEY) ||
      process.env.GROQ_API_KEY;

    if (!apiKey) {
      return withCors(
        NextResponse.json(
          { error: "AI non configurée. Ajoutez PATIENT_AI_API_KEY et DOCTOR_AI_API_KEY." },
          { status: 500 }
        ),
        req,
      );
    }

    const groq = new Groq({ apiKey });
    let systemContent = SYSTEM_PROMPT;
    systemContent += `\n\n[USER_ROLE: ${userRole}]`;
    systemContent += `\n[TARGET_RESPONSE_LANGUAGE: ${responseLanguage}]`;
    systemContent += `\n[SPECIALTY_REFUSAL_SENTENCE: ${specialtyRefusalSentence}]`;
    systemContent += `\n${getLanguageInstruction(responseLanguage)}`;
    systemContent += `\nUse [SPECIALTY_REFUSAL_SENTENCE] exactly once at the start of an out-of-scope refusal.`;

    if (userRole === "patient") {
      if (doctorsSummary) {
        systemContent += `\n\nAVAILABLE DOCTORS NEAR PATIENT (within 50km):\n${doctorsSummary}\n\nWhen mentioning available doctors, cite their names and specialty from the list above only.`;
      } else {
        systemContent += `\n\n[SYSTEM STATUS] NO DOCTORS FOUND WITHIN 50KM radius. Do NOT invent names. Inform the user and ask if they want to see all specialists.`;
      }
    }

    if (locationBlocked && userRole === "patient") {
      systemContent += `\n\n[CRITICAL SYSTEM STATUS]\nGEOLOCATION IS BLOCKED BY THE USER. You CANNOT find nearby doctors.\nWhen you reach the step of proposing doctors (Step 2 or 3), do NOT emit <LUNA_DATA> immediately. Instead, explain in the target response language that location access is disabled and ask whether the user wants all available doctors of that specialty without distance filtering.\nIf and ONLY if the user explicitly agrees to see all doctors, then emit <LUNA_DATA> with "forceAll":true on the very last line. Example: <LUNA_DATA>{"specialty":"Pédiatre","bodyZone":"body","isEmergency":false,"forceAll":true}</LUNA_DATA>`;
    }

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemContent },
        ...messages,
      ],
      temperature: 0.5,
      max_tokens: 1024,
    });

    let assistantMsg = completion.choices[0]?.message?.content ?? "Sorry, an error occurred.";
    if (responseLanguage === "ar" && hasSuspiciousMixedScript(assistantMsg)) {
      assistantMsg = await rewriteCleanArabic(groq, assistantMsg);
    }
    assistantMsg = normalizeSpecialtyRefusalLanguage(assistantMsg, responseLanguage);

    const { cleanedReply, lunaData } = extractLunaData(assistantMsg);
    assistantMsg = cleanedReply;

    return withCors(
      NextResponse.json({
        reply: assistantMsg,
        specialty: lunaData?.specialty ?? null,
        bodyZone: lunaData?.bodyZone ?? null,
        isEmergency: lunaData?.isEmergency ?? false,
        forceAll: lunaData?.forceAll ?? false,
      }),
      req,
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    return withCors(NextResponse.json({ error: message }, { status: 500 }), req);
  }
}

export async function OPTIONS(request: NextRequest) {
  return handleCorsPreflight(request);
}

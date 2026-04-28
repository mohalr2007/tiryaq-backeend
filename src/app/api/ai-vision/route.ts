import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import Groq from "groq-sdk";
import { detectMessageLanguage, getLanguageInstruction } from "@/features/ai-assistant/language";

export const runtime = "nodejs";

const pdfExtractionScriptPath = path.join(process.cwd(), "scripts", "extract-pdf-text.cjs");

type VisionAttachment = {
  fileName?: string;
  mimeType?: string;
  dataUrl?: string;
};

type VisionPayload = {
  userRole?: "patient" | "doctor";
  userPrompt?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  attachments?: VisionAttachment[];
};

function buildAttachmentPrompt(
  userRole: "patient" | "doctor",
  languageInstruction: string,
  fileName: string,
  kind: "image" | "pdf"
) {
  if (userRole === "doctor") {
    return [
      `You are Mofid AI, the smart medical assistant of the TERIAQ platform. ${languageInstruction}`,
      kind === "image"
        ? "Analyze the uploaded image for a doctor."
        : "Analyze the uploaded PDF for a doctor.",
      "First identify what the attachment actually contains.",
      "If it is NOT medical or clinical, you MUST REFUSE to analyze it. Say clearly: 'Ce n'est pas ma spécialité' (or its equivalent in the detected language).",
      "If it is medical, respond with medically careful and operational guidance.",
      "If a finding is uncertain, say so clearly instead of inventing.",
      kind === "image"
        ? "For images, describe the visible medical content precisely. If it is a medical document, read and summarize it."
        : "For PDFs, summarize the clinical content clearly. Highlight anomalies and next actions.",
      `File name: ${fileName}`,
    ].join(" ");
  }

  return [
    `You are Mofid AI, the smart medical assistant of the TERIAQ platform. ${languageInstruction}`,
    kind === "image"
      ? "Analyze the uploaded image for a patient."
      : "Analyze the uploaded PDF for a patient.",
    "First identify what the attachment actually contains.",
    "If it is NOT medical (e.g. math, homework, general docs, academic tests), you MUST REFUSE to analyze it. Say clearly: 'Ce n'est pas ma spécialité'.",
    "If it is medical, use careful medical wording, never give a definitive diagnosis, and suggest the most relevant specialist if possible.",
    "Mention urgent warning signs only when the content is clearly medical and justified.",
    `File name: ${fileName}`,
  ].join(" ");
}

function buildSynthesisPrompt(
  userRole: "patient" | "doctor",
  languageInstruction: string,
  userPrompt: string,
  attachmentSummaries: string,
  history: Array<{ role: "user" | "assistant"; content: string }>
) {
  const historyBlock = history
    .slice(-6)
    .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`)
    .join("\n");

  return [
    `You are Mofid AI, the professional medical assistant of the TERIAQ platform. ${languageInstruction}`,
    "PLATFORM: TERIAQ is a smart medical ecosystem for patients and doctors.",
    "Merge the attachment analyses into one final answer.",
    "STRICT RULE: If any attachment is non-medical, you MUST REFUSE to discuss it and state 'Ce n'est pas ma spécialité'.",
    "LANGUAGE RULE: Detect the user's language from the prompt. Respond ENTIRELY in that language.",
    "If the target language is Arabic, write in clean, natural Arabic only without ANY Latin script noise (like 'hơn').",
    "Do not mention internal processing steps or separate models.",
    "Keep the answer practical and readable.",
    "If the attachment is medical, keep the answer medically careful.",
    historyBlock ? `Recent conversation:\n${historyBlock}` : "",
    `User message:\n${userPrompt}`,
    `Attachment analyses:\n${attachmentSummaries}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function getDataUrlBase64(dataUrl: string) {
  const parts = dataUrl.split(",", 2);
  if (parts.length !== 2) {
    throw new Error("Pièce jointe invalide.");
  }
  return parts[1];
}

function hasSuspiciousMixedScript(text: string) {
  return /[\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/.test(text);
}

async function extractPdfText(dataUrl: string) {
  const buffer = Buffer.from(getDataUrlBase64(dataUrl), "base64");
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "teriyaq-pdf-"));
  const tempPdfPath = path.join(tempDir, "upload.pdf");

  await fs.writeFile(tempPdfPath, buffer);

  try {
    return await extractPdfTextInChildProcess(tempPdfPath);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function extractPdfTextInChildProcess(pdfPath: string) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, [pdfExtractionScriptPath, pdfPath], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Échec de lecture du PDF (code ${code}).`));
        return;
      }

      try {
        const parsed = JSON.parse(stdout) as { text?: string };
        resolve((parsed.text ?? "").trim());
      } catch (error) {
        reject(error instanceof Error ? error : new Error("Réponse invalide du lecteur PDF."));
      }
    });
  });
}

async function analyzeImage(
  groq: Groq,
  prompt: string,
  dataUrl: string
) {
  const completion = await groq.chat.completions.create({
    model: "meta-llama/llama-4-scout-17b-16e-instruct",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
    temperature: 0.3,
    max_tokens: 900,
  });

  return completion.choices[0]?.message?.content ?? "Analyse indisponible pour le moment.";
}

async function analyzePdf(
  groq: Groq,
  prompt: string,
  dataUrl: string,
  fileName: string
) {
  const pdfText = await extractPdfText(dataUrl);
  if (!pdfText) {
    throw new Error(`Le PDF ${fileName} ne contient pas de texte exploitable.`);
  }

  const completion = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      {
        role: "user",
        content: `${prompt}\n\nExtracted PDF content:\n${pdfText.slice(0, 18000)}`,
      },
    ],
    temperature: 0.2,
    max_tokens: 900,
  });

  return completion.choices[0]?.message?.content ?? "Analyse indisponible pour le moment.";
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

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as VisionPayload;
    const userRole = body.userRole === "doctor" ? "doctor" : "patient";
    const userPrompt = body.userPrompt?.trim() ?? "";
    const attachments = (body.attachments ?? []).filter(
      (attachment) => attachment.dataUrl && attachment.mimeType && attachment.fileName
    );
    const history = Array.isArray(body.history) ? body.history : [];
    const language = detectMessageLanguage(userPrompt || history.at(-1)?.content || attachments[0]?.fileName || "");
    const effectiveUserPrompt =
      userPrompt ||
      (language === "ar"
        ? "حلل هذه المرفقات وقدم خلاصة واضحة."
        : language === "en"
          ? "Analyze these attachments and give me a clear summary."
          : "Analyse ces pièces jointes et donne-moi un résumé clair.");
    const apiKey =
      (userRole === "doctor" ? process.env.DOCTOR_VISION_API_KEY : process.env.PATIENT_VISION_API_KEY) ||
      process.env.AI_VISION_API_KEY ||
      process.env.GROQ_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "Vision AI non configurée. Ajoutez PATIENT_VISION_API_KEY et DOCTOR_VISION_API_KEY." },
        { status: 500 }
      );
    }

    if (attachments.length === 0) {
      return NextResponse.json(
        { error: "Aucune pièce jointe valide n'a été reçue." },
        { status: 400 }
      );
    }

    if (attachments.length > 5) {
      return NextResponse.json(
        { error: "Vous pouvez envoyer jusqu'à 5 pièces jointes maximum." },
        { status: 400 }
      );
    }

    const groq = new Groq({ apiKey });
    const languageInstruction = getLanguageInstruction(language);
    const analyses = await Promise.all(
      attachments.map(async (attachment, index) => {
        const fileName = attachment.fileName ?? `attachment-${index + 1}`;
        const mimeType = attachment.mimeType ?? "";
        const dataUrl = attachment.dataUrl ?? "";

        if (mimeType.startsWith("image/")) {
          const prompt = buildAttachmentPrompt(userRole, languageInstruction, fileName, "image");
          const reply = await analyzeImage(groq, `${prompt}\n\nUser message: ${effectiveUserPrompt}`.trim(), dataUrl);
          return `Attachment ${index + 1} - ${fileName}\n${reply}`;
        }

        if (mimeType === "application/pdf") {
          const prompt = buildAttachmentPrompt(userRole, languageInstruction, fileName, "pdf");
          const reply = await analyzePdf(groq, `${prompt}\n\nUser message: ${effectiveUserPrompt}`.trim(), dataUrl, fileName);
          return `Attachment ${index + 1} - ${fileName}\n${reply}`;
        }

        throw new Error(`Le fichier ${fileName} n'est pas pris en charge. Utilisez uniquement des images ou des PDF.`);
      })
    );

    const synthesis = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "user",
          content: buildSynthesisPrompt(userRole, languageInstruction, effectiveUserPrompt, analyses.join("\n\n"), history),
        },
      ],
      temperature: 0.25,
      max_tokens: 1100,
    });

    let reply = synthesis.choices[0]?.message?.content ?? analyses.join("\n\n");
    if (language === "ar" && hasSuspiciousMixedScript(reply)) {
      reply = await rewriteCleanArabic(groq, reply);
    }

    return NextResponse.json({ reply });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

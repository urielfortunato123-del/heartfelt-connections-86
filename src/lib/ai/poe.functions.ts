import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const MessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string().min(1).max(20000),
});

const InputSchema = z.object({
  messages: z.array(MessageSchema).min(1).max(40),
  model: z.string().min(1).max(80).optional(),
  context: z.string().max(8000).optional(),
});

const SYSTEM_PROMPT = `Você é um assistente especialista em engenharia rodoviária e GIS,
integrado ao software KM/Converter Pro. Ajude o usuário com:
- Interpretação de arquivos DXF/TXT/KML/Shapefile
- Detecção e conversão de sistemas de coordenadas (SIRGAS 2000, UTM, WGS84)
- Sugestões de estaqueamento, sentido de rodovia e marcos quilométricos
- Padrões DER-SP, DNIT e concessionárias
- Cálculos de quilometragem, hectômetros, estacas

Responda em português brasileiro, de forma técnica, objetiva e profissional.
Use markdown quando útil (listas, tabelas, blocos de código).`;

export const askPoe = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data }) => {
    const apiKey = process.env.POE_API_KEY;
    if (!apiKey) {
      return { ok: false as const, error: "POE_API_KEY não configurada" };
    }

    const model = data.model || "Claude-Sonnet-4.5";
    const systemContent = data.context
      ? `${SYSTEM_PROMPT}\n\n## Contexto do projeto atual\n${data.context}`
      : SYSTEM_PROMPT;

    const payload = {
      model,
      messages: [
        { role: "system" as const, content: systemContent },
        ...data.messages,
      ],
      stream: false,
      temperature: 0.3,
    };

    try {
      const res = await fetch("https://api.poe.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.error("Poe API error:", res.status, text);
        return {
          ok: false as const,
          error: `Poe API erro ${res.status}: ${text.slice(0, 300) || res.statusText}`,
        };
      }

      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = json.choices?.[0]?.message?.content ?? "";
      return { ok: true as const, content, model };
    } catch (error) {
      console.error("Poe request failed:", error);
      return {
        ok: false as const,
        error: error instanceof Error ? error.message : "Falha na requisição",
      };
    }
  });

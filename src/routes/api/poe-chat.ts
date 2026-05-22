import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const MessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string().min(1).max(20000),
});

const BodySchema = z.object({
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

export const Route = createFileRoute("/api/poe-chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.POE_API_KEY;
        if (!apiKey) {
          return new Response(
            JSON.stringify({ error: "POE_API_KEY não configurada" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }

        let parsed: z.infer<typeof BodySchema>;
        try {
          parsed = BodySchema.parse(await request.json());
        } catch (err) {
          return new Response(
            JSON.stringify({
              error: err instanceof Error ? err.message : "Entrada inválida",
            }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }

        const systemContent = parsed.context
          ? `${SYSTEM_PROMPT}\n\n## Contexto do projeto atual\n${parsed.context}`
          : SYSTEM_PROMPT;

        const upstream = await fetch("https://api.poe.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: parsed.model || "Claude-Sonnet-4.5",
            messages: [
              { role: "system", content: systemContent },
              ...parsed.messages,
            ],
            stream: true,
            temperature: 0.3,
          }),
        });

        if (!upstream.ok || !upstream.body) {
          const text = await upstream.text().catch(() => "");
          return new Response(
            JSON.stringify({
              error: `Poe API erro ${upstream.status}: ${text.slice(0, 300) || upstream.statusText}`,
            }),
            {
              status: upstream.status,
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        return new Response(upstream.body, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
          },
        });
      },
    },
  },
});

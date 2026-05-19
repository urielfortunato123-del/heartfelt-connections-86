#!/usr/bin/env bun
// Testa detectTxtPreset com amostras sintéticas cobrindo:
//   - PNEZD vs PENZD em UTM Sul real (N >> E) e local (N > E mas pequenos),
//   - NEZ vs ENZ (sem coluna de ID),
//   - Lat/Lng (GNSS),
//   - separadores: vírgula, ponto-e-vírgula, tab e espaço,
//   - decimal "." e ",".
//
// Rode com:  bun scripts/test-detect-txt-preset.ts
//        ou: npm run test:detect-txt

import { detectTxtPreset, detectTxtPresetVerbose, TXT_PRESETS } from "../src/lib/projeto/importers";

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
let failed = 0;
const pass = (m: string) => console.log(`${GREEN}✓${RESET} ${m}`);
const fail = (m: string) => {
  console.error(`${RED}✗${RESET} ${m}`);
  failed++;
};

function mkFile(name: string, content: string): File {
  return new File([content], name, { type: "text/plain" });
}

/** Gera N linhas substituindo "{sep}" pelo separador e "{dec}" pelo decimal. */
function rows(template: string, n: number, sep: string, dec: "." | ",") {
  return Array.from({ length: n }, (_, i) =>
    template
      .replaceAll("{i}", String(i + 1))
      .replaceAll("{sep}", sep)
      .replaceAll("{dec}", dec === "," ? "," : "."),
  ).join("\n");
}

type Case = {
  name: string;
  content: string;
  decimal?: "." | ",";
  skip?: number;
  expect: keyof typeof TXT_PRESETS | null;
};

const cases: Case[] = [
  // ----- PNEZD em UTM Sul real (N ≈ 7.5M > E ≈ 250k) -----
  {
    name: "PNEZD · UTM Sul real · vírgula · decimal .",
    content: rows("{i}{sep}7500000{dec}12{sep}250000{dec}34{sep}680{dec}5{sep}EIXO", 8, ",", "."),
    expect: "PNEZD (P,N,E,Z,D)",
  },
  {
    name: "PNEZD · sistema local (N pequeno mas > E) · vírgula",
    content: rows("{i}{sep}245009{dec}84{sep}141815{dec}74{sep}684{dec}97{sep}EIXO", 10, ",", "."),
    expect: "PNEZD (P,N,E,Z,D)",
  },
  {
    name: "PNEZD · tab · decimal vírgula (pt-BR)",
    content: rows("{i}{sep}7500000{dec}12{sep}250000{dec}34{sep}680{dec}5{sep}EIXO", 6, "\t", ","),
    decimal: ",",
    expect: "PNEZD (P,N,E,Z,D)",
  },

  // ----- PENZD (E primeiro: E < N) -----
  {
    name: "PENZD · UTM Sul · ponto-e-vírgula",
    content: rows("{i}{sep}250000{dec}34{sep}7500000{dec}12{sep}680{dec}5{sep}EIXO", 8, ";", "."),
    expect: "PENZD (P,E,N,Z,D)",
  },
  {
    name: "PENZD · espaço como separador",
    content: rows("{i}{sep}250000{dec}1{sep}7500000{dec}2{sep}680{dec}0{sep}EIXO", 6, " ", "."),
    expect: "PENZD (P,E,N,Z,D)",
  },

  // ----- NEZ / ENZ (sem coluna de ID) -----
  {
    name: "NEZ · N > E sem ID",
    content: rows("7500000{dec}12{sep}250000{dec}34{sep}680{dec}5", 6, ",", "."),
    expect: "NEZ (N,E,Z)",
  },
  {
    name: "ENZ · E < N invertido, sem ID",
    content: rows("250000{dec}34{sep}7500000{dec}12{sep}680{dec}5", 6, ",", "."),
    expect: "ENZ (E,N,Z)",
  },

  // ----- Lat/Lng (GNSS) -----
  {
    name: "Lat,Lng · GNSS · vírgula",
    content: rows("{i}{sep}-22{dec}3{sep}-49{dec}1{sep}680{dec}5{sep}PT", 6, ",", "."),
    expect: "Lat,Lng,Z (GNSS)",
  },

  // ----- Cabeçalho ignorado -----
  {
    name: "PNEZD · com 2 linhas de cabeçalho (skipHeader=2)",
    content:
      "# arquivo gerado pelo equipamento\n" +
      "P;N;E;Z;DESC\n" +
      rows("{i}{sep}7500000{dec}12{sep}250000{dec}34{sep}680{dec}5{sep}EIXO", 5, ";", "."),
    skip: 2,
    expect: "PNEZD (P,N,E,Z,D)",
  },

  // ----- Casos sem confiança suficiente -----
  {
    name: "vazio → null",
    content: "",
    expect: null,
  },
  {
    name: "amostra pequena demais (2 linhas) → null (low confidence)",
    content: rows("{i}{sep}7500000{dec}1{sep}250000{dec}2{sep}680{dec}0{sep}EIXO", 2, ",", "."),
    expect: null,
  },
  {
    // Empate técnico real: metade das linhas têm N>E em UTM Sul plausível e a outra
    // metade tem E>N também em UTM Sul plausível — ambos os lados passariam no
    // column-check, então o voto a/b decide e empata → null.
    name: "empate técnico PNEZD vs PENZD → null",
    content:
      rows("{i}{sep}7500000{dec}0{sep}250000{dec}0{sep}680{dec}0{sep}A", 3, ",", ".") +
      "\n" +
      rows("{i}{sep}250000{dec}0{sep}7500000{dec}0{sep}680{dec}0{sep}A", 3, ",", "."),
    expect: null,
  },
  {
    // Mesma configuração mas com valores arbitrários — o vencedor base ainda
    // fica em "low" e o column-check NÃO promove (faixa não-UTM/local).
    name: "margem baixa + valores locais arbitrários → null",
    content:
      rows("{i}{sep}999{dec}0{sep}11{dec}0{sep}5{dec}0{sep}A", 4, ",", ".") +
      "\n" +
      rows("{i}{sep}11{dec}0{sep}999{dec}0{sep}5{dec}0{sep}A", 2, ",", "."),
    expect: null,
  },
];

const file = (c: Case) => mkFile("sample.txt", c.content);

const run = async () => {
  for (const c of cases) {
    try {
      const got = await detectTxtPreset(file(c), c.decimal ?? ".", c.skip ?? 0);
      if (got === c.expect) {
        pass(`${c.name} ${DIM}→ ${got ?? "null"}${RESET}`);
      } else {
        fail(`${c.name}\n    esperado: ${c.expect ?? "null"}\n    obtido:   ${got ?? "null"}`);
      }
    } catch (err) {
      fail(`${c.name} — throw: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(
    failed === 0
      ? `\n${GREEN}✓ Todos os ${cases.length} casos passaram.${RESET}`
      : `\n${RED}✗ ${failed}/${cases.length} casos falharam.${RESET}`,
  );
  process.exit(failed === 0 ? 0 : 1);
};

run();

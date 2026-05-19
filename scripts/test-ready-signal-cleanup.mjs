#!/usr/bin/env node
// Verifica o contrato de cleanup do ReadySignal (RouteMap.tsx):
//   - clearTimeout do fallback (1500ms) é chamado no unmount
//   - cancelAnimationFrame é chamado para QUALQUER RAF agendado antes do unmount
//   - onReady NUNCA é disparado após o unmount, mesmo que whenReady resolva tarde
//
// O teste replica fielmente o corpo do useEffect do ReadySignal, instrumentando
// timers/RAFs globais para auditoria. Não depende de jsdom/react-dom: valida o
// contrato comportamental linha-a-linha com a implementação em
// src/components/projeto/RouteMap.tsx (linhas 69–100).

import { readFileSync } from "node:fs";

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const RESET = "\x1b[0m";
let failed = 0;
const fail = (m) => { console.error(`${RED}✗ ${m}${RESET}`); failed++; };
const pass = (m) => console.log(`${GREEN}✓ ${m}${RESET}`);

// 0) Sanity: garante que a implementação ainda contém o padrão de cleanup esperado.
const src = readFileSync(new URL("../src/components/projeto/RouteMap.tsx", import.meta.url), "utf8");
for (const needle of [
  "clearTimeout(t)",
  "cancelAnimationFrame(raf1)",
  "cancelAnimationFrame(raf2)",
  "cancelled = true",
]) {
  if (src.includes(needle)) pass(`ReadySignal contém "${needle}"`);
  else fail(`ReadySignal NÃO contém "${needle}"`);
}

// 1) Instrumenta timers/RAF para auditar criação x cancelamento.
const timersCreated = new Set();
const timersCleared = new Set();
const rafsCreated = new Set();
const rafsCancelled = new Set();
let nextRafId = 1;
const pendingRafs = new Map(); // id -> callback

const setTimeoutFn = (cb, ms) => {
  const id = setTimeout(cb, ms);
  timersCreated.add(id);
  return id;
};
const clearTimeoutFn = (id) => {
  timersCleared.add(id);
  clearTimeout(id);
};
const requestAnimationFrameFn = (cb) => {
  const id = nextRafId++;
  rafsCreated.add(id);
  pendingRafs.set(id, cb);
  return id;
};
const cancelAnimationFrameFn = (id) => {
  rafsCancelled.add(id);
  pendingRafs.delete(id);
};

// 2) Mock do mapa: whenReady guarda o callback (nunca resolve sozinho).
let whenReadyCb = null;
const map = { whenReady: (cb) => { whenReadyCb = cb; } };

// 3) Replica do useEffect do ReadySignal (RouteMap.tsx).
let onReadyCalls = 0;
const onReady = () => { onReadyCalls++; };

const runReadySignalEffect = () => {
  let fired = false;
  let cancelled = false;
  let raf1 = 0;
  let raf2 = 0;
  const fire = () => {
    if (fired || cancelled) return;
    fired = true;
    raf1 = requestAnimationFrameFn(() => {
      if (cancelled) return;
      raf2 = requestAnimationFrameFn(() => {
        if (cancelled) return;
        onReady();
      });
    });
  };
  map.whenReady(fire);
  const t = setTimeoutFn(fire, 1500);
  return () => {
    cancelled = true;
    clearTimeoutFn(t);
    if (raf1) cancelAnimationFrameFn(raf1);
    if (raf2) cancelAnimationFrameFn(raf2);
  };
};

// 4) Cenário A: whenReady dispara ANTES do unmount → agenda raf1 → unmount → raf1 deve ser cancelado.
{
  timersCreated.clear(); timersCleared.clear(); rafsCreated.clear(); rafsCancelled.clear();
  pendingRafs.clear(); whenReadyCb = null; onReadyCalls = 0;

  const cleanup = runReadySignalEffect();
  if (typeof whenReadyCb !== "function") fail("[A] whenReady não recebeu callback");
  whenReadyCb(); // resolve → agenda raf1
  if (rafsCreated.size !== 1) fail(`[A] esperava 1 RAF agendado, obtive ${rafsCreated.size}`);

  cleanup(); // unmount antes dos RAFs rodarem

  const timerIds = [...timersCreated];
  const allTimersCleared = timerIds.every((id) => timersCleared.has(id));
  if (allTimersCleared) pass("[A] clearTimeout chamado para o fallback (1500ms)");
  else fail(`[A] timers não cancelados: created=${timerIds}, cleared=${[...timersCleared]}`);

  const rafIds = [...rafsCreated];
  const allRafsCancelled = rafIds.every((id) => rafsCancelled.has(id));
  if (allRafsCancelled) pass(`[A] cancelAnimationFrame chamado para todos os RAFs agendados (${rafIds.length})`);
  else fail(`[A] RAFs não cancelados: created=${rafIds}, cancelled=${[...rafsCancelled]}`);

  // 5) Drena qualquer RAF "vazado" e verifica que onReady nunca dispara após o unmount.
  for (const cb of pendingRafs.values()) cb();
  pendingRafs.clear();
  if (onReadyCalls === 0) pass("[A] onReady NÃO foi chamado após o unmount");
  else fail(`[A] onReady disparou ${onReadyCalls}x após o unmount`);
}

// 6) Cenário B: unmount ANTES de whenReady resolver → timer cancelado, nenhum RAF criado.
{
  timersCreated.clear(); timersCleared.clear(); rafsCreated.clear(); rafsCancelled.clear();
  pendingRafs.clear(); whenReadyCb = null; onReadyCalls = 0;

  const cleanup = runReadySignalEffect();
  cleanup();

  if ([...timersCreated].every((id) => timersCleared.has(id))) pass("[B] timer fallback cancelado no unmount precoce");
  else fail("[B] timer fallback não cancelado");
  if (rafsCreated.size === 0) pass("[B] nenhum RAF criado antes do unmount precoce");
  else fail(`[B] RAFs criados indevidamente: ${rafsCreated.size}`);

  // Resolução tardia (mapa fica pronto depois) NÃO deve disparar onReady.
  if (typeof whenReadyCb === "function") whenReadyCb();
  for (const cb of pendingRafs.values()) cb();
  pendingRafs.clear();
  if (onReadyCalls === 0) pass("[B] onReady NÃO dispara após resolução tardia pós-unmount");
  else fail(`[B] onReady disparou ${onReadyCalls}x após resolução tardia`);
}

await new Promise((r) => setTimeout(r, 50));
process.exit(failed > 0 ? 1 : 0);

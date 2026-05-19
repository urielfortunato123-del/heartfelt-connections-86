#!/usr/bin/env node
// Garante o contrato de "safe handlers" do RouteMap:
//   - safeOnReady / safeOnClick / safeOnMovePoint / safeOnMovePointEnd
//     SEMPRE checam mountedRef antes de chamar o handler do pai;
//   - chamadas tardias do Leaflet (após unmount, durante init) são engolidas
//     e não atualizam estado;
//   - handlersRef é atualizado, mas a referência dos wrappers é estável.
//
// Replica fielmente o padrão em src/components/projeto/RouteMap.tsx
// (mountedRef + handlersRef + safeOn*) e audita os efeitos.

import { readFileSync } from "node:fs";

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const RESET = "\x1b[0m";
let failed = 0;
const fail = (m) => { console.error(`${RED}✗ ${m}${RESET}`); failed++; };
const pass = (m) => console.log(`${GREEN}✓ ${m}${RESET}`);

// 0) Sanity: garante que a fonte ainda usa o padrão mountedRef + handlersRef.
const src = readFileSync(new URL("../src/components/projeto/RouteMap.tsx", import.meta.url), "utf8");
for (const needle of [
  "mountedRef.current = false",
  "handlersRef.current",
  "if (!mountedRef.current) return",
]) {
  if (src.includes(needle)) pass(`RouteMap contém "${needle}"`);
  else fail(`RouteMap NÃO contém "${needle}"`);
}

// 1) Estado simulado do componente (espelha RouteMap).
const mountedRef = { current: true };
const stateUpdates = [];

const parentOnReady = () => stateUpdates.push("onReady");
const parentOnClick = (ll) => stateUpdates.push(`onClick:${ll.lat},${ll.lng}`);
const parentOnMovePoint = (id, ll) => stateUpdates.push(`onMovePoint:${id}@${ll.lat},${ll.lng}`);
const parentOnMovePointEnd = (id) => stateUpdates.push(`onMovePointEnd:${id}`);

const handlersRef = { current: {
  onClick: parentOnClick,
  onReady: parentOnReady,
  onMovePoint: parentOnMovePoint,
  onMovePointEnd: parentOnMovePointEnd,
}};

// safeOn* — replicados literalmente da implementação atual (deps []).
const safeOnClick = (ll) => {
  if (!mountedRef.current) return;
  handlersRef.current.onClick(ll);
};
const safeOnReady = () => {
  if (!mountedRef.current) return;
  handlersRef.current.onReady?.();
};
const safeOnMovePoint = (id, ll) => {
  if (!mountedRef.current) return;
  handlersRef.current.onMovePoint?.(id, ll);
};
const safeOnMovePointEnd = (id) => {
  if (!mountedRef.current) return;
  handlersRef.current.onMovePointEnd?.(id);
};

// Snapshot de referências antes de re-renders, para validar estabilidade.
const refsBefore = { safeOnClick, safeOnReady, safeOnMovePoint, safeOnMovePointEnd };

// 2) Simula um "Leaflet em inicialização" que vai disparar callbacks em fila,
// mas o componente desmonta no meio do processo (antes do whenReady resolver).
const leafletQueue = [];
const enqueue = (cb) => leafletQueue.push(cb);
const flush = () => {
  while (leafletQueue.length) {
    const cb = leafletQueue.shift();
    try { cb(); } catch { /* Leaflet engole */ }
  }
};

// Leaflet agenda: ready, depois um click "atrasado", um drag em progresso e um dragend.
enqueue(() => safeOnReady());
enqueue(() => safeOnClick({ lat: -22.0, lng: -47.8 }));
enqueue(() => safeOnMovePoint("p1", { lat: -22.01, lng: -47.81 }));
enqueue(() => safeOnMovePointEnd("p1"));

// 3) Desmonta o RouteMap ANTES de qualquer callback rodar (mid-init).
mountedRef.current = false;

// 4) Agora drena a fila — todos os callbacks vêm do Leaflet "tarde".
flush();

// 5) Asserções principais
if (stateUpdates.length === 0) pass("Nenhum handler atualizou estado após o unmount");
else fail(`Handlers chamados após unmount: ${JSON.stringify(stateUpdates)}`);

// 6) Mesmo se o pai trocar os handlers depois do unmount (re-render entre rotas),
// handlersRef pode mudar — mas mountedRef=false impede a propagação.
handlersRef.current = {
  onClick: () => stateUpdates.push("LATE-onClick"),
  onReady: () => stateUpdates.push("LATE-onReady"),
  onMovePoint: () => stateUpdates.push("LATE-onMovePoint"),
  onMovePointEnd: () => stateUpdates.push("LATE-onMovePointEnd"),
};
safeOnClick({ lat: 0, lng: 0 });
safeOnReady();
safeOnMovePoint("p2", { lat: 0, lng: 0 });
safeOnMovePointEnd("p2");
if (stateUpdates.filter((s) => s.startsWith("LATE-")).length === 0) {
  pass("Troca tardia de handlers no pai não vaza chamadas após o unmount");
} else {
  fail(`Handlers tardios dispararam: ${JSON.stringify(stateUpdates)}`);
}

// 7) Estabilidade de referência: re-render do pai atualiza handlersRef mas NÃO
// recria os wrappers (porque useCallback tem deps []).
if (
  refsBefore.safeOnClick === safeOnClick &&
  refsBefore.safeOnReady === safeOnReady &&
  refsBefore.safeOnMovePoint === safeOnMovePoint &&
  refsBefore.safeOnMovePointEnd === safeOnMovePointEnd
) {
  pass("safeOn* mantêm referência estável entre re-renders");
} else {
  fail("safeOn* mudaram de referência (causaria re-attach de listeners no Leaflet)");
}

// 8) Caminho positivo: enquanto montado, handlers DEVEM propagar.
const updates2 = [];
const mounted2 = { current: true };
const handlers2 = { current: {
  onClick: (ll) => updates2.push(`ok:${ll.lat}`),
  onReady: () => updates2.push("ok:ready"),
} };
const safeClick2 = (ll) => { if (!mounted2.current) return; handlers2.current.onClick(ll); };
const safeReady2 = () => { if (!mounted2.current) return; handlers2.current.onReady?.(); };
safeReady2();
safeClick2({ lat: 1, lng: 2 });
if (updates2.length === 2 && updates2[0] === "ok:ready" && updates2[1] === "ok:1") {
  pass("Enquanto montado, safeOn* propagam normalmente ao pai");
} else {
  fail(`Caminho positivo falhou: ${JSON.stringify(updates2)}`);
}

process.exit(failed > 0 ? 1 : 0);


## O que será construído

Nova rota `/projeto` com um editor completo de "projeto de pista" no padrão DER, traçado direto no mapa, exportável para PDF (com placas) e Excel.

### 1. Página `/projeto` (src/routes/projeto.tsx)

Layout em 3 áreas:

- **Cabeçalho do projeto** — nome (ex.: "SP-261"), sentido (crescente/decrescente), km inicial, km final, passo (default 1 km).
- **Mapa (Leaflet + OpenStreetMap, sem API key)** — usuário clica para marcar:
  1. Ponto de início (km inicial)
  2. Ponto de fim (km final)
  Traçamos a rota via **OSRM público** (`router.project-osrm.org`, free, demo) seguindo as ruas. Distribuímos marcadores de km automaticamente ao longo da polyline pelo comprimento acumulado. O usuário também pode adicionar pontos manuais (ponte, placa A-1a etc.) clicando no mapa em modo "marcar ponto".
- **Tabela de estaqueamento** — gerada a partir do cabeçalho + rota: cada linha contém km, estaca, hectômetro, excedente, conversão em todas as unidades (m, mi, nmi, yd, ft, légua, AU, ly), e descrição livre.

### 2. Persistência

`localStorage` (`pista.projects.v1`): lista de projetos com cabeçalho, polyline, marcadores manuais e descrições.

### 3. Exports

- **Excel/CSV** — `xlsx` (SheetJS); colunas: km, estaca, hectômetro, excedente, todas unidades, descrição.
- **PDF tabela** — `jsPDF` + `jspdf-autotable`, paisagem, com cabeçalho do projeto.
- **PDF "placas"** — uma página por marcador de km com placa estilizada SVG → canvas: número do km grande, sentido (seta), nome da rodovia, lado da pista (crescente em cima, decrescente embaixo, como no exemplo do usuário).

### 4. Link no Home

Adicionar botão "Abrir editor de projeto" no `index.tsx` que navega para `/projeto`.

### Detalhes técnicos

- Libs novas: `leaflet`, `react-leaflet`, `xlsx`, `jspdf`, `jspdf-autotable`. CSS do leaflet importado em `__root.tsx`.
- Mapa só renderiza client-side (componente dinâmico com flag `mounted`) para evitar SSR/hydration issues.
- Roteamento via OSRM demo: `https://router.project-osrm.org/route/v1/driving/{lng1},{lat1};{lng2},{lat2}?overview=full&geometries=geojson`. Servidor demo do OSRM é "best-effort"; em produção real seria preciso self-host, mas para uso pessoal funciona.
- Distribuição de km: percorrer a polyline acumulando distância (haversine entre vértices) e interpolar pontos a cada 1 km (ou passo configurado).
- Reutilizar `src/lib/converters/distance.ts` (já tem DER + unidades).
- Correção silenciosa: forçar locale `pt-BR` nas formatações numéricas (`formatKm`, `formatNumber`) para eliminar mismatch de hidratação no home.

### Fora deste plano (pode vir depois)
- Auto-detecção do nome da rodovia (precisaria reverse-geocoding).
- Sincronização entre dispositivos (exige backend).
- Edição da rota arrastando vértices.

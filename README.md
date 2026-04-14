# cli-stealth-reader

[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green)](https://nodejs.org/)

Um leitor de EPUB para terminal em modo tela cheia, com renderização e um diferencial único: o modo **stealth** disfarça o texto como código JavaScript plausível, para que pareça que você está programando enquanto lê.

## Visão Geral

O **cli-stealth-reader** oferece duas experiências de leitura:

- **Modo Code (Stealth)**: O texto é renderizado como código JavaScript com syntax highlighting real — variáveis, constantes, comentários, funções e array methods são aleatoriamente usados para mascarar o conteúdo
- **Modo Plain**: Prosa limpa e legível com formatação visual clara

Além disso:
- Interface TUI moderna com status bar integrada
- 4 temas de cores elegantes (Codex, Graphite, Amber, Forest)
- 13 slash commands com suporte a argumentos, aliases e flags
- Biblioteca SQLite persistida com XDG directories via `better-sqlite3`
- Import rigoroso de EPUB com suporte a EPUB3, NCX fallback e fragmentos de âncora
- Auto-detecção de arquivos `.epub` no diretório atual
- Posição de leitura sincronizada por livro
- Picker interativo de arquivos no diretório atual
- Scroll com mouse e barra lateral de progresso

## Instalação

### Requisitos

- **Node.js 20+**
- Terminal com suporte a cores 24-bit

### Setup Rápido

```bash
git clone https://github.com/felipebueno/cli-stealth-reader.git
cd cli-stealth-reader
npm install
npm run dev
```

Para compilar a CLI:

```bash
npm run build
node dist/index.js
```

## Uso Rápido

1. Inicie o leitor: `npm run dev`
2. Importe um livro com `/add` ou pressione `Enter` para abrir o picker de EPUBs da pasta atual
3. Use `j`/`k`, setas, `Space`/`b` ou a roda do mouse para navegar
4. Pressione `/` para abrir a barra de comandos
5. Pressione `?` para ver todos os atalhos

### Exemplo: Trocar de Modo

```
/mode code    # Ativa modo stealth (padrão)
/mode plain   # Ativa modo de leitura simples
```

### Exemplo: Mudar Tema

```
/colorscheme codex      # Tema azul frio
/colorscheme graphite   # Tema neutro
/colorscheme amber      # Tema quente
/colorscheme forest     # Tema verde
```

## Modos de Renderização

### Modo Code (Stealth)

Seu texto aparece como padrões JavaScript realistas que se repetem:

```javascript
const fragment0 = "Uma vez que Alice começou a se entediar de ficar";
// ao lado de sua irmã no banco, sem nada fazer.
function stage4() { return "Ela ocasionalmente dava uma olhadinha"; }
timeline.push("no livro que sua irmã lia, mas não havia figuras");
const fragment16 = "ou conversas nele, 'e que serve um livro', pensou Alice,";
// 'sem figuras ou conversas?'
function stage20() { return "O dia era muito quente e sonolento para ela."; }
timeline.push("Alice começou a sentir muito sono e preguiça.");
```

**Benefício**: Ninguém notará que você está lendo. Parece trabalho legítimo!

### Modo Plain

Interface clara e legível com formatação visual:

```
CAPÍTULO 1 — ABAIXO PELA TOCA DO COELHO

Uma vez que Alice começou a se entediar de ficar ao lado de sua irmã
no banco, sem nada fazer. Ela ocasionalmente dava uma olhadinha no livro
que sua irmã lia, mas não havia figuras ou conversas nele, 'e que serve um
livro', pensou Alice, 'sem figuras ou conversas?'

▏ O dia era muito quente e sonolento para ela. Alice começou a sentir
▏ muito sono e preguiça.

· · · · · · ·

▏ De repente, um Coelho Branco com olhos rosas passou correndo perto dela.
```

- Headings em maiúsculas com cor destaque
- Citações com prefixo `▏`
- Itens de lista com `·`
- Quebras de cena com `· · · · · · ·`

## Atalhos de Teclado

### Navegação

| Tecla | Ação |
|-------|------|
| `j` / `↓` | Scroll para baixo |
| `k` / `↑` | Scroll para cima |
| `Space` | Página para frente |
| `b` | Página para trás |
| `Home` | Ir para o início do capítulo |
| `End` | Ir para o fim do capítulo |
| `←` / `→` | Capítulo anterior / próximo capítulo |
| `wheel` | Scroll com mouse |
| `g` | Ir para o topo da leitura atual |
| `G` | Ir para o fim da leitura atual |

### Comandos

| Tecla | Ação |
|-------|------|
| `/` | Abrir barra de comandos |
| `Enter` | Executar comando ativo |
| `Esc` | Fechar overlay ou limpar input |
| `Tab` | Navegar seleção / completar comando |

### Interface

| Tecla | Ação |
|-------|------|
| `m` | Alternar modo de renderização (plain ↔ code) |
| `c` | Abrir picker de colorscheme |
| `p` | Avançar visibilidade da barra de progresso |
| `?` | Ver atalhos de teclado |
| `q` | Sair do leitor |

## Slash Commands

Pressione `/` para abrir a barra de comandos. Todos os comandos suportam argumentos e flags.

### Navegação

```bash
/prev [count]          # Ir ao capítulo anterior (ou N capítulos atrás)
/next [count]          # Ir ao próximo capítulo (ou N capítulos adiante)
/chapters [query]      # Abrir table of contents
  --current            # Destacar capítulo atual
  --flat               # Mostrar estrutura plana (sem hierarquia)
```

### Livros

```bash
/changebook [query]    # Trocar para outro livro
  --recent             # Listar apenas lidos recentemente
  --cwd                # Buscar apenas na pasta atual

/resume [book-query]   # Retomar um livro específico
  --latest             # Retomar o último lido

/add [path]            # Importar um EPUB ou abrir o picker da pasta atual
  --cwd                # Procurar EPUBs na pasta atual
  --force              # Reimportar mesmo que já exista

/remove [book-query]   # Remover livro da biblioteca
  --current            # Remover o livro atual

/removecurrent         # Remover apenas o livro em leitura
```

### Visualização

```bash
/mode [code|plain]     # Trocar modo de renderização

/colorscheme [theme]   # Mudar tema de cores
  --list               # Listar temas disponíveis
  --preview            # Ver preview do tema antes de aplicar

/toggleprogress [mode] # Controlar barra de progresso
  book | both | chapter | hidden
```

### Sistema

```bash
/help [command]        # Ver ajuda de um comando específico
  --all                # Listar todos os comandos

/keyboardshortcuts     # Ver atalhos de teclado
  --category <tipo>    # Filtrar por: navigation, commands, view
```

### Aliases

- `/book` → `/changebook`
- `/theme` → `/colorscheme`
- `/keys` → `/keyboardshortcuts`

## Temas de Cores

Quatro temas pensados para leitura prolongada:

### Codex (Padrão)
Azul frio e sofisticado — ideal para ambientes corporativos. Parece código real de um desenvolvedor.

### Graphite
Cinza neutro minimalista — clássico e profissional. Máxima discrição.

### Amber
Tons quentes de ouro e laranja — confortável para noites. Reduz fadiga ocular.

### Forest
Verde natural suave — ambiente calmo. Ideal para sessões longas de leitura.

## Arquitetura

```
src/
  index.ts           # Ponto de entrada CLI
  tui.ts             # Loop principal da TUI e estado da app
  types.ts           # Tipos compartilhados (CanonicalBook, CanonicalBlock, etc)
  commands.ts        # Definições e parser de slash commands
  renderers.ts       # Renderização de blocos (plain vs code)
  themes.ts          # 4 temas de cor pré-definidos
  help.ts            # Definições de atalhos de teclado
  color.ts           # Utilitários de formatação ANSI
  storage.ts         # Abstração SQLite com WAL (XDG dirs)
  paths.ts           # Resolução de caminhos XDG
  discovery.ts       # Auto-detecção de EPUBs no CWD
  
  parser/
    epub.ts          # Pipeline de import (JSZip + validação)
    html.ts          # Extração de blocos de HTML (parse5)
    xml.ts           # Utilitários de parsing XML
```

### Fluxo de Dados

```
Arquivo EPUB → epub.ts (JSZip + parsing) → CanonicalBook (chapters → blocks)
                                                  ↓
                                       storage.ts (SQLite)
                                                  ↓
                          tui.ts (AppState) ← → commands.ts
                                  ↓
                          renderers.ts → ANSI output → Terminal
```

### Armazenamento

O estado é persistido em diretórios XDG-padrão:

- **`$XDG_DATA_HOME/cli-stealth-reader/`**: Banco de dados SQLite (WAL mode)
  - Tabelas: `books`, `chapters`, `positions`, `diagnostics`, `settings`, `command_history`
- **`$XDG_CACHE_HOME/cli-stealth-reader/`**: Cache de JSON de livros

EPUBs encontrados no diretório atual são automaticamente oferecidos na tela inicial e em `/add --cwd`.

## Desenvolvimento

### Scripts

```bash
npm run dev            # Executar com tsx (sem build necessário)
npm run build          # Compilar TypeScript → dist/
npm start              # Rodar dist/index.js (CLI compilada)
npm test               # Rodar todos os testes
```

### Rodar Teste Único

```bash
node --import tsx --test test/epub.test.ts
node --import tsx --test test/commands.test.ts
```

### Modelo de Dados Principal

**`CanonicalBlock`** — Unidade básica de conteúdo:
```typescript
type CanonicalBlock = 
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "blockquote"; text: string }
  | { type: "list-item"; text: string }
  | { type: "scene-break" }
  | { type: "image"; text?: string }
  | { type: "anchor"; id: string }
```

**`CanonicalChapter`** — Capítulo com metadados:
```typescript
{
  title: string
  href: string
  blocks: CanonicalBlock[]
  wordCount: number
}
```

**`CanonicalBook`** — Livro completo:
```typescript
{
  title: string
  author?: string
  chapters: CanonicalChapter[]
  language?: string
  diagnostics: ImportDiagnostic[]
}
```

### Pipeline de Import EPUB

1. Validar arquivo: mimetype, `META-INF/container.xml`
2. Parsear OPF manifest e spine
3. Extrair TOC: EPUB3 `nav.xhtml` → NCX fallback → spine fallback
4. Para cada item do TOC: parsear HTML, extrair blocos, resolver fragmentos de âncora
5. Normalizar para formato canônico, calcular word counts, coletar diagnósticos

## Notas de Implementação

- Estado de app e todas as strings renderizadas passam por `tui.ts` — a "fonte da verdade"
- Comandos suportam aliases (ex: `/book` é alias para `/changebook`, `/theme` para `/colorscheme`)
- Argumentos entre aspas são interpretados literalmente (ex: `/add "Meu Livro.epub"`)
- A barra de progresso é customizável (`book`, `both`, `chapter`, `hidden`)
- Remoção de livro apaga apenas a entrada da biblioteca — o arquivo EPUB original não é deletado
- Posição de leitura é persistida por livro automaticamente

## Contribuição

Contribuições são bem-vindas! Siga o estilo de código existente e rode os testes antes de abrir um PR.

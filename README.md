# cli-stealth-reader

[Node.js](https://nodejs.org/)

Um leitor de EPUB para terminal em modo tela cheia, com renderização e um diferencial único: o modo **stealth** disfarça o texto como código (TypeScript, Python ou Rust) plausível, para que pareça que você está programando enquanto lê.

## Visão Geral

O **cli-stealth-reader** oferece múltiplas experiências de leitura:

- **Modo TypeScript (Stealth)**: O texto é renderizado como TypeScript realista — 12 padrões contextuais (const, let, arrow functions, export, await, nullish coalescing, type annotations, etc.) com nomes de variáveis gerados a partir das palavras do próprio texto
- **Modo Python (Stealth)**: Disfarça o texto como código Python
- **Modo Rust (Stealth)**: Disfarça o texto como código Rust
- **Modo Plain**: Prosa limpa e legível com formatação visual clara

Além disso:

- Interface TUI moderna com status bar integrada
- 4 colorschemes e 6 temas de aparência (dark, light, colorblind-friendly e ANSI)
- 25+ slash commands com suporte a argumentos, aliases e flags
- Biblioteca SQLite persistida com XDG directories via `better-sqlite3`
- Import rigoroso de EPUB com suporte a EPUB3, NCX fallback e fragmentos de âncora
- Suporte a CBZ (quadrinhos) e PDF além de EPUB
- Auto-detecção de arquivos `.epub`, `.cbz` e `.pdf` no diretório atual
- Posição de leitura sincronizada por livro
- Picker interativo de arquivos no diretório atual
- Scroll com mouse e barra lateral de progresso
- Modo foco: visualização centralizada de bloco único para leitura imersiva
- Busca com highlighting e ciclo de resultados
- Bookmarks com overlay de navegação
- Tags e notas por posição de leitura
- Export/Import de estado (posições, bookmarks, notas, tags) para sincronização entre máquinas
- Ordenação da biblioteca por título, autor, progresso ou último aberto
- Destaque de diálogos no modo plain
- Controle de densidade do código stealth (1–5)

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

Para instalar o comando globalmente no seu ambiente (via link local):

```bash
npm run build
npm link
which stealth-reader
```

Depois disso, você pode executar `stealth-reader` em qualquer diretório.

## Uso Rápido

1. Inicie o leitor: `npm run dev`
2. Importe um livro com `/add` ou pressione `Enter` para abrir o picker de EPUBs/CBZ/PDF da pasta atual
3. Use `j`/`k`, setas, `Space`/`b` ou a roda do mouse para navegar
4. Pressione `m` para ciclar entre os modos de renderização (plain, typescript, python, rust)
5. Pressione `f` para ativar o modo foco (leitura de bloco único centralizado)
6. Pressione `/` para abrir a barra de comandos
7. Pressione `?` para ver todos os atalhos

### Exemplo: Trocar de Modo

```
/mode plain        # Ativa modo de leitura simples
/mode typescript   # Ativa modo stealth TypeScript (padrão)
/mode python       # Ativa modo stealth Python
/mode rust         # Ativa modo stealth Rust
```

Ou use `m` para ciclar entre os modos sem abrir o comando.

### Exemplo: Mudar Colorscheme e Tema

```
/colorscheme codex      # Tema azul frio
/colorscheme graphite   # Tema neutro
/colorscheme amber      # Tema quente
/colorscheme forest     # Tema verde

/theme dark             # Tema escuro atual
/theme light            # Tema claro com fundo chalk
/theme dark-colorblind  # Tema escuro colorblind-friendly
/theme light-colorblind # Tema claro colorblind-friendly
/theme dark-ansi        # Tema escuro com cores ANSI
/theme light-ansi       # Tema claro com cores ANSI
```

## Modos de Renderização

### Modos Stealth (TypeScript, Python, Rust)

A tecla `m` cicla entre os modos: **plain → typescript → python → rust → plain**

O texto é mascarado como código real de cada linguagem. No modo TypeScript, 12 padrões contextuais são usados, com nomes de variáveis e funções gerados a partir das palavras do próprio livro:

```typescript
const aliceComecou = "Uma vez que Alice começou a se entediar de ficar";
// ao lado de sua irmã no banco, sem nada fazer.
const olhadinha = () => "Ela ocasionalmente dava uma olhadinha";
export const figuras = "no livro que sua irmã lia, mas não havia figuras";
const livroConversas: string = "ou conversas nele, 'e que serve um livro', pensou Alice,";
// 'sem figuras ou conversas?'
throw new Error("O dia era muito quente e sonolento para ela.");
console.log("Alice começou a sentir muito sono e preguiça.");
```

Blocos estruturais ocasionais (imports, interfaces, funções async) são inseridos para simular um arquivo real. A **densidade do código** é controlável de 1 a 5 (tecla `d` ou `/density`): densidade 1 favorece comentários, densidade 5 é código puro.

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


| Tecla     | Ação                                       |
| --------- | ------------------------------------------ |
| `j` / `↑` | Scroll para cima                           |
| `k` / `↓` | Scroll para baixo                          |
| `Space`   | Página para frente                         |
| `b`       | Página para trás                           |
| `Home`    | Ir para o início do capítulo               |
| `End`     | Ir para o fim do capítulo                  |
| `←` / `→` | Capítulo anterior / próximo capítulo       |
| `T`       | Abrir tabela de conteúdos                  |
| `B`       | Abrir overlay de bookmarks                 |
| `[` / `]` | Voltar / avançar no histórico de navegação |
| `wheel`   | Scroll com mouse                           |
| `g`       | Ir para o topo da leitura atual            |
| `G`       | Ir para o fim da leitura atual             |


### Comandos


| Tecla     | Ação                                                          |
| --------- | ------------------------------------------------------------- |
| `/`       | Abrir barra de comandos                                       |
| `Enter`   | Executar comando ativo                                        |
| `Esc`     | Fechar overlay ou limpar input                                |
| `Tab`     | Navegar seleção / completar comando                           |
| `n` / `N` | Próximo / anterior resultado de busca (após `/search`)        |
| `d`       | Deletar bookmark selecionado (dentro do overlay de bookmarks) |


### Interface


| Tecla | Ação                                                             |
| ----- | ---------------------------------------------------------------- |
| `m`   | Ciclar modo de renderização (plain → typescript → python → rust) |
| `f`   | Alternar modo foco (bloco único centralizado)                    |
| `d`   | Ciclar densidade do código stealth (1 → 3 → 5)                   |
| `c`   | Abrir picker de colorscheme                                      |
| `C`   | Abrir picker de tema                                             |
| `S`   | Abrir painel de configurações                                    |
| `p`   | Avançar visibilidade da barra de progresso                       |
| `?`   | Ver atalhos de teclado                                           |
| `q`   | Sair do leitor                                                   |


### Na Biblioteca (`/book`)


| Tecla | Ação                                                                      |
| ----- | ------------------------------------------------------------------------- |
| `s`   | Ciclar critério de ordenação (último aberto → título → autor → progresso) |
| `r`   | Reverter direção de ordenação                                             |


## Slash Commands

Pressione `/` para abrir a barra de comandos. Todos os comandos suportam argumentos e flags.

### Navegação

```bash
/prev [count]          # Ir ao capítulo anterior (ou N capítulos atrás)
/next [count]          # Ir ao próximo capítulo (ou N capítulos adiante)
/chapters [query]      # Abrir table of contents
  --current            # Destacar capítulo atual
  --flat               # Mostrar estrutura plana (sem hierarquia)

/goto <position>       # Pular para posição no livro
  10%                  # Por percentagem global
  --chapter 3          # Por número de capítulo

/search [term]         # Buscar texto no livro
  --global / -g        # Busca global (todos os capítulos)
```

Use `n` / `N` após `/search` para ciclar entre os resultados.

Use `[` / `]` para navegar no histórico (back/forward).

### Bookmarks

```bash
/mark [label]          # Criar bookmark na posição atual
/marks                 # Abrir overlay de bookmarks
/delmark <id-or-label> # Remover bookmark por ID ou label
```

A tecla `B` abre o overlay de bookmarks. Dentro dele, `Enter` navega para o bookmark e `d` o remove.

### Livros

```bash
/changebook [query]    # Trocar para outro livro
  --recent             # Listar apenas lidos recentemente
  --cwd                # Buscar apenas na pasta atual
  --sort               # Abrir picker com ordenação

/resume [book-query]   # Retomar um livro específico
  --latest             # Retomar o último lido

/add [path]            # Importar um EPUB, CBZ ou PDF; ou abrir o picker
  --cwd                # Procurar arquivos na pasta atual
  --force              # Reimportar mesmo que já exista

/remove [book-query]   # Remover livro da biblioteca
  --current            # Remover o livro atual

/removecurrent         # Remover apenas o livro em leitura
```

### Tags e Notas

```bash
/tag [tag]             # Adicionar tag ao livro atual; sem argumento lista as tags
  -d <tag>             # Remover tag

/tags                  # Listar tags do livro atual (alias de /tag)

/note <text>           # Adicionar nota na posição atual
  -l                   # Abrir overlay de notas
  -d <id>              # Deletar nota por ID
```

Tags aparecem na biblioteca ao lado do progresso. Filtre por tag usando `/changebook <tag>`.

### Export / Import

```bash
/export [path]         # Exportar posições, bookmarks, notas e tags para JSON
/import [path]         # Importar estado de leitura de um arquivo JSON
```

O arquivo exportado é indexado por `importHash` — sem dependência de caminho, ideal para sincronizar leitura entre máquinas.

### Visualização

```bash
/mode <mode>           # Trocar modo de renderização
  plain | typescript | python | rust

/density [level]       # Controlar densidade do código stealth (1–5)
  1 = mais comentários, 5 = código puro

/colorscheme [scheme]  # Mudar colorscheme
  --list               # Listar colorschemes disponíveis
  --preview            # Flag aceita por compatibilidade

/theme [theme]         # Mudar tema de aparência
  dark | light | dark-colorblind | light-colorblind | dark-ansi | light-ansi
  --list               # Listar temas disponíveis

/highlight             # Ativar destaque de diálogos no modo plain
  --on                 # Ativar
  --off                # Desativar

/toggleprogress [mode] # Controlar barra de progresso
  book | both | chapter | hidden

/settings              # Abrir painel pesquisável de configurações do leitor
                       # Space altera, Enter salva, / pesquisa, Esc cancela
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
- `/keys` → `/keyboardshortcuts`
- `/config` → `/settings`
- `/tags` → `/tag`

### Modo Foco

Pressione `f` para entrar no modo foco: a tela exibe um único bloco de conteúdo centralizado, sem distrações. Use `j`/`k` ou as setas para avançar/recuar bloco a bloco. Ao sair do modo foco, a posição equivalente é preservada no scroll normal.

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
  executor.ts        # Execução dos slash commands
  renderers.ts       # Dispatcher de renderização (plain vs código)
  focus.ts           # Lógica do modo foco (bloco único centralizado)
  themes.ts          # Colorschemes e temas de aparência pré-definidos
  help.ts            # Definições de atalhos de teclado
  color.ts           # Utilitários de formatação ANSI
  storage.ts         # Abstração SQLite com WAL (XDG dirs)
  paths.ts           # Resolução de caminhos XDG
  discovery.ts       # Auto-detecção de EPUBs/CBZ/PDF no CWD
  screen.ts          # Gerenciamento da tela do terminal
  input.ts           # Gerenciamento de input do teclado
  
  renderers/
    typescript.ts    # Renderizador TypeScript (12 padrões contextuais)
    python.ts        # Renderizador Python
    rust.ts          # Renderizador Rust
    shared.ts        # Utilitários compartilhados entre renderizadores

  parser/
    epub.ts          # Pipeline de import EPUB (JSZip + validação)
    cbz.ts           # Parser CBZ (quadrinhos em ZIP)
    pdf.ts           # Parser PDF
    html.ts          # Extração de blocos de HTML (parse5)
    xml.ts           # Utilitários de parsing XML
    index.ts         # Dispatcher de parsers por tipo de arquivo
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

- `**$XDG_DATA_HOME/cli-stealth-reader/**`: Banco de dados SQLite (WAL mode)
  - Tabelas: `books`, `chapters`, `positions`, `diagnostics`, `settings`, `command_history`, `bookmarks`, `book_tags`, `notes`
- `**$XDG_CACHE_HOME/cli-stealth-reader/**`: Cache de JSON de livros

EPUBs, CBZs e PDFs encontrados no diretório atual são automaticamente oferecidos na tela inicial e em `/add --cwd`.

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

`**CanonicalBlock**` — Unidade básica de conteúdo:

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

`**CanonicalChapter**` — Capítulo com metadados:

```typescript
{
  title: string
  href: string
  blocks: CanonicalBlock[]
  wordCount: number
}
```

`**CanonicalBook**` — Livro completo:

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
- Comandos suportam aliases (ex: `/book` é alias para `/changebook`)
- Argumentos entre aspas são interpretados literalmente (ex: `/add "Meu Livro.epub"`)
- A barra de progresso é customizável (`book`, `both`, `chapter`, `hidden`)
- Remoção de livro apaga apenas a entrada da biblioteca — o arquivo original não é deletado
- Posição de leitura é persistida por livro automaticamente
- Modos stealth (TypeScript, Python, Rust) são persistidos via `settings`; a tecla `m` cicla entre eles
- A densidade do código stealth (1–5) é persistida via `settings`; a tecla `d` cicla entre 1→3→5
- O modo foco preserva a posição equivalente ao retornar ao scroll normal
- Export/import usa `importHash` como chave, sem dependência de caminho do arquivo no sistema
- Tags são case-insensitive no banco (LOWER); notas são indexadas por `book_id`
- Histórico de navegação (back/forward) é mantido apenas em memória (não persistido)

## Contribuição

Contribuições são bem-vindas! Siga o estilo de código existente e rode os testes antes de abrir um PR.

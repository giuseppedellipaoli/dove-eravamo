# Dove eravamo?

**Riprendi un progetto lasciato a metà senza rileggere tutto.**

Un piccolo plugin Codex che usa un checkpoint Markdown e lo stato Git locale per indicare dove eri arrivato, cosa è cambiato, cosa blocca il lavoro e da quale azione concreta ripartire.

[English](README.md) · [Licenza MIT](LICENSE)

```text
$dove-eravamo riprendi questo progetto e mostrami il prossimo passo.
```

Legge il checkpoint che mantieni nel progetto. Non recupera vecchie chat e non deduce le tue intenzioni dai messaggi dei commit. Senza checkpoint, riporta i dati Git disponibili e segnala il contesto mancante.

## Provalo in 30 secondi

Serve **Node.js 20 o successivo**. Git è facoltativo. Non ci sono dipendenze npm da installare.

Dalla radice di questo repository:

```sh
node skills/dove-eravamo/scripts/project-context.mjs start --root examples/tiny-project
```

L'esempio fittizio descrive una piccola lista di letture senza codice ancora scritto. Il prossimo passo è decidere come gestire i link duplicati e scrivere un esempio di accettazione. Puoi leggere il [checkpoint](examples/tiny-project/STATUS.md) e il [compito attivo](examples/tiny-project/docs/next-step.md).

## Installazione in Codex

Installa direttamente da GitHub con una versione recente di Codex CLI:

~~~sh
codex plugin marketplace add giuseppedellipaoli/dove-eravamo --ref main
codex plugin add dove-eravamo@dove-eravamo-local
~~~

Se hai già clonato questo repository, puoi registrare la copia locale:

```sh
codex plugin marketplace add .
codex plugin add dove-eravamo@dove-eravamo-local
```

Riavvia l'app desktop e apri una nuova chat. Dopo la registrazione puoi trovare il plugin anche nel marketplace locale della directory dei plugin. Il file incluso `.agents/plugins/marketplace.json` punta alla radice del repository. La disponibilità varia tra client. [Guida ufficiale](https://developers.openai.com/plugins/build/plugins).

**Skill autonoma:** copia l'intera cartella `skills/dove-eravamo` in `~/.agents/skills/dove-eravamo` per usarla nei tuoi progetti, oppure in `<tuo-progetto>/.agents/skills/dove-eravamo` per un solo progetto. Se non compare, riavvia Codex. Scegli una sola modalità di installazione. [Percorsi delle skill](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills).

Poi apri il progetto da riprendere e scrivi:

```text
$dove-eravamo dove eravamo rimasti? Leggi il checkpoint e controlla lo stato del repository.
```

Il plugin richiede accesso ai file locali e ai comandi. Pubblicare questo repository su GitHub non installa automaticamente il plugin e non lo pubblica nella directory pubblica dei plugin.

## Prepara il checkpoint del progetto

Mantieni un breve `STATUS.md` nella radice del progetto con obiettivo, ultimo risultato verificato, attività in corso, blocchi o decisioni aperte e prossima azione. Aggiornalo quando interrompi il lavoro per lasciare un punto di ripresa attendibile.

Puoi creare un modello con questo comando dalla cartella del plugin, sostituendo il percorso d'esempio:

```sh
node skills/dove-eravamo/scripts/project-context.mjs init --root /percorso/del/tuo-progetto
```

`init` crea soltanto il file del checkpoint (`STATUS.md` come valore predefinito) e rifiuta di sovrascrivere un file esistente. Con `--status`, la cartella di destinazione deve già esistere. Non compila al posto tuo le informazioni sul progetto.

Basta un normale documento Markdown. Se il file contiene anche lo storico, puoi delimitare il contesto corrente:

```md
<!-- CURRENT_CONTEXT_START -->
## Ultimo risultato
Descrivi l'ultimo risultato verificato.

## Prossima azione
Scrivi la prima azione concreta.

<!-- ACTIVE_STEP: docs/next-step.md -->
<!-- CURRENT_CONTEXT_END -->
```

`ACTIVE_STEP` è facoltativo e indica un documento Markdown con percorso relativo alla radice del progetto. Senza i marcatori del contesto, lo script legge l'intero checkpoint. Per usare un altro file, aggiungi `--status notes/STATUS.md`.

## Comandi disponibili

Questi esempi vanno eseguiti dalla cartella del plugin:

```sh
node skills/dove-eravamo/scripts/project-context.mjs start --root /percorso/progetto
node skills/dove-eravamo/scripts/project-context.mjs current --root /percorso/progetto
node skills/dove-eravamo/scripts/project-context.mjs headings docs/next-step.md --root /percorso/progetto
node skills/dove-eravamo/scripts/project-context.mjs section docs/next-step.md "Acceptance criteria" --root /percorso/progetto
node skills/dove-eravamo/scripts/project-context.mjs lines STATUS.md 1 20 --root /percorso/progetto
```

| Comando | Risultato |
| --- | --- |
| `start` | `AGENTS.md` della radice se presente, checkpoint, eventuale documento attivo e riepilogo Git locale. |
| `current` | Solo il contesto corrente del checkpoint. |
| `headings <file.md>` | Titoli Markdown per scegliere una sezione. |
| `section <file.md> <titolo>` | Un titolo con la sua sezione. |
| `lines <file.md> <prima> <quantità>` | Estratto numerato; le righe partono da 1. |
| `init` | Un modello di checkpoint, se il file non esiste (`STATUS.md` predefinito). |

`--root` usa la cartella corrente come valore predefinito. `--status` usa `STATUS.md`. I documenti devono restare nel progetto selezionato e non superare 2 MiB. Un risultato troppo grande genera un errore esplicito: il contesto non viene tagliato in silenzio. I comandi per singole sezioni o righe consentono letture più mirate.

## Dati locali e limiti

Lo script non effettua richieste di rete e non raccoglie telemetria. Il riepilogo Git legge branch, HEAD e stato dei file tracciati e non tracciati; non esegue fetch o push, non legge gli URL dei remote e non analizza i messaggi dei commit. Il riepilogo esclude i submodule e mostra al massimo 30 voci, indicando quante altre sono presenti. Lo stato dei file viene saltato se sono attivi filtri clean/process sui file tracciati o se la loro verifica in sola lettura fallisce; questi filtri non vengono mai eseguiti. I comandi di lettura non modificano file del progetto. Solo `init` scrive un file.

Usando la skill, il testo selezionato entra nel contesto Codex. Non inserire credenziali nei checkpoint. Un checkpoint può diventare vecchio: la skill deve segnalare eventuali differenze tra il lavoro registrato e lo stato attuale. Funziona anche senza Git; senza checkpoint, dispone di meno contesto.

## Sviluppo

Esegui i test integrati di Node.js:

```sh
node --test
```

Non servono una build o un'installazione di pacchetti. La matrice CI è configurata per Windows, macOS e Linux con Node.js 20 e 24. Sono benvenuti piccoli miglioramenti accompagnati da un esempio riproducibile. Le [note di origine](docs/ORIGIN.md) raccontano l'estrazione da uno script privato usato nello sviluppo di un gioco.

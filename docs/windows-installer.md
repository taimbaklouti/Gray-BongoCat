# Mémo — Déploiement installeur Windows (Tauri + GitHub Actions)

> Procédure éprouvée sur ce projet. Directement réutilisable pour nos futurs projets Tauri.

## 1. Config Tauri (Windows / NSIS)

- **Désactiver les artefacts updater** (fork sans clé de signature) dans
  `src-tauri/tauri.windows.conf.json`, pas en CLI :
  ```json
  {
    "identifier": "com.example.MonApp",
    "bundle": {
      "createUpdaterArtifacts": false,
      "windows": {
        "nsis": {
          "installMode": "currentUser"
        }
      }
    }
  }
  ```
  → Le fichier plateforme est **auto-fusionné** au build Windows (JSON Merge Patch,
  le fichier plateforme gagne). macOS/Linux gardent leurs artefacts updater.
- **Jamais de `--config '{...}'` inline sous PowerShell** : `pwsh` mange les quotes
  simples (`error: ... key must be a string`) et les `\"` échappés cassent autrement.
  Commande simple uniquement :
  ```yaml
  run: pnpm tauri build --target x86_64-pc-windows-msvc
  ```
- Rappels NSIS :
  - `installMode: currentUser` = pas d'UAC, clés registre HKCU, dossier
    `%LOCALAPPDATA%`. Cohérent avec l'autostart (HKCU) et l'updater sans élévation.
  - La page de choix du dossier s'affiche toujours (aucune option Tauri v2 pour
    la retirer ; `deny_unknown_fields` rejetterait un champ inconnu).
  - Raccourci Menu Démarrer auto ; Bureau via la case de fin d'installation.
  - Si une ancienne install **per-machine** existe : la faire désinstaller d'abord,
    sinon deux installs côte à côte.

## 2. Workflow `build-windows.yml` — bonnes pratiques

```yaml
on: {workflow_dispatch:} # déclencheur manuel : Actions → Run workflow
```

| Étape  | Reco                                                                                                                                                          |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pnpm   | `pnpm/action-setup@v4` **avant** `setup-node`, `version` épinglée (ex. `10`, assortie au lockfile v9), `run_install: false` ; `setup-node` avec `cache: pnpm` |
| Rust   | `rustup target add <triplet>` explicite, même si préinstallé sur l'image                                                                                      |
| Cache  | `swatinem/rust-cache@v2` en auto-détection (ne pas pointer `workspaces: target`)                                                                              |
| Upload | `actions/upload-artifact@v4`, chemin **récursif depuis la racine du workspace Cargo** (voir piège n°1)                                                        |

```yaml
- name: Upload installer artifact
  uses: actions/upload-artifact@v4
  with:
    name: MonApp-windows-x64-installer
    path: '**/target/**/*.exe'
    if-no-files-found: warn # warn, pas error : un chemin qui bouge ne doit pas rougir le job
```

> **Piège n°1 — emplacement du dossier `target/`** : si un `Cargo.toml` `[workspace]`
> existe à la racine du repo, le dossier de build est `<repo>/target/`, **jamais**
> `src-tauri/target/`. Vérifiable en local : un `cargo check` crée `target/debug/`
> à la racine. Une fois le chemin stabilisé (ex.
> `target/x86_64-pc-windows-msvc/release/bundle/nsis/*.exe`), on peut resserrer
> le `path` et repasser `if-no-files-found: error`.
>
> **Astuce debug** : step `if: always()` avec garde `Test-Path` qui liste les `.exe`
> même si le build a échoué (ne plante jamais) :
>
> ```powershell
> foreach ($dir in @('target', 'src-tauri/target')) {
>   if (Test-Path $dir) {
>     Get-ChildItem -Path $dir -Recurse -Filter *.exe | Select-Object FullName
>   } else {
>     Write-Host "no dir: $dir"
>   }
> }
> ```

Exemple complet (ce projet) :

```yaml
jobs:
  build-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: {version: 10, run_install: false}
      - uses: actions/setup-node@v4
        with: {node-version: 20, cache: pnpm}
      - uses: dtolnay/rust-toolchain@stable
      - run: rustup target add x86_64-pc-windows-msvc
      - uses: swatinem/rust-cache@v2
      - run: pnpm install --frozen-lockfile
      - run: pnpm tauri build --target x86_64-pc-windows-msvc
      - uses: actions/upload-artifact@v4
        with:
          name: MonApp-windows-x64-installer
          path: '**/target/**/*.exe'
          if-no-files-found: warn
```

## 3. Checklist avant chaque build

- [ ] `git push origin master` fait (le workflow ne voit que ce qui est poussé ;
      ce poste n'a pas d'accès GitHub → pousser depuis une machine authentifiée)
- [ ] `pnpm install --frozen-lockfile` passe en local (lockfile en sync ; sinon
      régénérer le lockfile plutôt que `--no-frozen-lockfile`)
- [ ] Lancer : Actions → _Build Windows Installer_ → Run workflow → attendre
      15 à 40 min (build release + LTO, c'est normal)
- [ ] Artefact téléchargé : `*_x64-setup.exe` présent (chemin canonique :
      `target/<triplet>/release/bundle/nsis/`)
- [ ] Envoi : **zipper** l'exe (Drive bloque parfois les `.exe` bruts ; WeTransfer
      les accepte), prévenir le destinataire du **SmartScreen** (binaire non signé →
      « Informations complémentaires › Exécuter quand même »)
- [ ] Pré-requis destinataire : Windows 10/11 x64 + WebView2 (préinstallé par défaut)

## 4. Erreurs déjà rencontrées (pense-bête)

| Erreur                                      | Cause                                                                              | Fix                                                    |
| ------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `pnpm install` rouge en CI                  | `pnpm/action-setup@v3` + `version: latest` flottant, mauvais ordre setup-node/pnpm | v4 épinglé + pnpm d'abord + `cache: pnpm`              |
| `key must be a string`                      | `--config '{...}'` mangé par PowerShell                                            | Config dans `tauri.windows.conf.json`, commande simple |
| `invalid value '{\' for '--config'`         | `\"` échappés sous PowerShell                                                      | Idem : pas de JSON inline                              |
| `No files were found ... bundle/nsis/*.exe` | Build atterrit dans `<repo>/target/`, pas `src-tauri/target/`                      | `**/target/**/*.exe` + step de localisation            |
| Commit rejeté par commitlint                | Sujet en majuscule (`subject-case`)                                                | Sujet en minuscules, ex. `fix: ...`                    |
| Push impossible depuis ce poste             | Aucun credential GitHub (`could not read Username`)                                | Pousser depuis une machine authentifiée                |

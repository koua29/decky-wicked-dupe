import { ButtonItem, Navigation, PanelSection, PanelSectionRow, staticClasses } from "@decky/ui";
import { callable, definePlugin, toaster } from "@decky/api";
import { useEffect, useState } from "react";
import { GiChest } from "react-icons/gi";

interface State {
  found: boolean;
  searched: string[];
  build: string;
  realm_files: number;
  game_running: boolean;
  snapshot_time: number;
  snapshot_files: number;
  undo_time: number;
}

interface Update {
  current: string;
  latest?: string;
  available?: boolean;
  zip_url?: string;
  zip_sha256?: string;
  error?: string;
}

interface Result {
  ok: boolean;
  code: string;
}

const getState = callable<[], State>("get_state");
const snapshot = callable<[], Result>("snapshot");
const restore = callable<[], Result>("restore");
const undo = callable<[], Result>("undo");
const checkUpdate = callable<[], Update>("check_update");

const PLUGIN_NAME = "Wicked Dupe";
const INSTALL_TYPE_UPDATE = 2; // InstallType.UPDATE in Decky Loader

const locale = String((window as any).LocalizationManager?.m_rgLocalesToUse?.[0] || navigator.language || "en");
const fr = locale.toLowerCase().startsWith("fr");

const T = fr
  ? {
      status: "État",
      noSave: "Sauvegarde du jeu introuvable : lance le jeu une fois.",
      save: (build: string, n: number) => `Build ${build} · ${n} fichiers realm`,
      running: "Jeu lancé",
      noSnapshot: "Aucune copie du realm",
      snapshotAt: (d: string) => `Copie du realm : ${d}`,
      steps: "Méthode",
      step1: "1. Steam hors ligne, puis lance le jeu.",
      step2: "2. Mets les objets dans un coffre du monde.",
      step3: "3. Sauvegarder le realm.",
      step4: "4. Reprends les objets dans ton sac, puis quitte au menu principal.",
      step5: "5. Restaurer le realm, puis Continuer : les objets sont aussi dans le coffre.",
      step6: "Retour en ligne : au lancement, choisis la sauvegarde LOCALE.",
      snapshotBtn: "Sauvegarder le realm",
      restoreBtn: "Restaurer le realm",
      undoBtn: "Annuler la dernière restauration",
      refreshBtn: "Actualiser",
      updates: "Mises à jour",
      version: (v: string) => `Version ${v}`,
      checkBtn: "Vérifier les mises à jour",
      updateBtn: (v: string) => `Mettre à jour vers ${v}`,
      upToDate: "Le plugin est à jour.",
      updateFound: (v: string) => `Version ${v} disponible.`,
      updateError: "GitHub injoignable.",
      updated: "Mise à jour installée : rouvre Wicked Dupe.",
      searched: "Cherché dans :",
      msg: {
        saved: "Realm sauvegardé.",
        restored: "Realm restauré. Clique sur Continuer.",
        undone: "Realm d'avant la restauration remis.",
        no_save: "Sauvegarde du jeu introuvable.",
        no_snapshot: "Sauvegarde d'abord le realm.",
        no_undo: "Rien à annuler.",
      } as Record<string, string>,
    }
  : {
      status: "Status",
      noSave: "Game save not found: start the game once.",
      save: (build: string, n: number) => `Build ${build} · ${n} realm files`,
      running: "Game running",
      noSnapshot: "No realm copy yet",
      snapshotAt: (d: string) => `Realm copy: ${d}`,
      steps: "How to",
      step1: "1. Set Steam offline, then start the game.",
      step2: "2. Put the items in a chest in the world.",
      step3: "3. Save the realm.",
      step4: "4. Take the items back into your bag, then quit to the main menu.",
      step5: "5. Restore the realm, then Continue: the items are in the chest too.",
      step6: "Back online: at launch, pick the LOCAL save.",
      snapshotBtn: "Save the realm",
      restoreBtn: "Restore the realm",
      undoBtn: "Undo the last restore",
      refreshBtn: "Refresh",
      updates: "Updates",
      version: (v: string) => `Version ${v}`,
      checkBtn: "Check for updates",
      updateBtn: (v: string) => `Update to ${v}`,
      upToDate: "The plugin is up to date.",
      updateFound: (v: string) => `Version ${v} is available.`,
      updateError: "Could not reach GitHub.",
      updated: "Update installed: reopen Wicked Dupe.",
      searched: "Searched in:",
      msg: {
        saved: "Realm saved.",
        restored: "Realm restored. Click Continue.",
        undone: "Realm from before the restore put back.",
        no_save: "Game save not found.",
        no_snapshot: "Save the realm first.",
        no_undo: "Nothing to undo.",
      } as Record<string, string>,
    };

const muted = { fontSize: "12px", lineHeight: "16px", opacity: 0.7 };

function when(ts: number) {
  return new Date(ts * 1000).toLocaleString(fr ? "fr-FR" : "en-US", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function installUpdate(update: Update) {
  // Same call as Decky's own store: Decky asks for confirmation, checks the
  // SHA-256 of the zip, then installs the new build.
  const backend = (window as any).DeckyBackend;
  if (!backend?.call) return;
  await backend.call(
    "utilities/install_plugin",
    update.zip_url,
    PLUGIN_NAME,
    update.latest,
    update.zip_sha256,
    INSTALL_TYPE_UPDATE,
  );
  // The panel stays mounted on the old code: reload it, then close the menu.
  const loader = (window as any).DeckyPluginLoader;
  try {
    await (loader?.importPlugin?.(PLUGIN_NAME, update.latest) ?? loader?.loadPlugin?.(PLUGIN_NAME) ?? Promise.resolve());
  } catch (e) {
    console.error("[Wicked Dupe] plugin reload failed", e);
  }
  toaster.toast({ title: "Wicked Dupe", body: T.updated });
  Navigation.CloseSideMenus();
}

function Content() {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [update, setUpdate] = useState<Update | null>(null);

  const check = async (manual: boolean) => {
    const res = await checkUpdate();
    setUpdate(res);
    if (manual) {
      const body = res.error ? T.updateError : res.available ? T.updateFound(res.latest!) : T.upToDate;
      toaster.toast({ title: "Wicked Dupe", body });
    }
  };

  const load = async () => setState(await getState());
  useEffect(() => {
    load();
    check(false);
    // The panel can stay mounted while the game writes its save: keep the status fresh.
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, []);

  const run = async (action: () => Promise<Result>) => {
    setBusy(true);
    try {
      const res = await action();
      toaster.toast({ title: "Wicked Dupe", body: T.msg[res.code] || res.code });
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PanelSection title={T.status}>
        <PanelSectionRow>
          <div style={muted}>
            {!state ? "…" : state.found ? T.save(state.build, state.realm_files) : T.noSave}
            {state?.game_running && <div>{T.running}</div>}
            <div>{state?.snapshot_files ? T.snapshotAt(when(state.snapshot_time)) : T.noSnapshot}</div>
            {state && !state.found && (
              <div style={{ marginTop: "6px", wordBreak: "break-all" }}>
                {T.searched} {state.searched.join(", ") || "—"}
              </div>
            )}
          </div>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" disabled={busy || !state?.found} onClick={() => run(snapshot)}>
            {T.snapshotBtn}
          </ButtonItem>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            disabled={busy || !state?.found || !state?.snapshot_files}
            onClick={() => run(restore)}
          >
            {T.restoreBtn}
          </ButtonItem>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" disabled={busy} onClick={load}>
            {T.refreshBtn}
          </ButtonItem>
        </PanelSectionRow>
        {!!state?.undo_time && (
          <PanelSectionRow>
            <ButtonItem layout="below" disabled={busy} onClick={() => run(undo)}>
              {T.undoBtn}
            </ButtonItem>
          </PanelSectionRow>
        )}
      </PanelSection>
      <PanelSection title={T.updates}>
        {update?.available && (
          <PanelSectionRow>
            <ButtonItem layout="below" onClick={() => installUpdate(update)}>
              {T.updateBtn(update.latest!)}
            </ButtonItem>
          </PanelSectionRow>
        )}
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={() => check(true)}>
            {T.checkBtn}
          </ButtonItem>
        </PanelSectionRow>
        <PanelSectionRow>
          <div style={muted}>{T.version(update?.current || "…")}</div>
        </PanelSectionRow>
      </PanelSection>
      <PanelSection title={T.steps}>
        <PanelSectionRow>
          <div style={muted}>
            {[T.step1, T.step2, T.step3, T.step4, T.step5].map((s) => (
              <div key={s} style={{ marginBottom: "4px" }}>{s}</div>
            ))}
            <div style={{ marginTop: "6px" }}>{T.step6}</div>
          </div>
        </PanelSectionRow>
      </PanelSection>
    </>
  );
}

export default definePlugin(() => ({
  name: "Wicked Dupe",
  titleView: <div className={staticClasses.Title}>Wicked Dupe</div>,
  content: <Content />,
  icon: <GiChest />,
}));

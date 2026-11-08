import { ButtonItem, PanelSection, PanelSectionRow, staticClasses } from "@decky/ui";
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

interface Result {
  ok: boolean;
  code: string;
}

const getState = callable<[], State>("get_state");
const snapshot = callable<[], Result>("snapshot");
const restore = callable<[], Result>("restore");
const undo = callable<[], Result>("undo");

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

function Content() {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => setState(await getState());
  useEffect(() => {
    load();
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

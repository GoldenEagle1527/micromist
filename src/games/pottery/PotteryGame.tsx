import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import "./pottery.css";
import { useLocale } from "../../i18n";
import { clearLocalProgress, useLocalGamePersist } from "../local-persist";
import {
  deletePiece,
  loadCollection,
  POTTERY_SLUG,
  savePiece,
} from "./collection";
import {
  cloneProfile,
  createProfile,
  isValidProfile,
  newPieceId,
  normalizeClaySize,
  normalizeToolId,
  popProfileUndo,
  pushProfileUndo,
  type ClaySize,
  type Piece,
  type ToolId,
} from "./engine";
import { PotteryStudio, PotteryThumb, type PotteryStudioHandle } from "./PotteryStudio";

type Screen = "setup" | "studio" | "name" | "collection" | "detail";

type PotteryPersist = {
  screen: "studio";
  claySize: ClaySize;
  profile: number[];
  tool: ToolId;
};

const FIRE_MS = 1000;

function clayLabel(
  t: ReturnType<typeof useLocale>["t"]["pottery"],
  size: ClaySize,
): string {
  if (size === "small") return t.claySmall;
  if (size === "medium") return t.clayMedium;
  return t.clayLarge;
}

export function PotteryGame() {
  const { t } = useLocale();
  const pt = t.pottery;

  const [screen, setScreen] = useState<Screen>("setup");
  const [claySize, setClaySize] = useState<ClaySize>("medium");
  const [profile, setProfile] = useState<number[]>(() => createProfile("medium"));
  const [tool, setTool] = useState<ToolId>("hand");
  const [undo, setUndo] = useState<number[][]>([]);
  const [resume, setResume] = useState<PotteryPersist | null>(null);
  const [firing, setFiring] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [thumb, setThumb] = useState("");
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [active, setActive] = useState<Piece | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const studioRef = useRef<PotteryStudioHandle | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const fireTimerRef = useRef<number | null>(null);
  const confirmTitleId = useId();
  const nameTitleId = useId();

  const persistState: PotteryPersist | null =
    (screen === "studio" || screen === "name" || firing) && profile.length > 0
      ? { screen: "studio", claySize, profile, tool }
      : null;

  const persistEnabled = screen === "studio" || screen === "name" || firing;

  useLocalGamePersist<PotteryPersist>(POTTERY_SLUG, persistState, {
    enabled: persistEnabled,
    shouldSave: (s) => s.screen === "studio" && isValidProfile(s.profile),
    onHydrate: (data) => {
      const size = normalizeClaySize(data.claySize);
      const nextTool = normalizeToolId(data.tool) ?? "hand";
      if (size == null || !isValidProfile(data.profile)) return;
      setResume({
        screen: "studio",
        claySize: size,
        profile: cloneProfile(data.profile),
        tool: nextTool,
      });
    },
  });


  useEffect(() => {
    if (screen !== "name") return;
    nameInputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setScreen("studio");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [screen]);

  useEffect(() => {
    if (!confirmDelete) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfirmDelete(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [confirmDelete]);

  useEffect(() => {
    return () => {
      if (fireTimerRef.current != null) window.clearTimeout(fireTimerRef.current);
    };
  }, []);

  const refreshCollection = useCallback(() => {
    setPieces(loadCollection());
  }, []);

  const beginStudio = useCallback(
    (next: { size: ClaySize; profile: number[]; tool: ToolId }) => {
      setClaySize(next.size);
      setProfile(cloneProfile(next.profile));
      setTool(next.tool);
      setUndo([]);
      setFiring(false);
      setDraftName("");
      setThumb("");
      setActive(null);
      setScreen("studio");
    },
    [],
  );

  const startNew = useCallback(() => {
    clearLocalProgress(POTTERY_SLUG);
    setResume(null);
    beginStudio({
      size: claySize,
      profile: createProfile(claySize),
      tool: "hand",
    });
  }, [beginStudio, claySize]);

  const continueRun = useCallback(() => {
    if (!resume) return;
    beginStudio({
      size: resume.claySize,
      profile: resume.profile,
      tool: resume.tool,
    });
  }, [beginStudio, resume]);

  const openCollection = useCallback(() => {
    refreshCollection();
    setActive(null);
    setConfirmDelete(false);
    setScreen("collection");
  }, [refreshCollection]);

  const onGestureStart = useCallback(() => {
    setUndo((stack) => pushProfileUndo(stack, profile));
  }, [profile]);

  const doUndo = useCallback(() => {
    const popped = popProfileUndo(undo);
    if (!popped.profile) return;
    setUndo(popped.stack);
    setProfile(popped.profile);
  }, [undo]);

  const startFire = useCallback(() => {
    if (firing) return;
    const shot = studioRef.current?.captureThumb() ?? "";
    setThumb(shot);
    setFiring(true);
    fireTimerRef.current = window.setTimeout(() => {
      fireTimerRef.current = null;
      setFiring(false);
      setDraftName("");
      setScreen("name");
    }, FIRE_MS);
  }, [firing]);

  const confirmName = useCallback(() => {
    const name = draftName.trim() || pt.unnamed;
    const piece: Piece = {
      id: newPieceId(),
      name,
      firedAt: Date.now(),
      claySize,
      version: 1,
      profile: cloneProfile(profile),
    };
    if (thumb) piece.thumbDataUrl = thumb;
    savePiece(piece);
    clearLocalProgress(POTTERY_SLUG);
    setResume(null);
    setActive(piece);
    refreshCollection();
    setScreen("detail");
  }, [claySize, draftName, profile, pt.unnamed, refreshCollection, thumb]);

  const openPiece = useCallback((piece: Piece) => {
    setActive(piece);
    setConfirmDelete(false);
    setScreen("detail");
  }, []);

  const doDelete = useCallback(() => {
    if (!active) return;
    deletePiece(active.id);
    setActive(null);
    setConfirmDelete(false);
    refreshCollection();
    setScreen("collection");
  }, [active, refreshCollection]);

  const toolHint = useMemo(() => {
    if (tool === "hand") return pt.toolHintHand;
    if (tool === "sponge") return pt.toolHintSponge;
    return pt.toolHintWire;
  }, [pt, tool]);

  if (screen === "setup") {
    return (
      <div className="pottery pottery-setup">
        <div className="panel">
          <h2>{pt.setupTitle}</h2>
          <p className="hint" style={{ marginTop: 0 }}>
            {pt.setupHint}
          </p>
          <div className="pottery-controls">
            <p className="pottery-field-label">{pt.claySize}</p>
            <div className="pottery-size-row" role="group" aria-label={pt.claySize}>
              {(["small", "medium", "large"] as const).map((size) => (
                <button
                  key={size}
                  type="button"
                  className={`pottery-chip ${claySize === size ? "primary" : "ghost"}`}
                  onClick={() => setClaySize(size)}
                >
                  {clayLabel(pt, size)}
                </button>
              ))}
            </div>
            <p className="hint pottery-preset-blurb">{pt.clayBlurb(clayLabel(pt, claySize))}</p>
          </div>
          <div className="row">
            <button type="button" className="primary" onClick={startNew}>
              {pt.startStudio}
            </button>
            {resume ? (
              <button type="button" className="ghost" onClick={continueRun}>
                {pt.continueRun}
              </button>
            ) : null}
            <button type="button" className="ghost" onClick={openCollection}>
              {pt.openCollection}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (screen === "collection") {
    return (
      <div className="pottery pottery-collection">
        <div className="pottery-hud">
          <h2 className="pottery-screen-title">{pt.collectionTitle}</h2>
          <p className="hint">{pt.pieceCount(pieces.length)}</p>
        </div>
        {pieces.length === 0 ? (
          <p className="hint pottery-empty">{pt.collectionEmpty}</p>
        ) : (
          <ul className="pottery-grid">
            {pieces.map((piece) => (
              <li key={piece.id}>
                <button
                  type="button"
                  className="pottery-card"
                  onClick={() => openPiece(piece)}
                >
                  {piece.thumbDataUrl ? (
                    <img src={piece.thumbDataUrl} alt="" className="pottery-thumb" />
                  ) : (
                    <PotteryThumb profile={piece.profile} />
                  )}
                  <span className="pottery-card-name">{piece.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="pottery-actions">
          <button type="button" className="ghost" onClick={() => setScreen("setup")}>
            {pt.collectionBack}
          </button>
        </div>
      </div>
    );
  }

  if (screen === "detail" && active) {
    return (
      <div className="pottery pottery-detail">
        <div className="pottery-hud">
          <h2 className="pottery-screen-title">{active.name}</h2>
          <p className="hint">
            {pt.firedAt(active.firedAt)} ·{" "}
            {pt.claySizeLabel(clayLabel(pt, active.claySize))}
          </p>
        </div>
        <PotteryStudio
          profile={active.profile}
          tool="hand"
          spinning
          readOnly
          ariaLabel={pt.studioAria}
        />
        <div className="pottery-actions">
          <button type="button" className="ghost" onClick={openCollection}>
            {pt.detailBack}
          </button>
          <button type="button" className="ghost" onClick={() => setConfirmDelete(true)}>
            {pt.deletePiece}
          </button>
        </div>
        {confirmDelete ? (
          <div
            className="modal-backdrop"
            role="presentation"
            onClick={() => setConfirmDelete(false)}
          >
            <div
              className="modal-panel"
              role="dialog"
              aria-modal="true"
              aria-labelledby={confirmTitleId}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="modal-header">
                <h2 id={confirmTitleId}>{pt.deleteConfirmTitle}</h2>
              </div>
              <p className="lede modal-body">{pt.deleteConfirmBody}</p>
              <div className="modal-actions">
                <button type="button" className="ghost" onClick={() => setConfirmDelete(false)}>
                  {pt.deleteCancel}
                </button>
                <button type="button" className="primary" onClick={doDelete}>
                  {pt.deleteConfirmOk}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  if (screen === "name") {
    return (
      <div className="pottery pottery-name">
        <PotteryStudio
          profile={profile}
          tool={tool}
          spinning
          readOnly
          ariaLabel={pt.studioAria}
        />
        <div
          className="modal-backdrop pottery-name-backdrop"
          role="presentation"
        >
          <div
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby={nameTitleId}
          >
            <div className="modal-header">
              <h2 id={nameTitleId}>{pt.nameTitle}</h2>
            </div>
            <p className="lede modal-body">{pt.nameHint}</p>
            <label className="pottery-name-field">
              <span className="visually-hidden">{pt.namePlaceholder}</span>
              <input
                ref={nameInputRef}
                type="text"
                value={draftName}
                maxLength={40}
                placeholder={pt.namePlaceholder}
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") confirmName();
                }}
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="ghost" onClick={() => setScreen("studio")}>
                {pt.nameCancel}
              </button>
              <button type="button" className="primary" onClick={confirmName}>
                {pt.nameConfirm}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`pottery pottery-studio${firing ? " pottery-firing" : ""}`}>
      <PotteryStudio
        ref={studioRef}
        profile={profile}
        tool={tool}
        spinning
        readOnly={firing}
        onProfileChange={setProfile}
        onGestureStart={onGestureStart}
        ariaLabel={pt.studioAria}
      />
      <p className="hint pottery-tool-hint">{toolHint}</p>
      <div className="pottery-tools" role="group">
        {(["hand", "sponge", "wire"] as const).map((id) => (
          <button
            key={id}
            type="button"
            className={`pottery-chip ${tool === id ? "primary" : "ghost"}`}
            disabled={firing}
            onClick={() => setTool(id)}
          >
            {id === "hand" ? pt.toolHand : id === "sponge" ? pt.toolSponge : pt.toolWire}
          </button>
        ))}
      </div>
      <div className="pottery-actions">
        <button
          type="button"
          className="ghost"
          disabled={firing || undo.length === 0}
          onClick={doUndo}
        >
          {pt.undo}
        </button>
        <button type="button" className="primary" disabled={firing} onClick={startFire}>
          {firing ? pt.firing : pt.fire}
        </button>
        <button
          type="button"
          className="ghost"
          disabled={firing}
          onClick={() => {
            setResume({
              screen: "studio",
              claySize,
              profile: cloneProfile(profile),
              tool,
            });
            setScreen("setup");
          }}
        >
          {pt.studioBack}
        </button>
      </div>
      {firing ? (
        <div className="pottery-fire-veil" role="status" aria-live="polite">
          <p>{pt.firing}</p>
        </div>
      ) : null}
    </div>
  );
}

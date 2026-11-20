import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router";
import { getGame } from "../games/catalog";
import {
  GROW_MS,
  LIFT_MS,
  LIFT_ROWS,
  SETTLE_MS,
  extentRows,
  growStaggerMs,
  isSideCell,
  measureBoard,
  motionMs,
  nextFrame,
  placeCards,
  placePlayPieces,
  prefersReducedMotion,
  waitMs,
  type BoardPlace,
  type PlayPieceSize,
} from "../lib/board-expand";

export type BoardStageApi = {
  busy: boolean;
  currentSlug: string | null;
  playIn: boolean;
  sliding: boolean;
  showHome: boolean;
  showPlay: boolean;
  fadeOthers: boolean;
  seedSlug: string | null;
  cols: number;
  rows: number;
  openFromCard: (slug: string, place?: BoardPlace) => void;
  goHome: () => void;
  reportPlayRows: (rows: number) => void;
};

type Viewport = {
  left: number;
  top: number;
  cols: number;
  rows: number;
};

const BoardStageContext = createContext<BoardStageApi | null>(null);

export function useBoardExpand(): BoardStageApi {
  const value = useContext(BoardStageContext);
  if (!value) {
    throw new Error("useBoardExpand must be used within BoardExpandProvider");
  }
  return value;
}

function placeStyle(place: BoardPlace | undefined): CSSProperties | undefined {
  if (!place) return undefined;
  return {
    ["--card-col" as string]: String(place.column),
    ["--card-row" as string]: String(place.row),
    ["--card-w" as string]: String(place.width),
    ["--card-h" as string]: String(place.height),
  };
}

export function useBoardGrid(count: number): {
  boardStyle: CSSProperties;
  cardStyle: (index: number) => CSSProperties | undefined;
  places: BoardPlace[];
} {
  const { cols, rows } = useBoardExpand();
  const places = useMemo(() => placeCards(cols, rows, count), [cols, rows, count]);
  const boardStyle = useMemo<CSSProperties>(() => ({}), []);
  const cardStyle = useCallback((index: number) => placeStyle(places[index]), [places]);
  return { boardStyle, cardStyle, places };
}

export function usePlayLayout(pieces: PlayPieceSize[]): {
  places: BoardPlace[];
  pieceStyle: (index: number) => CSSProperties | undefined;
} {
  const { cols, reportPlayRows } = useBoardExpand();
  const origin = usePlayOrigin();
  const places = useMemo(
    () => placePlayPieces(cols, pieces, origin.column, origin.row),
    [cols, pieces, origin.column, origin.row],
  );

  useLayoutEffect(() => {
    reportPlayRows(extentRows(places, origin.row));
  }, [places, origin.row, reportPlayRows]);

  const pieceStyle = useCallback((index: number) => placeStyle(places[index]), [places]);
  return { places, pieceStyle };
}

const PlayOriginContext = createContext<{ column: number; row: number }>({
  column: 1,
  row: 1,
});

function usePlayOrigin(): { column: number; row: number } {
  return useContext(PlayOriginContext);
}

type FloorContextValue = {
  worldRef: { current: HTMLDivElement | null };
  style: CSSProperties;
  cells: ReactNode[];
  arriving: boolean;
};

const BoardFloorContext = createContext<FloorContextValue | null>(null);

type Props = {
  playSlug: string | undefined;
  isNotFound: boolean;
  children: ReactNode;
};

export function BoardExpandProvider({
  playSlug,
  isNotFound,
  children,
}: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const known = Boolean(playSlug && getGame(playSlug));
  const initialPlay = Boolean(playSlug) || isNotFound;

  const [viewport, setViewport] = useState<Viewport>({ left: 0, top: 0, cols: 1, rows: 1 });
  const [floorRows, setFloorRows] = useState(1);
  const [busy, setBusy] = useState(false);
  const [currentSlug, setCurrentSlug] = useState<string | null>(known ? playSlug! : null);
  const [showHome, setShowHome] = useState(!initialPlay);
  const [showPlay, setShowPlay] = useState(initialPlay);
  const [fadeOthers, setFadeOthers] = useState(false);
  const [lifting, setLifting] = useState(false);
  const [growing, setGrowing] = useState(false);
  const [shrinking, setShrinking] = useState(false);
  const [seed, setSeed] = useState<BoardPlace | null>(null);
  const [bornFromRow, setBornFromRow] = useState(0);
  const [playOrigin, setPlayOrigin] = useState<{ column: number; row: number }>({
    column: 1,
    row: 1,
  });

  const busyRef = useRef(false);
  const currentRef = useRef<string | null>(known ? playSlug! : null);
  const ownedNavRef = useRef<"open" | "home" | null>(null);
  const openedFromLobbyRef = useRef(false);
  const playExtentRef = useRef(0);
  const playOriginRef = useRef(playOrigin);
  const viewportRowsRef = useRef(1);
  const lastSeedRef = useRef<BoardPlace | null>(null);
  const worldRef = useRef<HTMLDivElement | null>(null);
  const snapScrollRef = useRef(false);
  const movingRef = useRef(false);

  playOriginRef.current = playOrigin;
  viewportRowsRef.current = viewport.rows;
  currentRef.current = currentSlug;

  const cols = Math.max(1, viewport.cols);
  const rows = Math.max(viewport.rows, floorRows);
  const sliding = lifting || growing || shrinking;
  const playIn = showPlay && !showHome;
  const seedSlug = fadeOthers || sliding ? currentSlug : null;

  const setBusyBoth = (value: boolean) => {
    busyRef.current = value;
    movingRef.current = value;
    setBusy(value);
  };

  const reportPlayRows = useCallback((needed: number) => {
    playExtentRef.current = Math.max(1, needed);
    if (movingRef.current) {
      const origin = playOriginRef.current.row;
      setFloorRows((prev) => Math.max(prev, origin + needed - 1, viewportRowsRef.current));
    } else if (showPlay && !showHome) {
      setFloorRows(Math.max(viewportRowsRef.current, needed));
    }
  }, [showPlay, showHome]);

  const measure = () => {
    const shell = document.querySelector<HTMLElement>(".shell");
    const main = document.querySelector<HTMLElement>(".main");
    if (!shell || !main) return null;
    const base = measureBoard(shell, main);
    setViewport(base);
    viewportRowsRef.current = base.rows;
    if (!movingRef.current) {
      const needed = playExtentRef.current;
      const origin = playOriginRef.current.row;
      const contentEnd = showPlay ? origin + Math.max(0, needed) - 1 : 0;
      setFloorRows(Math.max(base.rows, contentEnd));
    }
    return base;
  };

  useLayoutEffect(() => {
    measure();
    const shell = document.querySelector<HTMLElement>(".shell");
    const main = document.querySelector<HTMLElement>(".main");
    if (!shell || !main) return;
    const observer = new ResizeObserver(() => {
      measure();
    });
    observer.observe(shell);
    observer.observe(main);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    if (!snapScrollRef.current) return;
    snapScrollRef.current = false;
    const world = worldRef.current;
    if (world) world.scrollTop = 0;
  }, [playOrigin, showHome, showPlay]);

  const snapToGame = useCallback((slug: string) => {
    currentRef.current = slug;
    openedFromLobbyRef.current = false;
    lastSeedRef.current = null;
    setCurrentSlug(slug);
    setShowHome(false);
    setShowPlay(true);
    setFadeOthers(false);
    setLifting(false);
    setGrowing(false);
    setShrinking(false);
    setSeed(null);
    setBornFromRow(0);
    setPlayOrigin({ column: 1, row: 1 });
    playOriginRef.current = { column: 1, row: 1 };
    snapScrollRef.current = true;
  }, []);

  const snapToHome = useCallback(() => {
    currentRef.current = null;
    openedFromLobbyRef.current = false;
    lastSeedRef.current = null;
    playExtentRef.current = 0;
    setCurrentSlug(null);
    setShowHome(true);
    setShowPlay(false);
    setFadeOthers(false);
    setLifting(false);
    setGrowing(false);
    setShrinking(false);
    setSeed(null);
    setBornFromRow(0);
    setPlayOrigin({ column: 1, row: 1 });
    playOriginRef.current = { column: 1, row: 1 };
    setFloorRows(viewportRowsRef.current);
    snapScrollRef.current = true;
  }, []);

  useEffect(() => {
    if (ownedNavRef.current === "open" || ownedNavRef.current === "home") {
      ownedNavRef.current = null;
      return;
    }
    if (busyRef.current) return;
    if (isNotFound) {
      currentRef.current = null;
      setCurrentSlug(null);
      setShowHome(false);
      setShowPlay(true);
      setFadeOthers(false);
      setLifting(false);
      setGrowing(false);
      setSeed(null);
      setBornFromRow(0);
      setPlayOrigin({ column: 1, row: 1 });
      playOriginRef.current = { column: 1, row: 1 };
      return;
    }
    if (playSlug && getGame(playSlug)) {
      snapToGame(playSlug);
      return;
    }
    if (playSlug) {
      currentRef.current = null;
      setCurrentSlug(null);
      setShowHome(false);
      setShowPlay(true);
      setFadeOthers(false);
      setSeed(null);
      setPlayOrigin({ column: 1, row: 1 });
      playOriginRef.current = { column: 1, row: 1 };
      return;
    }
    snapToHome();
  }, [location.pathname, isNotFound, playSlug, snapToGame, snapToHome]);

  const openFromCard = useCallback(
    async (slug: string, place?: BoardPlace) => {
      if (busyRef.current) return;
      if (currentRef.current === slug) return;
      setBusyBoth(true);

      const finishOpen = () => {
        currentRef.current = slug;
        openedFromLobbyRef.current = true;
        lastSeedRef.current = place ?? lastSeedRef.current;
        setCurrentSlug(slug);
        setShowHome(false);
        setShowPlay(true);
        setFadeOthers(false);
        setLifting(false);
        setGrowing(false);
        setShrinking(false);
        setSeed(null);
        setBornFromRow(0);
        setPlayOrigin({ column: 1, row: 1 });
        playOriginRef.current = { column: 1, row: 1 };
        snapScrollRef.current = true;
        ownedNavRef.current = "open";
        navigate(`/play/${slug}`);
      };

      if (prefersReducedMotion() || !place) {
        finishOpen();
        setBusyBoth(false);
        return;
      }

      try {
        currentRef.current = slug;
        openedFromLobbyRef.current = true;
        lastSeedRef.current = place;
        ownedNavRef.current = "open";
        setCurrentSlug(slug);
        setSeed(place);
        setFadeOthers(true);
        setShowHome(true);
        navigate(`/play/${slug}`);

        await nextFrame();
        await nextFrame();
        const liftMs = motionMs(LIFT_MS);
        setLifting(true);
        if (liftMs) await waitMs(liftMs);

        const origin = { column: 1, row: place.row + place.height };
        playOriginRef.current = origin;
        setPlayOrigin(origin);
        const bornFrom = origin.row;
        setBornFromRow(bornFrom);
        const guessRows = Math.max(4, viewportRowsRef.current);
        setFloorRows(Math.max(viewportRowsRef.current, bornFrom + guessRows - 1));
        setShowPlay(true);
        setGrowing(true);

        await nextFrame();
        const world = worldRef.current;
        const shell = document.querySelector<HTMLElement>(".shell");
        const major = shell ? Number.parseFloat(getComputedStyle(shell).getPropertyValue("--board-major")) || 128 : 128;
        if (world) {
          const top = (bornFrom - 1) * major;
          world.scrollTo({ top, behavior: prefersReducedMotion() ? "auto" : "smooth" });
        }

        const needed = Math.max(playExtentRef.current, guessRows);
        setFloorRows(Math.max(viewportRowsRef.current, bornFrom + needed - 1));
        const lastStagger = growStaggerMs(cols, bornFrom + needed - 1, bornFrom);
        const growMs = motionMs(GROW_MS + lastStagger);
        if (growMs) await waitMs(growMs);

        setLifting(false);
        const settleMs = motionMs(SETTLE_MS);
        if (settleMs) await waitMs(settleMs);

        setGrowing(false);
        setBornFromRow(0);
        setShowHome(false);
        setFadeOthers(false);
        setSeed(null);
        playOriginRef.current = { column: 1, row: 1 };
        setPlayOrigin({ column: 1, row: 1 });
        setFloorRows(Math.max(viewportRowsRef.current, playExtentRef.current));
        snapScrollRef.current = true;
      } catch {
        finishOpen();
      } finally {
        setBusyBoth(false);
      }
    },
    [navigate, cols],
  );

  const goHome = useCallback(async () => {
    if (busyRef.current || !currentRef.current) return;
    setBusyBoth(true);
    const fromLobby = openedFromLobbyRef.current;
    const seedPlace = lastSeedRef.current;

    const finishHome = () => {
      ownedNavRef.current = "home";
      snapToHome();
      if (fromLobby) navigate(-1);
      else navigate("/");
    };

    if (prefersReducedMotion()) {
      finishHome();
      setBusyBoth(false);
      return;
    }

    try {
      if (seedPlace) {
        const origin = { column: 1, row: seedPlace.row + seedPlace.height };
        playOriginRef.current = origin;
        setPlayOrigin(origin);
        setShowHome(true);
        setFadeOthers(true);
        setSeed(seedPlace);
        setCurrentSlug(currentRef.current);
        await nextFrame();
        await nextFrame();
        setLifting(true);
        const liftMs = motionMs(LIFT_MS);
        if (liftMs) await waitMs(liftMs);
        setShrinking(true);
        setBornFromRow(origin.row);
        setShowPlay(false);
        playExtentRef.current = 0;
        setFloorRows(viewportRowsRef.current);
        const shrinkMs = motionMs(GROW_MS);
        if (shrinkMs) await waitMs(shrinkMs);
        setLifting(false);
        const settleMs = motionMs(SETTLE_MS);
        if (settleMs) await waitMs(settleMs);
        setShrinking(false);
        setBornFromRow(0);
        setSeed(null);
        setFadeOthers(false);
      }
    } catch {
      /* snap below */
    }

    finishHome();
    setBusyBoth(false);
  }, [navigate, snapToHome]);

  const api = useMemo<BoardStageApi>(
    () => ({
      busy,
      currentSlug,
      playIn,
      sliding,
      showHome,
      showPlay,
      fadeOthers,
      seedSlug,
      cols,
      rows,
      openFromCard,
      goHome,
      reportPlayRows,
    }),
    [
      busy,
      currentSlug,
      playIn,
      sliding,
      showHome,
      showPlay,
      fadeOthers,
      seedSlug,
      cols,
      rows,
      openFromCard,
      goHome,
      reportPlayRows,
    ],
  );

  const floorStyle = {
    ["--board-cols" as string]: String(cols),
    ["--board-rows" as string]: String(rows),
    ["--lift-rows" as string]: String(LIFT_ROWS),
  };

  const cells: ReactNode[] = [];
  for (let row = 1; row <= rows; row += 1) {
    for (let column = 1; column <= cols; column += 1) {
      const lift = Boolean(seed && lifting && isSideCell(column, row, seed));
      const born = Boolean(growing && bornFromRow > 0 && row >= bornFromRow);
      const unborn = Boolean(shrinking && bornFromRow > 0 && row >= bornFromRow);
      const delay = born || unborn ? growStaggerMs(column, row, bornFromRow) : 0;
      cells.push(
        <div
          key={`${column}:${row}`}
          className={`board-cell${lift ? " is-lift" : ""}${born ? " is-born" : ""}${unborn ? " is-unborn" : ""}`}
          style={{
            ["--c" as string]: column,
            ["--r" as string]: row,
            ["--born-delay" as string]: `${delay}ms`,
          }}
          data-c={column}
          data-r={row}
        />,
      );
    }
  }

  return (
    <BoardStageContext.Provider value={api}>
      <PlayOriginContext.Provider value={playOrigin}>
        <BoardFloorContext.Provider
          value={{
            worldRef,
            style: floorStyle,
            cells,
            arriving: growing,
          }}
        >
          {children}
        </BoardFloorContext.Provider>
      </PlayOriginContext.Provider>
    </BoardStageContext.Provider>
  );
}

export function BoardFloor({ children }: { children: ReactNode }) {
  const floor = useContext(BoardFloorContext);
  if (!floor) {
    throw new Error("BoardFloor must be used within BoardExpandProvider");
  }
  return (
    <div className="board-world" ref={floor.worldRef}>
      <div className={`board-floor${floor.arriving ? " is-arriving" : ""}`} style={floor.style}>
        {floor.cells}
        {children}
      </div>
    </div>
  );
}

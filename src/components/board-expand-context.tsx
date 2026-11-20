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
  SLIDE_MS,
  afterTransition,
  applyBoardOrigin,
  boardSlideSpan,
  layoutBoard,
  layoutShellBoard,
  motionMs,
  nextFrame,
  prefersReducedMotion,
  type BoardLayout,
} from "../lib/board-expand";

export type BoardStageApi = {
  busy: boolean;
  currentSlug: string | null;
  playIn: boolean;
  sliding: boolean;
  showHome: boolean;
  showPlay: boolean;
  openFromCard: (slug: string) => void;
  goHome: () => void;
};

const BoardStageContext = createContext<BoardStageApi | null>(null);

export function useBoardExpand(): BoardStageApi {
  const value = useContext(BoardStageContext);
  if (!value) {
    throw new Error("useBoardExpand must be used within BoardExpandProvider");
  }
  return value;
}

function boardStyleOf(layout: BoardLayout | null): CSSProperties {
  if (!layout) return {};
  return {
    ["--board-left" as string]: `${layout.left}px`,
    ["--board-top" as string]: `${layout.top}px`,
    ["--board-cols" as string]: String(layout.cols),
    ["--board-rows" as string]: String(layout.rows),
  };
}

function cardStyleOf(layout: BoardLayout | null, index: number): CSSProperties | undefined {
  const place = layout?.places[index];
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
} {
  const [layout, setLayout] = useState<BoardLayout | null>(null);

  useLayoutEffect(() => {
    const shell = document.querySelector<HTMLElement>(".shell");
    const main = document.querySelector<HTMLElement>(".main");
    if (!shell || !main) return;
    const sync = () => {
      setLayout(layoutBoard(shell, main, count));
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(shell);
    observer.observe(main);
    window.addEventListener("resize", sync);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [count]);

  const boardStyle = useMemo(() => boardStyleOf(layout), [layout]);
  const cardStyle = useCallback((index: number) => cardStyleOf(layout, index), [layout]);
  return { boardStyle, cardStyle };
}

export function useShellGrid(
  tileCount: number,
  boardIndex = -1,
): {
  boardStyle: CSSProperties;
  cardStyle: (index: number) => CSSProperties | undefined;
} {
  const [layout, setLayout] = useState<BoardLayout | null>(null);

  useLayoutEffect(() => {
    const shell = document.querySelector<HTMLElement>(".shell");
    const main = document.querySelector<HTMLElement>(".main");
    if (!shell || !main) return;
    const sync = () => {
      setLayout(layoutShellBoard(shell, main, tileCount, boardIndex));
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(shell);
    observer.observe(main);
    window.addEventListener("resize", sync);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [tileCount, boardIndex]);

  const boardStyle = useMemo(() => boardStyleOf(layout), [layout]);
  const cardStyle = useCallback((index: number) => cardStyleOf(layout, index), [layout]);
  return { boardStyle, cardStyle };
}

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
  const busyRef = useRef(false);
  const ownedNavRef = useRef<"open" | "home" | null>(null);
  const currentRef = useRef<string | null>(null);
  const openedFromLobbyRef = useRef(false);
  const shiftRef = useRef(0);

  const initialGame = playSlug && getGame(playSlug) ? playSlug : null;
  const initialPlay = Boolean(initialGame) || isNotFound;

  const [busy, setBusy] = useState(false);
  const [currentSlug, setCurrentSlug] = useState<string | null>(initialGame);
  const [sliding, setSliding] = useState(false);
  const [showHome, setShowHome] = useState(!initialPlay);
  const [showPlay, setShowPlay] = useState(initialPlay);
  const playIn = showPlay && !showHome;

  currentRef.current = currentSlug;

  const setBusyBoth = (value: boolean) => {
    busyRef.current = value;
    setBusy(value);
  };

  const writeShift = (px: number, animate: boolean) => {
    const shell = document.querySelector<HTMLElement>(".shell");
    if (!shell) return;
    shiftRef.current = px;
    if (animate) shell.classList.add("is-sliding");
    else shell.classList.remove("is-sliding");
    shell.style.setProperty("--board-shift-x", `${px}px`);
  };

  const measureSpan = () => {
    const shell = document.querySelector<HTMLElement>(".shell");
    const main = document.querySelector<HTMLElement>(".main");
    if (!shell || !main) return 0;
    applyBoardOrigin(shell, main);
    const span = boardSlideSpan(shell, main);
    shell.style.setProperty("--board-span-x", `${span}px`);
    return span;
  };

  const snapToGame = useCallback((slug: string) => {
    currentRef.current = slug;
    openedFromLobbyRef.current = false;
    setCurrentSlug(slug);
    setSliding(false);
    setShowHome(false);
    setShowPlay(true);
    writeShift(0, false);
  }, []);

  const snapToHome = useCallback(() => {
    currentRef.current = null;
    openedFromLobbyRef.current = false;
    setCurrentSlug(null);
    setSliding(false);
    setShowHome(true);
    setShowPlay(false);
    writeShift(0, false);
  }, []);

  useLayoutEffect(() => {
    const shell = document.querySelector<HTMLElement>(".shell");
    const main = document.querySelector<HTMLElement>(".main");
    if (!shell || !main) return;
    const sync = () => {
      measureSpan();
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(shell);
    observer.observe(main);
    window.addEventListener("resize", sync);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", sync);
    };
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
      setSliding(false);
      setShowHome(false);
      setShowPlay(true);
      writeShift(0, false);
      return;
    }
    if (playSlug && getGame(playSlug)) {
      snapToGame(playSlug);
      return;
    }
    if (playSlug) {
      currentRef.current = null;
      setCurrentSlug(null);
      setSliding(false);
      setShowHome(false);
      setShowPlay(true);
      writeShift(0, false);
      return;
    }
    snapToHome();
  }, [location.pathname, isNotFound, playSlug, snapToGame, snapToHome]);

  const openFromCard = useCallback(
    async (slug: string) => {
      if (busyRef.current) return;
      if (currentRef.current === slug) return;
      setBusyBoth(true);

      const finishOpen = () => {
        currentRef.current = slug;
        openedFromLobbyRef.current = true;
        setCurrentSlug(slug);
        setSliding(false);
        setShowHome(false);
        setShowPlay(true);
        writeShift(0, false);
        ownedNavRef.current = "open";
        navigate(`/play/${slug}`);
      };

      if (prefersReducedMotion()) {
        finishOpen();
        setBusyBoth(false);
        return;
      }

      try {
        const span = measureSpan();
        currentRef.current = slug;
        openedFromLobbyRef.current = true;
        ownedNavRef.current = "open";
        setCurrentSlug(slug);
        setShowHome(true);
        setShowPlay(true);
        writeShift(0, false);
        navigate(`/play/${slug}`);

        await nextFrame();
        await nextFrame();
        const ms = motionMs(SLIDE_MS);
        setSliding(true);
        writeShift(span, true);
        const track = document.querySelector<HTMLElement>(".board-track");
        if (track) await afterTransition(track, ms, "transform");
        else await new Promise((resolve) => setTimeout(resolve, ms + 80));

        setSliding(false);
        setShowHome(false);
        writeShift(0, false);
      } catch {
        finishOpen();
      } finally {
        setBusyBoth(false);
      }
    },
    [navigate],
  );

  const goHome = useCallback(async () => {
    if (busyRef.current || !currentRef.current) return;
    setBusyBoth(true);
    const fromLobby = openedFromLobbyRef.current;

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
      const span = measureSpan();
      setShowHome(true);
      setShowPlay(true);
      writeShift(span, false);
      await nextFrame();
      await nextFrame();
      const ms = motionMs(SLIDE_MS);
      setSliding(true);
      writeShift(0, true);
      const track = document.querySelector<HTMLElement>(".board-track");
      if (track) await afterTransition(track, ms, "transform");
      else await new Promise((resolve) => setTimeout(resolve, ms + 80));
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
      openFromCard,
      goHome,
    }),
    [busy, currentSlug, playIn, sliding, showHome, showPlay, openFromCard, goHome],
  );

  return (
    <BoardStageContext.Provider value={api}>
      {children}
    </BoardStageContext.Provider>
  );
}

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
  type RefObject,
} from "react";
import { useLocation, useNavigate } from "react-router";
import { getGame } from "../games/catalog";
import {
  EXPAND_MS,
  afterTransition,
  applyFixedBox,
  applySqueeze,
  boxTransition,
  clearAllSqueezes,
  clearFixedBox,
  clearFlyer,
  clearSqueeze,
  findCard,
  layoutBoard,
  makeFlyer,
  motionMs,
  nextFrame,
  otherCards,
  playDestRect,
  prefersReducedMotion,
  type BoardLayout,
} from "../lib/board-expand";

export type BoardExpandApi = {
  busy: boolean;
  currentSlug: string | null;
  embedSlug: string | null;
  ghostSlug: string | null;
  expanding: boolean;
  playIn: boolean;
  playRef: RefObject<HTMLDivElement | null>;
  openFromCard: (slug: string, card: HTMLElement) => void;
  goHome: () => void;
};

const BoardExpandContext = createContext<BoardExpandApi | null>(null);

export function useBoardExpand(): BoardExpandApi {
  const value = useContext(BoardExpandContext);
  if (!value) {
    throw new Error("useBoardExpand must be used within BoardExpandProvider");
  }
  return value;
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

  const boardStyle = useMemo<CSSProperties>(() => {
    if (!layout) return {};
    return {
      ["--board-left" as string]: `${layout.left}px`,
      ["--board-top" as string]: `${layout.top}px`,
      ["--board-cols" as string]: String(layout.cols),
      ["--board-rows" as string]: String(layout.rows),
    };
  }, [layout]);

  const cardStyle = useCallback(
    (index: number): CSSProperties | undefined => {
      const place = layout?.places[index];
      if (!place) return undefined;
      return {
        ["--card-col" as string]: String(place.column),
        ["--card-row" as string]: String(place.row),
        ["--card-w" as string]: String(place.width),
        ["--card-h" as string]: String(place.height),
      };
    },
    [layout],
  );

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
  const playRef = useRef<HTMLDivElement | null>(null);
  const flyerRef = useRef<HTMLElement | null>(null);
  const startBoxRef = useRef<DOMRect | null>(null);
  const busyRef = useRef(false);
  const ownedNavRef = useRef<"open" | "home" | null>(null);
  const currentRef = useRef<string | null>(null);
  const openedFromLobbyRef = useRef(false);

  const initialGame = playSlug && getGame(playSlug) ? playSlug : null;
  const initialPlayVisible = Boolean(playSlug) || isNotFound;

  const [busy, setBusy] = useState(false);
  const [currentSlug, setCurrentSlug] = useState<string | null>(initialGame);
  const [embedSlug, setEmbedSlug] = useState<string | null>(initialGame);
  const [ghostSlug, setGhostSlug] = useState<string | null>(initialGame);
  const [expanding, setExpanding] = useState(false);
  const [playIn, setPlayIn] = useState(initialPlayVisible);

  currentRef.current = currentSlug;

  const setBusyBoth = (value: boolean) => {
    busyRef.current = value;
    setBusy(value);
  };

  const dropFlyer = () => {
    clearFlyer(flyerRef.current);
    flyerRef.current = null;
  };

  const snapToGame = useCallback((slug: string) => {
    dropFlyer();
    clearAllSqueezes();
    currentRef.current = slug;
    openedFromLobbyRef.current = false;
    setCurrentSlug(slug);
    setEmbedSlug(slug);
    setGhostSlug(slug);
    setExpanding(false);
    setPlayIn(true);
    startBoxRef.current = null;
    const play = playRef.current;
    if (play) clearFixedBox(play);
  }, []);

  const snapToHome = useCallback(() => {
    dropFlyer();
    clearAllSqueezes();
    currentRef.current = null;
    openedFromLobbyRef.current = false;
    setCurrentSlug(null);
    setEmbedSlug(null);
    setGhostSlug(null);
    setExpanding(false);
    setPlayIn(false);
    startBoxRef.current = null;
    const play = playRef.current;
    if (play) clearFixedBox(play);
  }, []);

  useLayoutEffect(() => {
    if (!expanding) return;
    const play = playRef.current;
    const box = startBoxRef.current;
    if (!play || !box) return;
    applyFixedBox(play, box);
    play.style.opacity = "1";
    play.style.transition = "none";
  }, [expanding]);

  useEffect(() => {
    if (busyRef.current) return;
    if (ownedNavRef.current === "open" || ownedNavRef.current === "home") {
      ownedNavRef.current = null;
      return;
    }
    if (isNotFound) {
      snapToHome();
      setPlayIn(true);
      return;
    }
    if (playSlug && getGame(playSlug)) {
      snapToGame(playSlug);
      return;
    }
    if (playSlug) {
      snapToHome();
      setPlayIn(true);
      return;
    }
    snapToHome();
  }, [location.pathname, isNotFound, playSlug, snapToGame, snapToHome]);

  useEffect(() => {
    return () => {
      clearFlyer(flyerRef.current);
      flyerRef.current = null;
    };
  }, []);

  const openFromCard = useCallback(
    async (slug: string, card: HTMLElement) => {
      if (busyRef.current) return;
      if (currentRef.current === slug) return;
      setBusyBoth(true);
      setEmbedSlug(slug);

      const finishOpen = () => {
        currentRef.current = slug;
        openedFromLobbyRef.current = true;
        setCurrentSlug(slug);
        setGhostSlug(slug);
        setEmbedSlug(slug);
        setExpanding(false);
        setPlayIn(true);
        ownedNavRef.current = "open";
        navigate(`/play/${slug}`);
      };

      if (prefersReducedMotion()) {
        finishOpen();
        setBusyBoth(false);
        return;
      }

      try {
        const from = card.getBoundingClientRect();
        startBoxRef.current = new DOMRect(from.left, from.top, from.width, from.height);
        const dest = playDestRect();
        otherCards(slug).forEach((el) => applySqueeze(el, from, dest));
        const { fly } = makeFlyer(card);
        flyerRef.current = fly;

        currentRef.current = slug;
        openedFromLobbyRef.current = true;
        ownedNavRef.current = "open";
        setCurrentSlug(slug);
        setGhostSlug(slug);
        setExpanding(true);
        setPlayIn(true);
        navigate(`/play/${slug}`);

        await nextFrame();
        await nextFrame();

        const play = playRef.current;
        const start = startBoxRef.current ?? from;
        const destNow = playDestRect();
        const radius = getComputedStyle(card).borderRadius;
        const ms = motionMs(EXPAND_MS);

        if (play) {
          applyFixedBox(play, start);
          play.style.opacity = "1";
          play.style.borderRadius = radius;
          play.style.transition = "none";
          void play.offsetWidth;
          play.style.transition = boxTransition(ms, 0);
          applyFixedBox(play, destNow);
          play.style.borderRadius = "0px";
        }

        fly.style.transition = "none";
        applyFixedBox(fly, start);
        fly.style.opacity = "1";
        void fly.offsetWidth;
        fly.style.transition = boxTransition(
          ms,
          Math.round(ms * 0.72),
          Math.round(ms * 0.28),
        );
        fly.classList.add("is-expanding");
        applyFixedBox(fly, destNow);
        fly.style.opacity = "0";
        fly.style.borderRadius = "0px";

        await afterTransition(fly, ms, "width");
        dropFlyer();
        if (play) clearFixedBox(play);
        setExpanding(false);
      } catch {
        dropFlyer();
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
    const id = currentRef.current;
    const fromLobby = openedFromLobbyRef.current;
    const card = findCard(id);
    const play = playRef.current;

    const finishHome = () => {
      ownedNavRef.current = "home";
      snapToHome();
      if (fromLobby) {
        navigate(-1);
      } else {
        navigate("/");
      }
    };

    if (prefersReducedMotion() || !card || !play) {
      finishHome();
      setBusyBoth(false);
      return;
    }

    try {
      const dest = playDestRect();
      const target = card.getBoundingClientRect();
      startBoxRef.current = dest;
      const radius = getComputedStyle(card).borderRadius;
      const { fly } = makeFlyer(card);
      flyerRef.current = fly;
      applyFixedBox(fly, dest);
      fly.style.opacity = "0";
      fly.style.borderRadius = "0px";
      fly.classList.add("is-expanding");
      void fly.offsetWidth;

      setExpanding(true);
      applyFixedBox(play, dest);
      play.style.opacity = "1";
      play.style.borderRadius = "0px";
      void play.offsetWidth;

      const ms = motionMs(EXPAND_MS);
      play.style.transition = boxTransition(ms, Math.round(ms * 0.7));
      fly.style.transition = boxTransition(
        ms,
        Math.round(ms * 0.7),
        0,
      );

      applyFixedBox(play, target);
      play.style.opacity = "0";
      play.style.borderRadius = radius;

      applyFixedBox(fly, target);
      fly.style.opacity = "1";
      fly.style.borderRadius = radius;

      otherCards(id).forEach(clearSqueeze);

      await afterTransition(fly, ms, "width");
      dropFlyer();
      clearFixedBox(play);
    } catch {
      dropFlyer();
    }

    finishHome();
    setBusyBoth(false);
  }, [navigate, snapToHome]);

  const api = useMemo<BoardExpandApi>(
    () => ({
      busy,
      currentSlug,
      embedSlug,
      ghostSlug,
      expanding,
      playIn,
      playRef,
      openFromCard,
      goHome,
    }),
    [
      busy,
      currentSlug,
      embedSlug,
      ghostSlug,
      expanding,
      playIn,
      openFromCard,
      goHome,
    ],
  );

  return (
    <BoardExpandContext.Provider value={api}>
      {children}
    </BoardExpandContext.Provider>
  );
}

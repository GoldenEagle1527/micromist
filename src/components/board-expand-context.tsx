import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
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
  makeFlyer,
  motionMs,
  otherCards,
  playDestRect,
  prefersReducedMotion,
  wait,
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

export function useBoardGrid(): void {
  useLayoutEffect(() => {
    const shell = document.querySelector<HTMLElement>(".shell");
    const grid = document.querySelector<HTMLElement>(".grid");
    if (!shell || !grid) return;
    const sync = () => {
      const cell =
        parseFloat(getComputedStyle(shell).getPropertyValue("--board-cell")) ||
        32;
      const card = grid.querySelector<HTMLElement>(".card:not(.is-fly)");
      if (!card) return;
      const rect = card.getBoundingClientRect();
      const origin = shell.getBoundingClientRect();
      const shiftX = ((rect.left - origin.left) % cell + cell) % cell;
      const shiftY = ((rect.top - origin.top) % cell + cell) % cell;
      shell.style.setProperty("--board-shift-x", `${shiftX}px`);
      shell.style.setProperty("--board-shift-y", `${shiftY}px`);
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(shell);
    observer.observe(grid);
    window.addEventListener("resize", sync);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, []);
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
    const play = playRef.current;
    if (play) clearFixedBox(play);
  }, []);

  useEffect(() => {
    if (ownedNavRef.current === "open") {
      ownedNavRef.current = null;
      return;
    }
    if (ownedNavRef.current === "home") {
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
      setGhostSlug(slug);

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
        const dest = playDestRect();
        otherCards(slug).forEach((el) => applySqueeze(el, from, dest));
        const { fly } = makeFlyer(card);
        flyerRef.current = fly;

        currentRef.current = slug;
        openedFromLobbyRef.current = true;
        setCurrentSlug(slug);
        ownedNavRef.current = "open";
        navigate(`/play/${slug}`);

        await wait(0);
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve());
        });

        const play = playRef.current;
        const radius = getComputedStyle(card).borderRadius;
        if (play) {
          applyFixedBox(play, from);
          play.style.opacity = "1";
          play.style.borderRadius = radius;
        }

        setExpanding(true);
        setPlayIn(true);

        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve());
        });

        const destNow = playDestRect();
        const ms = motionMs(EXPAND_MS);
        if (play) {
          void play.offsetWidth;
          play.style.transition = boxTransition(ms);
          applyFixedBox(play, destNow);
          play.style.borderRadius = "0px";
        }

        fly.style.transition = boxTransition(ms);
        fly.classList.add("is-expanding");
        applyFixedBox(fly, destNow);
        fly.style.opacity = "0";
        fly.style.borderRadius = "0px";

        await afterTransition(fly, ms, "width");
        dropFlyer();
        if (play) {
          clearFixedBox(play);
        }
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
      const transition = boxTransition(ms);
      play.style.transition = transition;
      fly.style.transition = transition;

      applyFixedBox(play, target);
      play.style.opacity = "0";
      play.style.borderRadius = radius;

      applyFixedBox(fly, target);
      fly.style.opacity = "1";
      fly.style.borderRadius = radius;

      otherCards(id).forEach(clearSqueeze);

      await afterTransition(play, ms, "width");
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

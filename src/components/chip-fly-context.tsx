import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useLocation, useNavigate } from "react-router";
import { getGame } from "../games/catalog";
import {
  afterTransition,
  chipCenter,
  clearFlyer,
  COLLAPSE_MS,
  FLY_MS,
  makeFlyer,
  motionMs,
  PAGE_MS,
  prefersReducedMotion,
  prepareCollapse,
  prepareExpand,
  wait,
} from "../lib/chip-fly";

export const preloadPlayPage = () => import("../pages/PlayPage");

export type ChipFlyApi = {
  busy: boolean;
  currentSlug: string | null;
  ghostSlug: string | null;
  dimOthers: boolean;
  dockReady: boolean;
  dockHot: boolean;
  homeOut: boolean;
  playIn: boolean;
  wellRef: RefObject<HTMLButtonElement | null>;
  openFromCard: (slug: string, card: HTMLElement) => void;
  goHome: () => void;
};

const ChipFlyContext = createContext<ChipFlyApi | null>(null);

export function useChipFly(): ChipFlyApi {
  const value = useContext(ChipFlyContext);
  if (!value) {
    throw new Error("useChipFly must be used within ChipFlyProvider");
  }
  return value;
}

function findCard(slug: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `.card[data-game="${CSS.escape(slug)}"]`,
  );
}

type Props = {
  playSlug: string | undefined;
  isNotFound: boolean;
  children: ReactNode;
};

export function ChipFlyProvider({
  playSlug,
  isNotFound,
  children,
}: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const wellRef = useRef<HTMLButtonElement | null>(null);
  const flyerRef = useRef<HTMLElement | null>(null);
  const busyRef = useRef(false);
  const ownedNavRef = useRef<"open" | "home" | null>(null);
  const currentRef = useRef<string | null>(null);

  const initialGame =
    playSlug && getGame(playSlug) ? playSlug : null;
  const initialPlayVisible = Boolean(playSlug) || isNotFound;

  const [busy, setBusy] = useState(false);
  const [currentSlug, setCurrentSlug] = useState<string | null>(initialGame);
  const [ghostSlug, setGhostSlug] = useState<string | null>(initialGame);
  const [dimOthers, setDimOthers] = useState(Boolean(initialGame));
  const [dockReady, setDockReady] = useState(Boolean(initialGame));
  const [dockHot, setDockHot] = useState(Boolean(initialGame));
  const [homeOut, setHomeOut] = useState(initialPlayVisible && !isNotFound);
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
    currentRef.current = slug;
    setCurrentSlug(slug);
    setGhostSlug(slug);
    setDimOthers(true);
    setDockReady(true);
    setDockHot(true);
    setHomeOut(true);
    setPlayIn(true);
  }, []);

  const snapToHome = useCallback(() => {
    dropFlyer();
    currentRef.current = null;
    setCurrentSlug(null);
    setGhostSlug(null);
    setDimOthers(false);
    setDockReady(false);
    setDockHot(false);
    setHomeOut(false);
    setPlayIn(false);
  }, []);

  useEffect(() => {
    if (ownedNavRef.current === "open") {
      ownedNavRef.current = null;
      requestAnimationFrame(() => {
        setHomeOut(true);
        setPlayIn(true);
      });
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
      setHomeOut(true);
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
      void preloadPlayPage();
      setDimOthers(true);

      const finishOpen = () => {
        currentRef.current = slug;
        setCurrentSlug(slug);
        setGhostSlug(slug);
        setDockReady(true);
        setDockHot(true);
        ownedNavRef.current = "open";
        navigate(`/play/${slug}`);
      };

      if (prefersReducedMotion()) {
        finishOpen();
        setHomeOut(true);
        setPlayIn(true);
        setBusyBoth(false);
        return;
      }

      const well = wellRef.current;
      if (!well) {
        finishOpen();
        setHomeOut(true);
        setPlayIn(true);
        setBusyBoth(false);
        return;
      }

      try {
        const { fly, scale, origin } = makeFlyer(card);
        flyerRef.current = fly;
        setGhostSlug(slug);
        const dest = chipCenter(well);
        const collapse = motionMs(COLLAPSE_MS);
        const flyMs = motionMs(FLY_MS);
        const pageMs = motionMs(PAGE_MS);

        void fly.offsetWidth;
        fly.classList.add("is-collapsing");
        fly.style.transition = `transform ${collapse}ms var(--ease-out), background ${collapse}ms var(--ease-out), border-color ${collapse}ms var(--ease-out), box-shadow ${collapse}ms var(--ease-out)`;
        fly.style.transform = `scale(${scale})`;
        prepareCollapse(fly, collapse);
        await afterTransition(fly, collapse);

        fly.classList.remove("is-collapsing");
        fly.classList.add("is-flying");
        const dx = dest.x - origin.x;
        const dy = dest.y - origin.y;
        setDockHot(true);
        fly.style.transition = `transform ${flyMs}ms var(--ease-soft)`;
        fly.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
        await afterTransition(fly, flyMs);

        dropFlyer();
        finishOpen();
        await wait(pageMs);
      } catch {
        finishOpen();
        setHomeOut(true);
        setPlayIn(true);
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

    setPlayIn(false);
    setHomeOut(false);
    await wait(prefersReducedMotion() ? 0 : 200);

    const finishHome = () => {
      ownedNavRef.current = "home";
      snapToHome();
      navigate("/");
    };

    const card = findCard(id);
    const well = wellRef.current;
    if (prefersReducedMotion() || !card || !well) {
      finishHome();
      setBusyBoth(false);
      return;
    }

    try {
      const start = chipCenter(well);
      const end = chipCenter(card.querySelector(".chip-ic") ?? card);
      const rect = card.getBoundingClientRect();
      const { fly, scale, originOffset } = makeFlyer(card);
      flyerRef.current = fly;
      fly.classList.add("is-flying");
      const dx0 = start.x - (rect.left + originOffset.x);
      const dy0 = start.y - (rect.top + originOffset.y);
      fly.style.transition = "none";
      fly.style.transform = `translate(${dx0}px, ${dy0}px) scale(${scale})`;
      void fly.offsetWidth;

      setDockReady(false);
      setDockHot(false);
      const flyMs = motionMs(FLY_MS);
      const collapse = motionMs(COLLAPSE_MS);
      const dx1 = end.x - (rect.left + originOffset.x);
      const dy1 = end.y - (rect.top + originOffset.y);
      fly.style.transition = `transform ${flyMs}ms var(--ease-soft)`;
      fly.style.transform = `translate(${dx1}px, ${dy1}px) scale(${scale})`;
      await afterTransition(fly, flyMs);

      fly.classList.remove("is-flying");
      fly.classList.add("is-collapsing");
      fly.style.transition = `transform ${collapse}ms var(--ease-out), background ${collapse}ms var(--ease-out), border-color ${collapse}ms var(--ease-out), box-shadow ${collapse}ms var(--ease-out)`;
      fly.style.transform = `translate(${dx1}px, ${dy1}px) scale(1)`;
      prepareExpand(fly, collapse);
      fly.classList.remove("is-collapsing");
      await afterTransition(fly, collapse);
    } catch {
      // Fall through to a clean home state.
    }

    dropFlyer();
    finishHome();
    setBusyBoth(false);
  }, [navigate, snapToHome]);

  const api = useMemo<ChipFlyApi>(
    () => ({
      busy,
      currentSlug,
      ghostSlug,
      dimOthers,
      dockReady,
      dockHot,
      homeOut,
      playIn,
      wellRef,
      openFromCard,
      goHome,
    }),
    [
      busy,
      currentSlug,
      ghostSlug,
      dimOthers,
      dockReady,
      dockHot,
      homeOut,
      playIn,
      openFromCard,
      goHome,
    ],
  );

  return (
    <ChipFlyContext.Provider value={api}>{children}</ChipFlyContext.Provider>
  );
}

import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router";
import { Shell } from "./components/Shell";
import { HomePage } from "./pages/HomePage";
import { NotFoundPage } from "./pages/NotFoundPage";

const PlayPage = lazy(async () => {
  const module = await import("./pages/PlayPage");
  return { default: module.PlayPage };
});

const RoomsPage = lazy(async () => {
  const module = await import("./pages/RoomsPage");
  return { default: module.RoomsPage };
});

export function App() {
  return (
    <Suspense fallback={<p className="lede">载入中…</p>}>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<HomePage />} />
          <Route path="play/:slug" element={<PlayPage />} />
          <Route path="rooms" element={<RoomsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

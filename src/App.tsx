import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router";
import { Shell } from "./components/Shell";
import { useLocale } from "./i18n";
import { HomePage } from "./pages/HomePage";
import { NotFoundPage } from "./pages/NotFoundPage";

const PlayPage = lazy(async () => {
  const module = await import("./pages/PlayPage");
  return { default: module.PlayPage };
});

export function App() {
  const { t } = useLocale();
  return (
    <Suspense fallback={<p className="lede">{t.loading}</p>}>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<HomePage />} />
          <Route path="play/:slug" element={<PlayPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

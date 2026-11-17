import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router";
import { Shell } from "./components/Shell";
import { useLocale } from "./i18n";
import { NotFoundPage } from "./pages/NotFoundPage";

const PlayPage = lazy(async () => {
  const module = await import("./pages/PlayPage");
  return { default: module.PlayPage };
});

export function App() {
  const { t } = useLocale();
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={null} />
        <Route
          path="play/:slug"
          element={
            <Suspense fallback={<p className="lede">{t.loading}</p>}>
              <PlayPage />
            </Suspense>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

import { Link } from "react-router";
import { useLocale } from "../i18n";

export function NotFoundPage() {
  const { t } = useLocale();
  return (
    <section className="hero">
      <h1>{t.notFoundTitle}</h1>
      <p className="lede">
        {t.notFoundBody} <Link to="/">{t.notFoundLink}</Link>
      </p>
    </section>
  );
}

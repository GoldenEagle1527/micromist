import { Link } from "react-router";

export function NotFoundPage() {
  return (
    <section className="hero">
      <h1>雾散了</h1>
      <p className="lede">
        这条路径没有对应的页面。<Link to="/">回微渺首页</Link>
      </p>
    </section>
  );
}
